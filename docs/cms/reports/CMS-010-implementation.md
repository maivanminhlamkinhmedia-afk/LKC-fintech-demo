# IMPLEMENTATION REPORT — CMS-010 Preview

Date: 2026-10-06 (UTC+7). Branch `feature/cms-010-preview`; documentation HEAD `820e791d5f1c81668d5edb71a1d218a400756078`, parent/base main `5cbe3b8e0b456e701f7d9be820b94803546e98b4`. This is an **unstaged local implementation**, not a reviewed, CI-tested, staging-verified or deployed release.

## Design and files

`article-preview-query.ts` re-reads the ACTIVE actor and matching role inside a Serializable transaction, resolves the Article with `AND[id, articleCmsScope(actor)]` before any child query, and constructs a narrow DTO. It uses the real stored editor validator, existing taxonomy terms, `readableMedia`/`managedAsset`, and `safeSourceUrl`. Invalid, missing and foreign IDs share `NOT_FOUND`; unsupported documents have a safe error; unexpected failures log only `CMS_PREVIEW_READ_FAILED`. No mutation method is called. The server page calls `requirePermission('cms:access')` first; its metadata is generic with noindex/nofollow, no article canonical/OG, and `dynamic='force-dynamic'`/`revalidate=0`.

`PreviewRichText` renders the validated v1 JSON as React elements, including nested lists, ordered-list start/type, H2/H3, code whitespace, blockquote, hard breaks, rules and all supported marks. Text is escaped by React. Links are checked again and use safe target/rel/no-referrer. `PreviewCover` uses the same-origin private content route without an optimizer and has an on-error fallback. The preview shows saved timestamp in Asia/Ho_Chi_Minh, public-profile fields only, retained inactive taxonomy, primary instrument and ordered safe source links. Editor and list links use persisted IDs; the editor opens a separate tab and does not call autosave/leave/flush. Existing navigation guard already ignores `_blank` links.

Content paths changed:

| Path | Purpose |
|---|---|
| `src/features/cms/article-preview.ts` | Narrow DTO, labels and fixed-timezone formatting. |
| `src/features/cms/article-preview-query.ts` | Server-only scoped snapshot and safe failures. |
| `src/features/cms/components/PreviewRichText.tsx` | Strict read-only rich document renderer. |
| `src/features/cms/components/PreviewCover.tsx` | Private image and unavailable fallback. |
| `src/features/cms/components/ArticlePreview.tsx` | Read-only article, classification and source view. |
| `src/app/creator/articles/[id]/preview/page.tsx` | Protected dynamic route and private metadata. |
| `src/app/creator/articles/page.tsx` | Readable-article preview link. |
| `src/features/cms/components/ArticleDraftForm.tsx` | New-tab saved-preview link and unsaved-content guidance. |
| `tests/cms-article-preview.test.mjs` | Real query/validator/renderer through synthetic DB adapter. |
| `tests/cms-preview-diagnostics.test.mjs` | Exact allowlisted reporter registry. |
| `tests/e2e/cms-preview.spec.ts` | 19 guarded PREV browser registrations, including PREV-11 hostile metadata/link execution and network observation. |
| `scripts/cms-e2e/diagnostics.mjs` | Exact PREV titles/file/step codes. |
| `tests/README.cms-e2e.md` | v4/141-case runbook checkpoint. |
| `docs/cms/ROADMAP.md` | Local implementation checkpoint only. |
| `docs/cms/reports/CMS-010-implementation.md` | This evidence and handoff. |

No Prisma schema/migration, dependency/lockfile, role/auth policy, autosave/controller, source/classification/media mutation, storage or deploy workflow change. Manifest v4 and all 19 exact cleanup counters remain unchanged. `next.config.ts` still shows a prior status-only `M`: empty content diff and normalized blob `4d0d963d45e57b949a3add6a600832ce14efbce6` equal HEAD. It was not edited, staged or reset.

## Acceptance criteria mapping

`L` = local query/renderer/registry test or build; `B` = registered guarded browser case, **discovery only**; `S` = later full staging gate. A registered case is not a pass.

