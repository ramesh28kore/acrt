import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createExecutor, createLimiter } from "./execution";
import type { Deps } from "./coding.server";

// One executor and limiter per server instance. The service client is used only for the grader's
// privileged reads and writes; it never reaches the browser.
let cached: Deps | undefined;

export function codingDeps(): Deps {
  cached ??= {
    executor: createExecutor({
      PISTON_URL: process.env["PISTON_URL"],
      CODE_EXEC_URL: process.env["CODE_EXEC_URL"],
      CODE_EXEC_SECRET: process.env["CODE_EXEC_SECRET"],
    }),
    limit: createLimiter({ maxConcurrent: 4, maxQueue: 16, maxPerUser: 2 }),
    service: () => supabaseAdmin,
  };
  return cached;
}
