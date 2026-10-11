"""Stable identifiers and hashes.

The uuid5 formulas are the ones the previous importer used. Changing any of them would orphan existing rows and
the student progress that points at them; importer/tests/test_ids.py pins the values.
"""

from __future__ import annotations

import hashlib
import json
import uuid

NAMESPACE = uuid.UUID("f6a6f9b0-2f3b-4c9a-9c2e-5a2f6a2b7e10")

UNSORTED_TOPIC_ID = str(uuid.uuid5(NAMESPACE, "topic:unsorted"))


def set_id(topic_id: str, section: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"set:{topic_id}:{section}"))


def sheet_id(file_name: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"sheet:{file_name}"))


def case_id(problem_id: str, position: int) -> str:
    return str(uuid.uuid5(NAMESPACE, f"case:{problem_id}:{position}"))


def is_uuid(value: object) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return str(value).lower() == str(uuid.UUID(str(value)))


def canonical_hash(obj: object) -> str:
    """Order-independent hash of JSON-like data; UUIDs and datetimes hash as their text."""
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def legacy_content_hash(obj: object) -> str:
    """The `content_hash` column's historical formula; kept so existing values stay comparable."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode("utf-8")).hexdigest()
