# CMS-008 staging failures — local investigation and patch

Date: 2026-09-29. Checkpoint: `feature/cms-008-taxonomy-instruments`, HEAD `af1ca7e1ba6a07a7b6d1b2fd9a7ff6ebb01eb0e9`, parent `85f9eb55e5c63217d060e89f71780959cb00058a`. Initial working tree and index were clean. PR #23 is the draft checkpoint supplied by PO; no PR operation was performed here.

**Local result:** two test/helper defects reproduced and fixed; SRC-18 and TAX-10/11 remain **UNDETERMINED**. They receive safe phase diagnostics, not speculative behavioral fixes. Product source, schema, dependencies, auth policy, workflow, fixture/recovery/cleanup implementation and test timeouts/retries are unchanged.

New patch: **Claude independent review NOT RUN; CI NOT RUN; staging NOT RUN**. CMS-008 is **NOT COMPLETE**. Manual authenticated UAT remains **DEFERRED**.

## 1. Original staging evidence remains FAIL

PO supplied task `b1466gtu2`, runId `cf714c5512fad3d3d87a1ded`, BUILD_ID `Zmo8JthypO2dmcYKVJmeE`. I read the permitted filtered output and matching snapshot metadata locally:

- Output: `C:\Users\MTA-PC\AppData\Local\Temp\claude\d--lkc-phase1-rbac-patch-LKC-fintech-demo\eed68a29-a2b2-49fa-8cdb-8383f1645975\tasks\b1466gtu2.output`.
- Snapshot: `.next/cms-e2e-build-cf714c5512fad3d3d87a1ded/.next/cms-e2e-build.json` and `BUILD_ID`; commit/build matched the supplied checkpoint.
- Exactly **90 final CASE records: 86 passed / 4 failed / 0 timedOut / 0 skipped**. EDIT 20/20; AUTO 16/16; SRC 18/19; TAX 32/35.
- `CMS008_QA_EXIT_CODE=1`, `CMS_E2E STOP BROWSER_SUITE_FAILED`; no `CMS_E2E VERIFIED`. All 13 cleanup counters were zero. PO reports lock released, app stopped and Git clean. I did not rerun cleanup or staging.

Failed DIAGNOSTIC records are not test attempts. Config retains `retries: 0`. Installed Playwright's `invokePollMatcher` emits matcher steps for internal poll attempts, and the safe reporter can emit both failed leaves and enclosing steps. The output contains one final CASE for each failure:

| Case | Filtered observation |
| --- | --- |
| TAX-24-LINKS | Two failed diagnostics; leaf location at original `cms-taxonomy.spec.ts:626:110`, parent location null. Counter expected one after navigation. |
| SRC-18 | `SRC_OFFLINE` passed; four failed `SRC_UNKNOWN_ACK` diagnostics followed by a passed `SRC_UNKNOWN_ACK`; final CASE failed. No assertion follows this step in the test body. |
| TAX-10/11 | 25 failed diagnostics under `TAX_SELECTION_ROUNDTRIP`, assertion location/source null; one failed final CASE. No specific save/primary/reload checkpoint is identifiable. |
| TAX-25/26 | Two failed diagnostics; leaf at original `cms-taxonomy.spec.ts:645:135`, parent null. Global alert visibility assertion after whitespace input. |

No raw staging trace, payload, cookie, credential, DB row, or manifest was inspected or copied into this report.

## 2. Per-case investigation and disposition

