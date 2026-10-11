// Piston-compatible shim that runs each Python program in a throwaway, locked-down Docker container.
// Test infrastructure only: it lets the application's real execution client be exercised against an
// isolated backend. Usage:  node scripts/execution-shim.mjs   (listens on 127.0.0.1:2000)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IMAGE = process.env.SHIM_IMAGE ?? "python:3.12-alpine";
const MAX_OUTPUT_BYTES = 1024 * 1024;

function runContainer({ source, stdin, timeoutMs, memoryBytes }) {
  return new Promise((resolve) => {
    mkdtemp(join(tmpdir(), "acrt-run-")).then(async (dir) => {
      const name = `acrt-run-${randomUUID()}`;
      await writeFile(join(dir, "main.py"), source, { mode: 0o644 });
      const args = [
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--network",
        "none",
        "--memory",
        String(memoryBytes),
        "--memory-swap",
        String(memoryBytes),
        "--pids-limit",
        "64",
        "--cpus",
        "1",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "65534:65534",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "-v",
        `${dir}:/work:ro`,
        "-w",
        "/tmp",
        IMAGE,
        "python",
        "-I",
        "/work/main.py",
      ];
      const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const kill = () => {
        if (killed) return;
        killed = true;
        spawn("docker", ["kill", name], { stdio: "ignore" });
      };
      const timer = setTimeout(kill, timeoutMs);
      const collect = (current, chunk) =>
        current.length >= MAX_OUTPUT_BYTES ? current : current + chunk.toString("utf8");
      child.stdout.on("data", (chunk) => {
        stdout = collect(stdout, chunk);
        if (stdout.length >= MAX_OUTPUT_BYTES) kill();
      });
      child.stderr.on("data", (chunk) => {
        stderr = collect(stderr, chunk);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(stdin ?? "");
      child.on("close", async (code) => {
        clearTimeout(timer);
        await rm(dir, { recursive: true, force: true });
        // 137 is SIGKILL (timeout, memory or output limit); the process has no ordinary exit status.
        const signal = killed || code === 137 ? "SIGKILL" : null;
        resolve({ stdout, stderr, code: signal ? null : code, signal });
      });
    });
  });
}

export function startShim({ port = 0, maxTimeoutMs = 10_000 } = {}) {
  const server = createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && request.url === "/runtimes") {
      return send(200, [{ language: "python", version: "3.12.0", aliases: ["py"] }]);
    }
    if (request.method === "POST" && request.url === "/execute") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { message: "Invalid JSON" });
      }
      if (body.language !== "python") return send(400, { message: "Only python is available" });
      const source = body.files?.[0]?.content;
      if (typeof source !== "string") return send(400, { message: "No source" });
      const run = await runContainer({
        source,
        stdin: typeof body.stdin === "string" ? body.stdin : "",
        timeoutMs: Math.min(Number(body.run_timeout) || maxTimeoutMs, maxTimeoutMs),
        memoryBytes: Math.min(
          Number(body.run_memory_limit) || 256 * 1024 * 1024,
          256 * 1024 * 1024,
        ),
      });
      return send(200, { language: "python", version: "3.12.0", run });
    }
    send(404, { message: "Not found" });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const shim = await startShim({ port: 2000 });
  console.log(`Execution shim listening on ${shim.url} (image ${IMAGE})`);
}
