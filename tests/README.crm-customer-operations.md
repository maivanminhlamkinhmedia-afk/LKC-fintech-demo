# CRM customer export and bulk priority verification

TASK-CRM-014 adds secure customer CSV export and bulk **CustomerProfile** priority
updates to `/sales/customers`. Base: `9d6034ef0dd62ffd6bf52de93557ebca35846412`,
main after CRM-013 / PR #11. Delivery is local implementation, verification and
local commit only: no push, PR or merge is authorized by this task.

## Schema gate and existing behavior

No schema, migration, index, enum, dependency or authentication architecture changes.
CustomerPriority is LOW/MEDIUM/HIGH; CustomerTaskPriority is a different enum and
also includes URGENT. Bulk customer priority never changes task priority.

CustomerProfile has required id/userId/customerCode/status/priority/createdAt/
updatedAt, optional assignedSalesId/source/note/lastContactAt/nextContactAt, and
relations to User, assigned Sales, tasks and activities. User name/email and
assignedSales.name are the only User fields selected for export.

The existing customer list remains 30 rows per page, ordered `updatedAt DESC,
id ASC`, with the same CustomerSummary select, filters and scoped queries. The
existing `updateCustomerProfile` action is the sole production writer of an
existing customer's priority before this task; its generic CUSTOMER_PROFILE_UPDATE
audit also covers status. Its behavior is not rewritten. User creation/upsert
uses MEDIUM default; upsert's update is empty. Existing CustomerProfile audit
actions also include CUSTOMER_PIPELINE_STATUS_CHANGE, CUSTOMER_SALES_ASSIGNMENT,
CUSTOMER_ACTIVITY_CREATE and CUSTOMER_NEXT_CONTACT_UPDATE.

## Authorization

| Role | Read/export | Bulk write |
| --- | --- | --- |
| SUPER_ADMIN, ADMIN | Global CRM customers | Global CRM customers |
| MANAGER | Global CRM customers | Denied |
| SALES_MANAGER | Customers owned by members of currently managed teams | Same current scope |
| SALES | Currently assigned customers | Same current scope |
| CLIENT, CREATOR, ANALYST, EMPLOYEE | Denied | Denied |

Each endpoint independently calls requirePermission. Existing authentication
callbacks refresh current role/status; inside each Serializable transaction,
the actor is loaded again with id/role/status and must be ACTIVE with the relevant
permission. customerSalesScope alone is not a permission gate. No client role,
actor, task assignment, rendered checkbox or URL filter grants authorization.

Completed demotion/inactivation, customer reassignment or team membership removal
revokes old sessions/forms through fresh actor/scope checks. A task assigned to
the viewer never grants access to its foreign customer. Transactions serialize
against concurrent writes; no automatic retries hide conflicts. Once a successful
export has been downloaded, subsequent access revocation cannot recall that file.

## Export contract

GET `/sales/customers/export` is an explicit download, not a prefetched Next Link.
The route authenticates before calling the internal server-only export DAL. It
does not depend on layout authorization. HEAD is explicitly 405, avoiding an
automatic audited CSV generation for a HEAD request.

The supported dataset filters are exactly `q,status,priority,salesId,teamId,
followUp,task`. The route preserves repeated occurrences as arrays, uses the
unchanged parseCustomerFilters and customerFilterWhere, and combines filters
with customerSalesScope using independent AND clauses. All date predicates in
one export use one captured current time and existing Vietnam-day semantics.

Canonical URL trimming remains unchanged: `priority= HIGH ` normalizes to HIGH,
blank/whitespace-only filters are absent, literal search wildcard escaping is
unchanged. Repeated or invalid substantive filters cause HTTP 400 **before any
count/customer query**, rather than silently dropping a restriction and exporting
a broader dataset. The list retains its existing normalization and warning; its
export control is disabled until invalid substantive filters are corrected or
cleared. Unknown parameters are ignored, never forwarded by the export link.

`page` is entirely ignored by export, even if repeated or invalid. The export URL
is generated from normalized supported filters with page omitted. Export covers
the **entire authorized filtered result**, not the displayed page.

