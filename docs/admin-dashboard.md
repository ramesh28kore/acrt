# Admin dashboard

The `/admin` route provides an institute overview, student and faculty directories,
an all-users directory, activity history, and read-only institute details.
Administrators can create student/faculty accounts with an initial password,
edit names and roll numbers, change between student/faculty roles, and enable or
disable portal access. Search and filters run before 20-row pagination.
Activity supports text, action and actor-role filters and exports the displayed
page as CSV. Passwords are not stored in profiles or audit records.

## Database setup

Apply `0000_migration.sql`, `0001_super_admin_dashboard.sql`, then
`0002_admin_dashboard.sql` from `drizzle/migrations/` in order. The new migration
has been applied to the isolated local Supabase instance; hosted databases still
need these migrations. Set `SUPABASE_SERVICE_ROLE_KEY` only in the server runtime.

Authenticated endpoints verify an active admin account with an assigned institute.
Read RPCs derive the institute from the authenticated identity. Mutation inputs
accept no institute, actor identity, or creation flag. The server-only mutation
RPC rechecks the verified actor inside the same transaction as profile, role,
and audit writes, sharing the Super Admin advisory lock.

Admins cannot manage accounts in another institute, transfer accounts, assign
admin roles, or modify any account carrying an admin or super admin role, even
if that account is inactive or has multiple roles. New Auth accounts begin disabled
and unprivileged. Failed provisioning attempts remove only the newly created Auth
account; a cleanup failure leaves it disabled. Account creation sends no email.

The activity endpoint limits records to the admin's institute, omits raw audit
details, and avoids exposing identities of actors or targets in other institutes.
Class management and academic reports require M02 and M14 and are not implemented
by this dashboard.

## Verification

`src/test/admin-dashboard.test.tsx` covers directory navigation, protected accounts,
faculty creation, account editing, failure handling, activity filters, and strict
input boundaries. The isolated database script verifies institute isolation,
role escalation denial, service-only mutation privileges, audit rollback,
disabled-admin rejection, provisioning, and activity scoping:

```powershell
node scripts/verify-admin.mjs "<installed @electric-sql/pglite/dist/index.js>"
```

The admin database script passed 10 checks; the Super Admin regression script
passed 16 checks with all three migrations. The application suite passed 15 tests.
Browser visual verification was blocked by automatic approval review due to an
account usage limit; no browser inspection was completed. These checks do not
establish completion of the broader M11 or M16 modules.
