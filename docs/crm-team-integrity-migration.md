# CRM-008: local Sales Team integrity migration

Migration: `20260914050000_sales_team_member_user_unique`.

## Safety gate

Use only a local dev/test database. Never point these task commands at production.
The app, Prisma CLI, and verifiers must use the same `DATABASE_URL`.
Pause other writers while collecting before/after migration evidence.

Before editing the schema or creating the migration, the initial local preflight
found 2 memberships and **0 duplicated user IDs** in `localhost/lkc_fintech_dev`.
No data was repaired. Repeat this read-only preflight immediately before applying:

```powershell
node scripts/check-sales-team-integrity.mjs
if ($LASTEXITCODE -ne 0) { throw 'Stop: resolve the migration blocker outside this task.' }
npx.cmd prisma migrate status
```

The preflight groups **all** SalesTeamMember rows by userId, regardless of role.
If any count exceeds one, it reports the affected user IDs and team IDs and exits
2. Stop; do not delete, move, merge, or automatically repair those rows.
The script rejects non-loopback hosts, non-MySQL URLs, database names without a
dev/test segment, and names with a prod/production segment.

Inspect pending migrations before running `npx.cmd prisma migrate deploy` on the
verified local/test target. Only this named migration should be pending. Do not
use `migrate reset`, `db push --accept-data-loss`, or modify previous migrations.
A new conflicting row after preflight will make the unique-index creation fail;
that failure is a data blocker, not permission to repair data.

## SQL and schema

```sql
CREATE UNIQUE INDEX `SalesTeamMember_userId_key` ON `SalesTeamMember`(`userId`);
```

Prisma schema adds only `@@unique([userId])`. The existing composite unique
`teamId/userId`, non-unique userId index, and all relation fields are retained.
This intentionally enforces one membership for every user, including legacy
non-SALES membership rows. Existing demo seed rows are not changed or reseeded.

The migration adds an index only: no table drops, row rewrites, customer/task
ownership changes, or membership cleanup. MySQL DDL may take metadata locks and
build an index; there is no guarantee of zero operational impact on large tables.
DDL is not transactionally rolled back with surrounding application writes.

## Rollback SQL (provided, not automatically executed)

```sql
DROP INDEX `SalesTeamMember_userId_key` ON `SalesTeamMember`;
```

This removes **only** the new uniqueness enforcement. The old userId index still
supports the foreign key; composite uniqueness and all rows are retained.
Rollback weakens the invariant. Coordinate application/schema rollback and Prisma
migration history before using it; do not silently edit `_prisma_migrations` or
run this rollback in a production environment as part of this task.

## Verification

After local deployment, run preflight again, inspect `SHOW INDEX FROM
SalesTeamMember`, and require an empty `prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` result.
Compare customer, task, activity, team, membership, user, and audit data snapshots
before/after applying the migration (excluding Prisma's migration bookkeeping).

Local execution evidence for this task: the named migration was applied to
`localhost:3306/lkc_fintech_dev`; the business-data snapshot matched before/after,
the new unique index was present alongside both old indexes, and schema diff was
empty. No rollback SQL was executed and no production database was accessed.

`scripts/verify-crm-team-integrity.mjs` checks database-level concurrent duplicate
rejection plus server actions and the removal confirmation flow. The existing
`scripts/verify-crm-pipeline.mjs` checks assignment/pipeline/filter regressions.
See `tests/README.crm-team-integrity.md` and `tests/README.crm.md` for local runtime
setup. Temporary fixtures must be cleaned up and baseline snapshots must match.
