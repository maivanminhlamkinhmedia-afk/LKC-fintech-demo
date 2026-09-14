# CRM reporting verification

## Safety and execution

Requires installed dependencies, Node.js 24, and a local development/test MySQL
database. The app and verifier must use the same `DATABASE_URL` and authentication
configuration. This verifier does not apply migrations, seed, or repair data.

Build/start the app in one terminal:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3107'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

Run in a second terminal using the same database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3107'
node scripts/verify-crm-reports.mjs
```

Explicit opt-in authorizes temporary fixture creation and cleanup. Both hosts
must be loopback; the database name must have a delimited `dev` or `test` component
without `prod`/`production`. Manually verify it is local/test data: hostname/name
guards alone are not proof. Do not run concurrently with other database writers.
Fixture IDs use a random `crm010-<UUID>` prefix. Generated credentials remain in
memory and are never logged. The report requests themselves are GET-only and
are checked against before/after database snapshots for read-only behavior.

Cleanup runs in `finally`, removes only this run's fixture records, and compares
the original database snapshot. A hard process termination can prevent cleanup;
inspect only that run's IDs before removing any leftovers. Existing business
rows are never auto-repaired or deleted by the verifier.

## Coverage and limitations

The independent test oracle reads raw local database rows and calculates expected
counts without importing report-query/filter helpers. This fetch-and-group
strategy is test-only, not the production reporting architecture.

Coverage includes every role; customer authorization independent of task assignee;
all headline metrics; real status/priority/activity distributions; percentages;
Sales/Team current-ownership workload, null-owner/no-team buckets; scoped identity
options; foreign fixture changes affecting none of the visible scoped aggregates;
fresh-role denial for a previously authorized session after demotion;
ownership/status/priority filters; period presets/custom ranges; exact UTC+7 start
and inclusive-UI/exclusive-database end boundaries; invalid/repeated/malformed
inputs; empty/reset behavior; 20-row table pagination and deterministic ordering;
bounded options with more than 100 authorized owners; GET-only report behavior;
existing routes and dashboard navigation.

Fixtures distinguish customer snapshot counts from new-period counts, old tasks
completed inside the period, completion exactly at each boundary, null completion
dates, reopened tasks with legacy completion timestamps, current overdue/open
tasks created outside the selected period, nonzero null-owner/no-team task
workloads, null assignees and activities with
foreign/null actors. No historical attribution or conversion is inferred.

Live overdue/today metrics use the current instant. Avoid running across Vietnam
midnight or a fixture due instant. These HTTP/HTML and database checks do not test
browser hydration, visual layout, production-scale performance, or every possible
concurrent transaction interleaving.

Run `verify-crm-pipeline.mjs`, `verify-crm-team-integrity.mjs`, and
`verify-crm-follow-ups.mjs` separately for CRM-007/008/009 mutation and stale-scope
regressions, following their corresponding README safety instructions.

## Architecture and authorization

`/sales/reports` is an authenticated, dynamic Server Component. It requires
`sales:read`, uses a plain GET filter form and introduces no Server Actions.
Only the dashboard card and permission-gated PortalShell link modify existing
application files. Schema, migrations, indexes, dependencies, authentication,
assignment, pipeline, task and team mutation code are unchanged.

`report-filters.ts` validates known fields and builds a current customer predicate:
`customerSalesScope(user) AND report ownership/status/priority filters`.
The reporting period is deliberately not part of that portfolio predicate.
`report-queries.ts` applies it to every count, distribution and workload query.
Task and activity authorization runs through the related customer, never through
task assignee or activity actor. A mismatched historical task assignee neither
grants access nor changes the workload's current owner.

| Role | Read scope for every reporting section |
| --- | --- |
| SUPER_ADMIN, ADMIN, MANAGER | Existing global CRM customer scope |
| SALES_MANAGER | Customers whose current owner belongs to a currently managed team |
| SALES | Customers currently assigned to the viewer |
| CLIENT, CREATOR, ANALYST, EMPLOYEE | Denied by existing `sales:read` permissions |

The data-access function also checks read permission. Parameterized workload SQL
uses `report-scope-sql.ts`, a deliberately narrow adapter for the exact existing
`customerSalesScope` shapes. It rejects unexpected keys, nesting, role/scope
mismatches or future unsupported scope changes before any report queries run.
It is not a general Prisma-to-SQL converter. Both Prisma and SQL retain the
authorization clause independently from URL filters. All values are bound;
identifiers and query fragments are static. There is no unsafe raw-query API.

Identity options come from owners/teams with authorized current customers, not
all users or teams. They are independent of the selected report filters, ordered
by name/id, and capped at 100 with a truncation notice (101-row probe). Selected
IDs missing from those options receive a generic placeholder without a lookup.
Workload labels are separately re-scoped and selected only for the at-most-20
group IDs on each page. Null customer owners and missing memberships form
explicit authorized-only "Chưa phân công" and "Không có đội" buckets. Existing
owners are not dropped merely because their present account role/status changed.

## Filter and date contract

- `period`: `7d`, `30d` (default), `90d`, `ytd`, `custom`.
- Presets include today's full Vietnam calendar day and the preceding N-1 days;
  YTD starts January 1. They are calendar windows, not rolling-hour durations.
- `from`/`to`: strict real `YYYY-MM-DD` dates; only used by `custom`. The UI end
  day is inclusive. Queries use `[startUtc, endExclusiveUtc)` where the end is
  midnight following the selected Vietnam day. UTC+7 conversion is independent
  of host timezone. Custom windows allow at most 366 inclusive days and keep
  converted boundaries within supported MySQL DATETIME years.
- Invalid/missing custom dates, reversed dates and oversized ranges visibly fall
  back to 30 days. Invalid/repeated periods also fall back to 30 days. Preset
  date fields are validated, but even valid supplied dates do not override the
  preset. Invalid IDs/enums/pages are ignored/reset with an explicit notice.
- `salesId` and `teamId` filter current **customer ownership**, unlike CRM-009's
  task-assignee filters. `status` and `priority` are current CustomerProfile enums.
- `page` and `teamPage` independently paginate Sales and Team groups, respectively.
  Integers 1..1,000,000 are accepted then clamped to available pages; each page
  has at most 20 rows. Repeated arrays, controls and overlong input are rejected.
  Unknown query fields do not enter predicates. GET submission resets both pages.
- Report pagination retains active report filters. Existing CRM navigation links
  are intentionally unfiltered: report dates and owner filters must not be
  presented as equivalent to follow-up/task-assignee filters.

## Exact metric definitions

In this table, **portfolio** means current authorized customers intersected with
the current ownership/status/priority filters. No selected-period restriction is
applied to portfolio membership. All period comparisons use the same half-open
UTC+7 window. All current comparisons use one captured request-time `now`.

| Displayed metric | Snapshot or period | Source/date/predicate within portfolio |
| --- | --- | --- |
| Current customers | Snapshot | CustomerProfile count; no date restriction |
| New customers | Period | CustomerProfile.createdAt within period |
| Open tasks | Snapshot | CustomerTask through portfolio; current TODO or IN_PROGRESS |
| Overdue open tasks | Snapshot | Same open tasks; non-null dueAt strictly before now |
| Open tasks due today | Snapshot | Same open tasks; dueAt in today's half-open Vietnam day; may overlap overdue |
| Completed tasks | Period | CustomerTask through portfolio; current DONE and non-null completedAt within period |
| CRM activities | Period | CustomerActivity through portfolio; createdAt within period |
| Customer status distribution | Snapshot | CustomerProfile grouped by each real CustomerStatus; count and count/current portfolio total * 100 |
| Customer priority distribution | Snapshot | CustomerProfile grouped by each real CustomerPriority; same percentage denominator |
| Activity distribution | Period | CustomerActivity grouped by each real CustomerActivityType, createdAt within period |
| Sales workload: customers/new/open/overdue/completed | Snapshot or period as in matching rows above | Same definitions, grouped by CustomerProfile.assignedSalesId, including null owner |
| Team workload: customers/new/open/overdue/completed | Snapshot or period as in matching rows above | Same definitions, grouped by the current owner's SalesTeamMember.teamId, including no team |
| Workload group totals/page counts | Current portfolio metadata | Number of current owner/team groups with matching customers (including applicable null bucket), divided into 20-row pages |

Zero-valued enum buckets are displayed. Empty portfolio percentages are zero;
displayed percentages are rounded to at most two decimals and can sum to 99.99%
or 100.01%. Task creation date never substitutes for completion date. Reopened
tasks are excluded from completed-period counts; CRM-009 clears completedAt on
reopening, and even inconsistent legacy non-DONE rows are not counted. These are
current retained completion records, not a history of all completion events.

Sales/team figures describe **currently owned customer portfolios**, not the
person who acquired the customer, performed the task, or owned the customer at
the time of an event. Activity counts have no salesperson attribution. No revenue,
P&L, commission, completion rate, financial KPI or conversion rate is calculated.

Historical conversion deferred because current data does not provide sufficient
trustworthy transition history. CustomerActivity status transitions are free-text
content, not typed previous/new status columns. CRM-007 pipeline audits contain
structured transitions, but the general profile-update audit does not retain the
previous status. Together these do not establish a complete historical conversion
dataset; current status distribution must not be interpreted as conversion.

## Query bounds and consistency

One RepeatableRead transaction contains seven Prisma counts, three finite enum
groupings, one SQL owner/team group-total query, two bounded option queries, two
paginated workload aggregate queries, and two bounded label queries: 17 logical
queries independent of customer/group count, with no per-row queries. It contains
no rendering or network work and has a 10-second timeout. There is no shared
cross-user report cache, reporting table or materialized aggregate.

Prisma cannot group task aggregates by a related customer's owner/team directly.
Only those workload aggregates and their group totals use parameterized MySQL SQL:
CustomerProfile joins current membership and tasks. The existing CRM-008 unique
user membership prevents membership fan-out; COUNT DISTINCT customer IDs prevents
task joins from multiplying customer/new-customer counts. Activities are not joined
into workload queries. Numeric SQL results are checked as safe nonnegative integers.

Only 20 owner/team groups per table are returned, ordered by their stable IDs
(MySQL null first). SQL computes aggregates in the database; the application does
not fetch all customers/tasks to group them in JavaScript. Finite enum groups and
bounded label maps are the only application-side aggregation/lookup shaping.
Database work may still scan/sort many matching records, and offset pagination
and relation predicates have not been benchmarked at production scale. No index
change is included. The SQL scope adapter must be revisited if the shared scope
helper or schema changes; its refusal is intentional, not a global-access fallback.

## Local execution evidence (TASK-CRM-010)

Verified on `localhost:3306/lkc_fintech_dev` with the production-built app at
`http://127.0.0.1:3107`, Node 24.19.0, Prisma 7.8.0, and Next 16.2.6:

