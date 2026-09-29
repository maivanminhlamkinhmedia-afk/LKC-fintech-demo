# CMS-008 — TAX-08 and TAX-10/11 timeout investigation

Date: 2026-09-29. Branch `feature/cms-008-taxonomy-instruments`; HEAD `ced45a04c45709aa21aaaac8a322104a76e89f62`, parent `af1ca7e1ba6a07a7b6d1b2fd9a7ff6ebb01eb0e9`. Preflight matched the checkpoint with a clean working tree and empty index. PR #23 draft / CI 778 PASS is the supplied checkpoint; no GitHub mutation was performed in this task.

**TAX-08: ROOT CAUSE UNDETERMINED. TAX-10/11: ROOT CAUSE UNDETERMINED.** Local execution establishes distinct timeout mechanisms and the workload/call order, but does not identify the operation or actual timing in the supplied staging run. No product fix or timeout increase is justified by the available evidence. The patch adds bounded timing evidence and precise operation attribution, with regression tests; it does not claim to fix either staging timeout.

## 1. Supplied staging evidence

Claude staging evidence supplied by PO, not a staging run performed here:

- Task `bflxd4u1a`; runId `f451e42c8986c0330b57eee0`; BUILD_ID `WEpB_5aRMidqatNDHBjhe`; commit `ced45a04c45709aa21aaaac8a322104a76e89f62`.
- 90 CASE: **88 passed / 0 failed / 2 timedOut / 0 skipped**. EDIT 20 PASS, AUTO 16 PASS, SRC 19 PASS, TAX 33 PASS / 2 timedOut.
- Exit 1, `CMS_E2E STOP BROWSER_SUITE_FAILED`, no `CMS_E2E VERIFIED`. All 13 cleanup counters zero; lock released, app stopped and Git clean according to the supplied report.
- TAX-24-LINKS and TAX-25/26 passed this staging run. SRC-18 passed, but its historical failure cause remains unknown. No new repair to these case bodies is included.

| Case | Supplied observation | What it does not establish |
| --- | --- | --- |
| TAX-10/11 | SETUP, INITIAL_SAVE, NOOP, PRIMARY_SWITCH and PRIMARY_CLEAR passed. REPLACE did not finish; failed assertion location `cms-taxonomy.spec.ts:79:23` (`choose()` visibility assertion), source `error.location`; final CASE timedOut. | Which of category-7/topic-7/tag-7/instrument-8 was being chosen; how long the assertion waited; whether an option was missing for its full expect budget or interrupted by the body deadline; actual response order/latency. |
| TAX-08 | `TAX_DELETE_GUARDS` passed, final CASE timedOut; no assertion location or teardown phase. | Whether timeout was at the body boundary, disposal, context close, recovery, ordinary fixture teardown, afterAll or asynchronous work. A passed controlled step is not proof that the independent teardown budget did not expire. |

Only the supplied summary is used for this run; no raw staging trace, manifest, request/response, DB row, credential or environment file was collected. The original staging verdict remains **FAIL**.

## 2. Installed runtime and source inspection

Read AGENTS.md, relevant installed Next guidance, spec/implementation guidance, runbook, taxonomy spec/support, safe reporter/filter/registry, fixtures/taxonomy-fixtures, actual classification component/controller/options and installed Playwright 1.63.0 runtime/types. Existing config stays **test 60,000 ms / expect 10,000 ms / retries 0 / workers 1**; all 90 cases remain.

Installed `node_modules/playwright/lib/worker/workerProcessEntry.js` shows:

- Test begin/result start time precedes beforeAll, beforeEach and fixture setup. Default fixture setup/beforeEach/body share the default slot.
- Around lines 1661–1678, a **fresh after-hooks slot** is created with `elapsed: 0`, timeout `max(project.timeout, testInfo.timeout)`. afterEach and ordinary test-fixture teardown share it. This is not the unused remainder of the body slot.
- Around line 1771, each beforeAll/afterAll has a separate project-timeout slot. Custom-timeout fixtures may also have separate slots.
- Around line 1729, `result.duration` is default-slot elapsed + after-hooks-slot elapsed; it excludes the separate all-hook slots. It is neither body-only time nor full lifecycle wall time.
- Public step start/duration metadata uses worker wall-clock timestamps. Timeout slots internally use monotonic elapsed accounting. Public reporter APIs do not expose the exact active-slot counter at assertion onset.

