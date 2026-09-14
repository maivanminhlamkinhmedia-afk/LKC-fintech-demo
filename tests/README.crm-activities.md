# Customer activity timeline verification

## Safety and execution

Requires installed dependencies, Node.js 24, and a local development/test MySQL
database. App and verifier must use the same `DATABASE_URL` and authentication
configuration. The verifier does not apply migrations, seed, or repair data.

Build/start the app in one terminal:

```powershell
npm.cmd run build
$env:NEXTAUTH_URL = 'http://127.0.0.1:3107'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

In another terminal using the same database configuration:

```powershell
$env:CRM_VERIFY_FIXTURES = '1'
$env:CRM_VERIFY_BASE_URL = 'http://127.0.0.1:3107'
node scripts/verify-crm-activities.mjs
```

Explicit opt-in authorizes temporary fixture creation, scoped action submissions,
and cleanup. App/database hosts must be loopback; the database name must contain
a delimited `dev` or `test` component without `prod`/`production`. Manually confirm
it is local/test data; names alone are not proof. Do not run with other database
writers. All fixture IDs/codes/emails use this run's random `crm011-<UUID>` prefix
or are recorded immediately after creation. Credentials and confirmation tokens
remain in memory and are never logged.

Cleanup runs in `finally`, removes only this run's fixtures, and compares the
original database snapshot. A hard process termination can prevent cleanup;
inspect only that run's IDs before any manual cleanup. Existing business data
is never auto-repaired or deleted.

## Coverage and limitations

The verifier uses real credential sessions, rendered Server Action form metadata,
HTTP/HTML responses, and independent Prisma assertions. It covers every current
role, customer-based read/write scope, actor/task-assignee mismatches, all five
manual activity types, reserved system-type rejection, whitespace/length/Unicode
validation, exact 5,000 UTF-16-unit boundaries, repeated and file-valued fields,
forged actor/title/timestamp/ownership fields, escaped script-looking content,
exact append-only activity/audit rows and linked ID/type-only audit metadata.

Successful NOTE creation must leave the complete CustomerProfile unchanged.
CALL, EMAIL, MEETING and MESSAGE preserve the existing lastContactAt invariant;
only that timestamp and Prisma's automatic updatedAt may change on the target
profile. Customer ownership/status/priority, tasks, team memberships, user roles,
other profiles and all historical activity/audit rows are checked unchanged.

Timeline coverage includes real manual/system enum filters, no filter, empty
history, invalid/repeated URL values, bounded 20-row pages, filter-preserving links,
huge-page clamping, exact createdAt DESC/id DESC ordering for identical timestamps,
neutral null actors, stored historical actors, escaped historical text and no
edit/delete controls. No period or free-text timeline filtering is assumed.

Creation checks refresh CRM-010 activity counts for authorized viewers, unchanged
foreign reports, and unchanged customer/task/workload metrics. Actual CRM-007
pipeline and assignment actions generate system events and exercise stale forms
after reassignment. Actual CRM-008 warning/confirmation removal tests stale manager
scope without changing customer ownership/history. CRM-009 task status updates
remain available and do not invent new activity types.

Run the report, follow-up, pipeline and team-integrity verifiers separately for
their full regression suites, following their corresponding safety READMEs.
These checks do not exercise browser hydration/visual layout or every simultaneous
transaction interleaving. Live report periods/timestamps assume the run does not
cross Vietnam midnight or a fixture's due boundary.

## Schema gate and scope

The existing `CustomerActivity` model is sufficient; no schema, migration, index,
dependency or authentication architecture change is included. The fields used are
`id` (generated cuid), `customerId`, nullable `actorId`, `type`, required `title`,
nullable `content` (`@db.Text`), and `createdAt` (server/default timestamp). The
customer relation cascades on customer deletion; the optional actor relation uses
`onDelete: SetNull`. Existing indexes cover `[customerId, createdAt]` and
`[actorId, createdAt]`. No retention/deletion policy is changed by this task.

The actual enum is `CustomerActivityType`, not `ActivityType`:

- Manual allowlist: `NOTE`, `CALL`, `EMAIL`, `MEETING`, `MESSAGE`.
- System-reserved: `STATUS_CHANGE`, `ASSIGNMENT`.

The server and form share an explicit manual allowlist. Future enum members do
not automatically become manually writable. All seven current values remain
readable/filterable. System/manual labels use the enum only, never analysis or
rewriting of historical free text. There is no task/team activity enum value.
Existing profile/pipeline status changes and assignment events remain untouched;
team removal and task status actions retain their existing audit-only behavior.

Only the customer detail page and the old manual-action block in `actions.ts`
change among existing production files. The old exported `addCustomerActivity`
endpoint and its now-unused allowlist are removed, so there is no weaker parallel
manual creation path. Profile, task, assignment, pipeline, team and CRM-010 report
implementations are otherwise unchanged.

## Authorization and append transaction

Read requires `sales:read`; manual creation independently requires `sales:write`.
The existing authentication callback reloads account role/status for each request.
The dedicated `createCustomerInteraction` action authenticates before parsing or
returning a bounded draft, then checks the current actor's role and ACTIVE status
again inside its Serializable transaction.

| Role | Timeline read scope | Manual creation |
| --- | --- | --- |
| SUPER_ADMIN | Existing global CRM customer scope | Allowed globally |
| ADMIN | Existing global CRM customer scope | Allowed globally |
| MANAGER | Existing global CRM customer scope | Denied; remains read-only |
| SALES_MANAGER | Customers owned by members of currently managed teams | Same current customer scope |
| SALES | Currently assigned customers | Same current customer scope |
| CLIENT | Denied | Denied |
| CREATOR | Denied | Denied |
| ANALYST | Denied | Denied |
| EMPLOYEE | Denied | Denied |

Every activity count/list uses `customerId AND customerSalesScope(user) AND type`
with the optional type clause independent of authorization. Activity actors and
task assignees do not grant customer access. Missing/foreign customers return no
timeline or count. The action re-queries the customer using the transaction's
fresh actor and the shared customer scope. Reassignment, membership removal and
role demotion invalidate previously rendered requests; hidden identities and
previous action state never authorize a write.

Within one Serializable transaction the action creates one activity, preserves
the existing contact timestamp rule where applicable, and creates one audit.
Scope/conflict failures roll back all writes. Known conflict/missing-relation
errors return a handled retry message without an automatic retry. Unexpected
errors propagate rather than fabricate success. No activity update/delete,
historical timestamp edit, type conversion, hidden task or bulk operation exists.

Successful creation revalidates only the affected customer detail route and
`/sales/reports`. Existing system-action invalidation already includes the detail
route and did not need changes.

## Timeline query and filter contract

The timeline DAL uses a RepeatableRead transaction: scoped customer existence,
scoped count, then bounded `findMany`. The count and rows use the same predicate
and read snapshot. Each page contains at most 20 activities, ordered by
`createdAt DESC, id DESC`. Database `take`/`skip` performs pagination; the application
does not fetch all activity history and slice it. The selected fields are only
activity id/type/title/content/createdAt and actor id/name. The actor is a nested
relation selection, not a per-entry query loop. The existing customer-detail task
panel is retained; the new timeline DAL itself loads no tasks or unrelated data.

`activityType` accepts only a single real enum string (trimmed, at most 32 input
units, no controls). `activityPage` accepts a single integer 1..1,000,000 and clamps
to the available final page. Invalid/repeated values are ignored or reset with a
visible notice, never substituted for customer authorization. Unknown URL fields
do not enter the predicate. GET filter submission resets pagination; next/previous
links retain type and customer and target `#activity-timeline`. Reset removes both
timeline parameters. No optional date/search filter was added. Display dates use
`Asia/Ho_Chi_Minh` (UTC+7), with machine-readable ISO timestamps.

