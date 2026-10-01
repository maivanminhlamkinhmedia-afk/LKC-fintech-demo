# CMS-009 — local follow-up for MED-08/11, MED-23-COVER and MED-26

Checkpoint: `feature/cms-009-media-library` at `4336ba764f818df2b1194876741fc78b727c0c47`. This is an unstaged local delta for Claude independent review. No product source, schema, dependency, timeout, retry, fixture cleanup policy or storage adapter was changed.

## Evidence boundaries and conclusions

The staging run was **operator-launched and Claude-verified, as supplied by the Product Owner**: runId `68d3a3f5573aa535affdbea2`, BUILD_ID `1NrFukJu_KLI3l5rHCMsl`, 119 passed / 2 failed / 1 timedOut of 122, exit 1, no `CMS_E2E VERIFIED`; all 90 baseline cases passed and all 19 cleanup counters were zero. The UTF-16LE log in the QA checkout was read only and parsed for allowlisted `CMS_E2E` records. Neither the QA checkout nor its artifacts were changed.

| Case | Staging evidence | Local finding | Conclusion |
| --- | --- | --- | --- |
| MED-23-COVER | Failed assertion at old line 862 after the lost-ACK commit and DB/preserved-field checks had passed. | Real `ArticleCoverPanel` mounted from a synthetic committed cover snapshot: current-cover radio **exists and is checked**, no-cover radio is unchecked, while the old `data-media-id` locator has count 0. | **CONFIRMED test locator mismatch.** Search results start empty on reload; only result radios have `data-media-id`. The post-reload assertion now checks the named current-cover radio and the no-cover radio. The DB, lost-ACK dispatch and preserved-field assertions remain. |
| MED-26 | Failed inside `MED_LEGACY_MEDIA` after preceding assertions; the diagnostic did not provide an exact exception/location. | Real `attachLegacyCoverFixture` with an in-memory DB and synthetic private root rejects the already covered creator DRAFT (`MEDIA_LEGACY_COVER_INVALID`) and accepts the separate, initially uncovered `other-draft` owned by the `other` CREATOR. The previous cover remains untouched. | **CONFIRMED cross-test precondition defect locally;** the exact staging exception is unobserved. MED-23 intentionally leaves its cover attached, while MED-26 reused its article. The test now creates the legacy row for `other`, logs in as `other`, and uses `other-draft` throughout. Helper null-cover, ownership, Serializable CAS, journal and graph checks remain. |
| MED-08/11 | Creator upload/DB check passed. `MED_SCOPE_OTHER` started at test offset 7,539 ms and failed after 52,518 ms; `MED_SCOPE_SEARCH` failed at about 60,048 ms and CASE timed out. Only one nested assertion was recorded before the gap. | The old registry did not distinguish login, media navigation, query fill, search click, hidden-asset assertion or protected GET. Local reporter/filter regression confirms new fixed phases survive the safe output path only for this exact case. | **UNDETERMINED underlying slow await.** New controlled steps and observations expose phase, duration/status and the GET HTTP status. They retain the real actions, 404/visibility assertions, 60-second test budget, 10-second expect budget and failure propagation. No root cause is assigned to `MEDIA_BUSY`; the successful creator upload in this run contradicts that diagnosis for this occurrence. |

The local helper probe uses the real manifest validator, fixture preflight, `attachLegacyCoverFixture`, graph recovery and conditional `article.updateMany`; its DB is an in-memory adapter and its private root is synthetic scratch. It does not prove a MariaDB transaction or production filesystem behavior. The Chromium probe uses the real React component and installed browser with synthetic props/actions over loopback; it does not log in or save to a DB. No browser staging case was rerun.

## Diff and diagnostic policy

- `tests/e2e/cms-media.spec.ts`: correct MED-23 reload assertion; give MED-26 an isolated owned draft/legacy asset; split MED-08/11 other/admin operations into fixed observed phases. The other actor's GET still asserts 404 and records the returned numeric status.
- `scripts/cms-e2e/diagnostics.mjs`: allowlist the new phases only for MED-08/11. Existing exact-key validation rejects raw URL, query, body, cookie, stack, unexpected status and nonallowlisted error code.
- `tests/cms-e2e-diagnostics.test.mjs`: reporter/filter and rejection regression for the new phase/status schema.
- `tests/cms-e2e-taxonomy-harness.test.mjs`: real-helper synthetic regression for the covered predecessor and isolated `other-draft` paths.
- `tests/browser-local/cms-media-cover-reload.mjs`: loopback-only real-component regression proving the absent old locator versus checked current-cover radio.
- `tests/README.cms-e2e.md`: explain historical staging failure and interpretation of new phase records.
- This report records evidence, limits and validation.

Only fixed codes, timing, status, numeric HTTP status and an actually observed allowlisted safe error code may enter media diagnostics. The new scope observations set `errorCode: null` because these operations do not expose such a code. `httpStatus: 0` means no status was observed. The reporter/filter regression confirms both allowlisting and denial of extra fields. A started phase without a passed/failed finish does not by itself identify an application defect.

## Local validation

All subprocesses used Node **22.23.2** via the existing filtered wrapper, dummy DB/auth values, `.env` read guard and blocked DB ports 3306/3307; no staging credential was inherited. Outputs are under ignored `.next/cms006-local-20260926-05e7d1/`.

| Check | Result |
| --- | --- |
| Real component probe before/after assertion update | PASS; old locator count 0, current-cover checked, no-cover unchecked, no page error; Chromium 153.0.8010.12. |
| Focused diagnostics + fixture harness | **50/50 PASS**, 0 failed/skipped. |
| Full unit/action suite | **845/845 PASS**, 0 failed/skipped. |
| ESLint | PASS. |
| TypeScript `--noEmit --incremental false` | PASS. |
| Playwright discovery | **122** cases, PASS; discovery does not execute browsers. |
| `git diff --check` and new-file whitespace/conflict scan | PASS. |

`next.config.ts` remains status-only `M`: its working content normalizes to the same Git blob as HEAD; it was neither reset nor edited. Index remains empty. Claude delta review, CI and guarded staging of this patch are **NOT RUN**. Staging must demonstrate MED-08/11, MED-23-COVER and MED-26 on the new reviewed commit plus all suite/provenance and 19-counter cleanup gates before CMS-009 can progress. CMS-009 is **NOT COMPLETE**; manual authenticated production UAT remains **DEFERRED** by Product Owner decision.