The installed Next client action queue serializes pending Server Actions (`app-router-instance.js`, queue implementation around lines 49, 71 and 154–162). This is source inspection. The local HTTP probe below explicitly models FIFO as one scenario; it does not claim to execute Next Flight/auth/DB transport.

## 3. TAX-10/11 — actual search and roundtrip trace

`choose()` remains unchanged: click the kind button, fill query, click search, `expect(input).toBeVisible()`, then `input.setChecked(checked)`. The actual component searches on kind click and explicit search; mount also searches category. The actual controller uses a generation counter to reject stale results.

Full case order: initial five choices/save/graph/reload; no-op save/graph; primary switch/save/graph/reload; primary clear/save/graph/reload; remove three mappings; choose replacement category/topic/tag/instrument; save/graph/reload; remove replacement set; clear/save/graph/reload. No-op, primary 0/1, replacement, clear and preserved-field/source assertions are unchanged.

Search count from source: initial mount 1 + setup five choices ×2 =11; three reload mounts before REPLACE bring 14; replacement four choices ×2 brings 22; final two reloads bring **24 option searches** over the complete case. There are six saves (one no-op), five browser reloads and six `graph()` reads. These are call counts, not captured staging network timings.

### Real component/helper local browser probe

`tests/browser-local/cms-taxonomy-search-timing.mjs` extracts current `choose()` through TypeScript AST and mounts the real `ArticleClassificationPanel` and controller. Options use an explicit synthetic HTTP adapter on loopback; fresh Chromium contexts, no CMS login/real DB. It records dispatch/response ordering, each kind, assertion start/settle and elapsed times using **Node `performance.now()`**, independently of browser clock.

Eight combinations passed: native/installed browser clock × normal/delayed/reordered/modeled FIFO. All nine local requests per combination (mount 1 + four replacement choices ×2) settled; the final latest targeted option and all five selected replacement items were retained. Every delayed response was joined before context close. No JS errors occurred.

| Clock | Adapter mode | Replacement elapsed ms | Actual visibility assertion waits ms |
| --- | --- | ---: | ---: |
| native | normal | 653.81 | 6.58–14.54 |
| native | delayed | 4061.31 | 843.27–897.67 |
| native | reordered | 784.87 | 36.93–104.50 |
| native | modeled FIFO | 3977.57 | 831.24–868.80 |
| installed | normal | 683.95 | 11.24–47.40 |
| installed | delayed | 3965.64 | 842.22–856.94 |
| installed | reordered | 1003.41 | 104.96–111.10 |
| installed | modeled FIFO | 3998.19 | 840.58–861.77 |

Injected synthetic response delays: delayed mode blank 50 ms / targeted 450 ms; reordered/FIFO blank 500 ms / targeted 30 ms. Normal mode has no injected latency. The helper assertion budget is 10,000 ms, matching the repo. This standalone search probe has no full-case 60-second body budget and omits the real server/DB workload. It proves stale/reordered responses and installed clock did not break this local execution; it does **not** exclude a staging-only slow response, missing option, exhausted body budget or different request timing.

**Disposition:** no search/controller bug reproduced. Root cause remains UNDETERMINED; no product/helper behavior change.

## 4. TAX-08 — actual lifecycle and recovery workload

The case has no statement after its awaited `TAX_DELETE_GUARDS` step. It creates **one context with two pages**. It creates no response barrier, so the successful case's disposal list is empty. Common afterEach then closes contexts and runs recovery in `finally`; afterAll disconnects at suite/worker lifecycle completion. The source alone cannot locate the reported timeout among these boundaries.

Actual fixture modules were executed with predicate-aware in-memory adapters, synthetic data and journal callbacks. Identity, ownership, both-endpoint/full-graph validation and foreign-edge rejection remain active. No real fixture/DB/file journal operation was performed.

