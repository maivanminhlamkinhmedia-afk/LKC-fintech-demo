# CRM task planning verification

TASK-CRM-013 edits planning fields on existing CustomerTask records from the
customer detail page and the centralized follow-up workbench. Task creation,
assignment and CRM-009 status transitions remain separate workflows.

Reviewed implementation base: `777610812d80ba0b09b7276ffec42980f70fbb13`,
main after TASK-CRM-012 / PR #10. This task's workflow is local implementation,
verification and a local commit only; it does not authorize a push, PR or merge.

## Safety and local execution

Use Node.js 24, installed project dependencies and the local development/test
MySQL database. App and verifier must use the same DATABASE_URL and compatible
authentication configuration. Before opting in, manually confirm the database
contains local/test data; a database name alone is not proof.

The integration verifier requires `CRM_VERIFY_FIXTURES=1`, loopback app and
database hosts, an HTTP(S) app URL, and a MySQL database name with an
underscore-delimited `dev` or `test` component and no `prod`/`production` component.
Never point it at production or run it concurrently with other database writers.
There is no migration, seed, destructive reset, repair or production operation.

Build/start a verification app in one terminal. Confirm the selected port is free;
do not stop an unrelated listener to reuse it. These examples use port 3108:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3108'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108
```

Run the verifier in another terminal with the same database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3108'
node scripts/verify-crm-task-plan.mjs
```

Fixtures use randomized per-run identifiers, customer codes and emails. Only
recorded fixtures belonging to the current run may be changed or removed. A
baseline snapshot is compared after cleanup in `finally`; pre-existing business
rows are neither deleted nor auto-repaired. A hard process termination can prevent
cleanup, so inspect that specific run's recorded IDs before any manual cleanup.
Credentials, sessions and confirmation tokens must remain in memory and must not
be printed. Do not log customer snapshots or task title/body content.

Run the existing CRM-007 through CRM-012 verifiers sequentially, following their
individual safety READMEs and matching the same app port. Keep fixtures away from
live due boundaries and avoid crossing Vietnam midnight during a run.

## Schema gate and field ownership

The current schema is sufficient. No schema, migration, index, enum, dependency
or authentication-architecture change is included.

| CustomerTask field | Actual definition | TASK-CRM-013 treatment |
| --- | --- | --- |
| id | String, primary key, generated cuid | Immutable |
| customerId | Required String | Immutable; authorization follows this customer |
| assignedToId | Nullable String | Immutable; not an authorization shortcut |
| createdById | Required String | Immutable |
| title | Required String; existing migration uses VARCHAR(191) | Editable, existing 160-unit application limit |
| description | Nullable String, Text | Present but outside planning scope; immutable |
| status | CustomerTaskStatus, default TODO | Immutable; CRM-009 remains authoritative |
| priority | CustomerTaskPriority, default MEDIUM | Editable |
| dueAt | Nullable DateTime | Editable or explicitly cleared |
| completedAt | Nullable DateTime | Immutable |
| createdAt | DateTime, default now | Immutable |
| updatedAt | DateTime, Prisma-managed @updatedAt | Optimistic version; advances only on real updates |

Actual enums:

- `CustomerTaskStatus`: TODO, IN_PROGRESS, DONE, CANCELLED.
- `CustomerTaskPriority`: LOW, MEDIUM, HIGH, URGENT.

Relations: required customer with `onDelete: Cascade`; optional assignedTo User
with `onDelete: SetNull`; required createdBy User with `onDelete: Restrict`.
Existing indexes are `[customerId, status]`, `[assignedToId, status, dueAt]`, and
`[createdById]`. The existing migration stores task timestamps as DATETIME(3).

The only task data supplied to the planning update is `{ title, priority, dueAt }`;
Prisma manages updatedAt. Nothing writes CustomerProfile, CustomerActivity,
SalesTeam, SalesTeamMember or User. Task description/creator, assignment, status,
completion and creation times remain unchanged.

