# CMS-009 — MED-08/11 admin search abort follow-up

## Checkpoint and staging evidence

Local branch `feature/cms-009-media-library` remains at
`93e0356feb60319173bf171886e2e310631fc0f5` (parent
`2b3fa4bc91578a7b785435a5add63d5132013a20`). The index was empty
before work. `next.config.ts` retained its pre-existing status-only `M`;
its diff is empty and its Git-normalized blob equals HEAD
(`4d0d963d45e57b949a3add6a600832ce14efbce6`). It was not edited.

The Product Owner supplied operator-launched, Claude-observed staging run
`d7890161e41b759fda16e101`, BUILD_ID `0LbIlFCcYmk6LAgeYW5iD`.
Read-only QA build metadata records the exact HEAD and BUILD_ID, and the v4
fixture manifest records the runId. The UTF-16LE log
`.next/cms009-staging-logs/run-20261004-131450-c7a7963425144ee489296e91ca060be9.log`
has **121 passed / 1 failed / 0 timed out** across 122 CASE records; only
MED-08/11 failed. The other actor's search completed, foreign row absence
passed, and protected GET returned 404. Admin search recorded one POST:
`ACTION_REQUEST` at 73 ms, `ACTION_RESPONSE` HTTP 200 at 717 ms,
`ACTION_FAILED` with allowlisted `ABORTED` at 718 ms, then
`BUTTON_REENABLED` at 720 ms. The first failed assertion is
`tests/e2e/cms-media.spec.ts:281`, the `expect.poll` condition requiring
`actionFinishedOk()`. The later `ACTION_FAILED` assertion at line 283 and
admin-visible assertion were **not reached**. The log has no admin result or
form-error observation after this point. PO reports exit 1,
`BROWSER_SUITE_FAILED`, no VERIFIED marker and all 19 cleanup counters zero.
The staging run remains **FAIL**, regardless of cleanup.

## Root cause and local reproduction

The **test's immediate failure cause is confirmed**: it treated Playwright
`requestfinished` as mandatory Server Action success evidence, so a
`RESPONSE 200 → requestfailed ABORTED` sequence failed before checking the
application result. The **initiator of the browser abort and the business
outcome of this particular staging admin action remain undetermined**. HTTP
200 headers and button reenable alone do not prove a successful search.

Installed Next 16.2.6 uses `fetch` followed by React Flight decoding for the
Server Action. A separate, ignored `.next/cms009-search-prod-probe` used a
production `next build`/`next start`, Chromium/Playwright 1.63.0 and a
byte-identical copy of the current `MediaLibrary.tsx`. The action adapter
returned synthetic `MediaListResult` rows; auth, Prisma, private storage and
staging credentials were **not** used. Thus it tests the real component,
Next production action transport, browser and test observer, while its
search data/scope are synthetic. Existing real query/action tests remain in
the full unit suite; the probe makes no claim about a staging DB response.

Six production-local rounds per combination showed the following. Each
round rendered the expected result count and status without a form error;
the actual observer classified the one action request:

| Synthetic search | `requestfinished` | `200 → ABORTED` | Correct UI |
| --- | ---: | ---: | ---: |
| other, empty | 4 | 2 | 6/6 |
| other, own image | 4 | 2 | 6/6 |
| admin, empty | 3 | 3 | 6/6 |
| admin, image | 4 | 2 | 6/6 |

This reproduction rules out “admin role” or “nonempty result” as sufficient
causes of the signal. It does not identify which Next/React/browser layer
initiated cancellation. Deliberate local transport faults remained distinct:
aborting before headers yielded `FAILED`, a visible `INTERNAL_ERROR` and no
new row; a corrupt HTTP 200 Flight body yielded a visible `INTERNAL_ERROR`
and no new row. Neither met the revised completion predicate. This is a
local fault-injection result, not a staging fault replay.

## Stale-result delta after Claude review

Claude accepted the transport correction but identified an unproven stale-UI
claim: the other actor's initial list could already be empty, while an admin
list with one wrong asset could satisfy a count-only assertion. The
production-local probe was rebuilt with the same byte-identical
`MediaLibrary`, Next production Server Action transport and synthetic data
adapter. Its actor/query/row data were deliberately mutated; this is a
**negative control**, not evidence that staging returned stale data.

Before this delta, the probe imported the very same `assertMediaSearchGate`
helper called by MED-08/11. The helper initially contained the E2E's
count-only assertions unchanged. With one actual local `2xx → ABORTED`
action, click/submit, busy→idle, no form error and no navigation, the old
gate **PASSed** both unchanged states:

| Actor | Initial IDs | IDs after stale action | Old gate |
| --- | --- | --- | --- |
| other | `[]` | `[]` | PASS |
| admin | `[synthetic-decoy]` | `[synthetic-decoy]` | PASS |

That confirms a **test false-pass path**, not a confirmed product defect.
The corrected E2E now uploads a distinct media decoy as the `other` actor
using the existing guarded upload, manifest reservation, journal and recovery
path. It records the actual visible ID set before searching. The other list
must contain its decoy and exclude the creator target; the admin initial list
must contain that decoy. Both initial sets are required to differ from their
expected final sets. After the target-name search, the shared gate requires
the exact ID sets `[]` for other and `[creator target]` for admin, as well as
the existing transport, query input, status, no-error and no-navigation
checks. It makes no assumption that other cases left a particular list.
The one additional owned asset is included in the existing exact manifest
and 19-counter cleanup protocol; no cleanup or DB operation ran locally.

