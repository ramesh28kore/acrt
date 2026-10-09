# Rebuild Prompt: Avanthi Portal (CRT Learning Management System)

A reusable prompt set for rebuilding this project from an empty repository with
Claude Code. The spec below was reverse-engineered from the current codebase:
50 migrations, about 60 routes, and 30 `lib/` modules.

## How to use this file

| Step | What to do |
| ---- | ---------- |
| 1 | Create an empty repo and run `npx create-next-app@latest avanthi-portal --ts --tailwind --app --eslint`. |
| 2 | Copy **Part A (Master Prompt)** into `CLAUDE.md`. Claude Code loads it on every turn, so you never paste it again. |
| 3 | Run **one phase from Part B per session** by pasting only that phase block. A new session per phase keeps the context small. |
| 4 | Do not start the next phase until the current phase's **Done when** checks pass and the work is committed. |
| 5 | Optional: begin each phase in plan mode (`Shift+Tab` twice) and approve the plan before any code is written. |

> Why phases? No single session can hold the whole system. If one prompt asks for
> everything, you get stubs. If each phase has acceptance checks, you get working
> code.

---

## Part A: Master Prompt (save as `CLAUDE.md`)

```markdown
# Avanthi Portal: Project Instructions

## Role
Act as a senior full-stack architect, a security engineer, and a UI designer.
You are building a production LMS for real engineering students, not a CRUD demo.

## Product
Avanthi Portal is a Campus Recruitment Training (CRT) LMS for a Python course.
It serves two institutes (college codes PT and Q6) under JNTUH.
- Students: read cheat sheets, solve coding problems in the browser, take MCQ
  quizzes and timed Test Series exams, and follow a personal day-by-day schedule.
- Faculty (trainers): review and publish content, maintain test cases and
  solutions, and see only the students in the classes they teach.
- Admin: manages classes, users, login access, the schedule, Test Series, and
  reports, within the permissions a super admin grants.
- Super admin: a separate account. Handles RBAC, feature flags, the audit log,
  admin management, and the sign-in records.

## Stack (fixed; do not substitute)
| Layer     | Choice |
|-----------|--------|
| Frontend  | Next.js 16 App Router, React 19, TypeScript (strict), Tailwind v4, React Compiler |
| Backend   | Server Actions + Route Handlers |
| Database  | Supabase Postgres via @supabase/ssr; RLS on every table |
| Auth      | Supabase Auth (email/password), httpOnly cookie session |
| Editor    | @monaco-editor/react |
| Charts    | recharts |
| Excel     | xlsx (imports and exports) |
| Execution | Piston (PISTON_URL) → Vercel Python function api/execute.py (CODE_EXEC_URL + CODE_EXEC_SECRET) → local python (dev only) |
| Tests     | Vitest |
| Deploy    | Vercel |

Do NOT use Prisma, a custom JWT, or NextAuth. They connect as a single database
user, which leaves RLS nothing to key on (auth.uid()).

## Next.js 16 caveat
This Next.js version differs from your training data. Before you write framework
code, read node_modules/next/dist/docs/. Middleware is now `proxy.ts` and exports
`proxy()`. Follow every deprecation notice.

## Security invariants (never violate)
1. The database enforces access. The UI never does. Every table has RLS keyed on
   auth.uid(). `anon` has no grants anywhere.
2. RLS filters rows, not columns. So secrets live in their own tables, and
   students have no SELECT policy on them:
   problem_solutions, mcq_answer_keys, hidden test_cases (is_sample = false),
   and the Test Series answer keys.
3. Grading and solution reveal run on the server under the service role
   (lib/supabase/service.ts, marked `server-only`). The service key never
   reaches the browser.
4. Timers belong to the server. deadline = attempt.started_at + duration_minutes,
   recomputed on every save and submit. If a student edits the client countdown,
   they gain no time. Answers that arrive late are ignored.
5. Faculty scoping is a security boundary: faculty_can_view_student(). Students
   of trainer B must never appear anywhere for trainer A.
6. Privileged writes go through SECURITY DEFINER RPCs. Each one has a fixed
   search_path. Revoke EXECUTE from public and anon, and grant only to
   authenticated.
7. Triggers block self-escalation. A user cannot change their own role,
   is_super_admin, email/username, or academic placement.
8. Base GRANTs come before policies. A table created after the grant migration
   needs its own explicit grants.

## Roles model
- profiles.role ∈ {student, faculty, admin}, stored as plain text with a CHECK
  constraint, not a Postgres enum. Every RLS policy reads this column.
- profiles.is_super_admin (boolean) belongs to one separate account.
- profiles.admin_role_id → admin_roles, which hold per-module action grants:
  view/create/edit/delete/approve/export/import/manage/configure.
  admin_has_permission() in SQL is the authority. lib/rbac/rules.ts mirrors it
  for the UI.
- feature_flags: test_series, playground, discussions. A missing flag counts as
  on. Admins are never locked out.
- /dashboard redirects: faculty → /faculty, admin → /admin,
  super admin → /super-admin.

## Code conventions
- Pure logic lives in lib/<module>/*.ts with no Supabase imports, and has a
  sibling *.test.ts. Data access lives in lib/<module>/data.ts.
- When a rule exists in both SQL and TS (login access, RBAC, feature flags), the
  TS file's header comment names the SQL function it mirrors.
- Migrations go in supabase/migrations/<timestamp>_<name>.sql. Every migration
  opens with a comment block explaining WHY.
- Content tables use deterministic primary keys (source UUID or uuid5), so the
  importer can upsert without creating duplicates.
- Every date is a UTC `YYYY-MM-DD` string. Avoid local-timezone Date math.
- A server action returns { ok: true } | { ok: false, error }. It never throws
  onto the error page. Wrap it with a guard() that calls unstable_rethrow for
  redirect and notFound.
- The layout must work at 360px phone width.
- Do not write stubs, TODOs, or placeholder data in shipped code.

## Verification (run after every change)
npm run lint && npm run typecheck && npm run test && npm run build
If you need to change the schema, write a new migration and then run
`npx supabase db reset`. Never edit a migration that has already been applied.

## Working rules
- Read the files a change touches before you edit them. Keep each diff to the
  minimum the change needs.
- If an instruction conflicts with the repo, say so. Do not resolve it silently.
- Commit once per completed feature, and explain the WHY in the message.
```

