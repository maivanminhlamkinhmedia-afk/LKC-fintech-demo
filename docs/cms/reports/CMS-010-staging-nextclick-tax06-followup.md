# CMS-010 guarded staging: PREV-17/18 pagination and TAX-06 follow-up

## Provenance and verdict

Implementation branch `feature/cms-010-preview` remains at `0dc1ccdf0bd30cc199ae6a27c6e2077a6672a248` (parent `109c6816afe54bd87a0bf7896070d7eba4804c38`). The Product Owner supplied the guarded staging result; Codex read the QA checkout and log without running the staging runner or querying its database. The UTF-16LE log is `D:\lkc_phase1_rbac_patch\cms009-qa-checkout-23488bd6\.next\cms010-staging-logs\run-20261007-125816-b8e53eacd12b46f7b3d4b575c6f00694.log`. Its manifest and build metadata identify runId `002dede7cfee1f82c0d9d22a`, BUILD_ID `bQKr7HimTMz6c_paOWP4p`, and the exact implementation commit above.

The run had 141 registered cases: 139 passed, 1 failed, 1 timedOut, 0 skipped and 0 interrupted. EDIT 20/20, AUTO 16/16, SRC 19/19 and MED 32/32 passed; TAX 34/35 passed with TAX-06 failed; PREV 18/19 passed with PREV-17/18 timedOut. PREV-13/14/15 passed, including the earlier PreviewCover fix. The final markers were `CMS_E2E RESULT {"status":"failed"}`, `CMS_E2E STOP BROWSER_SUITE_FAILED`, and `CMS010_QA_EXIT_CODE=1`; there is no `CMS_E2E VERIFIED`. All 19 guarded cleanup counters were zero. Those final counters do not establish the Article or catalog state at the failing assertion.

| Case | First failing location / phase | Staging observation | Root-cause status |
| --- | --- | --- | --- |
| PREV-17/18 | Sixth `PREV_SUBMITTED_LIST_NEXT_CLICK` in `findListPreview`; case `timedOut` | The own-list and submitted-list navigation passed. Five earlier NEXT_CLICK steps passed, but the log does not record page number, link destination or whether those clicks advanced the list. | **CONFIRMED locally:** the helper can click a stale Next link repeatedly before Next navigation settles. This matches a plausible path to the staging timeout; the exact sixth-click staging cause remains **UNDETERMINED** without page/network state. |
| TAX-06 | `TAX_CATALOG_TOKEN`, `tests/e2e/cms-taxonomy.spec.ts:238:83`; case `failed` | The no-op and winner steps had reached the persisted `future + 1 ms` token assertion. The losing `EDIT_CONFLICT` element was not visible within the assertion. The log does not show the losing POST, HTTP response, alternate error, or browser state. | **UNDETERMINED.** Neither a product defect nor a test/environment race is established. |

TAX-06 passed in the previous guarded run at `109c6816...`; this single new failure is not labelled flaky or attributed to CMS-010. The earlier failed runs remain historical failures.

## PREV-17/18: local reproduction and change

The real list page renders a Next `<Link>` to `/creator/articles?page=N` and the navigation label `Trang N / total`; `getArticleDraftList` scopes to the actor and orders `updatedAt`, then `id`, with 20 rows per page. The manifest identifies SUBMITTED as creator-owned and submitted at fixture creation, but the staging log has no point-in-time read after preceding mutations. Source inspection did not identify a direct earlier mutation of that fixture; that is not a DB-state proof.

An isolated Next 16.2.6 production build on loopback used real Next links and Chromium, 7 synthetic pages with 20 links each, the target on page 6, and a controlled 180 ms server delay. Browser clock was installed as in the E2E login helper. No CMS authentication, real data, external request or database was used. Before the change, the original click-then-count algorithm issued six clicks while the displayed page still read 1 and the link still targeted page 2; click completion preceded page progression. With the explicit destination and progression checks, the same probe advanced pages 1→2→3→4→5→6 and found the target. A second run after the change used the same URL polling form as the patch: the baseline repeated stale-page clicks; the controlled path reached page 6. This reproduces a helper race under controlled conditions, not the precise staging browser failure.

