# CRM contact planning verification

The HTTP integration verifier uses real credential sessions, rendered React Server
Action metadata and the installed Prisma/MySQL stack. It does not import production
authorization, date or aggregate helpers to calculate expected contact-health data.

## Safety and execution

Use Node.js 24 and the installed project dependencies. The app and verifier must
use the same local development/test `DATABASE_URL`. Do not run against business or
production data, or alongside another verifier/process that changes that database.
The guard requires loopback app/database hosts, a MySQL database name containing a
`dev` or `test` underscore-delimited segment, no `prod`/`production` segment, and
explicit `CRM_VERIFY_FIXTURES=1`. No seed, migration or data repair is performed.

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
node scripts/verify-crm-contact-plan.mjs
```

Credentials and unique `crm012-<UUID>` fixture IDs are generated in memory. Only
this run's fixtures are mutated and deleted. Cleanup runs in `finally`, then hashes
all original customer/task/activity/team/membership/audit rows and non-secret user
fields to prove restoration. A hard process termination can prevent cleanup;
inspect only that run's random fixtures before any manual cleanup. No password,
session token, connection credential or customer snapshot content is logged.

## Coverage

- All nine application roles: global admins, global read-only MANAGER, scoped
  SALES_MANAGER and SALES, and blocked CLIENT/CREATOR/ANALYST/EMPLOYEE; forged
  dashboard filters and mismatched task assignees/activity actors grant no access.
- Independent all-status customer snapshot counts for overdue, today, upcoming
  and no-plan categories; CLOSED customers, UTC+7 midnight/end boundaries,
  overlapping today badges, existing list-filter links and refreshed result sets.
- Real SET/CLEAR actions for all four write roles, exact minute-precision UTC+7
  persistence and immutable historical audit rows. Same future timestamp and
  clear-null are complete no-ops, including `updatedAt` and audit count.
- Strict missing/blank/invalid/impossible/past/excessively distant dates,
  timezones/seconds/control characters, repeated fields, File values, invalid
  operations/IDs, forbidden date fields on CLEAR, foreign and nonexistent targets.
- Scheduling permits only `nextContactAt` and Prisma-managed `updatedAt`, plus
  exactly one privacy-safe old/new audit. Full snapshots protect actual-contact
  time, customer ownership/status/priority, tasks, activities, teams and user roles.
- Fresh role/status checks, stale forms after completed real assignment and signed
  team-removal workflows, and continued own-customer access after membership removal.
- All existing report data attributes and task-workbench rows/metrics remain unchanged by scheduling; all five
  manual interaction types preserve the plan and retain historical last-contact
  semantics. General profile saves, including forged plan fields, cannot change it.
- CRM dashboard, customer list/detail, assignment, teams, pipeline, follow-up and
  report route smoke checks. Existing dedicated CRM007–011 verifiers remain the
  separate comprehensive regression suites and should run sequentially.

These are HTTP/HTML/database checks, not browser
hydration or visual tests. Deterministic unit tests cover the exact 60-second
tolerance and 1095-day edges; live fixtures use clearly past/future values to avoid
clock races. Existing past dates cannot be re-SET as no-ops: validation runs first.
No forced concurrent transaction interleavings are attempted. Avoid running across
Vietnam midnight or while unrelated records cross a live due/contact boundary.

## Schema gate and feature boundaries

The existing CustomerProfile has nullable `lastContactAt DateTime?` and
`nextContactAt DateTime?`, `updatedAt DateTime @updatedAt`, and an existing
`@@index([nextContactAt])`. AuditLog already supports an action string, optional
actor/customer entity identity, JSON metadata and server-generated creation time.
No schema, migration, index, enum, dependency or authentication change is needed.

`lastContactAt` records actual contact under CRM-011's existing rule. A customer's
`nextContactAt` is an explicit contact plan, not a CustomerTask, calendar event,
notification, call or email delivery. Scheduling creates no CustomerActivity:
the enum has no contact-plan event, and NOTE is not used as a substitute.

The legacy `updateCustomerProfile` no longer parses or writes `nextContactAt`, and
its old input is removed. This paired change prevents omitted fields from clearing
plans and forged legacy submissions from bypassing the dedicated validation/audit.
Its other profile/status behavior and the task `dueAt` parser are unchanged.
CRM-008 assignment/team logic and CRM-009/010/011 implementations are unchanged.

## Authorization, transaction and audit

Customer detail uses the existing `sales:read` gate and `customerSalesScope`.
Health's read-only DAL also checks read permission; every count independently
ANDs that same scope with the canonical contact predicate.

| Role | Read | SET/CLEAR |
| --- | --- | --- |
| SUPER_ADMIN | Global customers | Global customers |
| ADMIN | Global customers | Global customers |
| MANAGER | Global customers | Denied |
| SALES_MANAGER | Customers owned by members of currently managed teams | Same scope |
| SALES | Currently assigned customers | Same scope |
| CLIENT | Denied | Denied |
| CREATOR | Denied | Denied |
| ANALYST | Denied | Denied |
| EMPLOYEE | Denied | Denied |

The dedicated `updateCustomerNextContact` action requires `sales:write`. Existing
authentication refreshes role/status per request. Within one Serializable
transaction the action reads the current actor again, checks ACTIVE/write
permission, validates input, and re-queries the customer using the fresh actor's
scope. Hidden IDs, previous action state, task assignee and activity actor do not
authorize a write. Completed reassignment, membership removal, demotion and
inactivation invalidate stale requests.

Only `CustomerProfile.nextContactAt` is supplied to the scoped `updateMany`;
Prisma automatically maintains `updatedAt`. No other customer, actual-contact
date, ownership/status/priority, task, activity, membership, team or user is written.
A real SET/CLEAR change and exactly one audit commit atomically:

```text
action: CUSTOMER_NEXT_CONTACT_UPDATE
actorId: current authenticated transaction actor
entityType: CustomerProfile
entityId: authorized customer ID
metadata: { customerId, previousNextContactAt, nextContactAt, operation }
```

Metadata dates are ISO UTC strings or null; operation is SET or CLEAR. No note,
interaction body, title, password, credential or session/confirmation token is
copied. Validation/scope failures create no writes or success audit. Known
P2034/P2025/P2003 conflicts return a handled reload/retry message without automatic
retry; unexpected failures propagate. Transaction rollback prevents partial audit
or plan updates. No rendering or network call runs inside the transaction.

An equal, valid SET timestamp or CLEAR on a null value returns no-change success
without touching any row, including updatedAt, or creating an audit. Date-range
validation precedes equality testing: an old past/out-of-range legacy timestamp
is rejected even if unchanged. Such a plan can still be explicitly cleared or
replaced by a valid future plan. No rendered-version token is added; sequential
authorized submissions can replace a previous plan. Serializable conflict handling
does not claim every possible simultaneous interleaving has been tested.

## Exact input and time contract

Exactly one string each is required for `customerId` and `operation`; SET also
requires exactly one `nextContactAt`. CLEAR must omit that date field entirely,
including blank/File/repeated values. IDs use `[A-Za-z0-9_-]{1,191}`. Missing,
repeated, file-valued, malformed or control-bearing trusted fields fail. Unknown
fields such as actor, lastContactAt, ownership, role, status, priority and task ID
are ignored and cannot enter the write shape.

`parseVietnamContactInput` accepts exactly `YYYY-MM-DDTHH:mm` with no trimming,
seconds, offset suffix or implicit host timezone. It validates numeric component
ranges and round-trips the calendar through UTC getters to reject normalization
of impossible dates. It subtracts a fixed seven-hour offset and checks converted
UTC years against MySQL DATETIME's 1000..9999 bounds. No date library is added.

| Vietnam input | Stored UTC |
| --- | --- |
| 2026-09-15T09:30 | 2026-09-15T02:30:00.000Z |
| 2026-09-15T00:00 | 2026-09-14T17:00:00.000Z |
| 2027-01-01T00:00 | 2026-12-31T17:00:00.000Z |

SET accepts the inclusive interval `[requestNow - 60 seconds,
requestNow + 1095 days]` (approximately three years). The one-minute lower
tolerance covers minute precision and request latency; clearly past and excessive
future dates are rejected, never clamped. The displayed input has minute precision;
existing seconds/milliseconds remain stored until an explicit valid change.
Display uses Vietnam time with machine-readable ISO timestamps.

Separate SET/CLEAR forms show pending/success/error feedback and are rendered only
for write roles. CLEAR cannot accidentally submit the SET date. A controlled SET
draft is retained on handled validation errors, synchronized with changed server
values, and keyed by customer identity. Normal React text rendering is used; no
unsafe HTML or user-provided markup is introduced. These client transitions have
not been independently tested in a hydrated browser.

## Canonical contact health and compatibility

CRM-007's existing windows are factored into the small `customerFollowUpWhere`
helper; the customer list/pipeline keep their previous predicate output. Detail
badges use `contactStates`, evaluated from those same windows. No customer status
is excluded, so CLOSED customers count when their date matches. The former
dashboard overdue contact card, which excluded CLOSED, is replaced by this
canonical section; other dashboard/customer/task metrics retain their definitions.

| Snapshot metric | Exact predicate | Customer drill-down |
| --- | --- | --- |
| Overdue | nextContactAt < now | /sales/customers?followUp=overdue |
| Today | nextContactAt in [Vietnam midnight, next midnight) | /sales/customers?followUp=today |
| Upcoming | nextContactAt >= now | /sales/customers?followUp=upcoming |
| Not scheduled | nextContactAt is null | /sales/customers?followUp=none |

Today deliberately overlaps overdue/upcoming. Four numbers are not a partition
and must not be summed into a total; both detail and dashboard explain this.
Four database counts use one captured request instant and a RepeatableRead
snapshot. The DAL does not accept URL filters, fetch customer history to group in
JavaScript, issue per-customer queries or share cached counts across users.
Foreign plan changes therefore alter none of a restricted viewer's counts.

After a real committed change, and only then, revalidation targets:

- `/sales/customers/<customerId>`
- `/sales/customers`
- `/sales`
- `/sales/pipeline` (also displays and filters nextContactAt)

No-op/error paths do not revalidate. CRM-009 uses task dueAt rather than this plan;
its data is unchanged. CRM-010 depends on customer creation/status/ownership,
tasks and activities, not nextContactAt or updatedAt, so report queries and report
revalidation are untouched. CRM-011 contact interactions retain their established
lastContactAt behavior and do not change nextContactAt.

## Local execution evidence (TASK-CRM-012)

Base main: `7e61bd289d407ff27d8fb3553fe6b4e621f407fe` (merged CRM-011 PR #9).
Verified with Node 24.19.0, Prisma 7.8.0 and Next 16.2.6 against
`localhost:3306/lkc_fintech_dev`. The production-built verification app used
`http://127.0.0.1:3108`, with matching NEXTAUTH_URL/CRM_VERIFY_BASE_URL; an existing
listener on 3107 was left untouched. No push, PR, merge, migration, seed, repair
or external communication/delivery operation was performed.