Hard maximum: **5000 data rows**. A scoped filtered count precedes row loading.
Above the cap, HTTP 413 asks the user to narrow filters without returning partial
CSV or the actual count. At/below the cap, a bounded query selects only required
fields, with the same `updatedAt DESC,id ASC` order as the list. A count/result
mismatch rejects the response. There is no JS authorization filtering, task or
activity loading, per-row Sales lookup, silent truncation or unbounded findMany.
Serializable keeps count, related scope, selected values and audit consistent.

Exact nine columns, in order:

```text
customerCode,name,email,status,priority,assignedSalesName,lastContactAt,nextContactAt,createdAt
```

Assigned Sales identity is the current display name, matching the list; names are
not guaranteed unique. Dates are exact ISO UTC strings (with Z), null values empty.
No internal customer/User/Sales IDs, note/source, password, phone, role/status
security data, sessions, activity bodies, task content or audit metadata is exported.

## CSV encoding and spreadsheet safety

The dedicated csv.ts serializer emits UTF-8 with a BOM and CRLF record separators,
including a trailing CRLF. Every field is enclosed in double quotes; internal
double quotes are doubled. Embedded commas, CR/LF and multiline text are preserved
inside quoted fields. Vietnamese, emoji and combining characters are not normalized.

Before quoting **every cell**, dangerous spreadsheet text receives one leading
apostrophe. The detector recognizes `=,+,-,@` after any leading whitespace, C0/C1
controls, DEL or quotes; this includes quote-wrapped formula-looking values.
Leading control-bearing cells are also prefixed even without a formula prefix.
Ordinary text containing `=` later is unchanged. This deliberately treats leading
negative numbers as text. Apostrophes can be visible in non-spreadsheet readers;
CSV is an operational export, not a byte-identical import format. The defense is
not a claim about every spreadsheet's later save/reopen/transformation behavior.

Successful response headers:

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="lkc-customers.csv"
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

The static filename contains no query, user identity or customer information.
Handled errors also use no-store/nosniff and return no CSV attachment. Existing
permission failures redirect to sign-in/dashboard; an actor revoked between
authentication and transaction fails with a generic 403. Other database failures
produce generic 503, never raw Prisma/MySQL details or foreign identifiers/counts.

## Export audit

AuditLog.entityId is nullable, allowing a real aggregate audit without fake IDs:

```text
action: CUSTOMER_CSV_EXPORT
actorId: current authenticated actor
entityType: CustomerProfile
entityId: null
metadata: { rowCount, filtersActive, format: "csv" }
```

Exactly one audit per successful generated export, including a zero-row export.
No search text, row IDs/list, names/emails, CSV or secrets are logged. CSV is fully
serialized inside the transaction before the audit is written; audit failure
prevents delivery. The audit records successful server generation, not proof the
browser received/saved the entire file. Validation/authorization/cap/conflict
failures do not write success audits. Export never revalidates application paths
or changes CustomerProfile/tasks/activities/teams/users.

## Bulk parsing and transaction

Only two submitted business fields are read: repeated `customerIds` and singleton
`priority`. customerIds must contain 1..100 **submitted occurrences**, each a
string matching `[A-Za-z0-9_-]{1,191}` without trimming. Files, malformed IDs and
over-limit input fail, never truncate. Valid IDs are deduplicated and sorted;
duplicates within the raw cap update each unique customer once. This also bounds
requests containing excessive repetitions of one ID.

Priority must be exactly one real CustomerPriority string. Missing/repeated/File,
case/whitespace variants and URGENT fail. Forged actor/customer ownership, status,
source/note, contact, task, version and previous-state fields have no effect.

The Serializable transaction reloads the actor, performs one scoped customer
fetch selecting only id/priority/updatedAt (take 100), and requires its length to
equal the selected unique-ID count. One missing or foreign customer rejects the
**whole batch**, including when authorized rows would be no-ops. Errors do not
identify an offending ID. Current priorities are read at submission time; this
workflow sets an explicit target priority, not a rendered-version editing draft.

Only rows differing from target are written. One updateMany repeats current
customer scope and ORs the exact changed id/previousPriority/updatedAt tuples.
Its affected count must equal the intended changed count. One bounded audit
createMany must return the same count. Update and audits commit together, or all
roll back. Database exceptions become a generic handled error, without retries.

