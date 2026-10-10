# Avanthi CRT Portal

This workspace is an early [Lovable](https://lovable.dev) scaffold using
TanStack Start, React 19, strict TypeScript, Tailwind CSS 4, and Supabase.
The build generates a Cloudflare Worker through the Lovable/Nitro preset.

The owner-supplied [rebuild specification](rebuild-project.prompt.md) describes
a Next.js 16 / Vercel target and a different role schema. That target has not
been implemented here. Read the
[repository audit](docs/repository-audit-2026-10-09.md) before replacing the
framework or changing the database.

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

The audit verified Node.js **24.19.0** and Bun **1.4.2**. Install from the
committed Bun lockfile rather than creating a second lockfile.

For a fresh clone, copy `.env.example` to `.env.local`, fill in your Supabase
project's public URL and publishable key, and apply the SQL files in
`drizzle/migrations/` in numeric order to that project's database. Account
management also requires the server-only service role key.

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

## Checks and current status

| Command              | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `npm run lint`       | ESLint and formatting                                           |
| `npm run typecheck`  | Strict TypeScript validation                                    |
| `npm run test`       | Vitest suite                                                    |
| `npm run build`      | Local production artifact; does not deploy                      |
| `npm run audit:deps` | Dependency advisories; requires Bun on PATH and registry access |
| `npm run preview`    | Local artifact preview                                          |

The initial 9 October 2026 audit passed type checking, the single routing test,
and the build. It recorded **282 lint errors and 6 warnings**. Dependency auditing found
**15 advisory entries across 6 package groups**, including a critical advisory
in a development dependency. LMS features remain planned, and authorization
has unresolved findings. **This scaffold is not ready for production.**

The [CI workflow](.github/workflows/ci.yml) checks pushes and PRs with pinned
actions, a frozen lockfile, and synthetic public configuration. It contains no
deployment or database migration steps. GitHub execution and branch rules
have not been verified.

## Audit and continuation

See the [audit report](docs/repository-audit-2026-10-09.md) and
[evidence directory](docs/audit-evidence/) for architecture, feature status,
security reproductions, results, and staged next tasks. The database diagnostic
runs entirely in memory and never connects to Supabase.

Respect [AGENTS.md](AGENTS.md) and preserve Lovable's published history.
Review the rebuild scope before a framework or role-schema change.
