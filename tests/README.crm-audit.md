# CRM Audit & Compliance Console — TASK-CRM-015

Local implementation/review base: `e314b8855b8b9eaf5569b9cab6f0584a024d454b`,
main after CRM-014 / PR #12. Branch: `feat/crm-audit-console`.
This task authorizes a local commit only: no push, PR, merge or branch deletion.

## Schema gate and access

No schema, migration, index, enum, dependency or authentication architecture
change. The current AuditLog model supports this read-only console.

Selected AuditLog fields: `id`, `createdAt`, nullable `actorId`, `action`,
`entityType`, nullable `entityId`, nullable JSON `metadata`, and the optional
`actor` relation selecting only User `id,name`. `ipAddress` is not selected.
The fresh requesting User query selects only `id,role,status`; actor options
select only `id,name`. No email, password, token, phone or security enrichment.
AuditLog.actor uses `onDelete: SetNull`; entityId has no entity foreign key.
Existing indexes are `[actorId,createdAt]` and `[entityType,entityId]`.

There is no dedicated audit permission in the existing permission architecture.
The explicit shared `CRM_AUDIT_ROLES` policy admits only SUPER_ADMIN and ADMIN.
MANAGER, SALES_MANAGER, SALES, CLIENT, CREATOR, ANALYST and EMPLOYEE are denied.
Neither `sales:read` nor `customerSalesScope` grants audit access. Only allowed
roles receive the PortalShell link and Sales dashboard card. Navigation hiding
is not authorization; both links disable prefetch.

`getCRMAudit` is server-only and calls existing `requireRole` independently of
layouts or navigation, before parsing input. Existing auth callbacks refresh
session role/status. Inside a Serializable transaction the DAL reloads the
requesting actor and checks existence, ACTIVE status and the explicit two-role
policy before any audit count/list/actor-option query. Missing/inactive actors
redirect to `/dang-nhap`; a demoted actor redirects to `/dashboard`. Redirects
are outside the database-error catch. A stale session cannot grant extra access.
No shared caching retains a previously authorized result.

## Actual audit inventory and safe registry

A repository-wide production-source search found 19 literal emitted actions:
15 CRM actions below and 4 excluded account/auth actions. Both create and
createMany are covered. CRM-010 reports themselves emit no audit event.
All paths below are relative to `src/features/crm/`.

The safe fields column is the complete metadata allowlist, not a sample.
An event label does not imply that omitted changes were absent historically.

| Action | Category | Emitter | Entity semantics | Safe metadata fields |
| --- | --- | --- | --- | --- |
| CUSTOMER_PROFILE_UPDATE | CUSTOMER | actions.ts | CustomerProfile / customer ID | status, priority |
| CUSTOMER_SALES_ASSIGNMENT | ASSIGNMENT | assignment-actions.ts | CustomerProfile / customer ID | previousSalesId, newSalesId |
| CUSTOMER_PIPELINE_STATUS_CHANGE | PIPELINE | pipeline-actions.ts | CustomerProfile / customer ID | previousStatus, newStatus |
| CUSTOMER_TASK_CREATE | TASK | actions.ts | CustomerTask / task ID | customerId, priority |
| CUSTOMER_TASK_STATUS_UPDATE | TASK | actions.ts | CustomerTask / task ID | customerId, previousStatus, status |
| CUSTOMER_TASK_PLAN_UPDATE | TASK | task-plan-actions.ts | CustomerTask / task ID | customerId, taskId, changedFields, previousPriority, priority, previousDueAt, dueAt |
| CUSTOMER_ACTIVITY_CREATE | INTERACTION | activity-actions.ts | CustomerProfile / customer ID | customerId, activityId, activityType |
| CUSTOMER_NEXT_CONTACT_UPDATE | CONTACT | contact-plan-actions.ts | CustomerProfile / customer ID | customerId, previousNextContactAt, nextContactAt, operation |
| CUSTOMER_BULK_PRIORITY_UPDATE | BULK_OPERATION | customer-bulk-actions.ts | CustomerProfile / each changed customer ID | customerId, previousPriority, priority, bulk |
| CUSTOMER_CSV_EXPORT | EXPORT | customer-export.ts | CustomerProfile / null aggregate ID | rowCount, filtersActive, format |
| SALES_TEAM_CREATE | TEAM | team-actions.ts | SalesTeam / team ID | managerId |
| SALES_TEAM_RENAME | TEAM | team-actions.ts | SalesTeam / team ID | none; label records the rename |
| SALES_TEAM_MANAGER_CHANGE | TEAM | team-actions.ts | SalesTeam / team ID | previousManagerId, newManagerId |
| SALES_TEAM_MEMBER_ADD | TEAM | team-actions.ts | SalesTeamMember / membership ID | teamId, userId |
| SALES_TEAM_MEMBER_REMOVE | TEAM | team-actions.ts | SalesTeamMember / already-deleted membership ID | teamId, userId, assignedCustomerCount, nonClosedCustomerCount, confirmationUsed |