| Case | Source and hypothesis | Local execution and demonstrated cause | Patch | Classification and limit |
| --- | --- | --- | --- | --- |
| TAX-24-LINKS | `cms-autosave-support.ts` accepted every POST with `next-action` beneath `/creator/articles/`. Actual classification panel effect calls `controller.search('category', '', 1)`; its read Server Action posts on the classification route. Hypothesis: this read increments the article-save counter. | Actual helper plus synthetic Request/Page/Route contracts: editor UPDATE followed by classification SEARCH counted **2** before patch, expected **1**. The broad predicate also consumed a barrier slot for unrelated requests. Before regression: **3/6 passed, 3 failed**; patched focused group **25/25 passed**. | Match only nonempty action-header POSTs on exact `/creator/articles/new` and `/creator/articles/[id]/edit` paths. Keep expected count one and DB assertion unchanged. | **CONFIRMED local helper defect.** Old staging request metadata was not captured; cannot identify the actual extra request from that run. |
| SRC-18 | Body ends after `SRC_UNKNOWN_ACK`. Investigated dispose, context close, `finally recover()`, disconnect, pending async work and reporter omissions. A passed controlled step does not settle fixture/hook/worker outcome. | Actual installed Playwright, safe reporter/filter and extracted current lifecycle callbacks, with synthetic adapters and body: close, recovery, disconnect and unhandled async failures all yield body-step PASS / final CASE FAIL. Baseline: five body steps passed, ten failed internal poll diagnostics, one final PASS / four FAIL; child exit **1**, correctly preserved. No unique cause follows from the old signature. | Add four awaited static teardown phase steps and allowlist them only for SRC cases. Preserve original order, error identity/precedence and `finally`. No behavioral recovery change. | **UNDETERMINED**; not proven to be a hook, app or harness defect. New probe distinguishes injected close/recover/disconnect phases; async still fails without inventing a phase. |
| TAX-10/11 | Read complete six-save sequence, observer metadata readiness, barriers, accumulated handlers, release/ACK and reloads. Null locations can originate in helpers outside the location allowlist. Hypotheses included missing action metadata, response wait, lifecycle handling or app state/token failure. | Integrated real controller/action/query/options/store + actual helper replay passes all six saves, seven query snapshots/reloads, 24 read-only searches; five parent CAS writes, no-op unchanged. Independent real Chromium helper loopback probe passes six retained-barrier save/ACK cycles and five reloads. No failing checkpoint or product defect reproduced. | Add seven case phases plus three nested helper-wait/ACK codes; preserve every operation/assertion and all DB/reload checks. Add integrated regression and retain standalone helper probe. | **UNDETERMINED**. Synthetic transaction/browser adapters do not prove MariaDB, actual compiled staging metadata, navigation/hydration timing or which staging poll failed. No transaction/primary fix justified. |
| TAX-25/26 | Whitespace is nonempty to native `required`; controller trims/rejects it. Global `getByRole('alert')` may include the Next route announcer in addition to the form error. | Real `TaxonomyCatalog`, controller/validator and installed Next `AppRouterAnnouncer` mounted on loopback: whitespace submits, returns `VALIDATION_ERROR`, focuses/describes name field, and dispatches **zero** actions. With announcer there are **two** alerts and old locator fails strictly; without it there is one. Both clock modes reproduce this. Patched assertion fragment **4/4 PASS**, recovery with Enter **4/4 PASS**, no JS errors. | Scope by role **and** exact domain `data-error-code`, assert exactly one visible alert, invalid name field, correct described error and focus. No `.first()` or forced focus. | **CONFIRMED local test locator defect.** Old staging DOM/raw error is unavailable; exact alert nodes from that run are not established. No app validation defect reproduced. |

## 3. Reproduction detail and preserved requirements

### TAX-24-LINKS: request measurement

Read every caller of `isArticleAction`, `countArticleActions` and `holdActionResponses`, including AUTO cases, EDIT-20 request failure observation, SRC cross-surface/link cases and TAX autosave/link cases. New six-test regression receives real helper exports; it covers create/update acceptance, GET/missing or empty header rejection, source/classification/catalog/search/login/nested-route exclusion, exact counter, hold limit, release/drop/disposal and fetch rejection propagation.

