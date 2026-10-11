"""Answer keys: derived by running code snippets, or reviewed by hand. Key values never reach a log or report.

Keys come from files kept outside git (PRIVATE_DIR). A key is written only where the row is still empty or the
importer wrote its current value; a key a faculty member entered is never replaced.
"""

from __future__ import annotations

import json
import pathlib
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .config import Config
from .model import ERROR, INFO, WARNING, Dataset, Entity
from .sandbox import Sandbox, prepare_stdin
from .verify import normalize_output

SINGLE_CHOICE = ("CODE_ANALYSIS_MULTIPLE_CHOICE", "MULTIPLE_CHOICE")
MANUAL_FILE = "manual_answer_keys.json"


@dataclass
class KeyReport:
    executed: int = 0
    reviewed: int = 0
    invalid: list[str] = field(default_factory=list)
    unkeyed: list[tuple[str, str]] = field(default_factory=list)  # (question id, question type)


def load_manual(cfg: Config, ds: Dataset) -> dict[str, dict]:
    path = cfg.private_dir / MANUAL_FILE
    if not path.exists():
        ds.issue(INFO, "no_manual_keys", f"{path} not found; only keys derived by execution are available")
        return {}
    try:
        data = json.loads(path.read_bytes().decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        ds.issue(ERROR, "invalid_manual_keys", f"{path.name} could not be read: {type(exc).__name__}",
                 source_path=str(path))
        return {}
    if not isinstance(data, dict):
        ds.issue(ERROR, "invalid_manual_keys", f"{path.name} must be an object", source_path=str(path))
        return {}
    return data


def resolve_manual(entry: dict, options: list[dict]) -> dict | None:
    """manual_answer_keys.json stores short option-id prefixes for readability; each must match exactly one option."""
    if not isinstance(entry, dict):
        return None
    if entry.get("kind") == "text":
        expected = entry.get("expected")
        return {"kind": "text", "expected": expected} if isinstance(expected, str) else None
    if entry.get("kind") == "options" and isinstance(entry.get("optionPrefixes"), list):
        ids = [o["id"] for o in options]
        chosen = []
        for prefix in entry["optionPrefixes"]:
            hits = [i for i in ids if str(i).startswith(str(prefix))]
            if len(hits) != 1:
                return None
            chosen.append(hits[0])
        return {"kind": "options", "optionIds": chosen}
    return None


def valid_key(key: dict, question_type: str, options: list[dict]) -> bool:
    if key.get("kind") == "text":
        return isinstance(key.get("expected"), str) and bool(key["expected"].strip())
    if key.get("kind") == "options":
        chosen = key.get("optionIds")
        have = {o["id"] for o in options}
        if not isinstance(chosen, list) or not chosen or len(set(chosen)) != len(chosen) or not set(chosen) <= have:
            return False
        return len(chosen) == 1 if question_type in SINGLE_CHOICE else True
    return False


def key_from_execution(sandbox: Sandbox, question_type: str, code: str, options: list[dict]) -> dict | None:
    """A key derived purely from running the snippet, or None when the result is not conclusive."""
    result = sandbox.run(code, [""])[0]
    if result.timed_out:
        return None
    exception = None
    if not result.ok:
        names = re.findall(r"^(\w+(?:Error|Exception))\b", result.error, re.M)
        exception = names[-1] if names else "Error"
    output = normalize_output(result.stdout)

    if question_type == "CODE_ANALYSIS_TEXTUAL":
        return None if exception else {"kind": "text", "expected": output}
    if question_type not in SINGLE_CHOICE:
        return None  # multi-select needs judgement about which set is right

    if not exception and output:
        matches = [o for o in options if normalize_output(o["content"]) == output]
        return {"kind": "options", "optionIds": [matches[0]["id"]]} if len(matches) == 1 else None
    if exception:
        # "No Error" also contains the word Error; a negative option must never win the match.
        naming = [o for o in options if re.search(r"error|exception", o["content"], re.I)
                  and not re.match(r"\s*(no|not)\b", o["content"], re.I)]
        named = [o for o in naming if exception.lower() in re.sub(r"\s+", "", o["content"].lower())]
        for candidates in (named, naming):
            if len(candidates) == 1:
                return {"kind": "options", "optionIds": [candidates[0]["id"]]}
    return None


def build_keys(cfg: Config, ds: Dataset, sandbox: Sandbox | None, jobs: int = 4) -> tuple[list[Entity], KeyReport]:
    manual = load_manual(cfg, ds)
    report = KeyReport()
    mcqs = {e.id: e for e in ds.entities["mcq"]}

    unknown = sorted(set(manual) - set(mcqs))
    if unknown:
        ds.issue(WARNING, "manual_key_without_question",
                 f"{len(unknown)} manual key(s) match no imported question", context={"ids": unknown[:10]})

    entities: dict[str, Entity] = {}
    todo: list[Entity] = []
    for qid, mcq in mcqs.items():
        p = mcq.payload
        if qid in manual:
            key = resolve_manual(manual[qid], p["options"])
            if key is None or not valid_key(key, p["question_type"], p["options"]):
                report.invalid.append(qid)
                continue
            entities[qid] = Entity("answer_key", qid, {"answer_key": key}, "manual")
            report.reviewed += 1
        elif p["code"] and p["question_type"].startswith("CODE_ANALYSIS"):
            todo.append(mcq)
        else:
            report.unkeyed.append((qid, p["question_type"]))

    if todo:
        if sandbox is None:
            report.unkeyed.extend((m.id, m.payload["question_type"]) for m in todo)
        else:
            def derive(mcq: Entity):
                p = mcq.payload
                return mcq.id, key_from_execution(sandbox, p["question_type"], p["code"], p["options"])

            with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
                for qid, key in pool.map(derive, todo):
                    p = mcqs[qid].payload
                    if key is None:
                        report.unkeyed.append((qid, p["question_type"]))
                    elif not valid_key(key, p["question_type"], p["options"]):
                        report.invalid.append(qid)
                    else:
                        entities[qid] = Entity("answer_key", qid, {"answer_key": key}, "executed")
                        report.executed += 1
    return list(entities.values()), report