Existing `createCustomerTask` is not redesigned: it retains its 160-unit trimmed
title limit, optional description and dueAt parser, and assigns the customer's
current Sales owner or falls back to the creator. The new parser is only for
editing existing tasks and does not weaken or replace creation authorization.
Creation previously had no explicit business-year range; the new edit range and
stricter controls are deliberately documented below rather than silently changing
the legacy create path.

## Read/write authorization and terminal tasks

Both existing pages require `sales:read`. Tasks are visible through
`customerSalesScope(user)`, never merely because assignedToId matches the viewer.
Every planning submission independently requires `sales:write`.

| Role | Read scope | Planning write scope |
| --- | --- | --- |
| SUPER_ADMIN | Global CRM customers | Global, open tasks only |
| ADMIN | Global CRM customers | Global, open tasks only |
| MANAGER | Existing global CRM customers | Denied |
| SALES_MANAGER | Customers owned by members of currently managed teams | Same current customer scope, open tasks only |
| SALES | Currently assigned customers | Same current customer scope, open tasks only |
| CLIENT | Denied | Denied |
| CREATOR | Denied | Denied |
| ANALYST | Denied | Denied |
| EMPLOYEE | Denied | Denied |

The authentication callback refreshes role/status for each request. After pure
input validation, the Serializable transaction re-reads the current actor from
the database, requires ACTIVE/write permission, and derives scope from that fresh
actor. It re-queries the task through its actual customer and repeats that scope
at the write boundary. Hidden IDs, previous action state, task assignee, customer
owner fields and actor fields never authorize a write.

Completed customer reassignment, team-membership removal, demotion or account
inactivation revoke stale access. A task assigned to someone else remains
editable if its customer is authorized; a foreign customer's task remains denied
even when the viewer is its task assignee.

Planning is allowed only for TODO and IN_PROGRESS. DONE/CANCELLED tasks remain
visible with a read-only planning notice and are rejected server-side even if a
form is forged. This matches the existing definition of open work. CRM-009 still
permits its existing explicit status transitions, including reopening; planning
never reopens a task, changes status or clears completedAt.

## Strict input contract

The action accepts exactly one string each for:

```text
taskId
title
priority
dueAt
expectedUpdatedAt
```

Missing, repeated and File-valued trusted fields fail. Task IDs must match
`[A-Za-z0-9_-]{1,191}` without trimming. Extra customerId, assignedToId, status,
completedAt, createdAt, description, customerAssignedSalesId, nextContactAt,
lastContactAt, teamId, actorId, role and previous-state fields have no effect.
Arbitrary form keys are never spread into Prisma update data.

Title is trimmed, required and limited to 160 JavaScript UTF-16 code units, matching
the existing create-task maximum and fitting VARCHAR(191). Vietnamese, combining
marks and emoji are preserved without normalization. No silent truncation occurs.
Every C0 control and DEL is rejected, including tabs/newlines at edges which trim
would otherwise remove. An 80-emoji astral title uses exactly 160 units.

Priority must exactly match one real CustomerTaskPriority value. Case changes,
leading/trailing whitespace, controls and invented enum members are rejected.

`expectedUpdatedAt` is the exact rendered UTC ISO timestamp, including three
fractional digits: `YYYY-MM-DDTHH:mm:ss.sssZ`. Its year is 1000..9999 and its parsed
Date must round-trip identically. Invalid calendars, noncanonical precision,
timezone offsets, controls and malformed strings fail. This version field is
not converted from Vietnam local time and is not restricted to the due-date range.

## dueAt conversion, range and intentional clearing

The new form accepts exactly `YYYY-MM-DDTHH:mm` in Vietnam UTC+7: no trimming,
seconds, `Z`, offset suffix or implicit host-local parsing. It reuses CRM-012's
low-level `parseVietnamContactInput` conversion, including calendar round-trip
validation, without changing that helper or importing CRM-012's future-only
contact-plan policy.

The accepted due-date range is inclusive from local `1900-01-01T00:00` through
`2100-12-31T23:59`. Past deadlines remain representable; there is no request-time
future requirement or 1095-day rule for tasks. This broad business-year range
rejects absurd dates without excluding ordinary overdue work. Inputs are rejected,
never clamped. Existing values outside this range are not repaired on read; an
edit must explicitly replace them with an in-range date or clear them.