The predicate is appropriate to the current draft routes and Server Actions. It is not a universal future action-ID classifier; a future unrelated Server Action added directly to a draft editor route would require reassessing this contract. Current application routes were inspected. AUTO-21 and FMT_CODE_BLOCK code remain untouched; their shared helper now excludes sibling-route requests.

### TAX-25/26: actual component and browser

`tests/browser-local/cms-taxonomy-validation.mjs` bundles the actual component/controller/validator with installed Next webpack. Only server actions and `next/link` use explicit synthetic adapters. It mounts the installed route announcer, rather than inventing a second alert. Fresh contexts, service workers blocked, loopback-only requests, no CMS login or DB.

Four combinations: native/installed browser clock × announcer absent/present. Empty string is native-invalid (submit count 0, invalid count 1); whitespace is native-valid, submits once and is rejected by the actual controller before dispatch. With announcer, broad matcher fails **2/2**; without announcer, baseline passes **2/2**. Patched assertion code is extracted from the working-tree E2E callback and passes **4/4**.

Node-clock measurements: whitespace validation **46.39–62.11 ms**; old matcher strict failures **13.39–18.01 ms**; scoped assertions **16.49–22.53 ms**. The hidden/clipped live announcer is still a matching `role=alert`, producing locator multiplicity rather than failed domain validation. All later text safety, keyboard Enter, responsive, list/DB and classification assertions remain present.

### SRC-18: phase attribution without suppressing errors

The standalone lifecycle probe does **not** execute the real SRC-18 business body: it executes extracted real hook bodies against injected synthetic adapters, plus a synthetic poll body. It maps synthetic test metadata to the known registry identity solely to exercise the actual reporter/filter. It uses an isolated Playwright config; no CMS global setup/guarded runner/browser/DB is started.

Four new codes: `SRC_TEARDOWN_DISPOSE`, `SRC_TEARDOWN_CONTEXT_CLOSE`, `SRC_TEARDOWN_RECOVER`, `SRC_TEARDOWN_DISCONNECT`. Existing 27 source business codes remain; registry now has **31 distinct SRC codes**, across the same 19 cases. After instrumentation the controlled close/recover/disconnect failures identify their exact phase. The async scenario remains FAIL; worker interruption does not fabricate a recovery completion. Final probe observed 19 teardown records, body 5 PASS, final 1 PASS / 4 expected FAIL, child exit 1; the parent probe exits 0 because these are asserted expected failures.

Unit regressions verify ordering, disposal rejection, context-close rejection with recovery, recovery-over-close `finally` precedence, disconnect rejection identity, allowlist isolation, secret filtering and final failed verdict even after passed phases. Source recovery in the business body already ran before the last step passed; a later recovery/close/async failure remains possible. `afterAll` normally runs at file completion or after an existing failure, so a disconnect-only hypothesis cannot by itself establish the primary cause of this mid-file staging failure.

Minimum missing safe evidence: which teardown phase completes/fails for SRC-18, or whether CASE fails despite all applicable phases passing. Such a result would distinguish known hook boundaries from fixture/worker/pending-async territory; it would still not identify an arbitrary raw exception. No speculative cleanup/recovery patch is included.

### TAX-10/11: complete roundtrip and helper waits

`tests/cms-classification-roundtrip.test.mjs` uses real classification controller, actions, query/options/store and both taxonomy response helpers. Only session/cache/Prisma/browser transport are synthetic. The predicate-aware transaction adapter checks Serializable use, conditional parent claims, exact millisecond tokens, rollback and single-flight; it does not implement a MariaDB server.

Six phases: initial assignment with primary A; clean no-op; switch to primary B while both mappings remain; clear primary while retaining both; nonempty replacement; clear all. Exact committed graph is checked while ACK is held, then actual ACK token becomes the next controller snapshot. It checks unchanged source/catalog/unrelated Article fields, no-op unchanged token, five changed parent writes, 24 read-only searches, seven loaded snapshots and 30 post-transaction revalidations. Playwright `route.continue()` is modeled as terminal network dispatch, not fallback through old handlers. Final integrated test **1/1 PASS**; adjacent focused group **51/51 PASS** before this adapter precision correction, and the final full suite includes the corrected test.

