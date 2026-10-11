import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  draftInputSchema,
  playgroundDeleteSchema,
  playgroundRunSchema,
  playgroundSaveSchema,
  problemInputSchema,
  runInputSchema,
} from "./coding.contracts";

// Every handler loads the service layer lazily so server-only code and keys stay out of the browser bundle.
async function load(context: { supabase: unknown; userId: string }) {
  const service = await import("./coding.server");
  const { codingDeps } = await import("./coding.runtime.server");
  const db = context.supabase as Parameters<typeof service.resolveCoder>[0];
  const coder = await service.resolveCoder(db, context.userId);
  return { service, deps: codingDeps(), db, coder };
}

export const codingProblems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { service, db, coder } = await load(context);
    return service.listProblems(db, coder);
  });

export const codingProblem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => problemInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, deps, db, coder } = await load(context);
    return service.getProblemDetail(db, coder, deps.executor.backend, data.problemId);
  });

export const codingRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => runInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, deps, db, coder } = await load(context);
    return service.runSamples(deps, db, coder, data.problemId, data.code);
  });

export const codingSubmit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => runInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, deps, db, coder } = await load(context);
    return service.submit(deps, db, coder, data.problemId, data.code);
  });

export const codingSolution = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => problemInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, coder } = await load(context);
    return service.getSolution(db, coder, data.problemId);
  });

export const codingTutorial = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data) => problemInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, coder } = await load(context);
    return service.getTutorial(db, coder, data.problemId);
  });

export const codingDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => draftInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, coder } = await load(context);
    return service.saveDraft(db, coder, data.problemId, data.code);
  });

export const codingValidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => problemInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, deps, db, coder } = await load(context);
    return service.validateReference(deps, db, coder, data.problemId);
  });

export const playgroundRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => playgroundRunSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, deps, db, coder } = await load(context);
    return service.runPlayground(deps, db, coder, data);
  });

export const playgroundPrograms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { service, db, coder } = await load(context);
    return service.listPrograms(db, coder);
  });

export const playgroundSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => playgroundSaveSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, coder } = await load(context);
    return service.saveProgram(db, coder, data);
  });

export const playgroundDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => playgroundDeleteSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { service, db, coder } = await load(context);
    return service.deleteProgram(db, coder, data.id);
  });
