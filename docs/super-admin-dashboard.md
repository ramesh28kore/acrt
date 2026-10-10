# Super admin dashboard

The `/super-admin` route now contains six working sections:

- Overview: exact account totals, role counts, institute summaries, access status,
  and the latest activity.
- Users: server-side search, role/institute/access filters, 20-row pagination,
  account creation, profile edits, role assignment, and enabling/disabling access.
- Admins: the same directory restricted to institute administrators.
- Institutes: create or edit institute names/codes and open their user directories.
- Roles & access: the current permission matrix and account counts by role.
- Activity: paginated sign-in and management events with action, actor-role,
  institute, and text filters; details; separate date/time columns; CSV export
  of the displayed page. CSV dates/times are UTC and spreadsheet formulas are escaped.

The panel includes responsive navigation, loading/empty/error states, retry,
success messages, accessible form labels, and protected controls for the current
super administrator. New accounts use an administrator-supplied initial password;
this flow sends no email. Passwords are never written to profile or audit tables.

## Database and authorization

Apply `drizzle/migrations/0001_super_admin_dashboard.sql` after the original
migration before using this dashboard with another database. It was applied to
the isolated local Supabase instance in this workspace. Hosted databases have
not been modified.

Both authenticated server functions and database RPCs verify the caller is an
active super administrator. Role, institute, status, and profile changes commit
in one transaction with their audit event. A database advisory lock serializes
access changes; self-demotion/deactivation and removal of the last active super
administrator are blocked.

The migration restricts direct profile updates to `full_name`, removes automatic
super admin grants based on an email address, stamps `disabled_at`, removes
anonymous execution of security-definer helpers, and makes role checks depend on
active status. New Auth users start disabled and without roles until provisioning
succeeds. A failed provisioning operation attempts to remove the newly created
Auth user; if that cleanup fails, the unconfigured account stays disabled.

Disabling a user blocks portal sign-in and privileged data access, including
requests using an existing session. Supabase Auth itself can still issue a token;
the portal checks active status before admitting the user. No hosted Auth settings
are changed by this feature.

The login audit trigger sets the timestamp, institute, and role snapshot instead
of trusting client-supplied values. These records are portal sign-in events, not
a complete provider-level log of failed authentication attempts. This implementation
does not add IP collection, customizable module permissions, feature flags,
academic scheduling, or performance reporting.

## Verification

```powershell
npm run typecheck
npm run test
npm run build
```

`src/test/super-admin-dashboard.test.tsx` verifies navigation, institute filtering,
editing roles/access, protected owner controls, and error handling.
`src/test/super-admin.test.ts` verifies inputs and CSV export safety.

The database regression script applies all three real migrations to an isolated
PGlite database. Pass an installed PGlite module path, as in the existing audit:

```powershell
node scripts/verify-super-admin.mjs "$env:TEMP\acrt-audit-tools\node_modules\@electric-sql\pglite\dist\index.js"
```

It verifies 16 cases including anonymous and non-super-admin denial, pagination,
protected profile columns, self-protection, audit rollback, activation timestamps,
institute uniqueness, and removal of email-based role grants.

The local-only `.supabase.local/verify-dashboard-api.mjs` additionally exercises
the live TanStack server endpoints with all four roles and checks create/edit
operations using temporary fixtures that are removed after the checks.

The earlier repository audit remains a historical baseline. This change does
not resolve every repository-wide lint, dependency, or unimplemented LMS finding.