---

## Part B: Phase Prompts (one per session)

Each block is self-contained. Paste it as the first message of a new session.

### Phase 1: Foundation, Auth, Roles

```text
Phase 1 of the Avanthi Portal rebuild. Follow CLAUDE.md.

Build:
1. Supabase local setup (supabase/config.toml), .env.local.example with
   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY, PISTON_URL, CODE_EXEC_URL, CODE_EXEC_SECRET.
2. lib/supabase/{client,server,service,proxy}.ts. The service client is
   `server-only`.
   Root proxy.ts refreshes the session and redirects unauthenticated users to
   /login. Public prefixes: /login, /join, /auth. Exclude static assets and
   api/execute from the matcher.
3. Migrations:
   - initial_schema: profiles (id → auth.users, email, full_name, role CHECK,
     roll_number, is_disabled, disabled_at, course_start_date), topics
     (position), sets (problem groups within a topic), sheets, problems,
     test_cases (is_sample), submissions, mcq_sets, mcqs, mcq_attempts, classes,
     class_members, join_codes, invitations, bookmarks, lesson_progress.
   - problem_solutions and mcq_answer_keys as SEPARATE tables with no student
     SELECT policy.
   - table_grants: authenticated gets CRUD, service_role gets all, anon gets
     nothing.
   - helper functions current_profile_role() and faculty_can_view_student(uuid).
   - triggers: profiles_prevent_role_escalation and a lock on email/username
     self-edit (the service role and postgres are exempt).
   - RPC set_profile_role (admin only, SECURITY DEFINER, search_path pinned).
4. /login (email + password, with a show/hide password field), /auth/callback
   (creates the profile row on first sign-in), /auth/blocked (for disabled or
   gated users), /join (redeem a join code to enter a class).
5. The (app) route group layout with an app header, role-aware navigation, and a
   footer. /dashboard redirects by role.
6. supabase/seed.sql inserts the 18 topics (Introduction to Python … IDP Prep
   Series Level-2) with fixed UUIDs.
7. test/rls.test.ts proves that a student JWT reads 0 rows from
   problem_solutions, mcq_answer_keys, and hidden test_cases, and that a student
   cannot update their own role.

Done when: verify passes, the RLS tests are green, and all three roles log in
and land on their own dashboards.
```

### Phase 2: Cheat Sheets, Publishing, Progress