Intentionally excluded actions are documented in `CRM_AUDIT_EXCLUDED_ACTIONS`:

| Action | Emitter | Reason |
| --- | --- | --- |
| AUTH_LOGIN | src/lib/auth.ts | Account authentication, not a CRM operation |
| USER_CREATE | src/features/users/actions.ts | Account administration, even when CLIENT creation also creates a profile |
| USER_ROLE_UPDATE | src/features/users/actions.ts | Account authorization administration |
| USER_STATUS_UPDATE | src/features/users/actions.ts | Account status administration |

Unknown future actions are not admitted by prefix or by sharing AuditLog.
The completeness test scans production TypeScript AST audit writes, including
createMany, and requires every current CRM action to be registered and every
non-CRM action to be explicitly excluded. Dynamic/new actions require review.

## Metadata validation and privacy boundary

Only own data properties of a JSON-like record are considered. Null, arrays,
scalars, non-plain objects, inherited properties and accessors do not become
metadata fields. Missing/invalid fields are omitted individually. No generic
JSON stringifier, raw-metadata fallback or metadata search exists.

Validation is action-specific:

- IDs: 1..191 ASCII letters/digits/underscore/hyphen, no trimming or controls.
  Only previousSalesId accepts null as an unassigned previous Sales value.
- Customer priorities: LOW/MEDIUM/HIGH. Task priorities also permit URGENT.
  The two enums remain distinct. Customer statuses: LEAD/PROSPECT/ACTIVE/DORMANT/
  CLOSED; task statuses: TODO/IN_PROGRESS/DONE/CANCELLED.
- Activity type: NOTE/CALL/EMAIL/MEETING/MESSAGE, matching the actual emitter.
- Date values: null or canonical `YYYY-MM-DDTHH:mm:ss.sssZ`, calendar round-trip
  checked; displayed in Vietnam time. Invalid precision, offsets and dates omit.
- operation: SET/CLEAR; format: csv; bulk: literal true only.
- Counts: nonnegative safe integers; CSV rowCount additionally capped at 5000.
  filtersActive/confirmationUsed are actual booleans, not truthy strings.
- changedFields: 1..3 unique names from title/priority/dueAt. Only the names
  render, never the task title content.

SALES_TEAM_CREATE.name and SALES_TEAM_RENAME.previousName/newName are deliberately
omitted: these are arbitrary free text. All unknown fields are ignored, including
password/passwordHash/token/session/secret/confirmationToken/content/note/query/
csv/unknownField. No task title/description, activity body, customer note, CSV
content, search query or secret is looked up to enrich an audit row.

The selected metadata exists only inside the server-only DAL. It is converted to
`AuditSummaryField[]` containing validated key/label/value strings; the returned
AuditRow type has no metadata property. Page/timeline receive only this DTO.
All displayed text is normal React text; no dangerouslySetInnerHTML is added.
Script-looking metadata cannot pass ID/enum/date validation. Independently,
script-looking actor names and supplied summary text are escaped by React.

