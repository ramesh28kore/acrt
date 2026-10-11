"""Structural checks over a loaded Dataset. Invalid entities are dropped and reported; nothing is repaired."""

from __future__ import annotations

from .config import IMAGE_URL_PREFIX
from .model import ERROR, INFO, WARNING, Dataset

BLOCK_TYPES = {"heading", "paragraph", "list_item", "code", "image"}
CHOICE_MARKERS = ("MULTIPLE_CHOICE", "MORE_THAN_ONE")


def _drop(ds: Dataset, entity_type: str, bad: set[str]) -> None:
    ds.entities[entity_type] = [e for e in ds.entities[entity_type] if e.id not in bad]


def _check_unique(ds: Dataset) -> None:
    for entity_type, entities in ds.entities.items():
        seen: set[str] = set()
        for entity in entities:
            if entity.id in seen:
                ds.issue(ERROR, "duplicate_id", f"{entity_type} id appears more than once; later copies are ignored",
                         entity_type=entity_type, entity_id=entity.id, source_path=entity.source_path)
            seen.add(entity.id)
        first: dict[str, object] = {}
        for entity in entities:
            first.setdefault(entity.id, entity)
        ds.entities[entity_type] = list(first.values())  # type: ignore[arg-type]


def _check_references(ds: Dataset) -> None:
    """Parents before children, so removing a parent removes everything that hangs off it."""
    topics = {e.id for e in ds.entities["topic"]}
    links = (
        ("set", "topic_id", topics, "topic"),
        ("sheet", "topic_id", topics, "topic"),
        ("mcq_set", "topic_id", topics, "topic"),
    )
    for entity_type, column, parents, parent_type in links:
        bad = {e.id for e in ds.entities[entity_type] if e.payload[column] not in parents}
        for entity_id in sorted(bad):
            ds.issue(ERROR, "dangling_reference", f"{entity_type} points at a {parent_type} that is not imported",
                     entity_type=entity_type, entity_id=entity_id)
        _drop(ds, entity_type, bad)

    sets = {e.id for e in ds.entities["set"]}
    bad = {e.id for e in ds.entities["problem"] if e.payload["set_id"] not in sets or e.payload["topic_id"] not in topics}
    for entity_id in sorted(bad):
        ds.issue(ERROR, "dangling_reference", "problem points at a set or topic that is not imported",
                 entity_type="problem", entity_id=entity_id)
    _drop(ds, "problem", bad)

    problems = {e.id for e in ds.entities["problem"]}
    bad = {e.id for e in ds.entities["case"] if e.payload["problem_id"] not in problems}
    bad |= {e.id for e in ds.entities["solution"] if e.id not in problems}
    for entity_id in sorted(bad):
        ds.issue(ERROR, "dangling_reference", "entity points at a problem that is not imported", entity_id=entity_id)
    for entity_type in ("case", "solution"):
        _drop(ds, entity_type, bad)

    mcq_sets = {e.id for e in ds.entities["mcq_set"]}
    bad = {e.id for e in ds.entities["mcq"] if e.payload["mcq_set_id"] not in mcq_sets}
    for entity_id in sorted(bad):
        ds.issue(ERROR, "dangling_reference", "mcq points at a set that is not imported",
                 entity_type="mcq", entity_id=entity_id)
    _drop(ds, "mcq", bad)


def _check_blocks(ds: Dataset, entity_type: str) -> None:
    bad: set[str] = set()
    for entity in ds.entities[entity_type]:
        problems = []
        blocks = entity.payload["content"]
        if not isinstance(blocks, list) or not blocks:
            problems.append("has no content blocks")
        else:
            for index, block in enumerate(blocks):
                kind = block.get("type")
                if kind not in BLOCK_TYPES:
                    problems.append(f"block {index} has unknown type {kind!r}")
                elif kind == "image":
                    if not str(block.get("url", "")).startswith(IMAGE_URL_PREFIX):
                        problems.append(f"block {index} is an image outside {IMAGE_URL_PREFIX}")
                elif not str(block.get("text", "")).strip():
                    problems.append(f"block {index} ({kind}) is empty")
        if not str(entity.payload["title"]).strip():
            problems.append("has no title")
        for message in problems[:5]:
            ds.issue(ERROR, "bad_content", message, entity_type=entity_type, entity_id=entity.id,
                     source_path=entity.source_path)
        if problems:
            bad.add(entity.id)
    _drop(ds, entity_type, bad)


def _check_mcqs(ds: Dataset) -> None:
    bad: set[str] = set()
    positions: dict[str, set[int]] = {}
    for entity in ds.entities["mcq"]:
        p = entity.payload
        ctx = {"entity_type": "mcq", "entity_id": entity.id, "source_path": entity.source_path}
        options = p["options"]
        ids = [o.get("id") for o in options]
        if any(not i for i in ids) or len(set(ids)) != len(ids):
            ds.issue(ERROR, "bad_options", "option ids are missing or repeated", **ctx)
            bad.add(entity.id)
            continue
        if any(CHOICE in p["question_type"] for CHOICE in CHOICE_MARKERS) and len(options) < 2:
            ds.issue(ERROR, "too_few_options", f"{p['question_type']} needs at least two options", **ctx)
            bad.add(entity.id)
            continue
        if not (p["prompt"] or "").strip() and not p["code"]:
            ds.issue(ERROR, "empty_prompt", "question has no text, code or image", **ctx)
            bad.add(entity.id)
            continue
        empty = [o["label"] for o in options if not (o.get("content") or "").strip()]
        if empty:
            ds.issue(WARNING, "empty_option", f"option(s) {', '.join(empty)} have no text", **ctx)
        seen = positions.setdefault(p["mcq_set_id"], set())
        if p["position"] in seen:
            ds.issue(WARNING, "duplicate_position", f"position {p['position']} is used twice in the set", **ctx)
        seen.add(p["position"])
    _drop(ds, "mcq", bad)

    incomplete = {
        set_id: counts for set_id, counts in ds.stats.get("mcq_sets", {}).items()
        if counts["expected"] and counts["captured"] < counts["expected"]
    }
    for set_id, counts in sorted(incomplete.items()):
        ds.issue(WARNING, "mcq_set_incomplete",
                 f"the export has {counts['captured']} of {counts['expected']} questions; the set stays short",
                 entity_type="mcq_set", entity_id=set_id, context=counts)
    ds.stats["mcq_sets_incomplete"] = len(incomplete)


def validate(ds: Dataset) -> None:
    _check_unique(ds)
    _check_references(ds)
    _check_blocks(ds, "problem")
    _check_blocks(ds, "sheet")
    _check_mcqs(ds)
    # A problem dropped for bad content takes its cases and solution with it.
    kept = {e.id for e in ds.entities["problem"]}
    ds.entities["case"] = [e for e in ds.entities["case"] if e.payload["problem_id"] in kept]
    ds.entities["solution"] = [e for e in ds.entities["solution"] if e.id in kept]
