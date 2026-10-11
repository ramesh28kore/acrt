"""Entities, issues and the table specifications the importer writes."""

from __future__ import annotations

from dataclasses import dataclass, field

from .ids import canonical_hash

ERROR, WARNING, INFO = "error", "warning", "info"


@dataclass(frozen=True)
class Spec:
    """One importable table. `owned` are the columns the importer may write; everything else is left alone."""

    entity_type: str
    table: str
    pk: str
    owned: tuple[str, ...]
    json_cols: tuple[str, ...] = ()
    touch: bool = False  # table has an updated_at column to refresh on update
    protected: tuple[str, ...] = ()  # columns whose presence means a person has taken the row over
    secret: bool = False  # payload must never be printed or reported
    null_is_missing: bool = False  # a row whose owned columns are all NULL counts as not yet filled


SPECS: dict[str, Spec] = {
    "topic": Spec("topic", "topics", "id", ("name", "position")),
    "set": Spec("set", "sets", "id", ("topic_id", "name", "kind", "position")),
    "problem": Spec(
        "problem", "problems", "id",
        ("set_id", "topic_id", "title", "difficulty", "source_url", "position", "content", "samples", "content_hash"),
        json_cols=("content", "samples"), touch=True,
    ),
    "sheet": Spec(
        "sheet", "sheets", "id",
        ("topic_id", "title", "position", "source_url", "content", "content_hash", "pdf_storage_path"),
        json_cols=("content",), touch=True,
    ),
    "mcq_set": Spec(
        "mcq_set", "mcq_sets", "id",
        ("topic_id", "name", "exam_content_type", "source_url", "expected_count", "position"),
    ),
    "mcq": Spec(
        "mcq", "mcqs", "id",
        ("mcq_set_id", "position", "question_type", "prompt", "code", "code_lang", "options", "content_hash"),
        json_cols=("options",), touch=True,
    ),
    "case": Spec(
        "case", "test_cases", "id",
        ("problem_id", "input", "expected_output", "is_sample", "position"),
    ),
    "solution": Spec(
        "solution", "problem_solutions", "problem_id", ("solution", "language"),
        touch=True, protected=("is_published", "updated_by"),
    ),
    "answer_key": Spec(
        "answer_key", "mcq_answer_keys", "mcq_id", ("answer_key",),
        json_cols=("answer_key",), touch=True, protected=("updated_by",), secret=True, null_is_missing=True,
    ),
}

# Parents before children: foreign keys must exist when a child is written.
WRITE_ORDER = ("topic", "set", "problem", "sheet", "mcq_set", "mcq", "solution", "case")


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    entity_type: str | None = None
    entity_id: str | None = None
    source_path: str | None = None
    context: dict = field(default_factory=dict)

    def line(self) -> str:
        where = f" [{self.entity_type} {self.entity_id}]" if self.entity_type else ""
        return f"{self.severity.upper():7} {self.code}{where}: {self.message}"


@dataclass
class Entity:
    entity_type: str
    id: str
    payload: dict  # owned columns only
    source_path: str | None = None

    def __repr__(self) -> str:  # secret payloads (answer keys) never reach logs
        if SPECS[self.entity_type].secret:
            return f"Entity({self.entity_type}, {self.id}, <redacted>)"
        return f"Entity({self.entity_type}, {self.id})"

    @property
    def source_hash(self) -> str:
        return canonical_hash(self.payload)


@dataclass
class Dataset:
    entities: dict[str, list[Entity]] = field(default_factory=lambda: {t: [] for t in SPECS})
    issues: list[Issue] = field(default_factory=list)
    fingerprint: str = ""
    # Source facts that are not rows: unmirrored images, expected vs captured MCQ counts, etc.
    stats: dict = field(default_factory=dict)

    def add(self, entity: Entity) -> None:
        self.entities[entity.entity_type].append(entity)

    def issue(self, severity: str, code: str, message: str, **kw) -> Issue:
        item = Issue(severity, code, message, **kw)
        self.issues.append(item)
        return item

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == ERROR]