```text
Phase 2. Follow CLAUDE.md.

Build:
1. /sheets → topic list → /sheets/[topicId] → /sheets/[topicId]/[sheetId].
   Sheets render structured blocks (components/sheet-blocks.tsx): headings,
   paragraphs, code blocks with a copy button, tables, and images from
   public/content/images. Add prev/next navigation and a "Mark as read" button
   that writes lesson_progress.
2. A private Storage bucket for sheet PDFs, downloaded through server-signed URLs
   only.
3. Publish gating: is_published (default false) on topics, sheets, problems, and
   mcq_sets. Faculty toggle it only through set_*_published RPCs, which change
   that one column and nothing else.
4. Progress states NOT_STARTED / IN_PROGRESS / COMPLETED, derived from existing
   data (lesson_progress, passed submissions, mcq_attempts). Never store a
   duplicate counter.
5. Sequential gating (lib/gating/compute.ts, pure + tests): each stage (sheets,
   quizzes, problems) has its own ladder. Item N+1 opens when item N is done.
   Stages don't block each other. A completed item never re-locks. Faculty and
   admin bypass the gate. Locked items show components/gating/locked-card.tsx.
6. Branding pass at render time (lib/branding/rebrand.ts): replace the
   source-platform names in imported prose on the student and faculty views only.
   Stored rows stay unchanged.

Done when: a student cannot open an unpublished or locked sheet by typing its
URL, progress survives a reload, and the gating unit tests pass.
```

### Phase 3: Coding Practice and Sandbox

```text
Phase 3. Follow CLAUDE.md.

Build:
1. lib/sandbox/run.ts, the single entry point with this backend order:
   Piston → CODE_EXEC_URL (api/execute.py) → local python (development only).
   Limits: 10s wall time, CPU/memory/process rlimits, truncated output, no
   secrets in the child environment.
2. api/execute.py, a Vercel Python function. It requires the CODE_EXEC_SECRET
   header (hmac.compare_digest) and refuses every request when the secret is
   unset.
3. /practice (problem list with Verified badges) and /practice/[problemId]:
   resizable panes with the problem, a Monaco editor, and results. Autosave the
   draft. Add Run (sample cases) and Submit (all cases, graded on the server by
   lib/practice/grade.ts using the service role).
   Verdicts: Accepted / Wrong Answer / Runtime Error / Time Limit, with output
   normalisation that ignores trailing whitespace and CRLF differences.
   Rate-limit submissions per user.
4. Route handlers: /api/practice/{run,submit,solution,debug}.
   The solution handler returns the official solution only after the caller
   has passed.
   The debug handler steps through the program line by line
   (lib/sandbox/trace-program.ts) for the debugger panel.
5. /submissions and /submissions/[id] show the student's own history.
6. problem_validations: run each reference solution against all of its cases
   and record pass/fail. Faculty see a validation badge.
7. Official solutions and tutorials: problem_solutions gains approach,
   algorithm, explanation, complexity, and is_published. A problem_tutorials
   table holds the beginner walkthrough, dry-run tables, and step-by-step
   solution chunks (code + explanation).
8. public_submissions(): a SECURITY DEFINER RPC. It returns other students'
   accepted code only to a caller who has passed the problem. EXECUTE is
   revoked from anon.
9. Per-problem discussions (threads + replies, visible to all students) behind
   the `discussions` feature flag.
10. /playground: a multi-language scratchpad (Python locally; C, C++, Java,
    and JS through Piston). A saved program is a row in `playground_programs`.

Done when: Run and Submit work locally against Piston, hidden inputs never
appear in any network response (check in DevTools), and the verdict and output
tests pass.
```

### Phase 4: MCQ Quizzes and Exam Engine

```text
Phase 4. Follow CLAUDE.md.

Build:
1. /quizzes → /quizzes/[topicId] → /quizzes/[topicId]/[setId].
2. Two modes, keyed off mcq_sets.duration_minutes:
   - null: an untimed practice quiz that can be retaken.
   - N > 0: a timed exam. start_attempt records started_at from the server
     clock. Answers autosave. A question palette shows answered, unanswered,
     and marked questions. Auto-submit fires at the deadline, and the server
     recomputes the deadline on every write.
3. Grading (lib/quizzes/grading.ts, pure + tests) reads mcq_answer_keys under
   the service role. The review screen shows correct and chosen answers with
   explanations only after submission.
4. MCQ prompts can contain inline code and images (lib/quizzes/prompt.ts).

Done when: moving the client clock or the countdown forward buys no extra
time, and a student's JWT can never read an answer key before submitting.
```

### Phase 5: Academic Structure, Classes, Login Access