`tests/browser-local/cms-taxonomy-barriers.mjs` separately uses actual helpers, installed Chromium, synthetic public compiled action-reference metadata and actual loopback POSTs. Browser clock installed; each new barrier remains registered as in the case. Six writes/held responses/ACKs and five reloads pass, counter exactly six despite search POSTs. Node-clock cycle durations: **398, 276, 140, 133, 133, 240 ms**. This rules out a deterministic retained-handler failure in this setup, not all staging races.

New phases: setup, initial save, no-op, primary switch, primary clear, replacement, clear; nested codes distinguish observer/hold setup, response-ready and ACK waits. The seven enclosing phases disambiguate repeated nested wait codes in filtered output. Static registry admits these ten codes only for TAX-10/11: **26 original TAX business codes + 10 phase codes = 36**, still 35 TAX cases. No raw error/stack/URL/ID/payload field is added.

Diff audit confirmed TAX-10/11 retains original ordering and **35 expect calls, five reloads, six graph reads, two saveClass calls, four explicit save clicks/holds/releases and two source-row comparisons**. Returns only carry values across added awaited step scopes. Minimum missing evidence is the first failing phase/helper checkpoint and whether prior ACK/DB/reload steps passed; old diagnostics cannot supply it. These additions are for targeted evidence in a separately authorized QA run, not a request to rerun staging to see whether it gets lucky.

## 4. Validation performed locally

Runtime: prepared **Node v22.23.2**, installed **Playwright 1.63.0**, **Chromium 153.0.8010.12**, **Next 16.2.6**. No packages/runtime/browser downloaded or changed.

All test/probe/lint/TypeScript/discovery children used the existing filtered wrapper `.next/cms006-local-20260926-05e7d1/run.cjs`: OS environment allowlist, dummy `DATABASE_URL`/`NEXTAUTH_*`, `.env` read and DB-port guards, ignored logs. No staging environment inherited. Synthetic loopback browser probes are separate from the guarded CMS suite.

| Check | Actual result |
| --- | --- |
| Matcher regression before fix | 3 PASS / 3 FAIL (expected demonstration of bug) |
| Matcher/helper/component focused after fix | 25/25 PASS |
| Catalog form/validator/controller focused | 28/28 PASS |
| Component browser probe | Four combinations; broad locator fails in both announcer combinations; patched assertions and Enter recovery 4/4 PASS |
| Source lifecycle/reporting focused | 35/35 PASS at that checkpoint |
| Lifecycle standalone probe before/after | PASS against expected injected failures; child failed verdict/exit 1 preserved |
| Classification actions/controller/helpers focused | 51/51 PASS; final corrected adapter integration 1/1 PASS |
| Final taxonomy/source diagnostics regression | 31/31 PASS |
| Real Chromium taxonomy helper probe | Six cycles PASS |
| **Full unit/action suite after all code edits** | **778/778 PASS; 0 fail, 0 cancelled, 0 skipped** (761 baseline + 17 new tests) |
| Full lint | PASS, exit 0 |
| TypeScript, no emit/incremental | PASS, exit 0 |
| Playwright discovery | **90**, PASS: 20 EDIT + 16 AUTO + 19 SRC + 35 TAX; browser suite NOT RUN |
| Git diff-check; new-file whitespace/conflict markers | PASS |
| App production build / Prisma generation | NOT RUN in this patch; no product/build/schema/dependency change. User permits omitting repeated build for test/helper-only changes. |

Final gate commands (PowerShell; prepared Node launches filtered wrapper, which launches each child):