| Source scope | Explicit DB adapter calls | Transactions | Persist callbacks |
| --- | ---: | ---: | ---: |
| `recover()` | 16 | 1 | 2 |
| `fixtureClassification()` | 18 | 1 | 0 |
| `graph()` = recovery + classification snapshot | 34 | 2 | 2 |
| TAX-08 complete body helper workload | 284 | 17 | 22 |
| TAX-10/11 before REPLACE | 201 | 12 | 12 |
| TAX-10/11 complete body helper workload | 270 | 16 | 16 |
| afterEach recovery, each case | 16 | 1 | 2 |

TAX-08 body: 11 recoveries (six inside graph), six classification snapshots. TAX-10 body: eight recoveries, six classification snapshots, two catalog preflights and four direct reads. Every graph read performs recovery and another full snapshot/preflight; no caching was introduced. v3 recovery persists twice even with an unchanged journal.

Source anchors: `fixtures.mjs` `discoverCreatedArticles` around 163, `readFixtureSnapshot` 178, v3 recovery 256/269, `fixtureCatalog` 294 and `fixtureClassification` 306. `saveManifest` around 83 performs mkdir/write/rename for each real persist. `taxonomy-fixtures.mjs` around 125–158 performs four catalog reads, a category-link read and three mapping reads, followed by complete endpoint checks. Counts exclude UI/server-action DB queries, transaction protocol overhead and driver/network behavior.

With a **synthetic requested 2 ms per read/persist**, both parallel-adapter and serialized-transaction models settled successfully. Node-monotonic body-helper totals: TAX-08 **3089.534 / 3673.746 ms**, TAX-10 **2415.993 / 3258.887 ms**. Individual afterEach recovery totals were **119.404–287.164 ms**. Timer scheduling is included; real journal disk I/O, network, DB, auth and UI latency are excluded. These are not staging latency estimates and do not prove the 60-second budget is insufficient. Tests also reject a foreign graph edge without writing the expanded journal.

**Disposition:** no recovery/close defect reproduced. Root cause remains UNDETERMINED. No ownership/identity/full-graph check, journal write, reserve-before-dispatch step or cleanup guard was removed, cached or bypassed. No timeout increase is proposed from synthetic timings.

## 5. Installed Playwright timeout mechanism probe

`tests/browser-local/cms-taxonomy-timeout-budget.mjs` runs the installed runner in an isolated generated config, with extracted actual taxonomy lifecycle callbacks, synthetic adapters and real Chromium locator assertions for the first two scenarios. Budgets of 650/1600 ms and deliberate delays exist **only in the synthetic probe**, not the CMS config. Node-monotonic events measure operation start/settle/reject. This is local mechanism evidence, not staging reproduction of a known cause.

| Synthetic scenario | Final observation |
| --- | --- |
| Body budget interrupts pending locator | Body budget 1600 ms; locator configured 900 ms. Assertion began **1231.23 ms** into body and rejected after **402.01 ms**, final CASE timedOut. The runner began teardown at body deadline while the locator was still pending; context close then caused rejection. This is not an assertion using its full timeout or proof of immediate promise cancellation. |
| Full assertion timeout | With ample 1600 ms body budget, configured 400 ms locator waited **423.49 ms**, CASE failed. Distinct from the previous timedOut result. |
| Independent afterEach allowance | Body **454.59 ms** + afterEach **398.65 ms** passed with a 650 ms test setting. Teardown exceeds the body remainder and still passes. |
| Context close / recovery / pending async close | Each body step passed, final CASE timedOut. Observed close **861.19 ms**, recovery **763.94 ms**, async close **825.72 ms**, each beyond the synthetic fresh-slot budget. |
| Ordinary fixture shares afterEach slot | afterEach **484.39 ms** + fixture teardown **367.75 ms** exceeded the fresh 650 ms shared slot; body passed, CASE timedOut. |
| Separate beforeAll and afterAll | beforeAll **455.52 ms** + body **444.55 ms** + afterEach **162.56 ms** + afterAll **445.56 ms** passed under 650 ms setting; `result.duration` was **612 ms**. It excludes all-hook slots. |
| afterAll timeout | Body **112.78 ms**, afterEach **36.41 ms**, result.duration **154 ms**, CASE timedOut; disconnect did not settle before worker exit. |