CSV export has a null aggregate entity: only rowCount/filtersActive/format are
summarized. A malformed historical non-null export entityId is not displayed.
The audit proves server generation, not browser delivery. Bulk priority events
show before/after priority and a bulk indicator for each customer independently;
there is no real batch ID and no synthetic batch reconstruction.

## Filter and time contract

Supported keys: period, from, to, action, category, actorId, page. Unknown keys
are ignored; no q, free-text metadata search or user-controlled JSON path.
Every supported key is singleton. Repeated identical or empty values are invalid.
Absent or singleton empty-string optional fields are absent. Other whitespace,
case variants and controls are not normalized into enum/ID/page values.

Invalid supported input fails closed: after fresh authorization, no audit count,
audit row or actor-option query runs. The page shows a correction warning with
no result count, rows or pagination. Normalized safe form values never silently
broaden the requested dataset. Action and category are registry-validated and
intersect independently; a valid but incompatible combination yields zero rows.
Actor IDs use strict ID validation. Unknown/unrelated IDs yield the same empty
matching result and are never looked up in the all-User table by URL ID.

Periods are 7d, 30d, 90d and custom; default 30d. Presets include today in Vietnam
plus the preceding N-1 calendar days, through next Vietnam midnight. The audit
parser reuses CRM-010 parseReportFilters for strict calendar conversion and
range checks without changing CRM-010/012 helpers or adding a dependency.

Custom dates require exact YYYY-MM-DD, real calendar days, from <= to and at
most 366 inclusive days. Existing helper year bounds are 1000..9998, with converted
start still in MySQL DATETIME's supported years. Both preset date fields are
validated if supplied but do not alter preset boundaries. An invalid internal
clock also fails closed. Query interval is `[startUtc,endExclusiveUtc)` using
explicit fixed UTC+7, independent of host timezone. Display uses
an explicit +7-hour shift and `Intl.DateTimeFormat` in UTC, with seconds and a
full numeric year. This avoids historical Asia/Ho_Chi_Minh offsets (for example,
1900 or 1960) disagreeing with CRM's fixed-offset date contract.

For example, custom 2024-02-29 through 2024-02-29 becomes
`[2024-02-28T17:00:00.000Z,2024-02-29T17:00:00.000Z)`.
Filter GET submissions reset the page; pagination links keep only canonical
supported filters and omit unused custom dates and page=1.

## Queries, pagination and identities

Each successful query intersects the explicit 15-action registry with date,
action, category and actor restrictions in SQL. MySQL's existing collation is
case-insensitive, so three parameterized `Prisma.sql` reads use `BINARY a.action`
for exact action matching: count, ordered page IDs, and bounded actor options.
The actor filter also uses binary equality. No unsafe raw-query API, interpolated
SQL string, user-controlled identifier or JSON path is used. All action/category
choices derive from the registry; date, actor, limit and offset values are bound.
The bounded IDs are loaded via Prisma findMany using the same logical filters
AND exact page ID set, preserving the minimized actor relation/JSON decoding.
All reads use one Serializable snapshot, timeout 10 seconds. Order is
`createdAt DESC,id DESC`. Page size is 50; input page is 1..1000 and clamps to the
available last page. The maximum skip is 49,950. Above 50,000 matching events,
the count remains accurate but navigation is limited to 1000 pages with a visible
request to narrow filters. No history is loaded and then sliced in JavaScript.

Actor options select current Users having a related audit in the same registry/
period/action/category universe, ignoring only the selected actor restriction.
They are ordered id ASC and capped at 200; no unbounded all-user dropdown. A
selected ID outside these choices is retained as a neutral 'ID đã chọn' option,
not a looked-up name or evidence that an unrelated account exists. Thus HTML may
contain the all-actors option, up to 200 fetched choices and one neutral selection.

