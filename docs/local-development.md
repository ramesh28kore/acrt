# Local development accounts

These instructions restart the prepared setup in this Windows workspace. The
ignored local setup files and accounts are not included in a fresh GitHub clone.

The local backend uses Docker project `acrt-local-development` and the
loopback-only network `acrt-local-network`. Its files are under the ignored
`.supabase.local/` directory. The hosted project configuration remains in
`supabase/config.toml` and `.env`.

The application reads `.env.local` to connect to the local backend. Both
`.env.local` and `.supabase.local/` are excluded by the existing `*.local`
Git ignore rule. They contain local credentials and must not be committed.

Open <http://127.0.0.1:8080/auth>. The four development accounts are:

| Role | Email | Institute |
| --- | --- | --- |
| Super admin | superadmin@avanthi.test | All institutes |
| Admin | admin@avanthi.test | PT |
| Faculty | faculty@avanthi.test | PT |
| Student | student@avanthi.test | PT |

Generated passwords are saved in `.supabase.local/accounts.json`. These accounts
belong to the isolated local database. Account provisioning confirms the emails
directly and sends no messages.

## Start again

Start Docker Desktop, then run these commands in PowerShell from the project
directory. Supabase CLI 2.120.0 is installed in the temporary tools directory.

```powershell
$supabaseCli = "$env:TEMP\acrt-local-tools\node_modules\.bin\supabase.cmd"
$env:SUPABASE_PROJECT_ID = 'acrt-local-development'
& $supabaseCli start --workdir .supabase.local --network-id acrt-local-network --exclude 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'
node .supabase.local/bind-loopback.mjs
npm run dev -- --host 127.0.0.1 --port 8080 --strictPort
```

The database persists in Docker volumes. To stop this backend while preserving
its data, run:

```powershell
& $supabaseCli stop --workdir .supabase.local --project-id acrt-local-development
```

If the temporary CLI installation has been removed, reinstall it with:

```powershell
npm install --prefix "$env:TEMP\acrt-local-tools" --no-audit --no-fund --package-lock=false supabase@2.120.0
```

## Account verification

The local provisioning script checks actual password authentication, user
identity, profile visibility, the exact assigned role, audit insertion, and
sign-out for every account. Results are stored in
`.supabase.local/verification.json`. To repeat those checks:

```powershell
node .supabase.local/seed-accounts.mjs
```

The script accepts only `http://127.0.0.1:54321`, uses the saved passwords, and
does not reset passwords for existing accounts. The setup uses a copy of the
repository's existing migration; the authorization findings in the repository
audit still apply. Role dashboard pages remain scaffold placeholders.

To reconnect the application to the original hosted backend, move `.env.local`
to a filename Vite does not load, then restart the development server.