## Input, rendering and identity

The action accepts exactly one string each for `customerId`, `type` and `content`;
missing/repeated/file-valued fields fail. Customer IDs must match the existing CRM
identifier convention `[A-Za-z0-9_-]{1,191}`. Type must exactly match the manual
allowlist, independently of what the rendered select offers.

Content is trimmed, required, and limited to 5,000 UTF-16 code units after trimming
(the same unit used by JavaScript length and textarea maxlength). It is never
silently truncated. This fits the existing MySQL Text column for multibyte text.
Unicode/Vietnamese, combining marks, emoji, tabs and line breaks are preserved;
other C0 controls and DEL are rejected. Submitted title, actor, timestamp,
ownership, role, team and task fields are ignored. The required short title is
derived from the type's label, rather than duplicating customer content.

React renders title/content/actor names as escaped plain text; no
`dangerouslySetInnerHTML` is used. Multiline text is preserved visually. Actor
display comes only from the stored actor relation's name, never the current owner,
session or an inferred audit match. Null/missing names use the neutral label
`Không rõ người thực hiện`: a deleted human actor can also become null, so null
does not prove system authorship. The relation stores identity, not a historical
snapshot of the user's display name.

The form exposes pending/success/error feedback and no edit/delete controls.
Success clears the submitted content; handled failures return only that request's
bounded draft, never database content. The current timeline filter/page remains;
the success notice directs the user to its first matching page to find the new
entry. CALL/EMAIL/MEETING/MESSAGE record events only: no provider integration,
sending, calling, attachments or calendar synchronization is implemented.