| Vietnam input | Stored UTC |
| --- | --- |
| 2026-09-15T09:30 | 2026-09-15T02:30:00.000Z |
| 2026-09-15T00:00 | 2026-09-14T17:00:00.000Z |
| 2027-01-01T00:00 | 2026-12-31T17:00:00.000Z |
| 1900-01-01T00:00 | 1899-12-31T17:00:00.000Z |
| 2100-12-31T23:59 | 2100-12-31T16:59:00.000Z |

An explicitly present, singleton `dueAt=''` means intentional clearing to null.
Omitting dueAt is an error, not a request to clear it. Whitespace, the string
`null`, repeated empty values and File values also fail. The UI's clear button
only empties the draft; the user must press Save to persist that null value.

The form displays minute precision. If a valid submitted minute matches the
stored deadline's displayed Vietnam minute, the action preserves the stored
seconds/milliseconds. A title/priority edit must not round a legacy deadline.
Changing the minute or clearing the field is an explicit deadline change. This
UI intentionally cannot reset seconds while keeping that same minute unchanged.

## Optimistic version, no-op and atomicity

The form renders expectedUpdatedAt with its editable draft. Inside one Serializable
transaction, the action checks current actor authorization, reads the scoped task,
and compares the rendered timestamp with the stored updatedAt before checking
terminal eligibility or no-op equality. Even an otherwise identical stale request
fails rather than being silently accepted.

Canonical comparison uses trimmed title, exact priority, and dueAt after the
same-minute preservation rule. If all three are unchanged, it returns no-change
success without updating any row, including updatedAt, adding an audit or
revalidating paths.

A real update uses `updateMany` with task ID, actual customer ID, expected updatedAt,
current status and customer scope, and requires exactly one affected row. It then
re-reads Prisma-managed updatedAt. If that timestamp did not strictly advance,
the transaction throws a handled stale error and rolls back. This ensures a
successful planning edit invalidates its own prior timestamp token even at
millisecond resolution; it does not manually assign updatedAt.

Only after those checks does the transaction create one planning audit. An audit
failure rolls back the task update; a failed update leaves no audit. Known
P2034/P2025/P2003 conflicts or missing-relation errors return a handled reload
message, with no automatic retry. Unexpected failures propagate instead of
fabricating success. Revalidation happens only after a real successful commit.

Timestamp versions are not absolute revision counters. The post-write check
guards this planning action, but CRM-009 or external writers can theoretically
perform distinct writes sharing a millisecond timestamp, or preserve a timestamp.
Those cases cannot be exhaustively detected by timestamp-only optimistic locking.
The existing CRM-009 implementation is unchanged: it has its own transaction-time
status/version CAS, not a rendered expectedUpdatedAt form token. Planning never
writes status or completedAt, including during conflicts. No claim is made that
every possible concurrent interleaving has been forced or benchmarked.

## Audit and privacy

Exactly one audit is appended for a real planning change:

```text
action: CUSTOMER_TASK_PLAN_UPDATE
actorId: fresh authenticated transaction actor
entityType: CustomerTask
entityId: actual task ID
metadata: {
  customerId,
  taskId,
  changedFields,
  previousPriority,
  priority,
  previousDueAt,
  dueAt
}
```

`changedFields` lists only changed names in title/priority/dueAt order. Due dates
are exact ISO UTC strings or null; priorities are real enum values. Old/new
priority and dueAt are included even when only title changed. Title content is
deliberately omitted because it can contain sensitive customer information;
`changedFields` still records that it changed. No description, interaction body,
secret, session or confirmation token is duplicated into AuditLog. Historical
audits remain immutable. No-op, validation, authorization and stale failures
create no success audit.

## UI, bounded reads and rendering

Both customer detail and follow-up workbench reuse a compact disclosure containing
one TaskPlanningForm. Its only editable fields are title, priority and due date;
the existing independent TaskStatusForm is retained, not duplicated. No task or
customer reassignment selector is introduced. Read-only users receive no planning
form. Terminal tasks show a read-only planning notice.

