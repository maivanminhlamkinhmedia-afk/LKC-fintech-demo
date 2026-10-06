# CMS-009 journal diagnostic transport — local delta handoff

## Finding and evidence boundary

On HEAD `877d2756723242cafaca482f2fb42b6ea606c55f`, the Product Owner supplied operator-launched, Claude-monitored staging run `b26503ba9d5b518891a1c933` (BUILD_ID `0v801fNZKwy2XfMAbLGtz`): 120 passed, MED-21 failed, MED-08/11 timed out, exit 1, no `CMS_E2E VERIFIED`, and 19 cleanup counters zero. That staging run predates both local deltas. It remains a failure; neither MED-21's exception phase/errno nor a post-fix MED-08/11 result is known.

Claude's follow-up finding is confirmed by source inspection. The prior local product delta made `advanceMediaOperation` emit an exact `CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=... errno=...` marker through `console.error`. In `scripts/cms-e2e/run.mjs`, `launch()` immediately resumed and discarded the app's stderr. The existing `createDiagnosticOutputFilter` only received Playwright stdout, so the app marker had no route to the guarded operator log. The earlier [layout/journal report](CMS-009-staging-layout-journal-followup.md) now explicitly limits its emission claim; it had not proved transport. This report adds **local transport evidence**, not staging evidence or an attribution to MED-21.

## Minimal transport

`run.mjs` now uses `launchApp()` only for the app process. It attaches a private stderr listener and bounded parser synchronously after `spawn`, before stderr is resumed. Build stderr remains discarded, as do Playwright stderr and all nonmatching app stderr. The actual runner writes only the canonical line `CMS_E2E APP_JOURNAL phase=<phase> errno=<errno>` to its stdout, where the operator log captures runner output. No case ID or operation ID is inferred from this app-wide source.

The accepted producer line is the **entire** `CMS_MEDIA_JOURNAL_ADVANCE_FAILED phase=<phase> errno=<errno>` line. Phase is exactly `open`, `write`, `sync`, `close` or `rename`; errno is exactly `EACCES`, `EPERM`, `EEXIST`, `ENOENT`, `EBUSY`, `EIO`, `ENOSPC`, `EMFILE` or the producer's `OTHER` fallback. An extra prefix/suffix, extra field, control/ANSI character, unrecognized value or line over 128 characters is discarded. The parser handles split UTF-8 chunks, multiple lines in a chunk and LF/CRLF. It accepts a final exact marker without a newline once on stream end; invalid or oversized tails are dropped. `CMS_E2E CASE`, `RESULT`, `CLEANUP`, `VERIFIED` and `STOP` text on app stderr cannot pass this parser.

The output callback and stderr stream each have a fail-closed path: a callback exception or stream error disables only this diagnostic filter while the pipe continues to drain. Child exit, Playwright result, fixture cleanup, VERIFIED and STOP rules are unchanged. The forwarded marker does not prove DB commit/rollback, trigger recovery/resend, alter public upload errors or resolve whether historical MED-14-COVER and MED-21 shared a cause.

## Reproduction and validation

The new regression invokes **the same exported `launchApp()` used by `run.mjs`**, with a synthetic local child. That child sends raw synthetic private text to stdout/stderr, an exact marker split across writes, two more exact markers, near-matches and a forged VERIFIED line; it exits with code 23. The parent runner output contained exactly the three canonical `APP_JOURNAL` lines in order plus its explicit `CHILD_EXIT 23`; no synthetic private text escaped. This proves producer-shaped child stderr → launcher/filter → runner stdout locally. Separate parser tests exercise all 5×9 phase/errno combinations, CRLF, an unterminated final record, oversize recovery, hostile fields/control characters and diagnostic-writer failure. The initial new-test run failed because the helper did not yet exist; after implementation the focused 56/56 tests passed. A later test-only assertion had to account for Node's existing TypeScript module warning on the synthetic wrapper's own stderr; it still asserts no child payload appears there.

All validation used prepared Node **v22.23.2** through the existing filtered dummy environment, `.env` read guard and blocked DB ports:

