# Avanthi CRT Portal — Roadmap and Phase 1 Design (Logins and Four Roles)

This plan covers planning only. No code is written until you approve a build step.

## Context
- This project is empty. The portal is planned fresh here, not migrated from the old code.
- Your brief names Next.js, Vercel and GitHub Actions. This project uses a different setup: TanStack Start for the app, with Lovable Cloud for data, logins and server logic. The security rules in your brief still apply as written.
- Colleges: PT and Q6 (JNTUH).

## Overall roadmap (in order)
1. **Logins and four roles** (Phase 1, detailed below)
2. Institutes and classes: colleges, academic years, branches, sections, Excel student import, faculty-student assignment
3. Learning content: Python lessons, cheat sheets, curriculum schedule, progress tracking
4. Quizzes and exams: MCQ practice, timed exams, test series, exam security (server-side timing, answers hidden until submission)
5. Coding: code editor, problems, sandboxed code running and grading, playground
6. Analytics and engagement: leaderboards, dashboards with charts, reports, Excel/PDF exports
7. Operations: attendance and timetable, feature flags, audit log viewer, content review workflow

Every phase must ship with role checks enforced on the server and database, plus tests for its main flows.

## Phase 1 — Logins and four roles

### What users get
- Public landing page with a "Sign in" button.
- Sign in with email and password. Password reset by email.
- No open sign-up. Admins create accounts, or import students later in Phase 2.
- After sign-in, each person lands on their own dashboard:
  - **Student**: profile, placeholder sections for courses and tests
  - **Faculty**: assigned sections (empty until Phase 2)
  - **Admin**: user list for their college; create, deactivate and reset users, and assign Student or Faculty roles
  - **Super Admin**: everything an Admin can do, across all colleges; can create Admins
- Account menu with sign-out. Deactivated accounts cannot sign in.
- Every login and every role change is recorded in an audit log.

### Permission rules
| Action | Student | Faculty | Admin | Super Admin |
|---|---|---|---|---|
| View own profile | yes | yes | yes | yes |
| View users in own college | no | own students | yes | all colleges |
| Create users / assign roles | no | no | Student, Faculty in own college | any role, any college |
| View audit log | no | no | own college | all |

## Technical details
- Enable Lovable Cloud with email auth only; turn sign-up off and turn on leaked-password checks.
- Tables: `institutes` (seeded with PT and Q6), `profiles` (name, roll or employee number, institute_id, active flag), `user_roles` (separate table, enum `student | faculty | admin | super_admin`), `audit_logs`.
- `has_role()` and `user_institute()` security-definer functions; row-level security on every table, scoped by role and institute.
- Admin actions (create user, change role) run as authenticated server functions that check the caller's role first, then use privileged access only inside the handler. An Admin can never grant `admin` or `super_admin`.
- Routes: `/` (public), `/auth`, `/reset-password`, protected `/dashboard`, which sends each user to `/student`, `/faculty`, `/admin` or `/super-admin` behind role-gated layouts.
- The first Super Admin is created once by you through Cloud user management, then given the role by a one-time migration.
- Tests: Vitest checks for role guards, plus a browser check that signs in as each role and confirms that blocked pages and blocked actions are refused.
- Record these architecture decisions in AGENTS.md.

## Open items
- The real email of the first Super Admin is needed when we build.
- Brand colours and logo for Avanthi, if you have them.
