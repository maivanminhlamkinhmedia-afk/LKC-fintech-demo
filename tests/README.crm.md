# CRM pipeline and filtering verification

Requires the project's installed dependencies and Node.js 24 (native TypeScript stripping for the pure filter tests).

```powershell
node --test tests/crm-customer-filters.test.mjs
```

The HTTP integration check uses real credential sessions, rendered HTML forms,
Prisma queries, and the existing MySQL database. Use a local **test database**;
the app and verifier must use the same `DATABASE_URL`. No seed or migration is run.
Do not run alongside other processes that edit that database: before/after snapshots
must match after the fixtures are cleaned up.

Build and start the app in one terminal:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3107'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

In a second terminal:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3107'
node scripts/verify-crm-pipeline.mjs
```

The opt-in authorizes temporary fixture creation and cleanup. The script refuses
non-loopback app/database hosts. It creates random fixture IDs and only mutates
those records; credentials are generated in memory and never logged. Cleanup runs
in `finally` and checks the original CRM/team/user/audit snapshot. A hard process
termination can prevent cleanup; inspect only that run's `crm007-<UUID>` fixtures
before manually cleaning up. The script does not auto-repair existing data.

Coverage: role-scoped filters and option lists; combined, invalid, repeated, and
literal-wildcard search inputs; UTC+7 follow-up dates; open/overdue task predicates;
pipeline columns and status actions; no-op and invalid/foreign mutations; audit
and activity records; ownership invariants; stale sessions/forms; pagination and
column bounds; existing assignment actions, team scope, CRM routes and navigation.

These are HTTP/HTML and database checks, not browser-hydration or visual tests.