Exact CustomerProfile update data is `{ priority }`; updatedAt is Prisma-managed.
No status, assignedSalesId, userId, source, note, lastContactAt, nextContactAt or
createdAt writes. No CustomerTask, CustomerActivity, SalesTeam, SalesTeamMember or
User mutation. Timestamp predicates supplement Serializable consistency; they
are transaction-read guards, not formal revision counters.

If all selected customers already match: zero updates, zero audits, zero
revalidation, including no updatedAt change. In a mixed batch only changed rows
advance updatedAt and receive audits. Per changed customer:

```text
action: CUSTOMER_BULK_PRIORITY_UPDATE
actorId: fresh authenticated actor
entityType: CustomerProfile
entityId: actual changed customer id
metadata: { customerId, previousPriority, priority, bulk: true }
```

Historical audits remain immutable. There is no CustomerActivity event and no
free-text/customer email/body/secret duplication in audit metadata.

## UI and compatibility

Read-only users get no active bulk form or checkboxes. Writers can select each
visible customer or all current-page customers, see selected count, select one
target priority, and submit with accessible pending/status/error feedback.
The selection is keyed by normalized filter URL, effective page and ordered
visible IDs/priorities, clearing invisible selections after result changes.
Only current 30-row CustomerSummary data is passed to the client; no new private
fields or unbounded read is introduced. Filters, pagination, detail links and
Sales/team/follow-up/task filtering remain intact.

| Existing feature | CRM-014 boundary |
| --- | --- |
| CRM-007 | Same scope/filter helpers; priority membership/order can change, pipeline status cannot |
| CRM-008 | Membership/ownership unchanged; removal revokes manager export/bulk scope |
| CRM-009 | Task rows/status unchanged; customerPriority workbench filtering may change |
| CRM-010 | Customer-priority distribution changes; unfiltered customer/task/activity totals and workload ownership unchanged |
| CRM-011 | No activity creation/history change or lastContactAt change; no bodies exported |
| CRM-012 | nextContactAt/contact-health unchanged; exported contact dates are read-only |
| CRM-013 | Task title/priority/dueAt/status/assignee/completion remain untouched |

After a real bulk change, exact revalidation paths:

- `/sales/customers`: display, priority filtering and updatedAt ordering.
- `/sales/pipeline`: same display/filter/order dependencies.
- `/sales/reports`: customer-priority distribution and filtering.
- `/sales`: HIGH, non-CLOSED customer count.
- `/sales/follow-ups`: customer priority display and customerPriority filter.
- `/sales/assignment`: priority display and priority/updatedAt ordering of capped list.
- `/sales/customers/<changedId>` for each changed customer only.

No teams invalidation. No-op/failure/export invalidates nothing. Filtered report
and workbench totals can legitimately change as customers enter/leave a priority
filter; unfiltered totals and persisted task/activity rows remain unchanged.

## Local verification safety

Use Node 24 and the existing dependencies with a manually confirmed local/test
MySQL database. The app and verifier must share DATABASE_URL/auth configuration.
Never run against production, concurrently with unrelated database writers, or
across moving due-date/day boundaries. A dev/test database name is not by itself
proof of safe data. No migration, seed, reset, repair or production operation.

The verifier requires CRM_VERIFY_FIXTURES=1, loopback app/MySQL hosts, HTTP(S)
app scheme, mysql database scheme, a dev/test underscore-delimited database name
component and no prod/production component. Fixtures use randomized recorded IDs;
cleanup in finally only removes those fixtures and compares the original complete
business/audit snapshot. A hard kill can prevent cleanup: inspect that run's exact
IDs before manual removal, never repair/delete pre-existing business rows.
Credentials/sessions/confirmation tokens stay in memory and are not printed.

Start a built verification app on an unused loopback port (3108 here); do not stop
an unrelated listener:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3108'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108
```

In a separate terminal with the same database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3108'
node scripts/verify-crm-customer-operations.mjs
```

Run CRM-013 through CRM-007/008 regression verifiers sequentially using their
individual safety READMEs. Stop only the verification app you started afterward.

## Verification layers and limitations

Pure tests cover CSV serialization/formula policy, filter normalization and bulk
input contracts without a database. Mocked action/export tests execute actual
modules with injected auth/Prisma dependencies to check scoped query/write shapes,
count guards, no-op, audit/revalidation, and rollback control flow. Mock failure
injection is not proof of a real MySQL storage failure or every isolation schedule.

