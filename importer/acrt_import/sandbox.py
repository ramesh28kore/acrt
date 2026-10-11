"""Run reference solutions and snippets without trusting them: no network, capped memory and processes, read-only."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from typing import Protocol

IMAGE = "python:3.12-alpine"
CASE_TIMEOUT_S = 5
OUTPUT_LIMIT = 100_000

HARNESS = '''\
import json, os, subprocess, sys

LIMIT = %d
PER_CASE = float(os.environ.get("CASE_TIMEOUT", "5"))
results = []
for stdin in json.load(open("cases.json", encoding="utf-8")):
    try:
        p = subprocess.run([sys.executable, "-I", "solution.py"], input=stdin, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=PER_CASE)
        results.append({"ok": p.returncode == 0, "stdout": p.stdout[:LIMIT], "error": p.stderr[-400:], "timed_out": False})
    except subprocess.TimeoutExpired:
        results.append({"ok": False, "stdout": "", "error": "timed out", "timed_out": True})
print(json.dumps(results))
''' % OUTPUT_LIMIT


class SandboxUnavailable(Exception):
    """Docker is missing or not responding. A run must stop rather than record a false verdict."""


@dataclass
class RunResult:
    ok: bool
    stdout: str
    error: str
    timed_out: bool = False


class Sandbox(Protocol):
    def run(self, code: str, stdins: list[str]) -> list[RunResult]: ...


def prepare_stdin(text: str) -> str:
    return text if not text or text.endswith("\n") else text + "\n"


class DockerSandbox:
    def __init__(self, image: str = IMAGE, memory: str = "256m", pids: int = 64):
        self.image, self.memory, self.pids = image, memory, pids

    def check(self) -> None:
        try:
            done = subprocess.run(["docker", "image", "inspect", self.image], capture_output=True, timeout=30)
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            raise SandboxUnavailable(f"Docker is not available: {exc}") from exc
        if done.returncode != 0:
            raise SandboxUnavailable(f"Docker image {self.image} is not present locally; run `docker pull {self.image}`.")

    def run(self, code: str, stdins: list[str]) -> list[RunResult]:
        if not stdins:
            return []
        with tempfile.TemporaryDirectory(prefix="acrt-sandbox-") as tmp:
            work = pathlib.Path(tmp)
            (work / "solution.py").write_text(code, encoding="utf-8")
            (work / "cases.json").write_text(json.dumps([prepare_stdin(s) for s in stdins]), encoding="utf-8")
            (work / "harness.py").write_text(HARNESS, encoding="utf-8")
            if os.name != "nt":
                work.chmod(0o755)
                for f in work.iterdir():
                    f.chmod(0o644)
            name = f"acrt-import-{uuid.uuid4().hex[:12]}"
            cmd = [
                "docker", "run", "--rm", "--name", name, "--network", "none",
                "--memory", self.memory, "--memory-swap", self.memory, "--pids-limit", str(self.pids),
                "--cpus", "1", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--tmpfs", "/tmp:size=16m,noexec", "--user", "65534:65534",
                "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", f"CASE_TIMEOUT={CASE_TIMEOUT_S}",
                "-v", f"{work}:/work:ro", "-w", "/work", self.image, "python", "-I", "harness.py",
            ]
            budget = CASE_TIMEOUT_S * len(stdins) + 30
            try:
                done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                      timeout=budget)
            except FileNotFoundError as exc:
                raise SandboxUnavailable("Docker is not installed or not on PATH.") from exc
            except subprocess.TimeoutExpired:
                subprocess.run(["docker", "rm", "-f", name], capture_output=True)
                return [RunResult(False, "", "timed out", True) for _ in stdins]

        if done.returncode != 0 and not done.stdout.strip():
            tail = (done.stderr or "").strip()[-300:]
            if "docker daemon" in tail.lower() or "cannot connect" in tail.lower() or "pipe" in tail.lower():
                raise SandboxUnavailable(tail)
            return [RunResult(False, "", f"sandbox failed: {tail}") for _ in stdins]
        try:
            rows = json.loads(done.stdout)
        except json.JSONDecodeError:
            return [RunResult(False, "", "sandbox produced no result") for _ in stdins]
        return [RunResult(r["ok"], r["stdout"], r["error"], r["timed_out"]) for r in rows]