The same helper and production-local probe then produced these actual
post-header `ABORTED` outcomes:

| Synthetic control | Before → after IDs | New gate |
| --- | --- | --- |
| Stale other | `[] → []` | FAIL (indistinguishable precondition) |
| Stale admin / wrong ID, same count | `[decoy] → [decoy]` | FAIL |
| Correct other | `[decoy] → []` | PASS |
| Correct admin | `[decoy] → [target]` | PASS |
| Missing admin asset | `[decoy] → []` | FAIL |
| Extra admin asset | `[decoy] → [decoy, target]` | FAIL |
| Wrong other scope | `[decoy] → [decoy]` | FAIL |

Additional controls called the same gate: a cut before headers, corrupt
Flight HTTP 200 body, HTTP 500 and duplicate POST all **FAILed**. An
unrelated POST outside `/creator/media` left a correct search **PASSing**.
The cut/corrupt/500 controls displayed a form error and kept the prior
decoy; the duplicate was rejected even with the target visible. The injected
faults are synthetic. The natural local `ABORTED` samples do not identify the
abort initiator or establish the unobserved admin result from staging.

## Minimal correction and retained gates

`scripts/cms-e2e/media-search-observation.ts` now classifies the sole action
as `PENDING`, `FINISHED_2XX`, `ABORTED_AFTER_2XX` or `FAILED`, using the
same request's response and terminal event. More than one action POST,
non-2xx, missing headers and any failure other than `ABORTED` do not qualify.
The fixed-code safe diagnostic signal schema and request ordinals are
unchanged; raw URLs, queries, headers, action payloads and browser errors do
not enter reports.

The MED-08/11 browser case accepts only a terminal 2xx outcome of the two
specified kinds **plus** native click/submit, disable/reenable, no navigation,
no form error, the target query still in the input, the searched count/status
and exact result IDs, foreign-hidden, GET 404, and admin-visible asset. An
aborted transport is not accepted by itself. The shared test-only gate makes
the browser spec and local negative control use identical assertions. The
additional other-owned decoy makes a retained result distinguishable.
Existing assertions after the search are retained. There is no timeout,
retry, force-click, skip, product, auth, DB or journal implementation change.
The runbook now states the exact-set gate.

`tests/cms-media-search-observation.test.mjs` retains prior ordinal,
listener-disposal and safe failure-code checks and covers 2xx finished,
2xx aborted, pending, duplicate POST, cut/no-header, 500 and other network
failure. The production-local probe additionally exercised the actual
component, action transport and observer before/after the test change.

## Validation and handoff

All local subprocesses used prepared Node **v22.23.2**, a filtered dummy
environment, an `.env` read guard and blocked DB ports. No real database,
staging, QA artifact, dependency or media root was changed.

| Check | Actual result |
| --- | --- |
| Focused observer, diagnostics, media action/harness tests for this delta | **53/53 PASS** |
| Full unit/action suite | **857/857 PASS in the prior local correction**; not rerun for this test-only delta |
| Isolated production Next build after adapter change | PASS, Next 16.2.6 |
| Shared-gate stale/ID/scope production-local controls | Old gate 2 false PASS; new gate 2 correct PASS and 5 stale/wrong/missing/extra FAIL |
| Shared-gate transport/request controls | Cut, corrupt 200, 500, duplicate FAIL; unrelated POST with correct result PASS |
| ESLint / TypeScript `--noEmit --incremental false` | PASS / PASS |
| Playwright discovery | **122 cases PASS**; browser staging NOT RUN |
| `git diff --check`, whitespace/conflict scan | PASS |

The filtered wrapper's `npm run test:unit` and `npm run lint` launchers
exited 1 after only their script banners. Direct calls to the same installed
Node test runner and ESLint in that filtered environment passed; this is a
launcher limitation, not a product or test failure. The first probe attempt
used `networkidle`, which did not settle; the final probe instead observed
the actual button lifecycle and action/UI result without that condition.

Changed content paths: `scripts/cms-e2e/media-search-observation.ts`,
new `scripts/cms-e2e/media-search-gate.ts`, `tests/e2e/cms-media.spec.ts`,
`tests/cms-media-search-observation.test.mjs`,
`tests/README.cms-e2e.md`, and this report. All are **UNSTAGED**; the index
remains empty. `next.config.ts` remains separate status-only `M` and was not
included. The ignored probe and validation logs under `.next` are not part of
the handoff diff.

Claude delta review, CI and guarded staging for this **new stale-gate delta**
are **NOT RUN**. Review should scrutinize the extra other-owned fixture's
journal/cleanup scope, exact before/after ID assertions and the shared gate.
A future guarded 122-case run must reach admin-visible,
exit 0, verify all 19 cleanup counters and emit `CMS_E2E VERIFIED` before
staging may be called PASS. The LOW keyboard coverage remains open; manual
authenticated production UAT is **DEFERRED** by PO. Production storage
provisioning/ACL/proxy/backup/persistence gates remain open. CMS-009 is
**NOT COMPLETE**.
