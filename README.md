# Avanthi CRT Portal

> For the pending module release, current verification results, live URL, and
> Lovable synchronization prerequisites, see [11 October release notes](docs/release-2026-10-11.md).

This workspace is an early [Lovable](https://lovable.dev) scaffold using
TanStack Start, React 19, strict TypeScript, Tailwind CSS 4, and Supabase.
The build generates a Cloudflare Worker through the Lovable/Nitro preset.

The owner-supplied [rebuild specification](rebuild-project.prompt.md) describes
a Next.js 16 / Vercel target and a different role schema. That target has not
been implemented here. Read the
[M00 repository audit](docs/repository-audit-2026-10-10.md) before replacing the
framework or changing the database.

The intended local Docker backend, `avanthi-portal`, currently has a different
schema from this repository. The owner selected ACRT as the development
repository and backend reconciliation as the next prerequisite. Do not apply
these initial migrations to that existing database; follow the audit's
compatibility and isolated-validation plan first.

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

The audit verified Node.js **24.19.0** and Bun **1.4.2**. Install from the
committed Bun lockfile rather than creating a second lockfile.

For a fresh clone, copy `.env.example` to `.env.local` and supply the public
configuration for a compatible Supabase backend. The SQL files in
`drizzle/migrations/` describe a separate four-table baseline and may be applied
in numeric order only to an isolated, compatible test setup. The existing
`avanthi-portal` database needs reconciliation first. Account management also
requires the server-only service role key. A complete fresh-clone backend and
first-super-admin setup is not yet documented.

```sh
bun install --frozen-lockfile --ignore-scripts
npm run dev
```

For the isolated Docker backend and the four local role accounts, see
[local development](docs/local-development.md). Login passwords are stored in
the ignored `.supabase.local/accounts.json` file.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Environment and boundaries

Use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser,
and `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for authenticated server calls.
Both URLs must address the same backend. `SUPABASE_SERVICE_ROLE_KEY` belongs
only in the server runtime. Never prefix it with `VITE_` or commit it.
The supplied `.env` contains public hosted configuration. Local development
overrides it through the ignored `.env.local`, including a local-only server
key. Environment files are excluded from Git; `.env.example` documents the
required names without credentials.

- `src/routes/`: public pages, working admin and super admin panels, and student/faculty dashboard shells.
- `src/components/admin/`: institute overview, student/faculty accounts, and activity.
- `src/components/super-admin/`: overview, user and institute management, roles, and activity.
- `src/lib/`: profile queries, UX role guards, authenticated administration
  server functions, input contracts, and error handling.
- `src/integrations/supabase/`: generated clients, auth middleware, and types.
- `drizzle/migrations/`: the initial schema and admin/super admin authorization migrations.
- `supabase/config.toml`: hosted project ID only; no complete local DB setup.
- `src/test/`: routing, dashboard workflows, input validation, and export tests.

See [super admin dashboard](docs/super-admin-dashboard.md) for features,
database setup, authorization behavior, and verification commands.
See [admin dashboard](docs/admin-dashboard.md) for institute administration,
and [module architecture](docs/module-architecture.md) for the implementation sequence.

## Checks and 10 October audit baseline

| Command              | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `npm run lint`       | ESLint and formatting                                           |
| `npm run typecheck`  | Strict TypeScript validation                                    |
| `npm run test`       | Vitest suite                                                    |
| `npm run build`      | Local production artifact; does not deploy                      |
| `npm run audit:deps` | Dependency advisories; requires Bun on PATH and registry access |
| `npm run preview`    | Local artifact preview                                          |

The 10 October 2026 M00 audit passed type checking, **15 application tests**,
the build and **26 existing isolated database checks**. Six additional policy
and audit-log expectations failed. GitHub CI reports **265 lint errors and
6 warnings** and a failing dependency audit with **15 advisory entries across
6 package groups**, including a critical development-tool dependency advisory.
Most LMS workflows are missing from ACRT, although the intended backend already
contains substantial LMS schema. **This application is not ready for production.**

The [CI workflow](.github/workflows/ci.yml) checks pushes and PRs with pinned
actions, a frozen lockfile, and synthetic public configuration. It contains no
deployment or database migration steps. The audited GitHub run passed tests,
type checking and build but failed lint and dependency auditing. Main was
unprotected with no repository rulesets when inspected.

## Audit and continuation

See the [current M00 audit report](docs/repository-audit-2026-10-10.md),
[historical 9 October audit](docs/repository-audit-2026-10-09.md) and
[evidence directory](docs/audit-evidence/) for architecture, feature status,
security reproductions, results and staged next tasks. SQL reproductions run
entirely in memory. The M00 local-backend snapshot contains read-only catalog
metadata, not account data or credentials.

Respect [AGENTS.md](AGENTS.md) and preserve Lovable's published history.
Review the rebuild scope before a framework or role-schema change.