```text
Phase 5. Follow CLAUDE.md.

Build:
1. The hierarchy Institute → Academic Year → B.Tech Year → Branch → Section →
   Class → Students. It extends classes and class_members; it does not create
   parallel tables.
   Institutes are identified by the college code in the roll number: in
   25PT1A0501 the code is PT, and in 23Q61A0501 the code is Q6.
   lib/academics/roll-number.ts parses and validates roll numbers (+ tests).
2. A class can exist before a trainer is assigned (faculty_id is nullable).
3. Login access (lib/access/rules.ts mirrors login_allowed_for() in SQL). There
   are two independent tick-list gates, department and class, and each is off
   until something is unticked. A student must pass every gate that is on. Add
   an explicit allowUnassigned switch. The admin screen describes the effect in
   words before anything is applied.
4. /admin/classes: create classes, assign faculty, generate join codes, and
   bulk-import students from Excel (lib/admin/bulk.ts + tests). Bulk delete
   needs a confirmation step.
5. /classes/[classId] (class card, roster) and /faculty/students (scoped by RLS).
6. Scripts (node --env-file=.env.local): seed-demo.mts (refuses a non-local
   URL), check-duplicate-emails, place-students, delete-duplicate-students,
   set-password.

Done when: an Excel import places students into the correct sections, and
unticking a class blocks exactly those students at /auth/blocked.
```

### Phase 6: Schedule and Curriculum Plan

```text
Phase 6. Follow CLAUDE.md.

Build:
1. lib/schedule/plan.ts (pure, clock-free): curriculum items plus a start date
   become dated days, with a daily-minutes budget and rest days. The per-student
   anchor is profiles.course_start_date, which defaults to the active academic
   year's course start (15 Aug 2026).
2. /schedule for students: a month calendar, a day strip, a day timeline,
   "next in day", and a day context bar. Each item links to its sheet, quiz, or
   problem.
3. /admin/schedule plus /api/admin/schedule export the schedule as an .xlsx
   workbook (lib/schedule/workbook.ts) and a .docx course schedule
   (scripts/schedule-docx.mjs).
4. Consistency tests: every curriculum item exists and is published, and the
   plan has no gaps or duplicates.

Done when: two students with different start dates see correct day numbers,
and the exported workbook opens in Excel.
```

### Phase 7: Dashboards, Analytics, Gamification

```text
Phase 7. Follow CLAUDE.md.

Build:
1. Student /dashboard: one progress card, learning stats, a Test Series card,
   and a leaderboard. Keep it uncluttered on phones.
2. Gamification (lib/gamification/compute.ts, pure + tests): 10 points per
   sheet, 20 per quiz, 30 per problem, plus streaks and a daily goal. All of it
   is derived from recorded activity, so no score table exists.
3. Daily top-performers leaderboard and admin department rollups. Both are
   SECURITY DEFINER functions that return only aggregated columns, never raw
   rows about other students. Split department performance by study year.
   Re-weight by attempt count using unrounded averages.
4. Faculty dashboard: completion views for their own students, content review
   queues, test-case and solution editors (components/faculty/*), and a
   problem coverage page.
5. Admin: student performance (Roll-No-wise ordering + search), and faculty
   performance measured by each trainer's own work in the portal
   (faculty_activity_report).
6. Indexes for the activity queries (status/timestamp-first composites).
7. /search across sheets, problems, and quizzes (published items only for
   students).

Done when: trainer A's dashboard shows none of trainer B's students, and the
aggregation tests pass.
```

### Phase 8: Test Series (MCQ + Coding Exams)

```text
Phase 8. Follow CLAUDE.md.

Build:
1. The workflow: the admin imports an HTML test file (lib/test-series/parse.ts +
   tests), faculty review and correct the key and then confirm it, the admin
   enables the test, and students take it one question per request.
2. Questions have 2 to 26 options stored as text[]; option i has letter
   chr(65+i).
3. Timing: duration_minutes is null (untimed) or a number of minutes. The
   deadline is derived from the server's started_at, and the test auto-submits.
4. Coding tests: problems picked from the bank, graded by the practice grader,
   with CCBP-style instructions and cutoff marks.
5. Leave-the-page guard (components/test-series/leave-guard.tsx): after the
   third tab switch or minimise, the test auto-submits. Warnings are recorded
   on the server. There is no webcam.
6. Feedback comes only after the exam: the score, a full review with
   explanations, and the student's own 1–5 rating. Nothing is revealed
   per question.
7. Results by institute, branch, and section (/admin/test-series/results), with
   an Excel export.
8. Every action is wrapped in guard(). A failure shows a message and never
   the error page.

Done when: an imported HTML test runs end to end, and a student who leaves the
page three times gets auto-submitted.
```

