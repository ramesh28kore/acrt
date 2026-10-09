# Avanthi CRT Portal: repository audit

**Date:** 9 October 2026, Asia/Calcutta. **Objective:** understand the actual
workspace, verify its boundaries, and plan improvements before significant
implementation. **Release assessment: FAIL.**

This audit covers `D:\1.AVNT\ACRT`, not an assumed production deployment.
The second supplied attachment was saved verbatim as
[rebuild-project.prompt.md](../rebuild-project.prompt.md). Its requirements
are distinguished below from functionality that actually exists.

## A. Project architecture summary

| Area         | Observed here                                                    | Supplied rebuild target                                                  |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Framework    | TanStack Start 1.168.60, Router 1.170.41, Vite 8.1.5             | Next.js 16 App Router                                                    |
| UI           | React 19.2.8, Tailwind 4.3.3, Radix                              | React 19, Tailwind 4, React Compiler                                     |
| Language     | TypeScript 5.9.3, strict                                         | Strict TypeScript                                                        |
| Data/auth    | Supabase JS 2.117.3, browser storage, server bearer verification | Supabase SSR and cookie sessions                                         |
| Roles        | `app_role` enum + `user_roles` table                             | `profiles.role` text CHECK, separate `is_super_admin`, permission tables |
| Migrations   | One Drizzle SQL migration; empty generated schema/snapshot       | Timestamped Supabase migrations and extensive LMS schema                 |
| Tests        | Vitest 4.1.11; one route test                                    | Unit, JWT/RLS, integration, and browser tests                            |
| Build        | Nitro 3.0.260603-beta, Cloudflare Worker preset                  | Vercel                                                                   |
| Dependencies | `bun.lock`; Bun 1.4.2 used in audit                              | Prompt examples use npm                                                  |

Evidence: [package.json](../package.json), [bun.lock](../bun.lock),
[tsconfig.json](../tsconfig.json), [vite.config.ts](../vite.config.ts), and
installed package manifests. `next`, `@supabase/ssr`, Monaco, and XLSX are
absent. Recharts is installed, but there are no analytics consumers.

At the start there was no `CLAUDE.md` or rebuild prompt. `AGENTS.md` contains
Lovable history rules. `roadmap.md` says a fresh Phase 1 was partly built and
paused pending a source-repository decision. The rebuild prompt's description
of 50 migrations, about 60 routes, and 30 lib modules is not this baseline:
this workspace has one migration, seven page routes, and seven `src/lib` files.

### Routes and backend boundaries

| URL            | Implementation                                            |
| -------------- | --------------------------------------------------------- |
| `/`            | External Lovable blank-page image; no portal sign-in link |
| `/auth`        | Email/password sign-in; request reset email               |
| `/dashboard`   | Highest-role redirect or no-role message                  |
| `/student`     | Profile summary and coming-soon cards                     |
| `/faculty`     | Coming-soon cards                                         |
| `/admin`       | User-management placeholder                               |
| `/super-admin` | Global management placeholder                             |

The pathless `_authenticated/route.tsx` is client-rendered (`ssr: false`).
It calls `auth.getUser()` and checks profile activation. `role-guard.ts` is
explicitly a UX gate; Supabase/server authorization must protect the data.
`me.ts` queries the caller's profile and roles. `AppShell` handles account
display and sign-out.

`admin.functions.ts` declares five server functions: `listUsers` (GET),
`createUser` (POST), `setUserActive` (POST), `listAuditLogs` (GET), and
`bootstrapSuperAdmin` (POST). No application import/caller was found, and
their application handler markers are absent from the built artifact.
These are **dormant definitions**, not verified exposed APIs. There are no
custom API route handlers, Next.js Server Actions, execution backends, or
cron routes.

`start.ts` registers browser bearer attachment and CSRF middleware.
`auth-middleware.ts` verifies JWT claims server-side and derives the user ID
from the verified subject. The service client is in `client.server.ts` and
is dynamically imported inside privileged handlers. SSR/root error boundaries
provide generic error pages and logging.

### Database inventory

`drizzle/migrations/0000_migration.sql` defines four RLS-enabled tables:
`institutes` (PT/Q6 seed), `profiles` (Auth FK, identity/placement/activation),
`user_roles` (Auth FK, enum and unique user/role pair), and `audit_logs`.
There are four SECURITY DEFINER functions: `has_role`, `user_institute`,
`protect_profile_columns`, and `handle_new_user`. They pin `search_path` to
`public` and qualify table names, but do not revoke function EXECUTE.
Two triggers protect profile updates and handle new Auth users.

