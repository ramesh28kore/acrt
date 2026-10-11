"""Parsers for the saved CCBP question pages and MCQ captures.

Vendored from the scraper's questions_pdf.py (parse and its helpers) and mcq_pdf.py (code_of) so this package no
longer imports code from a folder outside the repository. Behaviour is kept identical on purpose: problem ids,
block order and sample pairing must not drift between the old importer and this one. Golden tests in
importer/tests/test_parsing.py pin it.
"""

from __future__ import annotations

import html as _html
import pathlib
import re

from bs4 import BeautifulSoup, NavigableString, Tag

TABS = {"description", "submissions", "tutorial", "discuss",
        "code playground", "get help", "help", "report an issue"}
STATUS = {"solved", "unsolved", "attempted"}
DIFF = {"easy", "medium", "hard"}
HEADS = {"input", "output", "explanation", "constraints", "note", "notes"}

JUNK = re.compile(
    r"(connect with course mentors|follow these steps|click on start|"
    r"copy the link and share|once the mentor|code and learn together|"
    r"^start$|give feedback|was this helpful|^helpful$)", re.I)

# Ace measures its font with a hidden node of one glyph repeated dozens of times.
FILLER = re.compile(r"(\S)\1{14,}")
SAMPLE = re.compile(r"^\s*sample\s*(input|output)\s*(\d*)\s*:?\s*$", re.I)
MD_TAG = re.compile(r"^markdown-(h[1-6]|p|highlighted-code|strong|em|li)-tag$")

LETTERS = "ABCDEFGH"

# Only strip tags we know: a bare `<[^>]+>` sweep also eats option text such as "<class 'list'>".
KNOWN_TAGS = (
    r"(?:br|p|div|span|code|pre|b|i|u|em|strong|sub|sup|ul|ol|li|h[1-6]"
    r"|table|thead|tbody|tr|td|th|img|a|blockquote|hr|font|s|strike|small|big)"
)


def esc(s) -> str:
    return _html.escape(str(s), quote=False)


def from_html(raw: str) -> str:
    txt = re.sub(r"<br\s*/?>", "\n", raw or "", flags=re.I)
    txt = re.sub(rf"</?\s*{KNOWN_TAGS}(?:\s[^>]*?)?/?>", " ", txt, flags=re.I)
    txt = _html.unescape(txt)
    txt = re.sub(r"[ \t]+", " ", txt)
    return "\n".join(line.strip() for line in txt.split("\n")).strip()


def code_of(q: dict) -> tuple[str, str]:
    ca = q.get("code_analysis") or {}
    det = ca.get("code_details") or {}
    src = (det.get("code") or "").rstrip("\n")
    lang = (det.get("language") or "PYTHON").replace("PYTHON39", "PYTHON")
    if not src:
        fib = q.get("fib_coding") or {}
        det = fib.get("code_details") or {}
        src = (det.get("code") or "").rstrip("\n")
        lang = (det.get("language") or "PYTHON").replace("PYTHON39", "PYTHON")
    return src, lang


def tidy(html: str) -> str:
    html = re.sub(r"\s+", " ", html).strip()
    html = re.sub(r"\s+([,.;:!?%)\]])", r"\1", html)
    html = re.sub(r"([(\[])\s+", r"\1", html)
    return html


def parse_markdown(md) -> list[tuple[str, str]]:
    """Rebuild paragraphs from the markdown fragments, in document order."""
    inner = md.select_one("#mark-down") or md
    out: list[tuple[str, str]] = []
    buf: list[str] = []

    def flush():
        if buf:
            text = tidy(" ".join(buf))
            if text:
                out.append(("p", text))
            buf.clear()

    def md_kind(el) -> str:
        for c in el.get("class", []) or []:
            m = MD_TAG.match(c)
            if m:
                return m.group(1)
        return ""

    def walk(node) -> None:
        for child in node.children:
            if isinstance(child, NavigableString):
                text = " ".join(str(child).split())
                if FILLER.search(text):
                    continue
                if text and not JUNK.search(text):
                    buf.append(esc(text))
                continue
            if not isinstance(child, Tag):
                continue

            kind = md_kind(child)
            text = " ".join(child.get_text(" ", strip=True).split())

            classes = " ".join(child.get("class", []) or [])
            if "markdown-code-block-container" in classes:
                flush()
                src = "\n".join(l.get_text("", strip=False) for l in child.select(".ace_line"))
                if not src.strip():
                    src = child.get_text("\n", strip=True)
                lang = child.select_one(".markdown-language-label-text")
                src = "\n".join(ln.rstrip() for ln in src.split("\n")).strip("\n")
                if src.strip():
                    out.append(("code", src if not lang else
                                f"{lang.get_text(strip=True).upper()}\x00{src}"))
                continue
            if child.name == "pre":
                flush()
                if text:
                    out.append(("code", child.get_text("", strip=False).strip("\n")))
                continue
            if kind.startswith("h") and kind != "highlighted-code":
                flush()
                if text and not JUNK.search(text):
                    out.append(("h", esc(text)))
                continue
            if kind == "li":
                flush()
                if text and not JUNK.search(text):
                    out.append(("li", esc(text)))
                continue
            if kind == "highlighted-code":
                if text:
                    buf.append(f"<code>{esc(text)}</code>")
                continue
            if kind in ("strong", "em"):
                if text:
                    tag = "strong" if kind == "strong" else "em"
                    buf.append(f"<{tag}>{esc(text)}</{tag}>")
                continue
            if kind == "p":
                joined = tidy(" ".join(buf))
                if joined and re.search(r"[.:!?]$", joined):
                    flush()
                walk(child)
                continue
            walk(child)

    walk(inner)
    flush()
    return out


