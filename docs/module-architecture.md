# Module architecture and continuation

This sequence records the owner's module plan. Inspect the actual repository before
each module and implement missing or defective functionality. Preserve working
features and published Lovable history. Execute one module at a time; complete
required checks before starting its dependent module. Review significant diffs
and record results and remaining work for the next module.

The current implementation uses TanStack Start, React, and Supabase. A Next.js /
Vercel target exists in the rebuild specification but has not been implemented.
Reconcile that target with the verified baseline before changing frameworks or
deployment configuration. Attendance and timetable requirements also need
verification against the repository when their module starts.

| Module | Name                             | Responsibility                                       | Current evidence / remaining scope                                                                                     |
| ------ | -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| M00    | Project Audit & Architecture     | Establish the actual baseline                        | Initial audit recorded in `repository-audit-2026-10-09.md`; refresh before new work.                                   |
| M01    | Authentication & Core Security   | Login, sessions, identity, foundational roles        | Login and role guards exist; active-account checks and guarded administration added. Broader security findings remain. |
| M02    | Academic Structure & Classes     | Institutes, departments, classes, enrollment, access | Institutes implemented; departments, classes and enrollment remain planned.                                            |
| M03    | Learning Content & Cheat Sheets  | Lessons, publishing, gating, progress                | Planned.                                                                                                               |
| M04    | Coding Practice & Playground     | Monaco, execution, submissions, grading              | Planned.                                                                                                               |
| M05    | MCQ Quiz Engine                  | Practice/timed quizzes, answer evaluation            | Planned.                                                                                                               |
| M06    | Content Import System            | Python importer, questions, solutions, images        | Planned.                                                                                                               |
| M07    | Test Series & Exam Engine        | Coding/MCQ exams and administration                  | Planned; depends on assessment foundations.                                                                            |
| M08    | Curriculum & Schedule            | Course plans, personalized schedules, exports        | Planned.                                                                                                               |
| M09    | Student Dashboard & Gamification | Progress, streaks, points, leaderboard               | Route shell only.                                                                                                      |
| M10    | Faculty Management               | Dashboard, tracking, content review                  | Route shell only.                                                                                                      |
| M11    | Admin Management                 | Institute administration, users, classes, reports    | Account dashboard implemented; classes and academic reports await their dependencies.                                  |
| M12    | Super Admin & RBAC               | Global permissions, feature flags, audits            | Global accounts, institutes, fixed roles and audits implemented; module permissions and feature flags remain planned.  |
| M13    | Attendance & Timetable           | Attendance records and academic timetables           | Planned; verify requirements before implementation.                                                                    |
| M14    | Analytics & Reporting            | Student, faculty, class, institute performance       | Account totals exist; academic analytics remain planned.                                                               |
| M15    | UI/UX & Performance              | Responsive design, accessibility, optimization       | Dashboard responsive layouts and form labels added; full accessibility and performance audits remain.                  |
| M16    | Security Audit & Testing         | Comprehensive security and regression testing        | Targeted administration tests exist; comprehensive audit remains.                                                      |
| M17    | CI/CD & Production Deployment    | GitHub Actions, Vercel, safe releases                | CI workflow exists; deployment target and production release remain unresolved.                                        |

Dependency sequence: M00 establishes facts; M01–M02 establish identity and academic
structure. Learning (M03/M06), assessment (M04/M05/M07), and scheduling (M08/M13)
build on those foundations. Role workspaces and analytics (M09–M12/M14) consume
their data. M15–M17 cover production readiness. Existing account dashboards are
partial delivery of M11/M12, not evidence that all preceding modules are complete.

For the next implementation request, refresh M00's findings and resolve outstanding
M01 checks before extending M02. This document records a plan; it does not start
all modules or authorize production deployment.