| Check | Actual result |
| --- | --- |
| Focused transport, diagnostic and harness tests | **56/56 PASS** before the final allowlist test addition; final full suite below includes that addition |
| Full unit/action suite | **854/854 PASS**, 0 failed/skipped/cancelled |
| ESLint | **PASS** |
| TypeScript `--noEmit --incremental false` | **PASS** |
| Playwright discovery | **122 cases**, PASS; browser staging **NOT RUN** |
| `git diff --check` and new-file whitespace/conflict scan | **PASS** |

The earlier isolated production build and media smoke were already PASS for the unchanged product files. This delta changes only the guarded runner, its parser, tests and documentation, so neither build nor standalone smoke was repeated. No real DB, staging, SSH, fixture cleanup, CI, commit or push ran.

## File integrity and review scope

Before this delta, Git-normalized fingerprints of the nine reviewed content paths were:

| Path | Before hash | Delta |
| --- | --- | --- |
| `scripts/cms-e2e/media-search-observation.ts` | `729fb1d050acdfaa4fe9aa27f59ffb01dce2168e` | unchanged |
| `src/features/cms/media-storage.ts` | `94198ba163889f8c46db0c7203a77145244155eb` | unchanged |
| `src/features/landing/components/FloatingContact.tsx` | `c189a0eec0ca2c4581e33ba3bcfcebfd69926445` | unchanged |
| `tests/README.cms-e2e.md` | `be676fb26ac4fb33c6355a8f8b806350af6ae44d` | prose updated |
| `tests/cms-e2e-diagnostics.test.mjs` | `178711d9bbc5b132e011528ae92b816f1cf86b62` | unchanged |
| `docs/cms/reports/CMS-009-staging-layout-journal-followup.md` | `a2c8a19830cefa15f13be676870dfaa005c4bf93` | transport claim corrected |
| `tests/browser-local/cms-media-journal-windows.mjs` | `881bbf34213654171aae722de40f26a33a3a7622` | unchanged |
| `tests/browser-local/cms-media-search-layout.mjs` | `02707674eddbfd9485ddca716edc206837aa6d2a` | unchanged |
| `tests/browser-local/cms-media-search-signals.mjs` | `fc3f2800c33effda5f3277da306a09e190d7f5ae` | unchanged |

After the prose correction, the Git-normalized hashes of the two intentionally changed prior paths are `5166f80eefb4b5776f59407955225e87d1745989` for the README and `ef4be765d017754d8fcaab55e2b44faa7bba54d4` for the prior report. The other seven prior hashes remain equal to the table above.

The **supplemental delta is six paths**: new `scripts/cms-e2e/app-journal-output.mjs`, modified `scripts/cms-e2e/run.mjs`, new `tests/cms-app-journal-output.test.mjs`, updated `tests/README.cms-e2e.md`, corrected prior report, and this new report. The full combined **13-path content inventory** is:

1. `scripts/cms-e2e/media-search-observation.ts`
2. `scripts/cms-e2e/run.mjs`
3. `scripts/cms-e2e/app-journal-output.mjs`
4. `src/features/cms/media-storage.ts`
5. `src/features/landing/components/FloatingContact.tsx`
6. `tests/README.cms-e2e.md`
7. `tests/cms-e2e-diagnostics.test.mjs`
8. `tests/cms-app-journal-output.test.mjs`
9. `tests/browser-local/cms-media-journal-windows.mjs`
10. `tests/browser-local/cms-media-search-layout.mjs`
11. `tests/browser-local/cms-media-search-signals.mjs`
12. `docs/cms/reports/CMS-009-staging-layout-journal-followup.md`
13. `docs/cms/reports/CMS-009-journal-output-transport.md`

All 13 are UNSTAGED. `next.config.ts` is a separate preexisting status-only `M` with empty diff and a Git-normalized blob equal to HEAD. The earlier LOW finding on keyboard coverage remains open and outside this transport change.

Claude delta review should inspect the exact line parser, early `launchApp()` wiring, fail-closed stream behavior and subprocess proof. CI and guarded staging for this combined diff are **NOT RUN**. MED-21 remains **UNDETERMINED**; MED-08/11 has a local layout fix but no post-fix staging result. CMS-009 is **NOT COMPLETE**. Manual authenticated production UAT remains **DEFERRED**, and production storage provisioning/ACL/proxy/backup/persistence release gates remain open.