### Phase 9: Super Admin, RBAC, Audit, Hardening

```text
Phase 9. Follow CLAUDE.md.

Build:
1. A separate super admin account (is_super_admin). The owner's everyday admin
   login must NOT open /super-admin.
2. /super-admin: users (+ detail view), admins, roles (a per-module action
   matrix), features (flags), audit logs, login access, departments, classes,
   schedule, student performance, faculty performance, test results, and system.
   These open inside the panel (components/super-admin/*).
3. audit_log is written by lib/audit/log.ts and by triggers on privileged
   writes.
4. Sign-in record: admin and staff login attempts (success/failure) with
   separate Date, Time, and IP columns, a Role filter that includes
   Super admin, and CSV download.
5. Disabling a user stamps disabled_at on every path, including the service
   role.
6. Security sweep: revoke EXECUTE from anon on every SECURITY DEFINER function,
   pin search_path on every function, and get the Supabase advisor to zero
   warnings.
7. next.config.ts security headers: X-Frame-Options DENY, a CSP with
   frame-ancestors 'none', base-uri 'self', form-action 'self', and
   object-src 'none'; HSTS; nosniff; Referrer-Policy; Permissions-Policy;
   COOP; X-Robots-Tag noindex; and poweredByHeader false. Add
   outputFileTracingExcludes for importer/, scripts/, supabase/, test/, and
   the content folders.
8. robots.ts disallows everything (the portal is private).

Done when: an anon-key caller gets "permission denied" from every RPC, lint
reports zero warnings, and verify passes.
```

### Phase 10: Content Importer and Deployment

```text
Phase 10. Follow CLAUDE.md.

Build:
1. importer/ (Python 3.11, beautifulsoup4, lxml, python-dotenv):
   import_content.py upserts topics, sheets, problems, mcq_sets, mcqs, and
   answer keys from the scraper export (SCRAPER_DIR) using deterministic IDs.
   Also fetch_images.py (→ public/content/images), generate_test_cases.py, and
   verify_and_publish_solutions.py (run each reference solution, then publish).
   Imported rows start unpublished.
2. README.md: prerequisites (Node 22+, Docker, Supabase CLI, Python 3.11),
   local setup steps 1–6, the scripts table, architecture and security notes,
   and troubleshooting.
3. Deploy: `npm run deploy`, which runs verify and then vercel --prod. Set the
   env vars in Vercel. Push the migrations to the hosted project with
   `npx supabase db push`.

Done when: a fresh clone reaches a working demo with install → supabase start →
db reset → import → seed → dev, and the production deploy passes a smoke test
on every role.
```

---

## Part C: Useful one-line prompts during the rebuild

| Situation | Prompt |
| --------- | ------ |
| Start of a phase | `Read CLAUDE.md and the files this phase touches, then give me a plan: migrations, lib modules, routes, tests. No code yet.` |
| After a phase | `/code-review high`, then `/security-review` |
| RLS doubt | `Write a failing Vitest test that proves a student JWT can read <table>, then fix the policy until it fails to read.` |
| Build failure | `Run npm run build, reproduce the error, fix the root cause only, and re-run verify.` |
| Before a commit | `Re-read your diff adversarially: what would break in production or leak data? Fix it, then commit.` |
| Context getting long | `/compact keep: current phase, open migrations, failing checks` |

## Part D: Critical trade-offs already decided (do not re-litigate)

| Decision | Chosen | Rejected | Why |
| -------- | ------ | -------- | --- |
| Data access | Supabase RLS | Prisma + JWT | RLS needs auth.uid() per request |
| Secrets (keys, solutions, hidden cases) | Separate tables | Hidden columns | RLS restricts rows, not columns |
| Faculty writes | Single-column SECURITY DEFINER RPCs | Broad UPDATE policies | The base grant would expose every column |
| Progress | Derived from activity | Stored counters | Nothing to drift or backfill |
| Role type | text + CHECK | Postgres enum | Easier to alter |
| Timer | Server started_at + duration | Client countdown | A client can be tampered with |
| Execution in production | Piston → Vercel Python function | Public Piston API | The public API is whitelist-only |
| Proctoring | Leave-page warnings (3 strikes) | Webcam | Owner decision, 2026-09-26 |
| Super admin | Separate account | Flag on the owner's admin | Owner request, 2026-09-26 |
