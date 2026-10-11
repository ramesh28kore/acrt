"""Read the export into a Dataset of entities and issues. Nothing here touches a database."""

from __future__ import annotations

import hashlib
import json
import pathlib
import re

from bs4 import BeautifulSoup, NavigableString, Tag

from . import parsing as qp
from .config import Config
from .ids import UNSORTED_TOPIC_ID, case_id, is_uuid, legacy_content_hash, set_id, sheet_id
from .images import ImageResolver, is_content_image, rewrite_markdown_images
from .model import ERROR, INFO, WARNING, Dataset, Entity

BLOCK_TYPE = {"p": "paragraph", "h": "heading", "li": "list_item", "code": "code"}
CHROME_LABELS = {
    "notes", "code playground", "discussions", "contents",
    "mcq practice", "coding practice", "mark as complete", "report an issue",
}
PYTHON = "python"


def read_text(path: pathlib.Path, ds: Dataset, **ctx) -> str | None:
    """Strict UTF-8 (a BOM is tolerated). A file that does not decode is reported, never repaired."""
    try:
        return path.read_bytes().decode("utf-8-sig")
    except FileNotFoundError:
        ds.issue(ERROR, "file_missing", f"{path.name} does not exist", source_path=str(path), **ctx)
    except UnicodeDecodeError as exc:
        ds.issue(ERROR, "invalid_utf8", f"{path.name} is not valid UTF-8 (byte {exc.start})",
                 source_path=str(path), **ctx)
    return None


def read_json(path: pathlib.Path, ds: Dataset, **ctx):
    text = read_text(path, ds, **ctx)
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        ds.issue(ERROR, "invalid_json", f"{path.name}: {exc.msg} (line {exc.lineno})", source_path=str(path), **ctx)
        return None


def fingerprint(cfg: Config) -> str:
    """Hash of every source file the import reads, so a report can say which export it described."""
    h = hashlib.sha256()
    root = cfg.scraper_dir
    names = ["topics.txt", "statements_manifest.txt", "questions.txt", "urls.txt", "solutions.json"]
    files = [root / n for n in names]
    for sub, pattern in (("statements_html", "*.html"), ("mcq_json", "*.json"), ("html", "*.html")):
        files.extend(sorted((root / sub).glob(pattern)) if (root / sub).is_dir() else [])
    if cfg.cheat_sheet_dir.is_dir():
        files.extend(sorted(cfg.cheat_sheet_dir.glob("*.html")))
    for path in files:
        if path.is_file():
            try:
                label = path.relative_to(root.parent).as_posix()
            except ValueError:
                label = path.name
            h.update(label.encode())
            h.update(hashlib.sha256(path.read_bytes()).digest())
    return h.hexdigest()


# --- topics, sets ---------------------------------------------------------------------------------------------
def load_topics(cfg: Config, ds: Dataset) -> tuple[dict[str, dict], dict[str, str]]:
    path = cfg.scraper_dir / "topics.txt"
    text = read_text(path, ds)
    by_id: dict[str, dict] = {}
    name_to_id: dict[str, str] = {}
    if text is None:
        return by_id, name_to_id
    position = 0
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tid, sep, name = (p.strip() for p in line.partition("|"))
        if not sep or not name or not is_uuid(tid):
            ds.issue(ERROR, "bad_topic_line", f"topics.txt line {number} is not '<uuid> | <name>'", source_path=str(path))
            continue
        if tid in by_id or name in name_to_id:
            ds.issue(ERROR, "duplicate_topic", f"topics.txt line {number} repeats a topic id or name",
                     entity_type="topic", entity_id=tid, source_path=str(path))
            continue
        position += 1
        by_id[tid] = {"name": name, "position": position}
        name_to_id[name] = tid
        ds.add(Entity("topic", tid, {"name": name, "position": position}, str(path)))
    return by_id, name_to_id