`drizzle/schema.ts` is intentionally blank; the initial snapshot contains
no tables, enums, or policies. Hosted migration application/ownership is unknown.

## B. Existing functionality and implementation status

| Rebuild area                                     | Status here                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Phase 1: foundation/auth/roles                   | Partial: sign-in, role routing, profile/RLS schema; no join/classes, local seed, complete invite/recovery lifecycle |
| Admin actions                                    | Dormant definitions; no user-management UI, role-change action, user reset action, or permission matrix             |
| Phase 2: sheets/publishing/progress              | Not implemented                                                                                                     |
| Phase 3: practice/sandbox/submissions/playground | Not implemented                                                                                                     |
| Phase 4: quizzes/exam engine                     | Not implemented                                                                                                     |
| Phase 5: academics/classes/import/access         | PT/Q6 institute seeds only; no assignments, academic hierarchy, roll parser, or Excel imports                       |
| Phase 6: schedule/curriculum                     | Not implemented                                                                                                     |
| Phase 7: analytics/gamification/search           | Not implemented                                                                                                     |
| Phase 8: Test Series                             | Not implemented, including answer protection, deadlines and three-warning leave guard                               |
| Phase 9: Super Admin/RBAC/audit                  | Role shell and basic log storage only; panel, permissions, flags, trusted login records absent                      |
| Phase 10: importer/deployment                    | Not implemented                                                                                                     |
| Attendance/timetable/reports/exports             | Roadmap only                                                                                                        |

Preserve the root `<Outlet />`, generated route tree, user-scoped client,
server JWT verification, CSRF registration, separate service client, explicit
manager checks, foreign keys/uniqueness, responsive login layout, and Lovable
integration. These foundation pieces do not establish a completed LMS.

## C. Authentication, authorization, and security findings

Student own-row access and direct role-write denial work in the baseline
fixture. Admin read policies scope by profile institute and Super Admin
policies allow global reads. However, the profile institute is self-editable:
the protection trigger checks `current_user` inside SECURITY DEFINER.
Faculty can read every college profile, including staff. No table policy
checks account activation.

The audit applied the **unmodified migration** to PGlite 0.3.14's in-memory
PostgreSQL 17.5, with synthetic Auth users and a minimal `auth.uid()` function.
Ten security expectations returned **3 PASS and 7 FAIL**. This exercises
real PostgreSQL grants, roles, triggers, and RLS, but not JWTs, GoTrue,
PostgREST, or hosted settings. See [results](audit-evidence/rls-results.json)
and [reproduction](audit-evidence/reproduce-rls.mjs).