| AC | Implementation and evidence layer |
|---|---|
| 01 | Protected page + pre-params `requirePermission`; B PREV-01/02. |
| 02 | Scoped parent read; L foreign/missing/invalid and admin/super matrix; B PREV-03/04. |
| 03 | Fresh ACTIVE/role check in transaction; L revoked actor; B PREV-06. |
| 04 | No edit-state gate; L ten statuses × admin/super; B PREV-05. |
| 05 | Narrow selects, parent-first snapshot and no child before scope; L call-order/projection traps. |
| 06 | Saved labels/time, not publication time; L renderer and B PREV-07/08/12. |
| 07 | Public displayName/jobTitle only; L public/non-public projection, B missing-profile fallback. No staging profile fixtures. |
| 08 | Real stored v1 validator and safe unsupported state; L negatives, B PREV-10. |
| 09 | Complete node/mark renderer; L rich schema/SSR, B PREV-09/16/17/20. |
| 10 | React escaping, validated link + safe rel/referrer; L hostile data, B PREV-11 execution/network assertions registered but not run. |
| 11 | Empty document/relations/cover fallback; L renderer, B PREV-07/08/12. |
| 12 | Managed private PNG/JPEG; L managed asset projection, B PREV-13/14/15 + PREV-13-JPEG. |
| 13 | Existing `readableMedia` checks attached foreign uploader vs unrelated; L scope trap, B PREV-13/14/15. |
| 14 | Missing/legacy/load-error fallback, no external URL; L query, B PREV-13/14/15 + PREV-15-LEGACY. |
| 15 | Stored category/topic/tag/instrument/primary and inactive retention; L projection, B PREV-16. |
| 16 | Ordered source projection, safe links/dates, no note/creator; L select trap, B PREV-09/16/17/20. |
| 17 | List link regardless of editability; persisted/new editor distinction; B PREV-17/18. |
| 18 | `_blank` bypasses only existing same-tab dirty guard; no save dispatch added; B PREV-19/17/18. |
| 19 | Preview reads committed DB document; B PREV-19 and saved-content/reload PREV-09/16/17/20. |
| 20 | No query mutations; L write-trap adapter, B Article snapshots PREV-04/05/10/16/21. Relation/asset checks remain S. |
| 21 | Dynamic/no shared cache, generic noindex metadata; B PREV-01/06/22, final cache/revocation evidence S. |
| 22 | Safe error codes and Next `notFound` outside catch; L/B PREV-03/10. |
| 23 | L Chromium static real-renderer/compiled-CSS probe at 390/768/1280; full app/keyboard B PREV-23 and definitive S. |
| 24 | Restricted diff and unchanged 122 baseline registrations; local diff audit. |
| 25 | Focused/full unit gates, lint, TS, Prisma, isolated build/assembly/smoke and discovery below. |
| 26 | Exact 19 PREV registry entries and 141-case side-effect-free discovery; L diagnostics test. |
| 27 | Full 141-case guarded staging + 19 zero counters/VERIFIED: **NOT RUN**, later review/CI checkpoint. |
| 28 | All content UNSTAGED, index empty; Claude review/CI/staging NOT RUN; manual UAT DEFERRED. |

## Scenario-group mapping

| Group | Automated coverage and remaining boundary |
|---|---|
| PREV-01 | B anonymous redirect/marker; RSC/network staging verification pending. |
| PREV-02 | B client/analyst; existing role-matrix unit tests cover all non-CMS roles. |
| PREV-03 | L scope order; B creator own/foreign/missing/invalid. |
| PREV-04 | L any-role/status matrix; B admin/super foreign and owner unchanged. |
| PREV-05 | L ten-status matrix; B ten-status read/no-write loop. |
| PREV-06 | L fresh actor negative; B suspension and owner transfer, restored through allowlisted helper. |
| PREV-07 | L DTO/select/order; B saved title/time/status. |
| PREV-08 | L real query+renderer public/private/missing profiles; B missing fallback only per v4 guard. |
| PREV-09 | L full v1 schema/React matrix; B saved Vietnamese rich text. |
| PREV-10 | L malformed link/heading and version; B version-2 safe state with restore. Existing editor-schema suite covers depth/size. |
| PREV-11 | L hostile text/URL escaping; B `PREV_XSS_NETWORK` now registers real UI save of hostile title/excerpt/source title and external source link, asserts literal text, no injected DOM/script execution or automatic external request on preview and reload. Browser execution remains S. |
| PREV-12 | L empty doc; B empty fixture fallbacks. |
| PREV-13 | B exact private PNG/real JPEG cover read and reload; S execution pending. |
| PREV-14 | B seeded other-uploader attached cover reads, unrelated ID returns 404; S pending. |
| PREV-15 | B legacy no external URL and intercepted image failure; S pending. |
| PREV-16 | L retained inactive/primary DTO; B four assigned kinds, inactive markers, parent snapshot; S pending. |
| PREV-17 | B saved source link/date privacy and list/editor links; S pending. |
| PREV-18 | B new draft has no URL, persisted editor opens a new page; S pending. |
| PREV-19 | B paused autosave dirty input versus committed preview; S pending for full state matrix. |
| PREV-20 | B real saved rich draft then preview reload; existing AUTO baseline retains navigation guards. |
| PREV-21 | L mutation traps; B GET/reload Article snapshots; full relation graph check S. |
| PREV-22 | B private metadata/cache header and revocation; final HTML/RSC inspection S. |
| PREV-23 | L static renderer/compiled CSS Chromium 390/768/1280 with long text/code; B full-app viewport, keyboard/actionability S. |
| PREV-24 | L registry/filter + full gates; full 141-case guarded run/cleanup/provenance S. |