The workbench keeps its filters, customer links, ordering and 30-row pagination;
only updatedAt is added to its existing task summary selection. The existing
customer detail task panel stays capped at 100 tasks. There is no unbounded task
history load or per-task query loop introduced by planning controls.

Controlled draft fields and their version are keyed together by task ID and
updatedAt. A fresh server version replaces both together after revalidation;
handled errors retain the current draft while the version remains unchanged.
Draft retention and inline feedback apply only while the planning form remains
rendered. A refreshed DONE/CANCELLED state removes the form and its inline error;
loss of scope or active-filter membership can remove the task card. Server-side
rejection still prevents mutation even when that feedback is no longer visible.
Pending state disables inputs/buttons and separate action feedback is accessible
through live status/error messages. React renders titles and feedback as escaped
plain text; no unsafe HTML interpretation is added. HTTP/HTML checks alone do not
prove browser hydration, focus behavior or visual layout.

## Revalidation and CRM compatibility

Every real planning update revalidates:

- `/sales/customers/<actualCustomerId>`
- `/sales/follow-ups`

Only a real canonical dueAt change additionally revalidates:

- `/sales/reports`
- `/sales`
- `/sales/customers`
- `/sales/pipeline`

Customer list and pipeline support `task=overdue` using related open-task dueAt,
so their filtered result sets can change even though CustomerProfile is untouched.
The dashboard's overdue-task metric also depends on dueAt. Title/priority do not
affect those surfaces. Teams and assignment pages are not invalidated. No-op and
failure paths perform no revalidation.

CRM-009 workbench due filters include every task status; its metrics count only
TODO/IN_PROGRESS intersecting all active filters. A dueAt edit affects due-state
membership and ordering. Title/priority edits can change filtered workbench rows
and metrics because search includes task title and priority is a task filter.
They do not change overall ownership or status totals. Status/completedAt and the
existing status action remain untouched.

CRM-010 report queries are unchanged. For an open task, dueAt can legitimately
change top-level overdue/today and the owning customer's current Sales/team
overdue workload values. Reports have no upcoming metric. Open/completed totals,
customer/new-customer counts, distributions, activities, workload group counts
and pagination are unchanged. Task title/priority affect no report metric; report
priority distribution concerns customers. Foreign viewers must see no new data
or aggregate delta outside their authorized customer scope.

CRM-012 nextContactAt is the customer's contact plan, not a task deadline.
Changing or clearing either field does not synchronize, clear, create or update
the other. Task title/priority/dueAt edits preserve the entire CustomerProfile,
including nextContactAt, lastContactAt, owner, status and priority. Contact-health
counts remain unchanged. Conversely, contact-plan SET/CLEAR leaves every task
unchanged. Reusing only the existing conversion helper does not change CRM-012's
own date grammar or scheduling range.

CRM-011 activity logging remains independent. Planning creates no CustomerActivity
and modifies no existing activity or lastContactAt. NOTE is not used as a
synthetic task-planning event. CRM-007 customer pipeline status and CRM-008
assignment/team membership behavior are unchanged.

## Verification layers and required coverage

Pure Node parser tests exercise singleton/File rejection, title and priority
rules, exact date range/conversion, timezone independence, expectedUpdatedAt
grammar, terminal eligibility and forged-field exclusion. They do not connect
to a database or execute a rendered Server Action.

`tests/crm-task-plan-action.test.mjs` uses mocked Prisma/auth/revalidation
dependencies to verify control
flow, write predicates/shapes, audit metadata, no-op behavior and failure handling.
Injected failures in a mock transaction can demonstrate the action's rollback
expectations but are not proof of actual MySQL isolation or storage atomicity.
Keep those results distinct from the integration verifier.