PostgreSQL documents that SECURITY DEFINER changes `current_user` and that
new functions grant PUBLIC EXECUTE by default. See
[session identity](https://www.postgresql.org/docs/current/functions-info.html)
and [function security](https://www.postgresql.org/docs/current/sql-createfunction.html).

No service-role value exists in local `.env` or process environment, and no
application service-key marker was found in the public build. Public browser
keys are expected. Signup, email verification, password protections, redirect
allowlists, hosted function ACLs, and whether this SQL was applied are unknown.

Assessment and execution security cannot be assessed as implementations:
those modules do not exist. The rebuild must enforce server grading/deadlines,
hidden answers, assignment scope, and isolated execution. CPU/memory limits
and a shared-secret header alone do not establish sandbox isolation; validate
that property before enabling the planned Python fallback for student code.

## D. Testing and reliability assessment

| Executed check                                   | Result        | Scope/evidence                                                                                      |
| ------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------- |
| Frozen dependency installation                   | PASS          | 540 packages; lifecycle scripts disabled; lock hash unchanged                                       |
| `npm run typecheck`                              | PASS          | TypeScript exit 0                                                                                   |
| `npm run test`                                   | PASS          | One file, one test; matches `/` without loaders/rendering/auth                                      |
| `npm run build`                                  | PASS          | Client, SSR and Cloudflare Worker generated                                                         |
| Tests/build with synthetic CI public environment | PASS          | No production or service-role secrets                                                               |
| `npm run lint`                                   | FAIL          | 282 errors: 280 formatting, one explicit `any`, one `prefer-const`; 6 React refresh warnings        |
| `bun audit --json`                               | FAIL          | 15 entries across 6 package groups: 1 critical, 11 high, 3 moderate; some duplicate advisory ranges |
| In-memory migration/RLS diagnostic               | FAIL          | SQL loads; 7 security expectations fail, 3 pass; diagnostic exits 1                                 |
| Edge public-route smoke check                    | PASS          | Four role routes redirect unauthenticated users to `/auth?redirect=...`                             |
| Login layout at 360px                            | PASS, limited | Document width and scroll width both 360px; screenshot inspected                                    |
| Workflow YAML/local invariants                   | PASS          | Five checks, SHA pins, read-only grants, frozen install, no secret references                       |
| New artifact syntax/lint/format checks           | PASS          | Limited to newly authored artifacts                                                                 |
| Live JWT/RLS and privileged browser tests        | NOT RUN       | No isolated Supabase/test accounts                                                                  |
| GitHub workflow / branch rules                   | NOT RUN       | No Git metadata or advertised remote refs                                                           |
| Production deployment/smoke tests                | NOT RUN       | No deployment performed                                                                             |

The first Vitest attempt hit Windows `spawn EPERM` in Vite's path helper;
approved process access resolved it and the test passed. Docker is installed
but its daemon is stopped. Bun was installed temporarily, not globally.
There are no existing role-guard, mutation, recovery, JWT/RLS, grading, exam,
or automated browser suites, nor coverage thresholds. The diagnostic is audit
evidence, not a replacement for those suites.

## E. GitHub Actions, Vercel, and CI/CD assessment

Originally there was no workflow directory, typecheck script, Vercel config,
deployment script, or migration workflow. `.git` metadata is absent, so branch,
working-tree status, history, and protection rules cannot be determined.
Read-only `git ls-remote https://github.com/ramesh28kore/acrt.git` exited 0
and returned **zero refs**, providing no original application snapshot.

The build confirms the existing Lovable/Nitro Cloudflare preset, not any
deployment. Vercel preview/production integration is unverified. No hosting,
domain, secret, branch rule, migration, account, commit, or push was changed.

### Safe changes implemented

- Added `typecheck` and `audit:deps` package scripts.
- Added `.github/workflows/ci.yml`: separate lint/typecheck/test/build/audit
  matrix jobs, `fail-fast: false`, 15-minute timeout, concurrency cancellation,
  read-only permissions, no persisted checkout credentials, Node 24.19.0,
  Bun 1.4.2, SHA-pinned actions, and frozen installation.
- Workflow uses synthetic public Supabase configuration and has no production
  secrets, deployment, or DB mutation steps. Existing failures remain failures.
- Updated README; preserved rebuild spec; added report and diagnostic evidence.

Action SHAs were verified against upstream refs. The workflow is **locally
prepared**, not executed on GitHub. Linux runner/cache-URL access remains
unverified; Bun's Lovable mirror URLs worked from this machine.

Rollback restores the prior README/package scripts and removes newly added
workflow/report/evidence/spec files. No DB rollback is required. Original
application files, migration, lockfile, and route tree were preserved.

## F. Prioritized risk register

No P0 production compromise was established. P1 findings are source/isolated
defects; deployment exposure is unknown. Dormant/conditional risks are labelled.

### R1 — P1: protected profile fields and tenant isolation are bypassable

**Evidence:** migration lines 26, 73, 76–88 grant table UPDATE and check
`current_user = 'authenticated'` inside SECURITY DEFINER. Reproduction changes
email, roll, institute, and activation; a PT Admin changes institute and reads
a Q6 student (0 rows before, 1 after). **Impact:** placement tampering and
cross-college scope. **Confidence:** high, reproduced. **Correction:** new
migration restricting authenticated UPDATE columns and a correct trusted-context
or invoker trigger defense; preserve migration 0000. **Verify:** actual JWT
PATCHes to all protected fields and cross-college reads/actions are refused.

### R2 — P1: faculty can read every college profile

**Evidence:** migration lines 71–72; same-college Admin row returned in the
reproduction; no assignments exist. **Impact:** unauthorized staff/student
disclosure. **Confidence:** high. **Correction:** assignment-backed policy;
deny peer access until assignments exist. **Verify:** trainer A can see assigned
students and cannot see trainer B's students or staff through direct requests.

### R3 — P1: activation is not a database authorization boundary

**Evidence:** policies/helpers omit `is_active`; inactive fixture can read
data and set itself active. **Impact:** existing tokens retain data access,
and R1 allows reactivation. **Confidence:** high for SQL, hosted banning behavior
untested. **Correction:** active-account checks in policies/server boundaries,
repair R1, and verify Auth session handling. **Verify:** JWT acquired before
deactivation must lose data/RPC access; test refresh and reactivation denial.

### R4 — P1, dormant: privileged actions ignore failures and can fail open

**Evidence:** `admin.functions.ts` lines 91–108 and 119–140 ignore profile,
role, ban, and audit errors. Target-role lookup error becomes an empty array.
**Impact:** partial provisioning, false success, missing audit; a lookup failure
can bypass the protected-Admin check. **Confidence:** high in source; functions
are unconnected. **Correction:** fail closed on reads, check all writes,
transactional DB updates, and explicit Auth compensation/recovery.
**Verify:** fault injection for each query/Auth call; failures cannot return
success or modify protected targets.

### R5 — P1, conditional: privileged bootstrap is a standing email rule

**Evidence:** migration lines 104–115 grant Super Admin on every new user
matching a fixed email; public bootstrap has no auth/rate limit and ignores
count errors. Redirect validation checks URL syntax only. **Impact:** unsafe
recreation/provisioning if signup/email/redirect settings or handler exposure
permit it. **Confidence:** high code evidence, exploitation unverified.
**Correction:** operator-controlled one-time bootstrap for an approved separate
account; verify signup/confirmation/redirect configuration. **Verify:** wrong
identity, unverified email, existing Super Admin, query failure, and disallowed
redirect all refuse bootstrap.

### R6 — P2: anonymous definer helpers expose authorization metadata

**Evidence:** lines 53–61 accept arbitrary user IDs without caller checks or
EXECUTE revocation. Isolated `anon` gets institute/Admin status while direct
profile SELECT is denied. **Impact:** metadata disclosure for known UUIDs.
**Confidence:** high under default ACLs; live ACLs unknown. **Correction:** revoke
PUBLIC/anon execution and constrain subject scope. **Verify:** inspect function
ACLs and real anonymous/authenticated RPC responses.

### R7 — P2: login audit metadata is caller-controlled

**Evidence:** lines 100–101 constrain only actor/action. Fixture inserts an
arbitrary institute, target, details, and 2099 timestamp. Login inserts omit
institute, so college Admin SELECT excludes ordinary sign-ins. **Impact:**
forgeable/incomplete audit history; no failed-login records. **Confidence:** high.
**Correction:** trusted server/DB-derived metadata and protected logging.
**Verify:** spoofing denied and actual sign-ins appear in the correct scope.

### R8 — P2: invitation/recovery and user management are incomplete

**Evidence:** `auth.tsx` lines 35–38 only requests reset email and ignores errors;
no recovery/password-update route, invite acceptance, or management UI exists.
**Impact:** intended account lifecycle cannot be completed through this UI.
**Confidence:** high about absence, email flows untested. **Correction:** complete
flows in the selected architecture and wire validated admin UI. **Verify:** new,
expired, and reset invitations, password change, blocked user, and each role.

### R9 — P2: verification safeguards are missing and lint fails

**Evidence:** one route test; no security/integration/browser suites; 282 lint
errors and 6 warnings. Authored CI has not run on GitHub. **Impact:** regressions
and authorization bugs can escape. **Confidence:** high. **Correction:** fix lint
without disabling checks; add negative-role, fault-injection, JWT/RLS, browser
tests and required PR checks. **Verify:** fresh-clone install and all jobs pass.

### R10 — P2: committed dependencies have known advisories

**Evidence:** [scan](audit-evidence/dependency-audit.json) lists brace-expansion,
esbuild, js-yaml, nanoid, shell-quote, source-map-js. `shell-quote` 1.10.0 enters
via Lovable preset → TanStack devtools → launch-editor; its critical
[advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) is fixed in 1.11.0.
**Impact:** vulnerable tooling; no exploitable portal input path demonstrated.
**Confidence:** high versions/advisories; reachability unverified. **Correction:**
review compatible upstream updates and deliberately regenerate lockfile.
**Verify:** repeat scan and full checks, inspect remaining runtime exposure.
Advisory severity is not a proven P0 incident. No dependencies were updated.

### R11 — P2: migration tooling does not describe the SQL schema

**Evidence:** blank Drizzle schema/empty snapshot, one SQL migration, no
verified migration command; Supabase config only a project ID. **Impact:**
no demonstrated fresh local setup; schema-push assumptions may be unsafe.
**Confidence:** high files, hosted process unknown. **Correction:** reconcile
authoritative schema/history and choose one migration workflow before schema
push/transfer. **Verify:** isolated reset, introspection, comparison and upgrade
with representative data. No production reset/push is authorized.

### R12 — P2: source/target mismatch obstructs feature continuity

**Evidence:** spec/roadmap reference a larger Next.js portal; actual scaffold
is small, history absent, referenced remote has zero refs. **Impact:** rebuilding
from this baseline cannot prove preservation of the original LMS.
**Confidence:** high mismatch, original location unknown. **Correction:** recover
authoritative source, compare parity, review framework/schema transition.
**Verify:** baseline inventory and feature/security parity matrix.

### R13 — P3: public entry and accessible forms need completion

**Evidence:** blank homepage/default metadata; browser confirms auth inputs
have no associated labels, aria-labels, or autocomplete attributes. **Impact:**
poor discoverability and form semantics. **Confidence:** high. **Correction:**
branded entry, labels/autocomplete/status feedback. **Verify:** keyboard,
accessible names and 360px layouts; authenticated shells remain untested.

## G. Top three recommended engineering tasks

1. **Establish authoritative source and bounded Phase 1 target.** Recover the
   original snapshot/history, map it to the ten-phase spec, prepare a reviewable
   Next.js/Vercel transition plan preserving data and Lovable continuity.
   Acceptance: source of truth, schema mapping, ownership, approved scope.
2. **Close authorization gaps before real users.** Address R1–R7 using new
   migrations, assignment/activation enforcement, trusted bootstrap, and
   fail-closed admin actions. Acceptance: negative JWT/RLS and fault-injection
   tests pass. If this SQL is already live, prioritize R1–R3 immediately.
3. **Complete and verify Phase 1.** Finish invite/recovery/management, repair
   lint, resolve advisories, add security/browser suites, verify CI.
   Acceptance: fresh-clone checks and four-role staging flows pass; no remaining
   critical/high release defect; deployment explicitly approved.

## H. Implementation order and approval requirements

| Order | Work                                                         | Boundary / recovery                                                                                                   |
| ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1     | Source recovery, comparison, bounded target plan             | Read-only work safe; framework/history replacement needs scope approval; preserve original snapshot/published commits |
| 2     | New local authorization migrations and tests                 | Local patches safe; review applied history/grants/data compatibility, test staging, then approve live changes         |
| 3     | Auth lifecycle, admin UI, reliable writes                    | Proceed within agreed phase using disposable test users; no bulk real-user operations                                 |
| 4     | Lint/advisory fixes, real integration tests, CI activation   | Local patches safe; protected branch/rule changes need approval; preserve failing checks                              |
| 5     | Preview/staging and migration rehearsal                      | Isolated data; existing hosting integration; backup and recovery rehearsal                                            |
| 6     | Approved merge, production migration/deployment, smoke tests | Explicit production authorization and reviewed recovery/forward-fix plan                                              |

Phase 10 deployment commands are future workflow examples, not authorization
to deploy during the audit. No commit, push, history rewrite, production migration,
bulk account change, or deployment was performed.

## I. Verification limitations and continuation state

- Live schema/history, owners/ACLs, advisors, backups, records and production
  exposure unknown; isolated SQL is not a real JWT/PostgREST integration test.
- Signup/confirmation, leaked-password checks, SMTP, redirects, rate limits,
  email delivery and token revocation were not accessed.
- No production service-role/migration credentials supplied, requested, or stored.
- Original Next.js source/history, protected branches and CI runs unavailable.
- Vercel project/previews/deployment, domains, runtime secrets and logs unverified.
- Browser checked local dev public pages/unauthenticated redirects, not signed-in
  authorization, nor the built Worker runtime. Build pass is not deployment proof.
- Source comparison used saved originals and hashes because `git diff` is
  unavailable; application code and migration were unchanged.

**Objective:** audit complete; source reconciliation and hardening next.
**Completed:** architecture/feature map, SQL reproduction, local checks, browser
smoke check, advisory scan, CI/scripts, durable documentation.
**Open:** 7 failed security expectations, 282 lint errors, 6 warnings, dependency
advisories. **Next:** recover authoritative Next.js source or review a bounded
Phase 1 rebuild plan; establish any live exposure of R1–R3 before real data use.

### Reproduce database evidence

Install PGlite 0.3.14 in a temporary tools directory outside application dependencies:

```sh
npm install --prefix <temporary-tools-directory> --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node docs/audit-evidence/reproduce-rls.mjs <temporary-tools-directory>/node_modules/@electric-sql/pglite/dist/index.js
```

The diagnostic accepts no database URL, runs only in memory, prints expectations,
closes PostgreSQL, and exits 1 while failures remain. Stored results use the
original migration and synthetic users only.