def parse_samples(root) -> list[tuple[str, str]]:
    """Pair each "Sample Input/Output N" label with the <pre> that follows it; headings are not labels."""
    headings = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def in_heading(node) -> bool:
        for parent in node.parents:
            if not isinstance(parent, Tag):
                continue
            if parent.name in headings:
                return True
            if parent.name in {"body", "html"}:
                break
        return False

    samples: list[tuple[str, str]] = []
    pending: str | None = None
    skip: set[int] = set()

    for node in root.descendants:
        if id(node) in skip:
            continue
        if isinstance(node, Tag) and node.name == "pre":
            for d in node.descendants:
                skip.add(id(d))
            if pending is not None:
                samples.append((pending, node.get_text("", strip=False).strip("\n")))
                pending = None
            continue
        if isinstance(node, NavigableString):
            text = " ".join(str(node).split())
            if SAMPLE.match(text) and not in_heading(node):
                if pending is not None:
                    samples.append((pending, ""))
                pending = text
    if pending is not None:
        samples.append((pending, ""))
    return samples


def clean_solution(src: str, blocks, samples) -> str:
    """Reject a 'solution' that is really page content (an embedded code block or a sample)."""
    if not src.strip():
        return ""
    norm = "\n".join(l.rstrip() for l in src.strip().split("\n"))
    for kind, text in blocks:
        if kind != "code":
            continue
        body = text.partition("\x00")[2] or text
        if "\n".join(l.rstrip() for l in body.strip().split("\n")) == norm:
            return ""
    for _label, text in samples:
        if text.strip() and "\n".join(l.rstrip() for l in text.strip().split("\n")) == norm:
            return ""
    return src


def editor_source(soup) -> str:
    """The code saved in the answer editor, scoped so an explanation's own code block is not spliced in."""
    ed = soup.select_one("#answer-editor")
    if ed is not None:
        lines = [l.get_text("", strip=False) for l in ed.select(".ace_line")]
    else:
        lines = [l.get_text("", strip=False) for l in soup.select("body > .ace_content .ace_line")]
        if not lines:
            blocks = soup.select(".ace_content")
            outside = [b for b in blocks if not b.find_parent(class_="markdown-code-block-container")]
            if outside:
                lines = [l.get_text("", strip=False) for l in outside[-1].select(".ace_line")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


_PARSER: str | None = None


def html_parser() -> str:
    """lxml when installed, else the stdlib parser (no wheel exists for a new Python for weeks)."""
    global _PARSER
    if _PARSER is None:
        for name in ("lxml", "html.parser"):
            try:
                BeautifulSoup("<p>x</p>", name)
            except Exception:
                continue
            _PARSER = name
            break
        else:
            _PARSER = "html.parser"
    return _PARSER


def parse_text(text: str) -> dict | None:
    """Parse one saved question page (already decoded) into blocks, samples and the saved solution."""
    soup = BeautifulSoup(text, html_parser())
    for t in ("script", "style", "noscript", "svg", "iframe", "button"):
        for e in soup.find_all(t):
            e.decompose()

    root = (soup.select_one("[class*='CodingQuestionContentComponent']")
            or soup.select_one("#coding-question-title-wrapper-id")
            or soup.body)
    if root is None:
        return None

    strings = []
    for s in root.stripped_strings:
        s = " ".join(s.split())
        if s and not JUNK.search(s):
            strings.append(s)
    if not strings:
        return None

    md = root.select_one(".markdown-body")
    if md is not None:
        blocks = parse_markdown(md)
        if blocks:
            samples = parse_samples(root)
            return {"blocks": blocks, "samples": samples,
                    "solution": clean_solution(editor_source(soup), blocks, samples)}

    samples = parse_samples(root)
    pres = [t for _l, t in samples]

    i = 0
    while i < len(strings) and (strings[i].lower() in TABS
                                or strings[i].lower() in STATUS
                                or strings[i].lower() in DIFF):
        i += 1
    if i < len(strings) and not SAMPLE.match(strings[i]):
        i += 1
    while i < len(strings) and (strings[i].lower() in TABS
                                or strings[i].lower() in STATUS
                                or strings[i].lower() in DIFF):
        i += 1

    pre_texts = {p.strip() for p in pres if p.strip()}
    blocks: list[tuple[str, str]] = []
    while i < len(strings):
        s = strings[i]
        if SAMPLE.match(s):
            break
        if s.lower().rstrip(":") in HEADS:
            blocks.append(("h", esc(s.rstrip(":"))))
        elif s not in pre_texts:
            blocks.append(("p", esc(s)))
        i += 1

    return {"blocks": blocks, "samples": samples,
            "solution": clean_solution(editor_source(soup), blocks, samples)}


def parse(path: pathlib.Path) -> dict | None:
    return parse_text(path.read_text(encoding="utf-8"))