The actor relation is included efficiently in the bounded audit query, with no
per-row application lookup. Current name plus stable User ID is displayed; names
are not historical snapshots and may change. Null relation means unknown actor,
not inferred system authorship, owner, assignee or current requester.

Customer links are registry-driven: CustomerProfile actions use entityId, except
CSV export has no link; CustomerTask actions use validated metadata.customerId.
Entity type must match the registry. Team/membership IDs never become customer
links. Targets are references, not existence guarantees: deleted customers can
legitimately produce a destination 404. No extra target lookup is performed.
Unexpected entity types have no reference/summary/link and are labeled Unknown.

Binary predicates exclude unknown case/trailing-space variants from counts,
rows and actor options, including variants outside the visible page. An additional
exact registry check in the DTO mapper fails closed if an unknown action is ever
returned despite that predicate. Database failures likewise
return no partial rows/options or raw Prisma/MySQL diagnostics. No retries.

## Read-only proof and limits

New runtime code has only User findUnique, three parameterized SELECT queries
and bounded AuditLog findMany inside a transaction. No create/update/delete,
Server Action, revalidation,
business enrichment, audit append/edit/delete, retention or undo is introduced.
Existing mutations, ownership/status/contact/task/activity/team data and audit
semantics are untouched. Existing-file changes are only the gated nav/card.

Bounded output and options do not bound database scan/locking costs. AuditLog
lacks an ideal action/timestamp index; no index/migration is authorized. Large
history counts, relation filters, deep offset pages and Serializable reads may
be expensive or contend with writers. No production-scale benchmark is claimed.
Separate page requests can shift after new events; this is not a historical
snapshot export. No immutable historical actor-name snapshot is available.
The allowlist is intentionally not a general raw JSON debugger or full-account
security console. Malformed fields can leave a row with only its event label.

## Safe local verification

Use Node 24 and existing installed dependencies with a manually confirmed
loopback MySQL local/test database. The app and verifiers share DATABASE_URL and
auth configuration. No migration, seed, reset, production operation or repair.
Do not run alongside unrelated database writers or across Vietnam midnight.

Build and start on an unused port; do not stop an unrelated listener:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3108'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108
```

In another terminal:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3108'
node scripts/verify-crm-audit.mjs
```

The new verifier requires explicit fixture opt-in, loopback HTTP(S) app and MySQL
hosts, a dev/test underscore-delimited database component and no prod/production
component. Names alone are not proof of safe data. It records randomized fixture
IDs before writes and deletes AuditLog fixtures only by exact recorded audit IDs,
including separately captured credential-login audits for exact fixture actors.
It snapshots original business/user/audit rows, checks every GET for no mutation,
cleans only its fixtures in finally and verifies full restoration. Credentials
and snapshots are not printed. A hard kill may prevent cleanup; inspect that
specific run's exact IDs before removal, never broadly delete or repair audits.

Run the eight existing integration verifiers sequentially, following their safety
READMEs: customer-operations, task-plan, contact-plan, activities, reports,
follow-ups, pipeline, team-integrity. Stop only the verification app you started.

Pure tests validate action inventory, safe summary types and strict UTC+7 filters.
Mocked DAL tests execute actual modules with auth/Prisma adapters to verify
authorization/query shapes, bounds, sanitized DTOs and no writes; mock failures
are not real storage failure/isolation proofs. The HTTP verifier uses genuine
credential sessions, independent fixture/oracle data and exact HTML/database
assertions. It does not prove visual layout, hydrated interaction, every possible
concurrency interleaving or production performance.

## Execution evidence

Verified on 2026-09-14 with Node 24.19.0, Prisma 7.8.0 and Next 16.2.6 against
`localhost:3306/lkc_fintech_dev`, using the production-built verification app on
`127.0.0.1:3108`. Preflight/postflight both found 1 original customer, 1 task,
1 activity, 2 memberships and zero duplicate membership user IDs. Postflight
found zero CRM-007 through CRM-015 fixture users and zero CRM-015 fixture audits.
All nine integration runs were sequential and restored their original complete
business/user/audit snapshots. Only temporary fixtures were removed; no original
business/audit row was repaired or deleted. The owned app on 3108 was stopped.