The independent HTTP verifier uses genuine credential sessions and rendered
Server Action metadata, actual scoped CSV and database assertions, exact audit
deltas and immutable-data snapshots. Test evidence must distinguish those layers.
HTTP/HTML checks do not prove hydrated browser selection, focus, visual layout or
every spreadsheet import/re-save behavior. The 5000-row cap bounds application
memory, not database count scan cost; no production-scale performance claim.

Review should scrutinize duplicate/invalid filter handling, formula protection on
every selected cell, the scoped count/query transaction, cap rejection without
partial output, whole-batch authorization, changed-only CAS/audit consistency,
and the distinction between customer and task priority.

## Execution evidence

Verified on 2026-09-14 with Node 24.19.0, Prisma 7.8.0 and Next 16.2.6 against
`localhost:3306/lkc_fintech_dev`, using the production-built app on loopback port
3108. The pre-existing port-3107 listener was untouched. Preflight and postflight
both found 1 original customer, 1 task, 1 activity, 2 memberships and no duplicate
membership user IDs. Postflight found zero CRM-007 through CRM-014 fixture users.

All eight integration runs were sequential and each restored its complete
original business/audit snapshot. Only recorded temporary fixtures were removed,
including the new verifier's 5000/5001-row export-cap group. No existing business
rows were removed or repaired. The owned verification app on 3108 was stopped.

| Command/check | Result |
| --- | --- |
| `npx.cmd prisma format` | PASS; normalized content identical, original schema bytes preserved after line-ending-only formatting |
| `npx.cmd prisma validate` | PASS |
| `npx.cmd prisma generate` | PASS |
| Combined focused command below | 172 tests PASS: 127 previous + 45 new |
| `npm.cmd run lint` | PASS with no warnings after verifier completion |
| `npm.cmd run build` | PASS including TypeScript, list UI and dynamic export route |
| `node --check scripts/verify-crm-customer-operations.mjs` | PASS |
| `node scripts/verify-crm-customer-operations.mjs` | 1416 assertions PASS |
| `node scripts/verify-crm-task-plan.mjs` | 1408 assertions PASS |
| `node scripts/verify-crm-contact-plan.mjs` | 927 assertions PASS |
| `node scripts/verify-crm-activities.mjs` | 436 assertions PASS |
| `node scripts/verify-crm-reports.mjs` | 1026 assertions PASS |
| `node scripts/verify-crm-follow-ups.mjs` | 259 assertions PASS |
| `node scripts/verify-crm-pipeline.mjs` | 169 assertions PASS |
| `node scripts/verify-crm-team-integrity.mjs` | 190 assertions PASS |
| Fixture cleanup / original-data restoration | PASS after all eight runs |
| Working, staged and branch diff whitespace checks | PASS |
| Strict UTF-8/mojibake check | PASS, all 14 changed files |
| Full source/test/documentation scope review | PASS; no schema/dependency/auth changes, secrets or generated/TASK diff artifacts |

The pre-existing MODULE_TYPELESS_PACKAGE_JSON and standalone-start notices are
non-failing. CRM-013 and CRM-008 bounded conflict probes emitted handled Prisma
write-conflict diagnostics while all their assertions passed. The new verifier
passed its first DB run. No new-feature storage-failure injection or exhaustive
concurrency test is claimed. No migration, seed, repair, production operation,
push, PR or merge was performed. Final local commit SHA and clean Git status are
provided in the delivery response, not embedded in this self-referential document.

Combined focused test command (14 files):

```powershell
node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs tests/crm-report-scope.test.mjs tests/crm-activity-filters.test.mjs tests/crm-interaction-validation.test.mjs tests/crm-contact-health.test.mjs tests/crm-contact-plan-time.test.mjs tests/crm-task-plan-action.test.mjs tests/crm-task-plan-validation.test.mjs tests/crm-csv.test.mjs tests/crm-customer-bulk.test.mjs tests/crm-customer-operations-action.test.mjs
```

The new 45 tests comprise 13 CSV/export-filter, 8 bulk-parser and 24 mocked
action/export/route tests; with the previous 127 tests, the combined suite has 172.
