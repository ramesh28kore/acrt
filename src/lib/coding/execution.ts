import { languageSpec } from "./languages";

export type RunOutcome = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timeMs: number;
};

export type ExecutionEnv = {
  PISTON_URL?: string | undefined;
  CODE_EXEC_URL?: string | undefined;
  CODE_EXEC_SECRET?: string | undefined;
};

export type BackendName = "piston" | "endpoint" | "none";

export class ExecutionError extends Error {
  constructor(
    message: string,
    readonly kind: "rejected" | "unsupported" | "unavailable" | "busy",
  ) {
    super(message);
    this.name = "ExecutionError";
  }
}

export const LIMITS = {
  maxSourceBytes: 64 * 1024,
  maxStdinBytes: 64 * 1024,
  maxOutputChars: 64 * 1024,
  runTimeoutMs: 10_000,
  compileTimeoutMs: 10_000,
  runMemoryBytes: 256 * 1024 * 1024,
  requestTimeoutMs: 30_000,
} as const;

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

function truncate(text: string): string {
  return text.length <= LIMITS.maxOutputChars
    ? text
    : `${text.slice(0, LIMITS.maxOutputChars)}\n… output truncated …`;
}

// Untrusted code is never run inside the application process: only a remote, isolated runner is used.
// There is deliberately no local fallback; an unconfigured environment reports "none".
export function selectBackend(env: ExecutionEnv): BackendName {
  if (env.PISTON_URL?.trim()) return "piston";
  if (env.CODE_EXEC_URL?.trim() && env.CODE_EXEC_SECRET?.trim()) return "endpoint";
  return "none";
}

type PistonRuntime = { language: string; version: string; aliases?: string[] };
type PistonResult = {
  run?: { stdout?: string; stderr?: string; code?: number | null; signal?: string | null };
  compile?: { stdout?: string; stderr?: string; code?: number | null };
  message?: string;
};

export type Executor = {
  backend: BackendName;
  run(language: string, source: string, stdin: string): Promise<RunOutcome>;
};

function validate(language: string, source: string, stdin: string) {
  const spec = languageSpec(language);
  if (!spec) throw new ExecutionError(`Unsupported language: ${language}`, "unsupported");
  if (byteLength(source) > LIMITS.maxSourceBytes) {
    throw new ExecutionError("The program is too large to run.", "rejected");
  }
  if (byteLength(stdin) > LIMITS.maxStdinBytes) {
    throw new ExecutionError("The input is too large.", "rejected");
  }
  return spec;
}

export function createExecutor(env: ExecutionEnv, fetchImpl: typeof fetch = fetch): Executor {
  const backend = selectBackend(env);
  const runtimeVersions = new Map<string, string>();

  async function pistonVersion(base: string, name: string): Promise<string> {
    const cached = runtimeVersions.get(name);
    if (cached) return cached;
    let response: Response;
    try {
      response = await fetchImpl(`${base}/runtimes`, {
        cache: "no-store",
        signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
      });
    } catch {
      throw new ExecutionError("The code runner is unavailable. Try again shortly.", "unavailable");
    }
    if (!response.ok) throw new ExecutionError("The code runner is unavailable.", "unavailable");
    const runtimes = (await response.json().catch(() => [])) as PistonRuntime[];
    const match = runtimes.find((r) => r.language === name || r.aliases?.includes(name));
    if (!match)
      throw new ExecutionError(
        `The ${name} runtime is not installed on the runner.`,
        "unsupported",
      );
    runtimeVersions.set(name, match.version);
    return match.version;
  }

  async function viaPiston(language: string, source: string, stdin: string): Promise<RunOutcome> {
    const spec = validate(language, source, stdin);
    const base = (env.PISTON_URL ?? "").trim().replace(/\/$/, "");
    const version = await pistonVersion(base, spec.piston);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(`${base}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: spec.piston,
          version,
          files: [{ name: spec.filename, content: source }],
          stdin,
          run_timeout: LIMITS.runTimeoutMs,
          compile_timeout: LIMITS.compileTimeoutMs,
          run_memory_limit: LIMITS.runMemoryBytes,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
      });
    } catch {
      throw new ExecutionError("The code runner is unavailable. Try again shortly.", "unavailable");
    }
    const timeMs = Date.now() - startedAt;
    const data = (await response.json().catch(() => ({}))) as PistonResult;
    if (!response.ok || !data.run) {
      throw new ExecutionError("The code runner could not run this program.", "unavailable");
    }
    if (data.compile && data.compile.code !== 0) {
      return {
        stdout: truncate(data.compile.stdout ?? ""),
        stderr: truncate(data.compile.stderr ?? ""),
        exitCode: data.compile.code ?? 1,
        signal: null,
        timeMs,
      };
    }
    return {
      stdout: truncate(data.run.stdout ?? ""),
      stderr: truncate(data.run.stderr ?? ""),
      exitCode: data.run.code ?? null,
      signal: data.run.signal ?? null,
      timeMs,
    };
  }

  async function viaEndpoint(language: string, source: string, stdin: string): Promise<RunOutcome> {
    validate(language, source, stdin);
    // The bundled runner is Python-only.
    if (language !== "python") {
      throw new ExecutionError(`Running ${language} needs a Piston runner.`, "unsupported");
    }
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl((env.CODE_EXEC_URL ?? "").trim(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-exec-secret": (env.CODE_EXEC_SECRET ?? "").trim(),
        },
        body: JSON.stringify({ code: source, stdin, timeoutSeconds: LIMITS.runTimeoutMs / 1000 }),
        cache: "no-store",
        signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
      });
    } catch {
      throw new ExecutionError("The code runner is unavailable. Try again shortly.", "unavailable");
    }
    const data = (await response.json().catch(() => ({}))) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
      signal?: string | null;
    };
    if (!response.ok)
      throw new ExecutionError("The code runner could not run this program.", "unavailable");
    return {
      stdout: truncate(data.stdout ?? ""),
      stderr: truncate(data.stderr ?? ""),
      exitCode: data.exitCode ?? null,
      signal: data.signal ?? null,
      timeMs: Date.now() - startedAt,
    };
  }

  return {
    backend,
    async run(language, source, stdin) {
      if (backend === "piston") return viaPiston(language, source, stdin);
      if (backend === "endpoint") return viaEndpoint(language, source, stdin);
      validate(language, source, stdin);
      throw new ExecutionError("Code execution is not configured on this server.", "unavailable");
    },
  };
}

// Bounds how much work one process queues. Per-user fairness stops one account flooding the runner.
export function createLimiter(options: {
  maxConcurrent: number;
  maxQueue: number;
  maxPerUser: number;
}) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const perUser = new Map<string, number>();

  return async function limited<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const mine = perUser.get(userId) ?? 0;
    if (mine >= options.maxPerUser) {
      throw new ExecutionError(
        "You already have runs in progress. Wait for them to finish.",
        "busy",
      );
    }
    if (active >= options.maxConcurrent && waiting.length >= options.maxQueue) {
      throw new ExecutionError("The code runner is busy. Try again in a moment.", "busy");
    }
    perUser.set(userId, mine + 1);
    if (active >= options.maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const left = (perUser.get(userId) ?? 1) - 1;
      if (left <= 0) perUser.delete(userId);
      else perUser.set(userId, left);
      waiting.shift()?.();
    }
  };
}