- `npx.cmd prisma format`: passed; only line endings were restored afterward,
  and the schema's Git content hash still matches the base commit.
- `npx.cmd prisma validate` and `npx.cmd prisma generate`: passed.
- `node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs`: 43 passed (15 + 6 + 10 + 12).
- `node --test tests/crm-report-scope.test.mjs`: 8 passed; all five test files
  together also passed (51 total).
- `npm.cmd run lint`: passed. `npm.cmd run build`: passed, including TypeScript;
  `/sales/reports` is dynamic.
- `node scripts/verify-crm-reports.mjs`: 1,026 assertions passed.
- `node scripts/verify-crm-follow-ups.mjs`: 259 assertions passed.
- `node scripts/verify-crm-pipeline.mjs`: 169 assertions passed.
- `node scripts/verify-crm-team-integrity.mjs`: 190 assertions passed.
- Every integration run restored its baseline business-data snapshot. Read-only
  membership preflight before/after: 2 memberships, 0 duplicated user IDs.

Runtime tests use real credential sessions and HTTP/HTML, not hydrated-browser
or visual verification. The existing MODULE_TYPELESS_PACKAGE_JSON warning and
`next start` standalone-output warning are non-failing environment notices.
No migration, seed, repair or production database operation was performed.

Independent review should focus on Prisma/SQL authorization parity, the existing
CRM-008 uniqueness assumption, portfolio-vs-actor semantics, completedAt/reopening,
UTC+7 boundaries, capped identity options, and real-data query-plan performance.
