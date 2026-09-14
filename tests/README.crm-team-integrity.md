# CRM team integrity and removal-safety verification

This opt-in integration verifier uses real credential sessions, rendered Server
Action forms, Prisma, and the locally running app. It does not apply a migration,
seed data, or repair duplicates. Apply the reviewed CRM-008 migration to an
approved local development/test database first, then build that same code.

Requirements: installed project dependencies and Node.js 24. The app and verifier
must use the same `DATABASE_URL` and authentication configuration. The verifier
requires loopback app/database hosts and a database name containing a delimited
`dev` or `test` component, without a `prod`/`production` component. This guard is
not a substitute for manually confirming the database is disposable local/test
data. Do not run alongside any process that writes to the database.

Build/start the app in one terminal:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3107'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

In a second terminal using the same local database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3107'
node scripts/verify-crm-team-integrity.mjs
```

`CRM_VERIFY_FIXTURES=1` explicitly opts into temporary fixture writes and cleanup.
Every mutation targets this run's random `crm008-<UUID>` fixture users, teams,
memberships, customers, tasks, or their audit records. Generated credentials and
confirmation tokens remain in memory and are not logged. Cleanup runs in
`finally` and compares the original database snapshot after removing fixtures.
A hard process termination can prevent cleanup; inspect only that run's fixture
IDs before any manual cleanup. Existing business data is never auto-repaired.

Coverage includes both authorized roles, zero-customer removal, warning-only
first requests, CLOSED customer inclusion, latest recount at confirmation,
signed explicit confirmation, invalid/repeated/mismatched/replayed confirmation
submissions, unauthorized and role-demoted sessions, unchanged customer/task
ownership and Sales role, exact audits, manager scoping, friendly duplicate and
invalid-member errors, concurrent confirmed removals of one membership,
concurrent two-admin adds, and direct concurrent Prisma
inserts (one success and one database `P2002`). Direct database probes intentionally
bypass application auditing and are restricted to dedicated temporary fixtures.

Run `scripts/verify-crm-pipeline.mjs` separately as documented in `README.crm.md`
for existing assignment, pipeline, customer filters, and CRM route regressions.
These checks exercise HTTP/HTML and database behavior, not browser hydration or
visual layout. Concurrent add/removal requests are issued together; this does not force
every possible database scheduling interleaving or simultaneous customer
reassignment/removal race.