## Local validation and limits

Installed Next 16.2.6 docs read before code: App Router dynamic routes/page, linking/navigation, caching without cacheComponents, data security, authentication, redirect/notFound and metadata guides under `node_modules/next/dist/docs/01-app/`. Node runtime for validation: prepared `node-v22.23.2-win-x64/node.exe`. A temporary ignored `.next/cms010-validation.mjs` launches child processes with only required Windows OS variables and dummy `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `CMS_MEDIA_ROOT`; it does not forward staging credentials. No `.env` was read.

| Gate | Actual command (through filtered Node 22 wrapper unless stated) | Result |
|---|---|
| Focused preview/registry | `node --test tests/cms-article-preview.test.mjs tests/cms-preview-diagnostics.test.mjs` | 7 pass, 0 fail, 0 skip. |
| Full unit/action | `node --test tests/*.test.mjs` | 892 total: 883 pass, 0 fail, 9 OS-specific skip, 0 cancelled. |
| Prisma | `prisma validate`; `prisma generate` via installed CLI | PASS, client 7.8.0; no migration or DB call. |
| Lint | `eslint .` | PASS, 0 errors/0 warnings on final run; initial unused test-adapter variable warning corrected. |
| TypeScript | `tsc --noEmit --incremental false` | PASS on final source/E2E set. |
| Build | `next build` from `.next/cms010-build-820e791-local` allowlisted snapshot | PASS; route shown as dynamic `ƒ`. Existing Next warning about workspace-root/NFT trace from media-storage retained, not a build failure. |
| Assembly/smoke | `assemble-standalone.mjs`; `smoke-standalone.mjs .next/standalone` in same snapshot | PASS: worker=1, codecs=2; PNG smoke, two process lifetimes. |
| Browser layout probe | `node .next/cms010-preview-probe.mjs` on Node 22, Chromium with real `ArticlePreview` SSR + compiled Tailwind CSS | PASS at 390/768/1280: no horizontal overflow, code scroll internal, hostile text remains text. Initial local probe adapter resolution failed and was corrected before PASS. |
| Discovery at original implementation review | `playwright test --list` via safe reporter | 140 = 122 baseline + 18 PREV; browser **NOT RUN**. See PREV-11 post-review delta below for current count. |
| Diff | `git diff --check` plus explicit new-file whitespace/conflict scan | PASS; the new-file scan found no matches. |

The isolated build copies only app/config/worker inputs and two codec packages into a fresh ignored `.next` snapshot; no source/dependency install or production/staging DB was used. Its runtime smoke tests the assembled media worker, not preview browser auth/SQL. The local Chromium probe renders the real article component with compiled CSS from synthetic data, without PortalShell/auth/MariaDB or real private image requests. Local query tests use real authorization helpers, validator, media policy and React renderer with a synthetic transaction adapter; they do not prove MariaDB isolation or HTTP cache behavior. The 19 guarded full-app browser registrations have not executed. Their cleanup remains the existing manifest v4 19-counter gate; no actual fixture/cleanup happened in this task.

Final Git state: 15 content paths above modified/new, all **UNSTAGED**; index empty. `next.config.ts` remains the pre-existing status-only `M` with empty diff and matching normalized blob. The ignored `.next/cms010-build-820e791-local` snapshot and local validation helpers are local-only artifacts, not deliverables or staged files. `git diff --check` emitted only LF→CRLF notices and exited 0. No commit or push occurred.

Claude independent review of the original implementation: **PASS, evidence supplied by PO**. PREV-11 browser delta: **not yet Claude regression-reviewed**. CMS-010 PR CI: **NOT RUN**. Guarded 141-case staging/MariaDB/19-counter cleanup: **NOT RUN**. Manual authenticated production smoke/UAT: **DEFERRED** by PO to project end. CMS-010 is not COMPLETE. CMS-009 test assets/receipt/sentinel remain untouched.

### PREV-11 coverage follow-up after PO-supplied review

The reviewed 18-case set had no PREV-11 browser case. `PREV_SAVED_CONTENT` checked source-note privacy, while `PREV_LEGACY_COVER` checked external requests only for a legacy cover; neither observed execution or requests from hostile preview metadata/link. This was a missing written browser assertion, not a staging failure. The new `PREV_XSS_NETWORK` case creates a synthetic article and source through the real UI, journals both through existing fixture discovery, then checks saved hostile title/excerpt/source title as literal text. It checks the external source link policy, absence of injected elements, a browser execution marker, and attempted requests to the synthetic external host on preview load and reload. The route aborts any attempted request to that host; a request still fails the assertion. No browser case ran locally.

This post-review delta touches the existing six content paths `tests/e2e/cms-preview.spec.ts`, `scripts/cms-e2e/diagnostics.mjs`, `tests/cms-preview-diagnostics.test.mjs`, `tests/README.cms-e2e.md`, `docs/cms/ROADMAP.md`, and this report. The actual checkpoint inventory is five modified content paths and ten new content paths (15 total), plus the pre-existing `next.config.ts` status-only `M`; the PO's 6-modified/9-new split differs, but the total content path set matches this report. The new case and these documentation changes have **not** been reviewed by Claude. All 15 content paths remain UNSTAGED, index empty; no commit/push/PR/CI was attempted.

Focused validation of this delta used the existing filtered/dummy-env wrapper and prepared Node 22.23.2: preview/query/diagnostics tests **7/7 PASS**, focused ESLint **PASS**, TypeScript `--noEmit --incremental false` **PASS**, and Playwright discovery **141 = 122 baseline + 19 PREV PASS** (registration only). `git diff --check` **PASS**. The original full suite/build evidence above was not rerun because this delta adds a guarded browser case and registry/documentation only. Guarded browser/MariaDB/19-counter cleanup **NOT RUN**.

Claude regression handoff: review the PREV-11 test, registry, diagnostics assertion and count/documentation delta before commit. The new case records network attempts without emitting raw URLs or content and aborts only the synthetic external host. It does not weaken the existing guard/cleanup. Staging after review/CI must run the full 141 cases on the reviewed head with fresh runId/BUILD_ID, exit 0, VERIFIED and all 19 counters zero.

### PREV-11 source-region selector correction after Claude finding

Claude regression review found that `#preview-sources` identifies the `<h2>`, not its enclosing `<section aria-labelledby="preview-sources">`. Thus `#preview-sources script, #preview-sources img` could return zero even if injected nodes existed in the source list. The product component already exposes the section as the accessible region named “Nguồn tham khảo”; no product markup was changed. In `tests/e2e/cms-preview.spec.ts`, PREV-11 now requires exactly one visible named region and the exact hostile source-title link inside it before asserting `region.locator('script, img')` has zero matches. It retains the separate header assertion and repeats region/link/header/injected-node checks after reload. Execution marker, request-attempt counter, UI payload creation, journaling and other assertions remain in place.

An isolated local Chromium probe rendered the real `ArticlePreview` component with synthetic data. It found one named region and its exact hostile link. A synthetic negative control then appended one inert `script` and one `img` without a URL into that region: the corrected locator found **2**, while the old heading-descendant locator still found **0**. No external request was observed. This proves selector targeting against the component DOM in this local setup; it is **not** an execution of the guarded staging case or evidence about MariaDB/Next hydration. The probe lives only in ignored `.next/cms010-selector-probe.mjs` and is not a deliverable.

Prepared Node 22.23.2 with filtered dummy environment: local selector probe **PASS**; focused preview/registry tests **7/7 PASS**; focused ESLint **PASS**; TypeScript `--noEmit --incremental false` **PASS**; Playwright discovery **141 = 122+19 PASS** (registration only); `git diff --check` and explicit whitespace/conflict-marker scan of the two untracked files **PASS**. Full suite/build and browser staging were not rerun for this selector-only correction. The correction changes exactly two deliverable paths in this turn: `tests/e2e/cms-preview.spec.ts` and this report. Both remain **UNSTAGED** with the rest of the implementation for Claude regression review; index empty. `next.config.ts` remains the pre-existing status-only `M` with content blob equal to HEAD. CMS-010 CI/staging are **NOT RUN**; manual authenticated production UAT remains **DEFERRED**.