## Audit and side effects

Each successful submission appends exactly one `CUSTOMER_ACTIVITY_CREATE` audit:

```text
actorId: authenticated transaction actor
entityType: CustomerProfile
entityId: actual authorized customer ID
metadata: { customerId, activityId, activityType }
```

The metadata has exactly those three fields. No interaction body/title, password,
auth/session token, confirmation token or secret is copied into it. Validation or
authorization failure creates neither an activity nor a success audit.

The pre-existing `addCustomerActivity` rule updated `lastContactAt` for every
non-NOTE manual contact. This is preserved for CALL, EMAIL, MEETING and MESSAGE,
using the newly created activity's server timestamp; Prisma also advances profile
`updatedAt`. NOTE leaves the entire profile unchanged. `nextContactAt`, customer
owner/status/priority, existing task ownership/status, memberships, roles, other
customer profiles and all historical activity/audit rows remain unchanged.

CRM-010 continues to count activities by `createdAt` within the selected UTC+7
period, through the currently authorized customer portfolio. A new in-period
interaction increments the matching activity total/type for authorized viewers;
foreign users' aggregates and customer/task/Sales/team workload metrics remain
unchanged. Report authorization/query architecture is not modified.

## Local execution evidence (TASK-CRM-011)

Verified locally on `localhost:3306/lkc_fintech_dev` with the production-built app
at `http://127.0.0.1:3107`, Node 24.19.0, Prisma 7.8.0 and Next 16.2.6:

- `npx.cmd prisma format`: PASS. Only formatter-induced line-ending changes were
  restored; schema content remains identical to the base commit.
- `npx.cmd prisma validate`: PASS.
- `npx.cmd prisma generate`: PASS.
- `node --test tests/crm-customer-filters.test.mjs tests/crm-team-removal-confirmation.test.mjs tests/crm-follow-up-filters.test.mjs tests/crm-report-filters.test.mjs tests/crm-report-scope.test.mjs tests/crm-activity-filters.test.mjs tests/crm-interaction-validation.test.mjs`:
  69 PASS (existing 51 plus 10 activity-filter and 8 interaction-validation tests).
- `npm.cmd run lint`: PASS, including the new verifier.
- `npm.cmd run build`: PASS, including TypeScript and the dynamic customer route.
- `node --check scripts/verify-crm-activities.mjs`: PASS.
- `node scripts/verify-crm-activities.mjs`: 436 assertions PASS.
- `node scripts/verify-crm-reports.mjs`: 1,026 assertions PASS.
- `node scripts/verify-crm-follow-ups.mjs`: 259 assertions PASS.
- `node scripts/verify-crm-pipeline.mjs`: 169 assertions PASS.
- `node scripts/verify-crm-team-integrity.mjs`: 190 assertions PASS.
- Every integration run restored its original customer/task/team/user/activity/
  audit snapshot after fixture cleanup. Read-only membership checks before and
  after all runs: 2 memberships, 0 duplicated user IDs.
- `git diff --check`, `git diff --cached --check` and branch diff checks: PASS.
- All 13 changed files passed strict UTF-8 decoding and a mojibake scan; full
  source/diff review found no blocking issue or out-of-scope artifact.

The existing Node MODULE_TYPELESS_PACKAGE_JSON and Next standalone-start warnings
are non-failing environment notices. CRM-008 conflict tests can emit handled
Prisma write-conflict diagnostics while their assertions pass. No migration,
seed, business-data repair, production operation or external delivery was run.

## Independent review focus

Review customer-scope checks and Serializable write behavior, removal of the old
manual endpoint, ID/type-only audit metadata, the documented contact timestamp
exception, type-based system labeling and nullable stored actors. HTTP/HTML tests
do not independently verify hydrated form reset/draft retention or visual layout.
Stale requests after completed scope changes are tested; every simultaneous
role/reassignment/removal interleaving is not forced. No production-scale query
benchmark or new index is included. Offset pages can shift between separate
requests when new entries are appended. There is no idempotency key: distinct
successful submissions create distinct activities; pending controls are not an
exactly-once delivery mechanism.
