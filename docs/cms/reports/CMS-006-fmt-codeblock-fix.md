# CMS-006 — FMT_DB code-block input fix

Date: 2026-09-26. Branch: `feature/cms-006-autosave`.
Starting/current HEAD: `aaa2ae8b8cff98f706f82ad99f37986af1a6d47b`.
Preflight: correct workspace/branch/HEAD, clean working tree and empty index.

## Finding and evidence boundary

**ROOT CAUSE: CONFIRMED locally — the test sends keyboard input before the
toolbar's asynchronous return of focus to the editor.** The actual application
component reproduces the missing code prefix with the original test sequence.
No application change is needed for this confirmed test synchronization defect.

The exact stored value/event sequence in the supplied staging failure remains
unobserved: its report did not contain actual `contentText`. Local reproduction
identifies a concrete cause of the same failed assertion; it is not a claim that
Codex inspected that staging row or reran staging successfully.

### Staging evidence supplied by the Product Owner

- Commit: `aaa2ae8b8cff98f706f82ad99f37986af1a6d47b`; draft PR #21, CI PASS.
- runId: `672ceb2723f2ff0025970be4`.
- 35 passed / 1 failed / 0 skipped: all 16 AUTO cases (including AUTO-21) PASS,
  19/20 EDIT PASS.
- EDIT-04/05/06/21 passed `FMT_SAVE_NAVIGATE`, then failed `FMT_DB` at the
  `contentText` assertion for `const tiếngViệt = "an toàn";` (original line 142).
  Earlier assertions in that step passed; the actual stored text is unavailable.
- Cleanup articles/profiles/users/logs = 0/0/0/0; app stopped, lock released,
  working tree clean. These do not establish the cause or correctness of input.
- No new staging run was performed in this task. AUTO-21 was not reinvestigated
  or modified.

## Local reproduction and source trace

`tests/browser-local/cms-fmt-codeblock.mjs` mounts the **unchanged ArticleEditor**
using installed React, TipTap, the application's `createEditorExtensions()` and
the actual toolbar handler. Installed Next's webpack and TypeScript bundle only
that component into an ignored directory; this does not build/start the CMS.
The component's CSS is included with its `:global(...)` selectors unwrapped and
the local `editor` class preserved. The full form, routing, auth, Tailwind layout,
Server Actions and database are not mounted.

The input sequence uses the original keyboard operations: fill the Vietnamese
paragraph, select/bold, append the list, click “Khối mã”, then type the complete
two-line code string using `page.keyboard.type()`. No `setContent`, injected JSON,
forced focus, fabricated keyboard event or sleep replaces these operations.
Fresh browser contexts use synthetic content and allow only their own ephemeral
loopback origin; service workers are blocked. No existing profile/account is used.

The probe records active element, ProseMirror focus/selection parent/anchor,
DOM selection parent, first key and toolbar/focus events. Timings below are Node
`performance.now()` elapsed times at event receipt, not the mocked browser clock;
binding delivery overhead means they are observations, not precise browser
execution timestamps.

Installed source explains the observed order:

- `ArticleEditor.tsx` runs `editor.chain().focus().toggleCodeBlock().run()` from
  a normal toolbar button's `onClick`.
- `node_modules/@tiptap/core/src/commands/focus.ts` schedules `view.focus()` in
  `requestAnimationFrame` on desktop Chromium (lines 61–69).
- Installed Playwright's `keyboard.type()` sends characters to current focus.
  Completing a locator click does not wait for that application RAF callback.
- `page.clock.install()` replaces RAF as well as timers. The original login
  helper installs a flowing clock; it does not pause this new-article case.

### Natural timing, before the fix

No RAF hold, clock pause, artificial delay or throttling was used for the native
and installed/flowing comparisons. In the initial observation and final regression
run, the original sequence retained code in 5/5 native-clock trials but lost it in
4/5 installed-clock trials. These are observations, not statistical guarantees.

Representative installed-clock baseline from `fmt-regression-final.log`:

| Node elapsed | Observation |
|---|---|
| 47 ms | Button focused; editor not focused |
| 48 ms | Physical toolbar click; selection still at the preceding paragraph |
| 57 ms | Playwright click promise fulfilled |
| 59 ms | First key `c` delivered while active element is BUTTON; PM selection already codeBlock |
| 67 ms | A second toolbar click during keyboard typing, from Space activating the still-focused button |
| 75 ms | Editor receives focus; selection parent now paragraph |

The resulting DOM has no `pre code`; JSON already contains paragraph text
`ếngViệt = "an toàn";` followed by `console.log(tiếngViệt)`. The validator derives
that same incomplete text. Vietnamese paragraph/list text and bold/bulletList
marks/nodes remain, reproducing the earlier passing checks and missing code-prefix
assertion locally. Loss occurs **before `getJSON()`**, not during persistence.

### Transport/validation comparison

The probe independently reads `editor.getJSON()` and the browser's
`JSON.stringify(editor.getJSON())` output, parses the trusted output on Node and
calls the application's actual strict `validateEditorDocument()`. JSON equality
holds before/after canonical validation; the validator neither loses nor repairs
the missing prefix. In patched cases, DOM code text and derived `contentText`
contain the exact two-line code string, including newline and Vietnamese.

Source inspection follows create form `getJSON()` → trusted JSON clone →
`createArticleDraft` → `normalizeCreateDraftInput` → `validateEditorDocument` →
explicit canonical JSON/text write fields. Body strings are not passed through
slug transliteration. `textBetween()` generates `contentText` from the validated
document. Existing tests additionally exercise the actual installed Next Flight
codecs with this exact Unicode/code-block string, both transport directions and
strict rejection cases; these were rerun, not replaced by a mocked codec.

## Minimal fix and preserved requirements

