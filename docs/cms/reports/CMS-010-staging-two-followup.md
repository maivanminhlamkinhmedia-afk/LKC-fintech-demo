# CMS-010 guarded staging two-case follow-up

## Checkpoint and evidence boundary

- Implementation branch: `feature/cms-010-preview`; parent HEAD `109c6816afe54bd87a0bf7896070d7eba4804c38`. Index was empty before investigation.
- Product Owner supplied guarded staging evidence from run `c83adc2bc1d81671e321556f`, commit `109c6816afe54bd87a0bf7896070d7eba4804c38`, BUILD_ID `HDhQkJ-yDCAS4fl6opjLO`. The UTF-16LE log is `D:\lkc_phase1_rbac_patch\cms009-qa-checkout-23488bd6\.next\cms010-staging-logs\run-20261007-075334-b2cfb6230b654cd3a047a24c9131b03f.log`. Its build metadata independently matches that commit and BUILD_ID. QA checkout and artifacts were read-only.
- Staging result remains **FAIL**: 139/141 passed, 1 failed, 1 timedOut, exit 1, no `CMS_E2E VERIFIED`. All 122 baseline cases passed; 19 cleanup counters were zero. Cleanup does not prove the Article state at a failing assertion. The earlier run `c160340c6f5e4c29957400d8` remains a separate historical failure.

| Case | First failing phase / location | Observed | Conclusion |
| --- | --- | --- | --- |
| PREV-13/14/15 | `PREV_PRIVATE_COVER`, `cms-preview.spec.ts` fallback visibility assertion (line 332 in staged source) | The private PNG read and unrelated 404 assertions had passed; the intercepted unavailable cover was not rendered as fallback. | Local real-Next reproduction **confirmed** a missed pre-hydration image error. This is consistent with staging; the staging log itself does not expose the browser event timing. |
| PREV-17/18 | `PREV_LINK_SUBMITTED_LIST`; `PREV_LINK_OWN_LIST` passed | The case timed out; the safe reporter provided no inner assertion location or page/operation. `PREV_LINK_NEW`, editor and popup phases were not reached. | **UNDETERMINED**. The exact awaited call, list page and cause are not observable in this run. No timeout, pagination or permission behavior was changed. |

## Cover reproduction and fix

The original client component relied solely on `<img onError>`. An SSR image can fail before hydration attaches that React handler. A synthetic route in an isolated Next 16.2.6 production build rendered the actual `PreviewCover` component; no CMS login, database or real media was involved. Chromium intercepted the synthetic cover with 404. Before the fix: one intercepted request, browser image `error=true`, image `complete=true` and `naturalWidth=0`, hydration complete, but `fallback=false`. This reproduces the product failure locally, not the staging execution itself.

`PreviewCover` now checks the image's `complete`/`naturalWidth` state after hydration and retains `onError` for later failures. Failure state is keyed to `src`, so a different source is not trapped by an earlier failed image. After the fix, the same production-build probe observed intercepted 404, browser image error, hydration complete, `fallback=true`, broken image removed. A valid same-origin synthetic image remained rendered (`naturalWidth=256`, `fallback=false`). The isolated Next production build passed. The probe only exercises this component and synthetic routes, not authorization, protected media or the real staging server.

PREV-13/14/15 now also confirms that the 404 route was intercepted, the browser emitted an image error, the fallback replaced the broken image, and the persisted Article snapshot did not change. The existing private PNG, unrelated 404, title and fixture cleanup checks remain.

## Submitted-list investigation

The fixture plan creates `SUBMITTED` for the creator. A source scan found no direct mutation of that fixture ID in earlier E2E specs, but the row was not read at the point of timeout. The list page is scoped by the existing actor policy, sorts by `updatedAt` and `id`, and takes 20 Articles per page. The real query function passed two focused tests against a synthetic adapter for actor scope and pagination; this does not reproduce the browser timeout. `findListPreview` starts at `/creator/articles`, counts the exact preview link and follows the real `Trang sau` link up to its existing 50-page limit. The staging log establishes only that the submitted-list phase failed, not whether navigation, a count, a click or visibility was pending. A client-navigation race is possible but unproven; no speculative wait or application change was made.

Only the submitted-list call now wraps its existing awaits in fixed `test.step` codes: `PREV_SUBMITTED_LIST_GOTO`, `LINK_COUNT`, `LINK_VISIBLE`, `NEXT_COUNT`, `NEXT_CLICK` and `NO_EDIT`. The reporter registry and test permit only those static codes for PREV-17/18. No raw URL, Article ID, request, credential or generated Playwright title is emitted. Repeated safe steps can reveal the number of pagination attempts on a later guarded run. The test still performs the same navigation, link and no-edit assertions, with the same 60-second test and 10-second expect limits. These diagnostics are **not** a PREV-17/18 fix or browser PASS.

## Validation and handoff

All local subprocesses used prepared Node 22.23.2 with a filtered environment, dummy database/auth values and an isolated build directory. No actual database operation occurred.

| Check | Result |
| --- | --- |
| Focused preview/diagnostics tests (`cms-article-preview`, `cms-preview-diagnostics`, `cms-e2e-diagnostics`) | 36 passed, 0 failed/skipped/cancelled |
| Focused list-query tests (`cms-article-draft-actions`, name-filtered) | 2 passed, 0 failed/skipped/cancelled; synthetic adapter, no browser |
| Focused ESLint on four modified code/test paths | PASS |
| `tsc --noEmit --incremental false` | PASS |
| Playwright discovery | 141 registered = 122 baseline + 19 PREV; browser cases **NOT RUN** locally |
| Isolated Next 16.2.6 production build and real Chromium cover probe | PASS after fix; baseline probe failed as described above |
| `git diff --check` | PASS |

Content delta for Claude review: `src/features/cms/components/PreviewCover.tsx`, `tests/e2e/cms-preview.spec.ts`, `scripts/cms-e2e/diagnostics.mjs`, `tests/cms-preview-diagnostics.test.mjs`, and this report. All remain **UNSTAGED**. `next.config.ts` remains a pre-existing status-only `M`: its diff is empty and Git-normalized blob matches HEAD; it is outside this delta. No source was staged, committed or pushed. No CI, staging rerun, SSH, real DB, fixture cleanup, deployment or PR update was performed.

Git-normalized content fingerprints at handoff (these identify this local diff, not an external review):

| Path | Git blob |
| --- | --- |
| `src/features/cms/components/PreviewCover.tsx` | `5486a36bdbb5626a04a47b69cc7a02b73fcc3f78` |
| `tests/e2e/cms-preview.spec.ts` | `c1dfd9934e2d5d0f1eea970e4d2d868c7b40cb1f` |
| `scripts/cms-e2e/diagnostics.mjs` | `37de2782bbcd2c5ae12db1d791e6e0132ccfab52` |
| `tests/cms-preview-diagnostics.test.mjs` | `034c3dd1af1a3841a390627223db637451783eba` |

The report's own blob is omitted from its table to avoid a self-referential fingerprint; it can be computed with `git hash-object --path=docs/cms/reports/CMS-010-staging-two-followup.md docs/cms/reports/CMS-010-staging-two-followup.md`.

Claude delta review should assess the hydration fallback and its `src`-keyed state, whether the browser error assertion is stable for PREV-13/14/15, and whether the submitted-list step codes provide enough safe location evidence without altering semantics. After review, the next authorized checkpoint is commit/CI followed by a fresh guarded full-141 staging run. CMS-010 is not COMPLETE. Manual authenticated production UAT remains DEFERRED to the end of the project.