Timeout does not cancel arbitrary promises. In injected close/recovery cases a controlled step could settle **PASS after its slot expired**, while `After Hooks` remained failed and final CASE timedOut. Thus neither a passed body nor even late passed teardown steps alone rules out a budget timeout.

All **nine expected scenarios PASS as a probe**: child results were two passed / one failed / six timedOut and child exit **1**, intentionally preserved; the asserting parent exited 0. Real SafeReporter → production runner filter emitted **231 TIMING records**, preserving all nine CASE verdicts. Synthetic test metadata alone is mapped to the fixed TAX-08/TAX-10 identities to exercise the real allowlist; no CMS suite, auth, fixture setup or staging runner is invoked.

## 6. Diagnostic patch and how it separates the remaining hypotheses

The old CASE/DIAGNOSTIC/DISCOVERY/RESULT shapes remain unchanged. New exact-shape `TIMING` uses the shared formatter and runner stream filter; it is emitted only for TAX-08 and TAX-10/11. Numeric fields are finite integers `0..3600000`; case/phase/scope/status/bodyState are static allowlists; location uses existing approved source paths. Extra fields, unknown codes/cases, wrong enums, NaN/Infinity/negative/oversized values and oversized/truncated lines are rejected. No query/name/ID/slug/form/DB/request/header/token/raw-error/stack is logged.

- Four replacement codes identify **category/topic/tag/instrument** without printing actual option data. Assertion begin/end records expose its onset and wait duration.
- Graph recovery and snapshot wrappers measure each unchanged check. Teardown codes distinguish disposal, context close, recovery and disconnect; fixed `PW_*` codes and anonymous `PW_FIXTURE` timing expose outer lifecycle/fixture spans.
- `durationMs` comes from public Playwright step duration. `testOffsetMs` is the **step start offset** from result start, not event-end time or budget consumed. It includes beforeAll/setup.
- `bodyElapsedMs` measures the explicit body callback span, frozen once that step ends. It omits preceding setup/beforeEach and can overlap teardown if an overdue callback is still settling. It is **not** exact default-slot elapsed or remaining allowance. Public APIs do not expose that counter; no private timer API or invented remaining-time estimate was added.
- `PW_AFTER_HOOKS` includes afterAll work, so its total is not the fresh afterEach slot counter. CASE status and timings must be read together, especially for late PASS after timeout. Worker wall-clock adjustments can affect public offsets; invalid/negative values are dropped, not clamped into evidence. Independent local probe measurements use Node monotonic time.

For TAX-10/11, the next authorized evidence can distinguish which kind was pending, whether its assertion waited close to the full 10 seconds or was interrupted after a short wait late in the body, and where earlier graph/search/save/reload phase time accumulated. A long search wait still does not by itself prove which server/DB component was slow.

For TAX-08, the next evidence identifies whether the body actually ended, which teardown/fixture/all-hook phase entered and settled, and whether it completed only after its independent deadline. Started records survive even if a phase never ends. This supplies operation and time data missing from the supplied run; it is not a request to rerun staging to see whether a failure disappears.

## 7. Local validation and commands

Prepared **Node v22.23.2**; installed **Playwright 1.63.0 / Chromium 153.0.8010.12 / Next 16.2.6**. All validation/probe subprocesses used the existing sanitized wrapper with OS allowlist, dummy DATABASE_URL/NEXTAUTH settings, `.env` read/DB-port guards and ignored scratch logs. No packages/runtime/browser installed.

| Check | Actual result |
| --- | --- |
| Focused timing + legacy diagnostic + source lifecycle tests | **38/38 PASS** |
| Actual fixture-module recovery workload / guard regression | **3/3 PASS** |
| Actual component / extracted choose browser probe | **8/8 combinations PASS** |
| Installed timeout + real reporter/filter probe | **9/9 expected outcomes PASS**, 231 timing records; deliberate child exit 1 retained |
| Full unit/action suite after final code edits, one run | **788/788 PASS, 0 fail / cancelled / skipped** (778 baseline + 7 protocol tests + 3 recovery tests) |
| Full lint | PASS |
| TypeScript | PASS |
| Playwright discovery | **90**, PASS; CMS browser/staging suite NOT RUN |
| Git diff-check and whitespace/conflict scan including new files | PASS |
| Prisma / production build | NOT RUN: no product, schema, dependency or build change requiring them |