Only `FMT_CODE_BLOCK` in `tests/e2e/cms-draft.spec.ts` changes:

1. Preserve the exact two-line literal in a local `code` constant.
2. Click the same real toolbar button.
3. Assert the editor **has received focus**, then assert its `pre` block is visible.
   These checks do not call `.focus()` or change selection. A toolbar that never
   restores focus fails the test. The `pre` wrapper is checked because an empty
   inline `code` element may have zero width before typing.
4. Type the same string through `page.keyboard.type()`.
5. Assert exact `pre code.textContent` before Save, including the newline. A future
   input mismatch fails at `FMT_CODE_BLOCK` instead of first becoming visible in DB.

All existing `FMT_NO_WRITE`, Save/navigation, DB, reload, bold/list/code, article
list and dashboard assertions are unchanged. No timeout/retry/skip adjustment,
assertion removal, native-paste change, diagnostics expansion or helper change.
App source, AUTO-21, RBAC, concurrency, validation, guards, schema, migrations and
dependencies are untouched.

## Regression and validation

The retained probe extracts and executes the actual `FMT_CODE_BLOCK` callback
from the spec using TypeScript's AST; it does not import/run staging hooks. It
compares that callback with the original two-operation baseline.

| Mode in final probe run | Baseline exact code | Patched exact code |
|---|---:|---:|
| Native clock, no timing intervention | 5/5 | 5/5 |
| Installed, flowing clock, no timing intervention | 1/5 (4 reproduced failures) | 5/5 |
| Controlled paused-frame comparison | 0/1 (expected failure reproduced) | 1/1 |

The last row explicitly intervenes: after paragraph/list entry, pause the browser
clock, then release a 16 ms frame after baseline typing or after observing the
patched operation still waiting. This is not the original staging timing. In the
patched trial, at 126 ms editor focus was false and key count zero; after releasing
the frame, focus arrived at 130 ms and the first `c` at 161 ms with codeBlock
selection and DOM anchor PRE. No imperative focus is used. The baseline's first
`c` reached BUTTON at 72 ms and its exact code assertion would fail. Every patched
operation is awaited, including failure paths; no abandoned Promise.race.

Final probe: exit 0, **22 comparisons completed**: 11 patched successes,
10 natural baseline observations and one asserted baseline failure reproduction.
Do not report these as 22 successful CMS E2E cases. Page JavaScript errors: none.

Runtime: Node **22.23.2**, Playwright **1.63.0**, Chromium **153.0.8010.12**,
TipTap **3.31.3**. No package/browser install.

Prepared executable used:

```text
C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe
```

All Node commands below run through the existing ignored
`.next/cms006-local-20260926-05e7d1/run.cjs` wrapper: OS-variable allowlist only,
dummy DB/auth configuration, dotenv path `NUL`, credential variables omitted,
`.env*` read blocking and DB-port blocking. No inherited staging DATABASE_URL.
`$Node22` refers to the executable above; `$Runner` is
`.next/cms006-local-20260926-05e7d1/run.cjs`. Paths are relative to the repo root.

| Command | Result |
|---|---|
| `& $Node22 $Runner fmt-regression-final tests/browser-local/cms-fmt-codeblock.mjs` | PASS comparison/regression, exit 0; results above |
| `& $Node22 $Runner fmt-focused --test tests/cms-editor-flight.test.mjs tests/cms-article-draft-validation.test.mjs` | PASS: 26 tests, 0 failed, 0 skipped |
| `& $Node22 $Runner fmt-lint-final npm run lint` | PASS |
| `& $Node22 $Runner fmt-typescript-final node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| `& $Node22 $Runner fmt-discovery-final npm run test:e2e:list` | PASS discovery: 36 cases; not staging/browser execution |
| `git diff --check` plus new-file whitespace/conflict-marker checks | PASS |

An initial probe setup attempt failed on a non-exported TipTap `package.json`
subpath; the probe now reads its known local package metadata path. An intermediate
patch checked empty `pre code` visibility and failed locally on its zero-width
box; the final patch correctly checks `pre` visibility and exact code text after
typing. Neither attempt was counted as passing evidence. Final log/bundle artifacts
remain ignored under `.next/`; they are not part of the handoff diff.

Full unit suite, Prisma validate/generate and production build: **NOT RUN this
round**. No application/dependency/schema changes require those broader gates;
the focused validator/Flight tests and test-code gates cover this diff. Existing
CI PASS belongs to the old committed tree, not this uncommitted patch.

## Files, review and pending work

| File | Purpose |
|---|---|
| `tests/e2e/cms-draft.spec.ts` | Observe focus/block readiness and verify exact code before Save |
| `tests/browser-local/cms-fmt-codeblock.mjs` | Repeatable real-component local before/after reproduction |
| `docs/cms/reports/CMS-006-fmt-codeblock-fix.md` | Evidence, limits and handoff |

Claude independent review: **NOT RUN**. New-patch CI: **NOT RUN**. New-patch
staging: **NOT RUN / PENDING**. Review should check the observed event order,
real-component probe fidelity/controlled timing distinction, exact pre-save check,
and unchanged DB/reload assertions. After review and CI, staging must still verify
all 36 cases on the new commit with fresh provenance and verified cleanup.

Final handoff has only these three files modified/untracked, all **UNSTAGED**;
index empty, HEAD unchanged. Exact status:

```text
 M tests/e2e/cms-draft.spec.ts
?? docs/cms/reports/CMS-006-fmt-codeblock-fix.md
?? tests/browser-local/cms-fmt-codeblock.mjs
```

No commit/push/merge/deploy, SSH, DB, fixtures,
cleanup or migration. No `.env`/secret read. **CMS-006 is not COMPLETE**.
CMS-005 authenticated production smoke remains **DEFERRED**.
