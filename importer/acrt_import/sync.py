"""Compare a Dataset with the database and apply only what is safe.

A row is written when it is new, or when the importer wrote its current contents earlier and nobody has changed it
since. A row that differs from what the importer last wrote was edited by hand and is left alone and reported. Rows
the export no longer mentions are reported and never deleted.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field

import psycopg
from psycopg.types.json import Jsonb

from .ids import canonical_hash
from .model import SPECS, WARNING, WRITE_ORDER, Dataset, Entity, Issue, Spec

CHUNK = 500
STATE_TABLES = ("content_import_runs", "content_import_state", "content_import_issues")


@dataclass
class Decision:
    entity: Entity
    action: str  # create | update | unchanged | conflict | blocked
    reason: str = ""
    exists: bool = False  # create on an existing row that is still empty (answer keys)
    columns: tuple[str, ...] = ()
    previous: dict | None = None
    current_hash: str | None = None
    adopt: bool = False  # unchanged, but the state row is missing or stale


@dataclass
class Outcome:
    decisions: dict[str, list[Decision]] = field(default_factory=dict)
    orphans: dict[str, list[str]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)

    def counts(self) -> dict[str, dict[str, int]]:
        return {t: dict(Counter(d.action for d in ds)) for t, ds in self.decisions.items()}

    def total(self, action: str) -> int:
        return sum(1 for ds in self.decisions.values() for d in ds if d.action == action)


def connect(dsn: str, *, read_only: bool = False, autocommit: bool = False) -> psycopg.Connection:
    conn = psycopg.connect(dsn, autocommit=autocommit, connect_timeout=10)
    if read_only:
        conn.read_only = True
    return conn


def has_state_tables(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("select bool_and(to_regclass('public.' || t) is not null) from unnest(%s::text[]) t",
                    (list(STATE_TABLES),))
        return bool(cur.fetchone()[0])


def _plain(value):
    """JSON-safe copy (UUIDs and datetimes become text) so it hashes and stores the same way every time."""
    return json.loads(json.dumps(value, default=str))


def _chunks(items: list, size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _load_rows(conn, spec: Spec, ids: list[str]) -> dict[str, dict]:
    cols = [spec.pk, *spec.owned, *spec.protected]
    sql = f"select {', '.join(cols)} from public.{spec.table} where {spec.pk} = any(%s::uuid[])"
    rows: dict[str, dict] = {}
    with conn.cursor() as cur:
        for part in _chunks(ids):
            cur.execute(sql, (part,))
            for values in cur.fetchall():
                row = dict(zip(cols, values))
                rows[str(row[spec.pk])] = row
    return rows


def _load_state(conn, entity_type: str, ids: list[str]) -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    sql = ("select entity_id::text, source_hash, written_hash from public.content_import_state "
           "where entity_type = %s and entity_id = any(%s::uuid[])")
    with conn.cursor() as cur:
        for part in _chunks(ids):
            cur.execute(sql, (entity_type, part))
            for entity_id, source_hash, written_hash in cur.fetchall():
                out[entity_id] = (source_hash, written_hash)
    return out


def _attempted_sets(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("select to_regclass('public.mcq_attempts') is not null")
        if not cur.fetchone()[0]:
            return set()
        cur.execute("select distinct mcq_set_id::text from public.mcq_attempts")
        return {r[0] for r in cur.fetchall()}


def _option_ids(options) -> list[str]:
    return sorted(str(o.get("id")) for o in (options or []))


def classify(conn, spec: Spec, entities: list[Entity], *, use_state: bool, overwrite: set[str],
             attempted_sets: set[str]) -> list[Decision]:
    ids = [e.id for e in entities]
    rows = _load_rows(conn, spec, ids)
    state = _load_state(conn, spec.entity_type, ids) if use_state else {}
    decisions: list[Decision] = []

    for entity in entities:
        row = rows.get(entity.id)
        src_hash = entity.source_hash
        if row is None:
            decisions.append(Decision(entity, "create", "new row"))
            continue
        current = _plain({c: row[c] for c in spec.owned})
        if spec.null_is_missing and all(v is None for v in current.values()):
            decisions.append(Decision(entity, "create", "row exists and is still empty", exists=True))
            continue
        current_hash = canonical_hash(current)
        st = state.get(entity.id)
        if current_hash == src_hash:
            adopt = use_state and (st is None or st != (src_hash, src_hash))
            decisions.append(Decision(entity, "unchanged", current_hash=current_hash, adopt=adopt))
            continue

        differing = tuple(c for c in spec.owned if _plain(entity.payload.get(c)) != current.get(c))
        base = {"columns": differing, "previous": current, "current_hash": current_hash}
        if entity.id in overwrite:
            decisions.append(Decision(entity, "update", "overwrite requested for this id", **base))
        elif any(row.get(c) for c in spec.protected):
            decisions.append(Decision(entity, "conflict", "a person has taken this row over", **base))
        elif st is None:
            decisions.append(Decision(entity, "conflict", "row exists but was not written by this importer", **base))
        elif current_hash != st[1]:
            decisions.append(Decision(entity, "conflict", "edited since the last import", **base))
        elif (spec.entity_type == "mcq" and "options" in differing
              and entity.payload["mcq_set_id"] in attempted_sets
              and _option_ids(entity.payload["options"]) != _option_ids(current.get("options"))):
            decisions.append(Decision(entity, "blocked", "option ids change on a set students have attempted", **base))
        else:
            decisions.append(Decision(entity, "update", "source changed", **base))
    return decisions


def find_orphans(conn, spec: Spec, entities: list[Entity]) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(f"select {spec.pk}::text from public.{spec.table}")
        have = {r[0] for r in cur.fetchall()}
    return sorted(have - {e.id for e in entities})


def plan(conn, ds: Dataset, *, use_state: bool, overwrite: set[str] = frozenset()) -> Outcome:  # type: ignore[assignment]
    out = Outcome()
    attempted = _attempted_sets(conn)
    for entity_type in WRITE_ORDER:
        spec = SPECS[entity_type]
        entities = ds.entities[entity_type]
        out.decisions[entity_type] = classify(conn, spec, entities, use_state=use_state,
                                              overwrite=set(overwrite), attempted_sets=attempted)
        orphans = find_orphans(conn, spec, entities)
        if orphans:
            out.orphans[entity_type] = orphans
            out.issues.append(Issue(
                "info", "orphan_in_database",
                f"{len(orphans)} {entity_type} row(s) exist that the export does not mention; left untouched",
                entity_type=entity_type, context={"count": len(orphans), "examples": orphans[:5]}))
    for decisions in out.decisions.values():
        for d in decisions:
            if d.action in ("conflict", "blocked"):
                out.issues.append(Issue(
                    WARNING, "conflict_edited" if d.action == "conflict" else "blocked_by_attempts",
                    f"{d.reason}; not written", entity_type=d.entity.entity_type, entity_id=d.entity.id,
                    source_path=d.entity.source_path, context={"columns": list(d.columns)}))
    return out


def ensure_answer_key_placeholders(conn, mcq_ids: list[str]) -> int:
    """A null row per question so staff can see which questions still need a key. Existing keys are untouched."""
    created = 0
    with conn.cursor() as cur:
        for part in _chunks(mcq_ids):
            cur.execute(
                "insert into public.mcq_answer_keys (mcq_id, answer_key) "
                "select m, null from unnest(%s::uuid[]) m "
                "where exists (select 1 from public.mcqs where id = m) on conflict (mcq_id) do nothing",
                (part,))
            created += cur.rowcount
    return created


def _value(spec: Spec, column: str, value):
    return Jsonb(value) if column in spec.json_cols and value is not None else value


def _upsert_state(cur, spec: Spec, entity: Entity, written_hash: str, previous: dict | None, run_id) -> None:
    keep = None if spec.secret or previous is None else Jsonb(_plain(previous))
    cur.execute(
        "insert into public.content_import_state "
        "(entity_type, entity_id, source_hash, written_hash, previous_row, run_id, imported_at) "
        "values (%s, %s, %s, %s, %s, %s, now()) "
        "on conflict (entity_type, entity_id) do update set source_hash = excluded.source_hash, "
        "written_hash = excluded.written_hash, previous_row = excluded.previous_row, "
        "run_id = excluded.run_id, imported_at = now()",
        (spec.entity_type, entity.id, entity.source_hash, written_hash, keep, run_id))


def apply(conn, outcome: Outcome, run_id) -> Counter:
    """Write the decided rows inside the caller's transaction. Returns what was done."""
    done: Counter = Counter()
    with conn.cursor() as cur:
        for entity_type in (*WRITE_ORDER, "answer_key"):
            spec = SPECS[entity_type]
            for d in outcome.decisions.get(entity_type, []):
                entity = d.entity
                if d.action == "create" and not d.exists:
                    cols = [spec.pk, *spec.owned]
                    values = [entity.id] + [_value(spec, c, entity.payload[c]) for c in spec.owned]
                    cur.execute(
                        f"insert into public.{spec.table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                        values)
                    _upsert_state(cur, spec, entity, entity.source_hash, None, run_id)
                    done[f"{entity_type}.created"] += 1
                elif d.action in ("create", "update"):
                    # Re-read under a row lock: a person may have saved an edit since the plan was made.
                    cur.execute(f"select {', '.join(spec.owned)} from public.{spec.table} where {spec.pk} = %s for update",
                                (entity.id,))
                    locked = cur.fetchone()
                    now_hash = canonical_hash(_plain(dict(zip(spec.owned, locked)))) if locked else None
                    expected = d.current_hash if d.action == "update" else now_hash
                    filled_meanwhile = d.exists and locked is not None and any(v is not None for v in locked)
                    if locked is None or now_hash != expected or filled_meanwhile:
                        done[f"{entity_type}.raced"] += 1
                        continue
                    sets = [f"{c} = %s" for c in spec.owned] + (["updated_at = now()"] if spec.touch else [])
                    cur.execute(
                        f"update public.{spec.table} set {', '.join(sets)} where {spec.pk} = %s",
                        [_value(spec, c, entity.payload[c]) for c in spec.owned] + [entity.id])
                    _upsert_state(cur, spec, entity, entity.source_hash, d.previous, run_id)
                    done[f"{entity_type}.{'filled' if d.action == 'create' else 'updated'}"] += 1
                elif d.action == "unchanged" and d.adopt:
                    _upsert_state(cur, spec, entity, entity.source_hash, None, run_id)
                    done[f"{entity_type}.adopted"] += 1
                else:
                    done[f"{entity_type}.{d.action}"] += 1
    return done


def restore(conn, run_id: str, *, apply_changes: bool) -> tuple[list[tuple[str, str]], list[tuple[str, str]], list[tuple[str, str]]]:
    """Revert the rows a run updated, but only those nobody has edited since. Returns (reverted, skipped, created)."""
    reverted: list[tuple[str, str]] = []
    skipped: list[tuple[str, str]] = []
    created: list[tuple[str, str]] = []
    with conn.cursor() as cur:
        cur.execute("select entity_type, entity_id::text, written_hash, previous_row from public.content_import_state "
                    "where run_id = %s order by entity_type, entity_id", (run_id,))
        for entity_type, entity_id, written_hash, previous in cur.fetchall():
            spec = SPECS[entity_type]
            if previous is None:
                created.append((entity_type, entity_id))
                continue
            cur.execute(f"select {', '.join(spec.owned)} from public.{spec.table} where {spec.pk} = %s for update",
                        (entity_id,))
            row = cur.fetchone()
            if row is None or canonical_hash(_plain(dict(zip(spec.owned, row)))) != written_hash:
                skipped.append((entity_type, entity_id))
                continue
            if apply_changes:
                sets = [f"{c} = %s" for c in spec.owned] + (["updated_at = now()"] if spec.touch else [])
                cur.execute(f"update public.{spec.table} set {', '.join(sets)} where {spec.pk} = %s",
                            [_value(spec, c, previous.get(c)) for c in spec.owned] + [entity_id])
                cur.execute("update public.content_import_state set written_hash = %s, previous_row = null "
                            "where entity_type = %s and entity_id = %s",
                            (canonical_hash({c: previous.get(c) for c in spec.owned}), entity_type, entity_id))
            reverted.append((entity_type, entity_id))
    return reverted, skipped, created


class RunLog:
    """Records a run and its issues on a separate connection so a rolled-back import still leaves a trace."""

    def __init__(self, dsn: str, command: str, host: str, source_fingerprint: str | None):
        self.conn = connect(dsn, autocommit=True)
        with self.conn.cursor() as cur:
            cur.execute("insert into public.content_import_runs (command, target_host, source_fingerprint) "
                        "values (%s, %s, %s) returning id::text", (command, host, source_fingerprint))
            self.run_id: str = cur.fetchone()[0]

    def issues(self, issues: list[Issue]) -> None:
        if not issues:
            return
        with self.conn.cursor() as cur:
            cur.executemany(
                "insert into public.content_import_issues "
                "(run_id, severity, code, entity_type, entity_id, source_path, message, context) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                [(self.run_id, i.severity, i.code, i.entity_type, i.entity_id, i.source_path, i.message[:2000],
                  Jsonb(_plain(i.context))) for i in issues])

    def finish(self, status: str, counts: dict, note: str | None = None) -> None:
        with self.conn.cursor() as cur:
            cur.execute("update public.content_import_runs set status = %s, finished_at = now(), counts = %s, note = %s "
                        "where id = %s", (status, Jsonb(_plain(counts)), note, self.run_id))
        self.conn.close()
