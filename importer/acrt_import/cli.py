"""Command line: plan, apply, images, verify, keys, restore."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
from collections import Counter

from . import images as img
from . import keys as keymod
from . import sync, verify as verifymod
from .config import REPORT_DIR, Config, ConfigError, check_write_target, load_config
from .model import ERROR, INFO, SPECS, WRITE_ORDER, Dataset, Issue
from .sandbox import DockerSandbox, SandboxUnavailable
from .source import load_dataset

EXIT_OK, EXIT_FAIL, EXIT_REFUSED = 0, 1, 2


def _issue_dict(i: Issue) -> dict:
    return {"severity": i.severity, "code": i.code, "entity_type": i.entity_type, "entity_id": i.entity_id,
            "source_path": i.source_path, "message": i.message, "context": i.context}


def write_report(command: str, body: dict) -> pathlib.Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = REPORT_DIR / f"{stamp}-{command}.json"
    path.write_text(json.dumps({"command": command, "created_at": stamp, **body}, indent=1, default=str) + "\n",
                    encoding="utf-8")
    return path


def print_issues(issues: list[Issue], limit: int = 12) -> None:
    by_code = Counter((i.severity, i.code) for i in issues if i.code != "summary")
    if not by_code:
        print("issues: none")
        return
    print("issues:")
    for (severity, code), n in sorted(by_code.items(), key=lambda kv: (kv[0][0] != ERROR, kv[0][1])):
        print(f"  {severity:7} {code:26} x{n}")
    shown = [i for i in issues if i.severity == ERROR][:limit]
    for i in shown:
        print("   - " + i.line() + (f" ({pathlib.Path(i.source_path).name})" if i.source_path else ""))
    if sum(1 for i in issues if i.severity == ERROR) > limit:
        print(f"   ... more errors are in the report file")


def print_outcome(outcome: sync.Outcome) -> None:
    print(f"{'entity':10} {'create':>8} {'update':>8} {'unchanged':>10} {'conflict':>9} {'blocked':>8}")
    for t in WRITE_ORDER:
        c = outcome.counts().get(t, {})
        print(f"{t:10} {c.get('create', 0):>8} {c.get('update', 0):>8} {c.get('unchanged', 0):>10} "
              f"{c.get('conflict', 0):>9} {c.get('blocked', 0):>8}")
    for t, ids in outcome.orphans.items():
        print(f"  not in export, left untouched: {len(ids)} {t}")


def print_dataset(ds: Dataset) -> None:
    print("source: " + ", ".join(f"{len(v)} {k}" for k, v in ds.entities.items()))
    if "mcq_sets_incomplete" in ds.stats:
        print(f"        {ds.stats['mcq_sets_incomplete']} MCQ set(s) are shorter in the export than their stated size")


def _outcome_report(ds: Dataset, outcome: sync.Outcome | None) -> dict:
    return {
        "source_fingerprint": ds.fingerprint,
        "source_counts": {k: len(v) for k, v in ds.entities.items()},
        "stats": ds.stats,
        "plan": outcome.counts() if outcome else None,
        "orphans": {t: len(v) for t, v in outcome.orphans.items()} if outcome else None,
        "issues": [_issue_dict(i) for i in ds.issues + (outcome.issues if outcome else []) if i.code != "summary"],
    }


def _overwrite_ids(path: str | None) -> set[str]:
    if not path:
        return set()
    return {line.strip().lower() for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")}


# --- commands ---------------------------------------------------------------------------------------------------
def cmd_plan(cfg: Config, args) -> int:
    ds = load_dataset(cfg)
    print_dataset(ds)
    outcome = None
    if args.offline or not cfg.dsn:
        print("offline: no database was consulted; every row would be new")
    else:
        with sync.connect(cfg.dsn, read_only=True) as conn:
            use_state = sync.has_state_tables(conn)
            if not use_state:
                print("note: the M06 bookkeeping tables are not on this database yet; edits cannot be detected")
            outcome = sync.plan(conn, ds, use_state=use_state, overwrite=_overwrite_ids(args.overwrite_ids))
        print_outcome(outcome)
    print_issues(ds.issues + (outcome.issues if outcome else []))
    path = write_report("plan", {"target_host": cfg.target_host, **_outcome_report(ds, outcome)})
    print(f"report: {path}")
    return EXIT_REFUSED if ds.errors else EXIT_OK


def cmd_apply(cfg: Config, args) -> int:
    ds = load_dataset(cfg)
    print_dataset(ds)
    if ds.errors and not args.skip_invalid:
        print_issues(ds.issues)
        print(f"\nrefused: {len(ds.errors)} invalid record(s). Fix the export, or pass --skip-invalid to import "
              "everything else and leave the invalid records out.")
        write_report("apply-refused", _outcome_report(ds, None))
        return EXIT_REFUSED
    try:
        host = (check_write_target(cfg.dsn, args.confirm_remote,
                                   pathlib.Path(args.backup_file) if args.backup_file else None,
                                   pathlib.Path(args.plan_report) if args.plan_report else None)
                if args.yes else cfg.target_host)
    except ConfigError as exc:
        print(f"refused: {exc}")
        return EXIT_REFUSED

    with sync.connect(cfg.dsn, read_only=not args.yes) as probe:
        if not sync.has_state_tables(probe):
            print("refused: apply the M06 migration (supabase/migrations/20261010160000_m06_content_import.sql) "
                  "to this database first.")
            return EXIT_REFUSED
        preview = sync.plan(probe, ds, use_state=True, overwrite=_overwrite_ids(args.overwrite_ids))
    print_outcome(preview)
    print_issues(ds.issues + preview.issues)
    if not args.yes:
        print(f"\ntarget {host}: nothing written. Re-run with --yes to apply this plan.")
        return EXIT_OK

    log = sync.RunLog(cfg.dsn, "apply", host, ds.fingerprint)
    try:
        with sync.connect(cfg.dsn) as conn:
            outcome = sync.plan(conn, ds, use_state=True, overwrite=_overwrite_ids(args.overwrite_ids))
            done = sync.apply(conn, outcome, log.run_id)
            placeholders = sync.ensure_answer_key_placeholders(conn, [e.id for e in ds.entities["mcq"]])
            conn.commit()
    except Exception as exc:  # the transaction rolled back; keep a record of why
        log.issues([Issue(ERROR, "apply_failed", f"{type(exc).__name__}: {str(exc)[:300]}")])
        log.finish("failed", {}, f"{type(exc).__name__}")
        print(f"failed and rolled back: {type(exc).__name__}: {str(exc)[:300]}")
        return EXIT_FAIL

    counts = dict(done)
    counts["answer_key.placeholders"] = placeholders
    log.issues([i for i in ds.issues + outcome.issues if i.code != "summary"])
    log.finish("succeeded", counts)
    for key in sorted(counts):
        print(f"  {key:28} {counts[key]}")
    path = write_report("apply", {"run_id": log.run_id, "target_host": host, "done": counts,
                                  **_outcome_report(ds, outcome)})
    print(f"run {log.run_id} recorded. report: {path}")
    return EXIT_OK


def cmd_images(cfg: Config, args) -> int:
    if args.seed_from:
        copied, present, rejected = img.seed_from(pathlib.Path(args.seed_from), pathlib.Path(args.seed_manifest))
        print(f"seeded: {copied} copied, {present} already present, {len(rejected)} rejected")
        for name in rejected[:20]:
            print(f"  rejected {name}")
        return EXIT_OK
    result = img.mirror(cfg.scraper_dir, cfg.image_hosts, apply=args.apply, force=args.force)
    print(f"present {len(result.present)}, fetched {len(result.fetched)}, "
          f"missing {len(result.missing)}, failed {len(result.failed)}")
    for url, reason in result.failed:
        print(f"  FAILED {url}: {reason}")
    if result.missing and not args.apply:
        print("dry run: re-run with --apply to download the missing images")
    return EXIT_FAIL if result.failed else EXIT_OK


def cmd_verify(cfg: Config, args) -> int:
    only = _overwrite_ids(args.ids) or None
    sandbox = DockerSandbox()
    try:
        sandbox.check()
        if args.source == "db":
            if not cfg.dsn:
                raise ConfigError("IMPORT_DATABASE_URL is not set.")
            with sync.connect(cfg.dsn, read_only=True) as conn:
                items = verifymod.items_from_db(conn, only)
        else:
            ds = load_dataset(cfg, with_fingerprint=False)
            items = verifymod.items_from_dataset(ds, only)
        print(f"verifying {len(items)} problem(s) in the sandbox with {args.jobs} worker(s)...")
        verdicts = verifymod.verify_all(sandbox, items, args.jobs)
    except (SandboxUnavailable, ConfigError) as exc:
        print(f"refused: {exc}")
        return EXIT_REFUSED

    counts = Counter(v.status for v in verdicts)
    print("  " + ", ".join(f"{k} {counts.get(k, 0)}" for k in ("passed", "failed", "no_solution", "error")))
    warn = Counter(w for v in verdicts for w in v.warnings)
    for name, n in sorted(warn.items()):
        print(f"  warning {name}: {n}")
    for v in [v for v in verdicts if v.status == "failed"][:15]:
        print(f"  FAILED {v.problem_id} {v.passed}/{v.total}: {v.detail}")

    body = {"counts": dict(counts), "warnings": dict(warn), "verdicts": [
        {"problem_id": v.problem_id, "status": v.status, "passed": v.passed, "total": v.total,
         "detail": v.detail, "warnings": v.warnings} for v in verdicts]}
    if args.apply:
        if args.source != "db":
            print("refused: --apply records results, so it needs --source db.")
            return EXIT_REFUSED
        try:
            host = check_write_target(cfg.dsn, args.confirm_remote,
                                      pathlib.Path(args.backup_file) if args.backup_file else None,
                                      pathlib.Path(args.plan_report) if args.plan_report else None)
        except ConfigError as exc:
            print(f"refused: {exc}")
            return EXIT_REFUSED
        log = sync.RunLog(cfg.dsn, "verify", host, None)
        with sync.connect(cfg.dsn) as conn:
            written = verifymod.write_validations(conn, verdicts)
            conn.commit()
        log.finish("succeeded", dict(counts))
        print(f"recorded {written} verdict(s) in problem_validations (run {log.run_id}). Nothing was published.")
        body["run_id"] = log.run_id
    else:
        print("dry run: nothing recorded. Add --apply (with --source db) to write problem_validations.")
    print(f"report: {write_report('verify', body)}")
    return EXIT_OK


def cmd_keys(cfg: Config, args) -> int:
    ds = load_dataset(cfg, with_fingerprint=False)
    sandbox = None
    if not args.no_execute:
        sandbox = DockerSandbox()
        try:
            sandbox.check()
        except SandboxUnavailable as exc:
            print(f"refused: {exc} (or pass --no-execute to use reviewed keys only)")
            return EXIT_REFUSED
    entities, report = keymod.build_keys(cfg, ds, sandbox, args.jobs)
    print(f"keys ready: {report.executed} derived by execution, {report.reviewed} reviewed; "
          f"{len(report.invalid)} invalid, {len(report.unkeyed)} without a key")
    for qtype, n in sorted(Counter(t for _, t in report.unkeyed).items()):
        print(f"  unkeyed {qtype}: {n}")

    body = {"executed": report.executed, "reviewed": report.reviewed, "invalid": report.invalid,
            "unkeyed": [{"mcq_id": i, "question_type": t} for i, t in report.unkeyed]}
    if not cfg.dsn:
        print("offline: no database configured, nothing compared or written")
        print(f"report: {write_report('keys', body)}")
        return EXIT_OK

    host = cfg.target_host
    if args.apply:
        try:
            host = check_write_target(cfg.dsn, args.confirm_remote,
                                      pathlib.Path(args.backup_file) if args.backup_file else None,
                                      pathlib.Path(args.plan_report) if args.plan_report else None)
        except ConfigError as exc:
            print(f"refused: {exc}")
            return EXIT_REFUSED
    with sync.connect(cfg.dsn, read_only=not args.apply) as conn:
        if not sync.has_state_tables(conn):
            print("refused: apply the M06 migration to this database first.")
            return EXIT_REFUSED
        with conn.cursor() as cur:
            cur.execute("select id::text from public.mcqs")
            present = {r[0] for r in cur.fetchall()}
        wanted = [e for e in entities if e.id in present]
        decisions = sync.classify(conn, SPECS["answer_key"], wanted, use_state=True,
                                  overwrite=_overwrite_ids(args.overwrite_ids), attempted_sets=set())
        counts = Counter(d.action for d in decisions)
        print("  " + ", ".join(f"{k} {counts.get(k, 0)}" for k in ("create", "update", "unchanged", "conflict")) +
              f"; {len(entities) - len(wanted)} key(s) have no question in the database yet")
        body["plan"] = dict(counts)
        if args.apply:
            log = sync.RunLog(cfg.dsn, "keys", host, None)
            outcome = sync.Outcome(decisions={"answer_key": decisions})
            done = sync.apply(conn, outcome, log.run_id)
            conn.commit()
            log.finish("succeeded", dict(done))
            print(f"wrote keys: {dict(done)} (run {log.run_id}). Values are not shown or reported.")
            body["run_id"] = log.run_id
        else:
            print("dry run: nothing written. Add --apply to write the ready keys.")
    print(f"report: {write_report('keys', body)}")
    return EXIT_OK


def cmd_restore(cfg: Config, args) -> int:
    try:
        host = check_write_target(cfg.dsn, args.confirm_remote,
                                  pathlib.Path(args.backup_file) if args.backup_file else None,
                                  pathlib.Path(args.plan_report) if args.plan_report else None)
    except ConfigError as exc:
        print(f"refused: {exc}")
        return EXIT_REFUSED
    with sync.connect(cfg.dsn) as conn:
        reverted, skipped, created = sync.restore(conn, args.run_id, apply_changes=args.yes)
        if args.yes:
            conn.commit()
    verb = "reverted" if args.yes else "would revert"
    print(f"{verb} {len(reverted)} updated row(s); skipped {len(skipped)} edited since; "
          f"{len(created)} row(s) were created by that run and are left for manual review ({host}).")
    if not args.yes:
        print("dry run: re-run with --yes to revert.")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="acrt_import", description="Avanthi CRT content importer")
    sub = p.add_subparsers(dest="command", required=True)

    def guard_flags(sp):
        sp.add_argument("--confirm-remote", help="host name, required to write to a non-local database")
        sp.add_argument("--backup-file", help="a backup written in the last 24 hours (remote writes)")
        sp.add_argument("--plan-report", help="a plan report from the last 24 hours (remote writes)")
        sp.add_argument("--overwrite-ids", help="file of ids whose edited rows may be overwritten")

    s = sub.add_parser("plan", help="read the export and compare with the database; writes nothing")
    s.add_argument("--offline", action="store_true", help="do not connect to a database")
    s.add_argument("--overwrite-ids")
    s.set_defaults(fn=cmd_plan)

    s = sub.add_parser("apply", help="write new and unedited rows; refuses invalid records")
    s.add_argument("--yes", action="store_true", help="actually write (otherwise only a preview)")
    s.add_argument("--skip-invalid", action="store_true", help="import the valid records, leave invalid ones out")
    guard_flags(s)
    s.set_defaults(fn=cmd_apply)

    s = sub.add_parser("images", help="mirror referenced course images into public/content/images")
    s.add_argument("--apply", action="store_true", help="download (otherwise list what is missing)")
    s.add_argument("--force", action="store_true")
    s.add_argument("--seed-from", help="copy valid images another checkout already mirrored")
    s.add_argument("--seed-manifest", help="that checkout's image_manifest.json")
    s.set_defaults(fn=cmd_images)

    s = sub.add_parser("verify", help="run reference solutions against their test cases in a sandbox")
    s.add_argument("--source", choices=("dataset", "db"), default="dataset")
    s.add_argument("--ids", help="file of problem ids to limit the run")
    s.add_argument("--jobs", type=int, default=4)
    s.add_argument("--apply", action="store_true", help="record results in problem_validations (--source db)")
    guard_flags(s)
    s.set_defaults(fn=cmd_verify)

    s = sub.add_parser("keys", help="derive and write MCQ answer keys where the row is still empty")
    s.add_argument("--apply", action="store_true")
    s.add_argument("--no-execute", action="store_true", help="use reviewed keys only; run no code")
    s.add_argument("--jobs", type=int, default=4)
    guard_flags(s)
    s.set_defaults(fn=cmd_keys)

    s = sub.add_parser("restore", help="revert rows a run updated, unless edited since")
    s.add_argument("run_id")
    s.add_argument("--yes", action="store_true")
    guard_flags(s)
    s.set_defaults(fn=cmd_restore)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg = load_config()
        if args.command == "images" and args.seed_from and not args.seed_manifest:
            print("--seed-from needs --seed-manifest")
            return EXIT_REFUSED
        return args.fn(cfg, args)
    except ConfigError as exc:
        print(f"error: {exc}")
        return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())