| Command/check | Result |
| --- | --- |
| `npx.cmd prisma format` | PASS; normalized content identical, original schema bytes preserved |
| `npx.cmd prisma validate` | PASS |
| `npx.cmd prisma generate` | PASS |
| `npx.cmd tsc --noEmit --incremental false` | PASS |
| Combined focused test command below (17 files) | 231 tests PASS: 172 previous + 59 new |
| `npm.cmd run lint` | PASS, no warnings |
| `npm.cmd run build` | PASS; includes TypeScript and dynamic `/sales/audit` |
| `node --check scripts/verify-crm-audit.mjs` | PASS |
| `node scripts/verify-crm-audit.mjs` | 6909 assertions PASS |
| `node scripts/verify-crm-customer-operations.mjs` | 1416 assertions PASS |
| `node scripts/verify-crm-task-plan.mjs` | 1408 assertions PASS |
| `node scripts/verify-crm-contact-plan.mjs` | 927 assertions PASS |
| `node scripts/verify-crm-activities.mjs` | 436 assertions PASS |
| `node scripts/verify-crm-reports.mjs` | 1026 assertions PASS |
| `node scripts/verify-crm-follow-ups.mjs` | 259 assertions PASS |
| `node scripts/verify-crm-pipeline.mjs` | 169 assertions PASS |
| `node scripts/verify-crm-team-integrity.mjs` | 190 assertions PASS |
| Fixture cleanup / original-data restoration | PASS after all nine runs |
| Working, staged and pre-commit branch diff whitespace checks | PASS |
| Strict staged UTF-8/mojibake check | PASS, all 14 changed files |
| Full scope review | PASS; no schema/dependency/auth changes, secrets or generated/TASK diff artifacts |

New tests: 14 registry/privacy/inventory, 17 filter/date/SQL-binding and 28
mocked DAL/React static-rendering tests. The combined command preserves every
previous focused test file from CRM-007 through CRM-014:

```powershell
node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs tests/crm-report-scope.test.mjs tests/crm-activity-filters.test.mjs tests/crm-interaction-validation.test.mjs tests/crm-contact-health.test.mjs tests/crm-contact-plan-time.test.mjs tests/crm-task-plan-action.test.mjs tests/crm-task-plan-validation.test.mjs tests/crm-csv.test.mjs tests/crm-customer-bulk.test.mjs tests/crm-customer-operations-action.test.mjs tests/crm-audit-registry.test.mjs tests/crm-audit-filters.test.mjs tests/crm-audit-query.test.mjs
```

Pre-commit review found and fixed two new-console issues: case-insensitive MySQL
action matching could otherwise admit unregistered off-page events into counts/
actor options; historical IANA offsets could disagree with CRM's fixed UTC+7
date contract. Parameterized binary predicates and fixed-offset/full-year
formatting resolve them. The new HTTP verifier passed its first DB run including
off-page case/trailing-space variants and historical 1902 display cases.

Existing MODULE_TYPELESS_PACKAGE_JSON and standalone-start notices are non-failing.
CRM-013/008 conflict probes emitted handled Prisma write-conflict/deadlock
diagnostics while their assertions passed. No new real storage-failure injection
or exhaustive concurrency/performance claim. No migration, seed, repair,
production operation, push, PR or merge. Local commit SHA and final Git status
belong in the delivery response, not in a self-referential committed document.

Independent review should scrutinize the binary SQL universe shared by count,
IDs and actors; fresh-role checks; field-specific metadata types and DTO-only
rendering; historical fixed-offset dates; bounded paging/options; and exact
fixture-owned audit-ID cleanup.
