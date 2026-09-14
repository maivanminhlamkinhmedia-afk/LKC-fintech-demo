# Follow-up workbench verification

Requires installed dependencies, Node.js 24, and a local development/test MySQL
database. The app and verifier must use the same `DATABASE_URL` and authentication
configuration. No migration, seed, or repair is performed by this verifier.

Focused pure filter tests (including shared CRM-007 date semantics):

```powershell
node --test tests/crm-follow-up-filters.test.mjs
```

The Node test uses a narrowly scoped resolver hook for the extensionless shared
TypeScript import that Next resolves natively; no application module settings change.

Build/start the app in one terminal:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3107'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

Run in a second terminal, using the same database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3107'
node scripts/verify-crm-follow-ups.mjs
```

Explicit opt-in authorizes temporary fixture creation, mutation and cleanup.
Both app/database hosts must be loopback, and the database name must have a
delimited `dev` or `test` component without `prod`/`production`. Manually confirm
it is local/test data; hostname/name guards are not sufficient proof by themselves.
Do not run concurrently with other writers. Fixture IDs use a random
`crm009-<UUID>` prefix; credentials remain in memory and are never logged.
Cleanup runs in `finally`, deletes only this run's fixtures, and compares the
original database snapshot. A hard process termination can prevent cleanup;
inspect only that run's IDs before manually removing leftover fixtures.

Coverage: real credential sessions; every role's workbench access; customer-based
task scope despite deliberately mismatched task assignees; scoped/filtered metrics;
all filters and real task statuses; literal percent/underscore/backslash search
with decoys; invalid/repeated filters; empty/reset results; UTC+7 dates and midnight
boundaries; pagination; shared task status actions; no-op/completion/reopening;
audit counts; preservation of customer/task ownership, unrelated task fields,
activity history, roles and teams; forged IDs/ownership fields; stale sessions,
customer reassignment and membership removal; customer-detail task operations;
existing CRM route and dashboard links.

The due-state list filter applies to all task statuses. Metrics count open
(`TODO`/`IN_PROGRESS`) tasks intersecting every active list filter. Vietnam calendar
"today" overlaps overdue/upcoming. Dates are measured live; avoid running across
Vietnam midnight or a fixture's due instant. HTTP/HTML and database checks do not
cover browser hydration, visual layout, or every concurrent database interleaving.

Run `scripts/verify-crm-pipeline.mjs` and `scripts/verify-crm-team-integrity.mjs`
separately for existing assignment/filter/pipeline and CRM-008 safe-removal
regressions; see `README.crm.md` and `README.crm-team-integrity.md`.

## Architecture and review notes

The route requires `sales:read`. `customerSalesScope` is a separate AND predicate
through each task's customer, never replaced by URL filters. The Sales filter is
`CustomerTask.assignedToId`, and the team filter follows that assignee's current
membership; neither changes customer-based authorization. Option lists select
assignees of visible tasks; team options additionally retain existing role scope.
A historical assignee can therefore differ from the authorized customer owner.

The list selects task/customer/assignee summaries only, with 30 rows per page and
stable due-date/id ordering. Five database counts and the bounded task fetch use a
RepeatableRead transaction; all four open-task metrics intersect every active
filter. No per-row query or activity-history fetch is used. Assignee/team option
lists are not paginated, and MySQL ascending due dates place null dates first.
Large-dataset query plans and latency have not been benchmarked; no index/schema
change is included in this task.

Both the workbench and customer detail reuse `updateCustomerTaskStatus` and the
shared `TaskStatusForm`. `sales:write` is checked on every submission; MANAGER
remains read-only. A Serializable transaction reads the currently scoped task and
conditionally updates the same scoped row/version. Only status/completedAt change
(plus Prisma's updatedAt); forged customer/owner/team/task fields are ignored.
Actual changes create the existing `CUSTOMER_TASK_STATUS_UPDATE` audit with
status, previousStatus and customerId atomically. Existing task updates did not
create activity rows; this remains unchanged. No-op submissions preserve the
entire task and add no audit. Scope/validation/conflict failures return handled
errors. Cache invalidation includes the workbench after task/profile, assignment,
pipeline or team changes; those other mutation rules are unchanged.

## Local execution evidence (TASK-CRM-009)

Verified against `localhost:3306/lkc_fintech_dev` with the built app at
`http://127.0.0.1:3107`, using Node 24.19.0, Prisma 7.8.0 and Next 16.2.6:

- Prisma format, validate and generate passed. Schema/migration content unchanged.
- CRM-007 filters + CRM-008 confirmation unit tests: 21 passed.
- CRM-009 focused filter unit tests: 10 passed.
- ESLint and production build: passed; `/sales/follow-ups` is dynamic.
- CRM-009 runtime verifier: 259 assertions passed.
- CRM-007 pipeline/assignment/filter regression: 169 assertions passed.
- CRM-008 team integrity/safe removal regression: 190 assertions passed.
- Every integration run restored its original business-data snapshot after cleanup.
- Read-only membership preflight: 2 memberships, 0 duplicated user IDs.

Runtime verification uses HTTP/HTML submissions to the real rendered Server
Actions, not a hydrated browser. It covers stale requests after scope/role changes
but does not force simultaneous task-update/reassignment interleavings. Node's
existing MODULE_TYPELESS_PACKAGE_JSON warning and the existing standalone-output
warning from `next start` are non-failing environment notices.