The real integration layer uses credential sessions, rendered Server Action
metadata, HTTP/HTML responses and independent Prisma assertions. Required
coverage includes all nine role read/write cases, foreign/mismatched assignee
cases, real title/priority/due/combined updates, explicit clear and no-op, strict
malformed/repeated/File inputs, no-side-effect snapshots and exact privacy-safe
audit deltas. It must test old forms after completed status changes and planning
updates, plus real reassignment and team removal, with no stale success audit or
reverted status/completedAt. Contact-plan separation and due-sensitive report,
workbench, dashboard and customer/pipeline filter behavior need real assertions.

The integration verifier also sends two concurrent planning requests carrying the
same version. It checks one winner, one handled stale/conflict response, exactly
one privacy-safe audit, and unchanged status/ownership/contact/activity data.
This bounded race supplements ordered stale-form tests; it is not exhaustive
concurrency or real database-failure injection coverage.

The independent CRM-007 through CRM-012 verifiers remain the full regression
suites for their respective features. Hydrated browser behavior, production-scale
performance, every concurrent transaction interleaving and actual database
failure injection are not implied by passing pure or mocked tests.

## Local execution evidence (TASK-CRM-013)

Verified with Node 24.19.0, Prisma 7.8.0 and Next 16.2.6 against local
`localhost:3306/lkc_fintech_dev`; the production-built verification app used
`http://127.0.0.1:3108`. The existing listener on port 3107 is left untouched.
Read-only preflight and postflight both found 1 customer, 1 task, 1 activity,
2 memberships, 0 duplicate membership user IDs and 0 CRM-013 fixture users.
All seven integration runs were sequential and restored their original complete
business/audit snapshots. Only each run's temporary fixtures were deleted.

| Command/check | Result |
| --- | --- |
| `npx.cmd prisma format` | PASS; original bytes restored only after normalized-content equality confirmed formatter-only differences |
| `npx.cmd prisma validate` | PASS |
| `npx.cmd prisma generate` | PASS |
| Combined eleven focused test files below | 127 PASS: 90 existing + 20 parser + 17 mocked action tests |
| `npm.cmd run lint` | PASS, including the new verifier and tests |
| `npm.cmd run build` | PASS, including TypeScript and both dynamic planning surfaces |
| `node --check scripts/verify-crm-task-plan.mjs` | PASS |
| `node scripts/verify-crm-task-plan.mjs` | 1408 assertions PASS |
| `node scripts/verify-crm-contact-plan.mjs` | 927 assertions PASS |
| `node scripts/verify-crm-activities.mjs` | 436 assertions PASS |
| `node scripts/verify-crm-reports.mjs` | 1026 assertions PASS |
| `node scripts/verify-crm-follow-ups.mjs` | 259 assertions PASS |
| `node scripts/verify-crm-pipeline.mjs` | 169 assertions PASS |
| `node scripts/verify-crm-team-integrity.mjs` | 190 assertions PASS |
| Fixture cleanup and original-data restoration | PASS after every integration run |
| Working/staged/branch whitespace checks | PASS |
| Strict UTF-8/mojibake check | PASS, all ten changed files |
| Full diff scope review | PASS; no schema/dependency/auth change or unrelated generated artifact |

Combined unit command:

```powershell
node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs tests/crm-report-scope.test.mjs tests/crm-activity-filters.test.mjs tests/crm-interaction-validation.test.mjs tests/crm-contact-health.test.mjs tests/crm-contact-plan-time.test.mjs tests/crm-task-plan-validation.test.mjs tests/crm-task-plan-action.test.mjs
```

The existing MODULE_TYPELESS_PACKAGE_JSON and Next standalone-start warnings are
non-failing notices. The bounded planning race and CRM-008 conflict tests emitted
handled Prisma write-conflict diagnostics while all assertions passed. Only the
verification app started for this task on port 3108 was stopped after the runs.
No migration, seed, repair, production operation, push, PR or merge was performed.
The delivery response supplies the final local commit SHA and clean Git status;
this document intentionally does not embed its own commit hash.

Independent review should scrutinize the exact scoped CAS and timestamp-advance
guard, terminal/no-op ordering, explicit blank-versus-missing clear semantics,
same-minute deadline preservation, title privacy, conditional invalidation and
strict separation from status, assignment, activities and contact planning.