def load_manifest_rows(cfg: Config, ds: Dataset) -> list[dict]:
    path = cfg.scraper_dir / "statements_manifest.txt"
    text = read_text(path, ds)
    rows: list[dict] = []
    seen: set[str] = set()
    for number, raw in enumerate((text or "").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        bits = [b.strip() for b in line.split("|")]
        url = ""
        if len(bits) > 1 and bits[1].startswith("http"):
            url = bits.pop(1)
        if len(bits) < 4 or not is_uuid(bits[0]) or not all(bits[1:4]):
            ds.issue(ERROR, "bad_manifest_line",
                     f"statements_manifest.txt line {number} needs '<uuid> | [url |] <title> | <section> | <topic>'",
                     source_path=str(path))
            continue
        if bits[0] in seen:
            ds.issue(ERROR, "duplicate_problem", f"statements_manifest.txt line {number} repeats a problem id",
                     entity_type="problem", entity_id=bits[0], source_path=str(path))
            continue
        seen.add(bits[0])
        rows.append({"uuid": bits[0], "url": url or f"https://learning.example/question/{bits[0]}",
                     "title": bits[1], "section": bits[2], "topic": bits[3], "line": number})
    return rows


def set_kind(section: str) -> str:
    return "assignment" if "assignment" in section.lower() else "practice"


def build_sets(rows: list[dict], name_to_id: dict[str, str], ds: Dataset) -> dict[str, str]:
    """'topic|section' -> set id. Rows whose topic is not in topics.txt are reported once per topic name."""
    per_topic: dict[str, int] = {}
    seen: dict[str, str] = {}
    unmapped: dict[str, int] = {}
    for row in rows:
        key = f"{row['topic']}|{row['section']}"
        if key in seen:
            continue
        topic_id = name_to_id.get(row["topic"])
        if topic_id is None:
            unmapped[row["topic"]] = unmapped.get(row["topic"], 0) + 1
            continue
        per_topic[topic_id] = per_topic.get(topic_id, 0) + 1
        sid = set_id(topic_id, row["section"])
        seen[key] = sid
        ds.add(Entity("set", sid, {
            "topic_id": topic_id, "name": row["section"], "kind": set_kind(row["section"]),
            "position": per_topic[topic_id],
        }, "statements_manifest.txt"))
    for name, count in sorted(unmapped.items()):
        ds.issue(ERROR, "unmapped_topic", f"topic {name!r} is not in topics.txt; its sections are skipped",
                 source_path="statements_manifest.txt", context={"topic": name, "sections": count})
    return seen


# --- problems ---------------------------------------------------------------------------------------------------
def load_difficulty(cfg: Config, ds: Dataset) -> dict[str, str | None]:
    path = cfg.scraper_dir / "questions.txt"
    out: dict[str, str | None] = {}
    if not path.exists():
        return out
    text = read_text(path, ds)
    for line in (text or "").splitlines():
        bits = [b.strip() for b in line.split("|")]
        if len(bits) >= 4 and bits[0].startswith("http"):
            uid = bits[0].rstrip("/").rsplit("/", 1)[-1]
            level = bits[3]
            out[uid] = None if level.lower() in ("none", "null", "-", "") else level
    return out


def blocks_to_json(blocks: list[tuple[str, str]]) -> list[dict]:
    out = []
    for kind, text in blocks:
        if kind == "code":
            lang, sep, src = text.partition("\x00")
            out.append({"type": "code", "lang": lang if sep else "PYTHON", "text": src if sep else text})
        else:
            out.append({"type": BLOCK_TYPE[kind], "text": text})
    return out


def _match_key(text: str) -> str:
    import html as _html

    stripped = _html.unescape(re.sub(r"<[^>]+>", "", text or ""))
    return " ".join(stripped.split()).lower()


def statement_images(text: str) -> list[tuple[str, str, str]]:
    """(anchor, url, alt) for each course image on a saved question page; the anchor is the text just before it."""
    soup = BeautifulSoup(text, qp.html_parser())
    root = soup.select_one("#mark-down") or soup.body or soup
    out: list[tuple[str, str, str]] = []
    anchor = ""
    for node in root.descendants:
        if isinstance(node, NavigableString):
            t = " ".join(str(node).split())
            if len(t) > 3 and not qp.FILLER.search(t):
                anchor = t
        elif isinstance(node, Tag) and node.name == "img":
            src = (node.get("src") or "").strip()
            if is_content_image(src):
                out.append((anchor, src, " ".join((node.get("alt") or "").split())))
    return out


def splice_image_blocks(blocks: list[dict], images: list[tuple[str, str, str]], resolve: ImageResolver) -> list[dict]:
    """Insert each image after the text it followed; one with no findable anchor goes last, never dropped silently."""
    out = list(blocks)
    cursor = 0
    for anchor, url, alt in images:
        local = resolve(url)
        if local is None:
            continue
        block = {"type": "image", "url": local}
        if alt:
            block["alt"] = alt
        key = _match_key(anchor)[-60:]
        at = None
        if key:
            for start in (cursor, 0):
                for i in range(start, len(out)):
                    if key in _match_key(out[i].get("text", "")):
                        at = i
                        break
                if at is not None:
                    break
        if at is None:
            out.append(block)
            cursor = len(out)
        else:
            out.insert(at + 1, block)
            cursor = at + 2
    return out


def to_samples(raw) -> list[dict]:
    """Regroup the flat 'Sample Input N' / 'Sample Output N' stream into pairs, keyed by label number."""
    groups: dict[str, dict] = {}
    order: list[str] = []
    for item in raw or []:
        label = item.get("label") or ""
        match = re.search(r"Sample\s+(Input|Output)\s*(\d*)", label, re.I)
        if not match:
            continue
        key = match.group(2) or "0"
        if key not in groups:
            groups[key] = {}
            order.append(key)
        groups[key]["input" if match.group(1).lower() == "input" else "output"] = item.get("text") or ""
    return [dict(groups[k]) for k in sorted(order, key=lambda k: int(k) if k.isdigit() else 0)]


def build_problems(cfg: Config, ds: Dataset, rows: list[dict], name_to_id: dict[str, str],
                   set_ids: dict[str, str], resolve: ImageResolver) -> dict[str, dict]:
    """Problem, test-case and (page) solution entities. Returns problem id -> parsed page data."""
    diff = load_difficulty(cfg, ds)
    html_dir = cfg.scraper_dir / "statements_html"
    per_set: dict[str, int] = {}
    parsed_pages: dict[str, dict] = {}

    for row in rows:
        topic_id = name_to_id.get(row["topic"])
        sid = set_ids.get(f"{row['topic']}|{row['section']}")
        if topic_id is None or sid is None:
            continue  # already reported once as unmapped_topic
        path = html_dir / f"{row['uuid']}.html"
        ctx = {"entity_type": "problem", "entity_id": row["uuid"]}
        text = read_text(path, ds, **ctx)
        if text is None:
            continue
        parsed = qp.parse_text(text)
        if parsed is None or not parsed["blocks"]:
            ds.issue(ERROR, "unparseable_statement", f"{path.name} has no readable statement",
                     source_path=str(path), **ctx)
            continue

        per_set[sid] = per_set.get(sid, 0) + 1
        content = splice_image_blocks(blocks_to_json(parsed["blocks"]), statement_images(text), resolve)
        samples = [{"label": label, "text": body} for label, body in parsed["samples"]]
        ds.add(Entity("problem", row["uuid"], {
            "set_id": sid, "topic_id": topic_id, "title": row["title"], "difficulty": diff.get(row["uuid"]),
            "source_url": row["url"], "position": per_set[sid], "content": content, "samples": samples,
            "content_hash": legacy_content_hash({"content": content, "samples": samples,
                                                 "solution": parsed["solution"]}),
        }, str(path)))
        parsed_pages[row["uuid"]] = {"solution": parsed["solution"], "samples": samples, "path": str(path)}

        for position, case in enumerate(to_samples(samples)):
            if "output" not in case:
                ds.issue(WARNING, "sample_incomplete",
                         f"sample {position + 1} has an input but no expected output; no test case made",
                         source_path=str(path), **ctx)
                continue
            if case["output"] == "":
                ds.issue(WARNING, "sample_empty_output", f"sample {position + 1} expects empty output",
                         source_path=str(path), **ctx)
            ds.add(Entity("case", case_id(row["uuid"], position), {
                "problem_id": row["uuid"], "input": case.get("input", ""), "expected_output": case["output"],
                "is_sample": position == 0, "position": position,
            }, str(path)))
        if not to_samples(samples):
            ds.issue(WARNING, "no_samples", "the problem has no sample cases, so it has no test cases",
                     source_path=str(path), **ctx)
    return parsed_pages


def build_solutions(cfg: Config, ds: Dataset, parsed_pages: dict[str, dict]) -> None:
    """Reference solutions: solutions.json first (authored and verified), else the code saved on the page.

    Never published here; whether a solution may be shown to students is decided after review.
    """
    path = cfg.scraper_dir / "solutions.json"
    authored: dict[str, str] = {}
    if path.exists():
        data = read_json(path, ds)
        if isinstance(data, dict):
            for pid, code in data.items():
                if not is_uuid(pid) or not isinstance(code, str) or not code.strip():
                    ds.issue(WARNING, "bad_solution_entry", "solutions.json entry is not '<problem uuid>': '<code>'",
                             entity_type="solution", entity_id=str(pid), source_path=str(path))
                    continue
                authored[pid] = code
        elif data is not None:
            ds.issue(ERROR, "invalid_solutions_file", "solutions.json must be an object", source_path=str(path))

    origin: dict[str, str] = {}
    for pid, page in parsed_pages.items():
        code = authored.get(pid)
        if code is not None:
            origin[pid] = "solutions.json"
        elif page["solution"].strip():
            code, origin[pid] = page["solution"], "page"
        else:
            continue
        ds.add(Entity("solution", pid, {"solution": code, "language": PYTHON}, page["path"]))
    stray = sorted(set(authored) - set(parsed_pages))
    if stray:
        ds.issue(WARNING, "solution_without_problem", f"{len(stray)} solutions.json entries match no imported problem",
                 source_path=str(path), context={"ids": stray[:10]})
    ds.stats["solution_origin"] = origin


# --- MCQs ---------------------------------------------------------------------------------------------------------
def build_mcqs(cfg: Config, ds: Dataset, topics_by_id: dict[str, dict], resolve: ImageResolver) -> None:
    files = sorted((cfg.scraper_dir / "mcq_json").glob("*.json")) if (cfg.scraper_dir / "mcq_json").is_dir() else []
    if not files:
        ds.issue(WARNING, "no_mcq_files", "mcq_json/ has no files; no MCQ sets imported")
    per_topic: dict[str, int] = {}
    captured: dict[str, dict] = {}
    for path in files:
        d = read_json(path, ds, entity_type="mcq_set", entity_id=path.stem)
        if not isinstance(d, dict):
            continue
        ctx = {"entity_type": "mcq_set", "entity_id": str(d.get("set_id") or path.stem), "source_path": str(path)}
        questions = d.get("questions") or []
        if not questions:
            ds.issue(WARNING, "empty_mcq_set", "the set has no captured questions", **ctx)
            continue
        m = re.search(r"t_id=([0-9a-f-]{36})", d.get("url", ""), re.I)
        topic_id = m.group(1).lower() if m and m.group(1).lower() in topics_by_id else None
        if topic_id is None or not is_uuid(d.get("set_id")) or not str(d.get("name") or "").strip():
            ds.issue(ERROR, "bad_mcq_set", "needs a set_id, a name and a t_id that matches topics.txt", **ctx)
            continue

        per_topic[topic_id] = per_topic.get(topic_id, 0) + 1
        ds.add(Entity("mcq_set", d["set_id"], {
            "topic_id": topic_id, "name": d["name"], "exam_content_type": d.get("exam_content_type"),
            "source_url": d.get("url", ""), "expected_count": d.get("expected") or 0,
            "position": per_topic[topic_id],
        }, str(path)))
        captured[d["set_id"]] = {"expected": d.get("expected") or 0, "captured": len(questions)}

        for q in questions:
            qctx = {"entity_type": "mcq", "entity_id": str(q.get("question_id")), "source_path": str(path)}
            if not is_uuid(q.get("question_id")):
                ds.issue(ERROR, "bad_mcq", "question has no valid question_id", **qctx)
                continue
            options = []
            for index, o in enumerate(sorted(q.get("options") or [], key=lambda o: o.get("order", 0))):
                options.append({"id": o.get("option_id"), "label": qp.LETTERS[index % len(qp.LETTERS)],
                                "content": qp.from_html(o.get("content", ""))})
            src, lang = qp.code_of(q)
            question = q.get("question") or {}
            images = [resolve(m["url"]) for m in (question.get("multimedia") or [])
                      if m.get("format") == "IMAGE" and m.get("url")]
            prompt = rewrite_markdown_images(qp.from_html(question.get("content", "")), resolve)
            prompt += "".join(f"\n\n![question image]({u})" for u in images if u)
            ds.add(Entity("mcq", q["question_id"], {
                "mcq_set_id": d["set_id"], "position": q.get("question_number") or 0,
                "question_type": q.get("question_type", ""), "prompt": prompt, "code": src or None,
                "code_lang": lang if src else None, "options": options, "content_hash": legacy_content_hash(q),
            }, str(path)))
    ds.stats["mcq_sets"] = captured


# --- cheat sheets -------------------------------------------------------------------------------------------------
def load_sheet_titles(cfg: Config, ds: Dataset) -> list[tuple[str, str, str | None]]:
    path = cfg.scraper_dir / "urls.txt"
    text = read_text(path, ds)
    out = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        url, _, title = line.partition("|")
        url, title = url.strip(), title.strip()
        if not url.startswith("http") or not title:
            continue
        m = re.search(r"t_id=([0-9a-f-]{36})", url, re.I)
        out.append((url, title, m.group(1).lower() if m else None))
    return out


def parse_sheet_html(text: str, resolve: ImageResolver) -> list[dict]:
    soup = BeautifulSoup(text, qp.html_parser())
    body = soup.body
    if body is None:
        return []
    blocks: list[dict] = []
    for el in body.find_all(["h2", "h3", "p", "ul", "div", "table", "img"], recursive=False):
        classes = el.get("class") or []
        if el.name == "img":
            src = (el.get("src") or "").strip()
            local = resolve(src) if is_content_image(src) else None
            if local:
                blocks.append({"type": "image", "url": local, "alt": " ".join((el.get("alt") or "").split())})
        elif el.name in ("h2", "h3"):
            t = el.get_text(strip=True)
            if t:
                blocks.append({"type": "heading", "text": t})
        elif el.name == "p":
            if "out-label" in classes:
                continue
            t = el.get_text(strip=True)
            if t and t.lower() not in CHROME_LABELS:
                blocks.append({"type": "paragraph", "text": t})
        elif el.name == "ul":
            for li in el.find_all("li", recursive=False):
                t = li.get_text(strip=True)
                if t:
                    blocks.append({"type": "list_item", "text": t})
        elif el.name == "div" and "code-card" in classes:
            lang_el, src_el = el.find(class_="lang"), el.find(class_="src")
            t = src_el.get_text() if src_el else ""
            if t.strip():
                blocks.append({"type": "code", "text": t, "lang": lang_el.get_text(strip=True) if lang_el else None})
        elif el.name == "div" and "out-card" in classes:
            pre = el.find("pre")
            t = pre.get_text() if pre else ""
            if t.strip():
                blocks.append({"type": "code", "text": t, "lang": "OUTPUT"})
        elif el.name == "table" and "tbl" in classes:
            for tr in el.find_all("tr"):
                cells = [c.get_text(strip=True) for c in tr.find_all(["th", "td"])]
                if cells:
                    blocks.append({"type": "paragraph", "text": " | ".join(cells)})
    return blocks


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def sheet_title_matches(title: str, file_name: str) -> bool:
    """`NN_<Title>.html` against the urls.txt title; file names are truncated, so a prefix match counts."""
    stem = re.sub(r"^\d+_", "", pathlib.Path(file_name).stem)
    a, b = _slug(title), _slug(stem)
    return bool(a and b and (a.startswith(b) or b.startswith(a)))


def build_sheets(cfg: Config, ds: Dataset, topics_by_id: dict[str, dict], resolve: ImageResolver) -> None:
    titled = load_sheet_titles(cfg, ds)
    pdf_dir = cfg.cheat_sheet_dir
    if not pdf_dir.is_dir():
        ds.issue(WARNING, "no_sheet_dir", f"{pdf_dir} does not exist; no cheat sheets imported")
        return
    if not titled:
        # Sheets map to topics only through the t_id in urls.txt; guessing from titles was wrong for most of them.
        ds.issue(WARNING, "sheets_unmappable",
                 "urls.txt has no usable '<url> | <title>' rows, so cheat sheets cannot be tied to topics; "
                 "no sheets imported. Restore urls.txt from the scrape's discover step.",
                 source_path=str(cfg.scraper_dir / "urls.txt"))
        return
    numbered = [p for p in pdf_dir.glob("*.html") if re.match(r"(\d+)_", p.name)]
    if not numbered:
        numbered = [p for p in pdf_dir.glob("course_*.html")]
    key = lambda p: int(re.search(r"(\d+)", p.name).group(1))  # noqa: E731
    source_dir = cfg.scraper_dir / "html"
    source_by_number = {
        key(p): p for p in source_dir.glob("*.html") if re.match(r"(\d+)_", p.name)
    } if source_dir.is_dir() else {}

    per_topic: dict[str, int] = {}
    unsorted: list[Entity] = []
    for path in sorted(numbered, key=key):
        n = key(path)
        ctx = {"entity_type": "sheet", "entity_id": sheet_id(path.name), "source_path": str(path)}
        if n > len(titled):
            ds.issue(ERROR, "sheet_without_url", f"sheet {n} has no row {n} in urls.txt ({len(titled)} rows)", **ctx)
            continue
        url, title, tid = titled[n - 1]
        if not sheet_title_matches(title, path.name):
            ds.issue(WARNING, "sheet_title_mismatch",
                     f"file {path.name} is matched by number to urls.txt title {title!r}", **ctx)

        blocks: list[dict] = []
        source = source_by_number.get(n)
        if source is not None:
            text = read_text(source, ds, **ctx)
            blocks = parse_sheet_html(text, resolve) if text else []
        if not blocks:
            text = read_text(path, ds, **ctx)
            blocks = parse_sheet_html(text, resolve) if text else []
        if not blocks:
            ds.issue(ERROR, "unparseable_sheet", f"{path.name} produced no content blocks", **ctx)
            continue

        pdf_name = path.stem + ".pdf"
        payload = {
            "title": title, "source_url": url, "content": blocks,
            "content_hash": legacy_content_hash(blocks),
            "pdf_storage_path": pdf_name if (pdf_dir / pdf_name).exists() else None,
        }
        topic_id = tid if tid in topics_by_id else None
        if topic_id is None:
            unsorted.append(Entity("sheet", ctx["entity_id"], payload, str(path)))
            continue
        per_topic[topic_id] = per_topic.get(topic_id, 0) + 1
        ds.add(Entity("sheet", ctx["entity_id"], {**payload, "topic_id": topic_id, "position": per_topic[topic_id]},
                      str(path)))

    if unsorted:
        max_pos = max((t["position"] for t in topics_by_id.values()), default=0)
        ds.add(Entity("topic", UNSORTED_TOPIC_ID, {"name": "Unsorted", "position": max_pos + 1}, "urls.txt"))
        ds.issue(WARNING, "sheets_unsorted", f"{len(unsorted)} sheet(s) have no topic and go under 'Unsorted'",
                 source_path="urls.txt")
        for position, entity in enumerate(unsorted, 1):
            entity.payload.update({"topic_id": UNSORTED_TOPIC_ID, "position": position})
            ds.add(entity)


def load_dataset(cfg: Config, resolve: ImageResolver | None = None, *, with_fingerprint: bool = True) -> Dataset:
    """Read everything. Problems and sheets are checked against mirrored images through `resolve`."""
    from .validate import validate

    resolve = resolve or ImageResolver()
    ds = Dataset()
    topics_by_id, name_to_id = load_topics(cfg, ds)
    rows = load_manifest_rows(cfg, ds)
    set_ids = build_sets(rows, name_to_id, ds)
    pages = build_problems(cfg, ds, rows, name_to_id, set_ids, resolve)
    build_solutions(cfg, ds, pages)
    build_mcqs(cfg, ds, topics_by_id, resolve)
    build_sheets(cfg, ds, topics_by_id, resolve)

    if resolve.unmirrored:
        severity = ERROR if not resolve.ready else WARNING
        ds.issue(severity, "images_unmirrored",
                 f"{len(resolve.unmirrored)} image reference(s) have no mirrored copy and were dropped; "
                 "run `images` first" if not resolve.ready else
                 f"{len(resolve.unmirrored)} image reference(s) have no mirrored copy and were dropped",
                 context={"urls": sorted(resolve.unmirrored)[:20]})
    ds.stats["images_used"] = len(resolve.used)
    validate(ds)
    if with_fingerprint:
        ds.fingerprint = fingerprint(cfg)
    return ds