`findListPreview` now verifies the Next link points to the expected subsequent page, performs the ordinary click, then waits with the existing expect budget for both URL page and the rendered pagination label to advance before searching again. It never accepts an arbitrary/stale page. Two fixed diagnostic phase codes distinguish target, click and progression without emitting Article IDs or URLs. The exact preview identity, visibility and no-edit checks remain, as do the 60-second case timeout, 10-second expect timeout and 50-page bound. No product list/query code changed, and no force click, retry, sleep or navigation opt-out was added.

## TAX-06: evidence boundary and targeted diagnostics

TAX-06 uses seed topic 3, whereas earlier TAX-03 uses seed 2 and TAX-05 creates an instrument. The case explicitly sets the topic token one hour in the future, opens admin and super forms, verifies a no-op did not write, holds the winner's real response, and confirms the winner persisted exactly `future + 1 ms` before clicking the stale super form. The action validates the expected token in a Serializable transaction and returns `EDIT_CONFLICT` for a mismatch; the panel displays safe failures in a `data-error-code` alert. Focused synthetic action/panel tests still pass. Those tests cannot reproduce the live browser, transport or MariaDB timing, so no product change is justified from this evidence.

Only TAX-06 gains fixed nested phases around the existing losing action: click, observed action POST, response arrival, HTTP 200, any safe error element, then the unchanged `EDIT_CONFLICT` visibility assertion. The observer matches the public action identity and path; the temporary response listener is attached before the click and removed in `finally`. No response body, catalog ID, URL, SQL, session data or alternate error text enters diagnostics. Registry tests ensure these codes are accepted only for TAX-06 and reject raw fields. The existing losing-input, disabled-save, winner-release and subsequent-token assertions remain. A later guarded run can locate the failing boundary; these diagnostics are **not** a TAX-06 fix or a claim that staging will pass.

## Validation and handoff

Validation used the prepared Node 22.23.2 subprocess wrapper with a filtered environment, dummy database/auth values and no live connection. The isolated loopback Next/Chromium probe used synthetic content only. The QA checkout and its artifacts remained read-only.

| Check | Result |
| --- | --- |
| Focused preview/diagnostics, taxonomy actions/panel/browser-support, article-list query tests | 102 passed, 0 failed/skipped/cancelled |
| Focused ESLint for the six changed code/test paths | PASS |
| `tsc --noEmit --incremental false` | PASS |
| Playwright `--list` | 141 registered = 122 baseline + 19 PREV; browser cases **NOT RUN** locally |
| Isolated real-Next/Chromium pagination probe | Baseline stale-page race reproduced; controlled progression to page 6 and target PASS. Synthetic route, no CMS/DB. |
| `git diff --check` | PASS |
| Full unit suite, application build, CI, new guarded staging | **NOT RUN**; no product or dependency graph changed |

The six changed code/test files, plus this new report, are **UNSTAGED** for Claude independent review. Git-normalized content fingerprints taken before handoff (local integrity only, not historical Claude hashes):

| Path | Git blob |
| --- | --- |
| `tests/e2e/cms-preview.spec.ts` | `e2aba007129679ed723a62ccc5cf0da900a131bc` |
| `tests/e2e/cms-taxonomy.spec.ts` | `e784e61edf374010657634c1397cc7d6c941213d` |
| `scripts/cms-e2e/diagnostics.mjs` | `088e70cbae53a5b5403110ef6ad5796ae734e301` |
| `scripts/cms-e2e/taxonomy-diagnostics.mjs` | `1487bc877647267886c2317e81cefee117e9a944` |
| `tests/cms-preview-diagnostics.test.mjs` | `e1dba81b03961f21684287e7baac03b361ee9b27` |
| `tests/cms-e2e-diagnostics.test.mjs` | `4a97e6cc9c870d339bb88f4823119664ce479466` |

The report's own blob is omitted to avoid a self-referential fingerprint. `next.config.ts` remains the pre-existing status-only `M`: its diff is empty and Git-normalized blob equals HEAD (`4d0d963d45e57b949a3add6a600832ce14efbce6`). The index remains empty. No commit, push, PR update, CI dispatch, staging rerun, SSH, real DB operation, fixture cleanup, merge or deploy occurred.

Claude should review whether the PREV page-progress checks correctly track the production list and whether the TAX-06 phases discriminate the next failure without affecting the held-winner scenario. After review: commit/CI on the reviewed diff, then one fresh guarded full-141 staging run. CMS-010 is not COMPLETE; manual authenticated production UAT remains DEFERRED to the end of the project.