| Command/check | Result |
| --- | --- |
| `npx.cmd prisma format` | PASS; only formatter-induced line endings restored; schema content unchanged |
| `npx.cmd prisma validate` | PASS |
| `npx.cmd prisma generate` | PASS |
| All nine unit-test files below | 90 PASS: existing 69 + 15 contact-plan/time + 6 contact-health |
| `npm.cmd run lint` | PASS, including new verifier |
| `npm.cmd run build` | PASS, including TypeScript and dynamic sales/customer routes |
| `node --check scripts/verify-crm-contact-plan.mjs` | PASS |
| `node scripts/verify-crm-contact-plan.mjs` | 927 assertions PASS |
| `node scripts/verify-crm-activities.mjs` | 436 assertions PASS |
| `node scripts/verify-crm-reports.mjs` | 1026 assertions PASS |
| `node scripts/verify-crm-follow-ups.mjs` | 259 assertions PASS |
| `node scripts/verify-crm-pipeline.mjs` | 169 assertions PASS |
| `node scripts/verify-crm-team-integrity.mjs` | 190 assertions PASS |
| Working/staged/branch diff whitespace checks | PASS |
| Changed-file strict UTF-8/mojibake scan | PASS |

Combined unit command:

```powershell
node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs tests/crm-report-scope.test.mjs tests/crm-activity-filters.test.mjs tests/crm-interaction-validation.test.mjs tests/crm-contact-plan-time.test.mjs tests/crm-contact-health.test.mjs
```

All integration runs were sequential and restored their original business/audit
snapshots. Read-only preflight/postflight: 2 memberships, 0 duplicated user IDs;
1 original customer, 1 activity and 1 task retained; 0 CRM-012 fixture users remain.
Only temporary test fixtures were removed by each verifier's cleanup.

Existing MODULE_TYPELESS_PACKAGE_JSON and Next standalone-start warnings are
non-failing notices. CRM-008's concurrent conflict tests emitted handled Prisma
write-conflict diagnostics while all assertions passed. No production-scale query
benchmark or forced contact-update concurrency/failure injection was performed.
Independent review should focus on scope freshness, the removal of the alternate
profile writer, overlapping contact semantics, UTC+7/range edges, no-op ordering,
and the exact nextContactAt-only/audit transaction boundary.