```powershell
$node = 'C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe'
$wrapper = '.next/cms006-local-20260926-05e7d1/run.cjs'
& $node $wrapper cms008-failures-diagnostics --test tests/cms-e2e-diagnostics.test.mjs tests/cms-source-lifecycle-diagnostics.test.mjs
& $node $wrapper cms008-failures-barriers-final tests/browser-local/cms-taxonomy-barriers.mjs
& $node $wrapper cms008-failures-unit-final npm run test:unit
& $node $wrapper cms008-failures-lint-final npm run lint
& $node $wrapper cms008-failures-tsc-final node_modules/typescript/bin/tsc --noEmit --incremental false
& $node $wrapper cms008-failures-discovery-final npm run test:e2e:list
git diff --check
git status --short --untracked-files=all
```

Additional executed probe commands use the same wrapper: `cms008-validation-browser-patched tests/browser-local/cms-taxonomy-validation.mjs` and `cms008-src18-phases-final tests/browser-local/cms-src18-lifecycle.mjs`. Logs reside under the wrapper directory with the label plus `.log`. Historical before-patch logs: `cms008-links-before.log` and `cms008-src18-lifecycle-filtered.log`. Logs/build scratch are ignored and are not part of the handoff diff.

## 5. Files and Claude review targets

All 14 files below are **UNSTAGED**; seven tracked modifications, seven new files including this report. No source/config/schema/migration/dependency file is changed.

| File | Purpose / current entry point |
| --- | --- |
| `tests/e2e/cms-autosave-support.ts` | Exact article request predicate, line 3; unchanged counter/barrier consume it. |
| `tests/e2e/cms-taxonomy.spec.ts` | TAX-10/11 static phases, line 310; TAX-25/26 scoped validation alert, line 662. TAX-24 count and DB assertions unchanged. |
| `tests/e2e/cms-sources.spec.ts` | Four awaited lifecycle phases, line 105; original business steps and recovery behavior unchanged. |
| `scripts/cms-e2e/diagnostics.mjs` | Case/file-scoped additions to static code allowlist. Filter schema unchanged. |
| `scripts/cms-e2e/taxonomy-diagnostics.mjs` | Ten static TAX-10/11 phase codes; original case inventory unchanged. |
| `tests/cms-e2e-diagnostics.test.mjs` | Registry inventory and phase/helper location, redaction and verdict regressions. |
| `tests/cms-taxonomy-form.test.mjs` | Whitespace domain validation, accessibility and explicit correction regression. |
| `tests/cms-article-browser-support.test.mjs` (new) | Six request counter/barrier acceptance/exclusion/failure regressions. |
| `tests/cms-classification-roundtrip.test.mjs` (new) | Integrated actual-module six-save regression with explicit synthetic adapters. |
| `tests/cms-source-lifecycle-diagnostics.test.mjs` (new) | Eight hook ordering/rejection/filter/verdict regressions. |
| `tests/browser-local/cms-taxonomy-validation.mjs` (new) | Actual component + Next announcer browser reproduction; extracts patched assertions. |
| `tests/browser-local/cms-src18-lifecycle.mjs` (new) | Actual lifecycle callback/Playwright reporter ambiguity and phase probe. |
| `tests/browser-local/cms-taxonomy-barriers.mjs` (new) | Actual response helpers on isolated Chromium/loopback through retained handlers/reloads. |
| `docs/cms/reports/CMS-008-staging-failures-fix.md` (new) | This evidence/limitations handoff. |

Review priorities: exact matcher contract for all shared callers; actual Next alert reproduction and accessibility assertions; faithful synthetic adapter boundaries; preservation of TAX-10/11 operations/DB checks; SRC `finally` and error propagation; static diagnostic allowlist and unchanged redaction/verdict. Do not promote either UNDETERMINED case or local synthetic results to staging PASS.

Final branch/HEAD remain the starting checkpoint; index is empty. No add/commit/push/PR change/ready/merge/deploy; no SSH, real DB, staging, fixtures/cleanup operation, migration, credential lookup or `.env` read. Original staging remains **FAIL**. New review/CI/staging evidence is still pending.
