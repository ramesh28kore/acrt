"""Check each reference solution against its test cases, using the same output rule as the portal's grader."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .model import Dataset
from .sandbox import Sandbox


def normalize_output(text: str) -> str:
    """Mirror of normalizeOutput in src/lib/coding/output.ts: CRLF to LF, trailing spaces and tabs per line
    ignored, trailing blank lines dropped. Leading whitespace and inner blank lines are significant."""
    lines = re.sub(r"\r\n?", "\n", text or "").split("\n")
    return re.sub(r"\n+$", "", "\n".join(re.sub(r"[ \t]+$", "", line) for line in lines))


@dataclass
class Case:
    input: str
    expected: str
    is_sample: bool
    position: int


@dataclass
class Item:
    problem_id: str
    solution: str | None
    cases: list[Case]


@dataclass
class Verdict:
    problem_id: str
    status: str  # passed | failed | no_solution | error
    passed: int
    total: int
    detail: str | None = None
    warnings: list[str] = field(default_factory=list)


READS_INPUT = re.compile(r"\binput\s*\(|sys\.stdin|open\(\s*0\s*\)|readline")


def items_from_dataset(ds: Dataset, only: set[str] | None = None) -> list[Item]:
    solutions = {e.id: e.payload["solution"] for e in ds.entities["solution"]}
    cases: dict[str, list[Case]] = {}
    for e in ds.entities["case"]:
        p = e.payload
        cases.setdefault(p["problem_id"], []).append(Case(p["input"], p["expected_output"], p["is_sample"], p["position"]))
    items = []
    for problem in ds.entities["problem"]:
        if only is not None and problem.id not in only:
            continue
        items.append(Item(problem.id, solutions.get(problem.id),
                          sorted(cases.get(problem.id, []), key=lambda c: c.position)))
    return items


def items_from_db(conn, only: set[str] | None = None) -> list[Item]:
    with conn.cursor() as cur:
        cur.execute("select id::text from public.problems order by id")
        ids = [r[0] for r in cur.fetchall() if only is None or r[0] in only]
        cur.execute("select problem_id::text, solution from public.problem_solutions")
        solutions = {r[0]: r[1] for r in cur.fetchall()}
        cur.execute("select problem_id::text, input, expected_output, is_sample, position "
                    "from public.test_cases order by problem_id, position")
        cases: dict[str, list[Case]] = {}
        for pid, stdin, expected, is_sample, position in cur.fetchall():
            cases.setdefault(pid, []).append(Case(stdin, expected, is_sample, position))
    return [Item(pid, solutions.get(pid), cases.get(pid, [])) for pid in ids]


def verify_item(sandbox: Sandbox, item: Item) -> Verdict:
    total = len(item.cases)
    if not (item.solution or "").strip():
        return Verdict(item.problem_id, "no_solution", 0, total, "No reference solution is stored.")
    if total == 0:
        return Verdict(item.problem_id, "error", 0, 0, "The problem has no test cases.")

    warnings: list[str] = []
    if any(c.input.strip() for c in item.cases) and not READS_INPUT.search(item.solution):
        warnings.append("solution_ignores_input")
    if total == 1:
        warnings.append("single_case_only")

    results = sandbox.run(item.solution, [c.input for c in item.cases])
    passed, detail = 0, None
    for case, result in zip(item.cases, results):
        actual = normalize_output(result.stdout)
        if result.ok and actual == normalize_output(case.expected):
            passed += 1
            continue
        if detail is None:
            label = f"case {case.position + 1}"
            if not case.is_sample:  # hidden cases never have their expected output copied into a message
                detail = f"hidden {label} " + ("timed out" if result.timed_out else "failed")
            elif result.timed_out:
                detail = f"sample {label} timed out"
            elif not result.ok:
                detail = f"sample {label} raised an error: {result.error.strip()[-160:]}"
            else:
                detail = (f"sample {label}: expected {normalize_output(case.expected)[:100]!r}, "
                          f"got {actual[:100]!r}")
    status = "passed" if passed == total else "failed"
    return Verdict(item.problem_id, status, passed, total, detail, warnings)


def verify_all(sandbox: Sandbox, items: list[Item], jobs: int = 4) -> list[Verdict]:
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        return list(pool.map(lambda item: verify_item(sandbox, item), items))


def write_validations(conn, verdicts: list[Verdict]) -> int:
    """Record verdicts in problem_validations. This never touches problem_solutions or any is_published flag."""
    with conn.cursor() as cur:
        cur.executemany(
            "insert into public.problem_validations (problem_id, status, passed_count, total_count, detail, validated_at) "
            "values (%s, %s, %s, %s, %s, now()) on conflict (problem_id) do update set status = excluded.status, "
            "passed_count = excluded.passed_count, total_count = excluded.total_count, "
            "detail = excluded.detail, validated_at = now()",
            [(v.problem_id, v.status, v.passed, v.total, v.detail) for v in verdicts])
    return len(verdicts)