Commands executed from repository root (logs under the wrapper directory with each label plus `.log`):

```powershell
$node = 'C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe'
$wrapper = '.next/cms006-local-20260926-05e7d1/run.cjs'
& $node $wrapper cms008-search-timing-final tests/browser-local/cms-taxonomy-search-timing.mjs
& $node $wrapper cms008-tax-timeout-recovery --test tests/cms-taxonomy-recovery-cost.test.mjs
& $node $wrapper cms008-timeout-protocol tests/browser-local/cms-taxonomy-timeout-budget.mjs
& $node $wrapper cms008-timeouts-diagnostics --test tests/cms-taxonomy-timing.test.mjs tests/cms-e2e-diagnostics.test.mjs tests/cms-source-lifecycle-diagnostics.test.mjs
& $node $wrapper cms008-timeouts-unit-final npm run test:unit
& $node $wrapper cms008-timeouts-lint-final npm run lint
& $node $wrapper cms008-timeouts-tsc-final node_modules/typescript/bin/tsc --noEmit --incremental false
& $node $wrapper cms008-timeouts-discovery-final npm run test:e2e:list
git diff --check
git status --short --untracked-files=all
```

## 8. Files, preserved scope and handoff

| Changed file | Purpose |
| --- | --- |
| `tests/e2e/cms-taxonomy.spec.ts` | Unchanged recovery/snapshot calls wrapped at lines 25/38, lifecycle calls at 147–155, four existing replacement choices at 373–376. Assertions and call order retained. |
| `tests/e2e/safe-reporter.mjs` | Targeted structured begin/end timing, body-span tracking and anonymous lifecycle/fixture codes; old verdict behavior retained. |
| `scripts/cms-e2e/diagnostics.mjs` | Synchronized formatter/runner protocol validation for TIMING. |
| `scripts/cms-e2e/taxonomy-diagnostics.mjs` | Four replacement, four teardown and two graph codes plus fixed timing hook map. |
| `tests/cms-e2e-diagnostics.test.mjs` | Static registry inventory updated; existing assertions retained. |
| `tests/README.cms-e2e.md` | Timing schema, interpretation and budget limitations. |
| `tests/cms-taxonomy-timing.test.mjs` (new) | Seven protocol/metadata/redaction/legacy/verdict regressions. |
| `tests/cms-taxonomy-recovery-cost.test.mjs` (new) | Three actual-module call-count/timing/ownership-guard tests with synthetic adapters. |
| `tests/browser-local/cms-taxonomy-search-timing.mjs` (new) | Real component/helper search ordering/timing probe. |
| `tests/browser-local/cms-taxonomy-timeout-budget.mjs` (new) | Installed runner budgets, actual lifecycle callbacks and actual reporter/filter integration. |
| `docs/cms/reports/CMS-008-taxonomy-timeouts.md` (new) | This report. |

Inventory stays 90 cases. TAX controlled-code inventory is now 46 =26 business +14 roundtrip/replacement +4 teardown +2 graph; fixed Playwright hook/fixture codes apply only to TIMING. SRC remains 27 business +4 teardown. No case split/merge, skip, retry, arbitrary staging sleep, assertion removal, forced selection, response fabrication or timeout increase. TAX-24/TAX-25 bodies and SRC-18 source are unchanged; shared taxonomy wrappers only observe existing work and emit targeted records for the two investigated cases. AUTO-21, native paste, FMT_CODE_BLOCK, DB/reload/delete-used/primary checks and all guard operations remain.

Final Git: same branch/HEAD/parent as preflight; **11 files UNSTAGED (6 modified +5 new), index empty**. No add/commit/push/PR/ready/merge/deploy, SSH, real DB, staging, fixtures/cleanup CLI, migration or environment/credential read. No cleanup was rerun.

Claude review / CI / staging for this patch: **NOT RUN**. Review targets are timing semantics (especially late promise settlement), protocol rejection/redaction/legacy compatibility, actual adapter boundaries and preservation of all assertions/guards. Both staging root causes remain UNDETERMINED; CMS-008 is **NOT COMPLETE**, manual UAT **DEFERRED**.
