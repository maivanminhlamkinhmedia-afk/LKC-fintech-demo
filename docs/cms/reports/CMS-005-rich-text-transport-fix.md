# CMS-005 — Rich-text Server Action transport fix

Date: 2026-09-25. **ROOT CAUSE: CONFIRMED by local reproduction.**
CMS-005 remains **NOT COMPLETE**. This report covers the uncommitted local fix;
Claude independent review, CI and staging verification of this fix are pending.

## Baseline and evidence boundaries

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Workspace: `D:\lkc_phase1_rbac_patch\LKC-fintech-demo`.
- Branch: `feature/cms-005-draft-editor-tiptap`.
- HEAD before and after the fix: `8e19a8f1d6176858b0aa41e082a0807e568c400b`.
- Preflight matched the requested repository, branch and HEAD; the working tree
  was clean. No reset, clean, stash, branch switch or overwrite was used.
- Read AGENTS.md, ROADMAP, CMS-005 spec and implementation guidance, the existing
  implementation and staging diagnostics reports, the editor/form/validator/
  action/query paths, both affected browser specs, and the installed Next.js
  Server/Client Components, Mutating Data and Error Handling guides.

The user supplied the following **earlier staging evidence**. No staging/browser
run or database operation was performed during this fix:

| Evidence | Supplied staging result |
|---|---|
| runId | `d58634e712b8c54e58ce5575` |
| BUILD_ID | `-168sMx_S0PbBSX1iFtdV` |
| Browser suite | 18 passed / 2 failed / 0 skipped |
| EDIT-04/05/06/21 | `FMT_SAVE_NAVIGATE`, `tests/e2e/cms-draft.spec.ts:51:22` |
| EDIT-18 | `CLIP_SAVE_NAVIGATE`, `tests/e2e/cms-editor-safety.spec.ts:55:22` |
| Failing assertion | Edit-page URL in `registerCreated()` after clicking Save draft |
| EDIT-13 / EDIT-14 | PASS on real MariaDB on the earlier staging build |
| Cleanup articles/profiles/users/logs | 0/0/0/0 |
| Final QA working tree | Reported clean |

The failed navigation assertions do not prove that saving succeeded or that
navigation merely needs more time. The local evidence below establishes a
deterministic data-transport defect consistent with both rich-text save failures.
It does not claim that either browser case now passes on staging, or rule out an
additional issue that only a new browser run would expose.

## Confirmed root cause

The local probe uses `getSchema(createEditorExtensions())` from the application,
real ProseMirror node/mark factories, and the installed
`Editor.prototype.getJSON` implementation against those documents. It does not
substitute hand-built JSON for the editor output. Inputs are synthetic Vietnamese
paragraphs, code blocks, links, headings and ordered lists.

Installed TipTap 3.31.3 calls `state.doc.toJSON()` in
`node_modules/@tiptap/core/src/Editor.ts:793`. ProseMirror constructs attributes
with `Object.create(null)` (`prosemirror-model/src/schema.ts:18,28`), and node/
mark serialization retains those attribute objects (`src/node.ts:322`,
`src/mark.ts:74`). Consequently, `getJSON()` does not guarantee ordinary object
prototypes throughout its result.

The experiment loads the **installed Next.js 16.2.6 production Turbopack Flight
codecs**, with Next's compiled React aliases, and uses distinct client/server
temporary-reference sets. This matches Next's action path:
`server-action-reducer.js:43,46` creates the client set and calls `encodeReply`;
`action-handler.js:557,558,700` creates the server set and calls `decodeReply`.

| Document | Raw editor output | After client encode / server decode | Application validation |
|---|---|---|---|
| Paragraph | Ordinary objects, no attrs | Content preserved | PASS |
| Code block | `attrs` has null prototype | `$T` becomes opaque function reference | `VALIDATION_ERROR` |
| Link mark | `attrs` has null prototype | `$T` becomes opaque function reference | `VALIDATION_ERROR` |
| Heading | `attrs` has null prototype | `$T` becomes opaque function reference | `VALIDATION_ERROR` |
| Ordered list | `attrs` has null prototype | `$T` becomes opaque function reference | `VALIDATION_ERROR` |

With `temporaryReferences`, the client need not throw during serialization.
Unsupported attribute objects become opaque references instead of transmitting
their fields. The strict application validator correctly rejects the decoded
function-valued attrs. Normalization after decoding cannot recover missing attrs.

There is a second affected boundary: `validateEditorDocument` reconstructs a
ProseMirror document and previously returned its raw `toJSON()` output. That
reintroduces null-prototype attrs even when stored JSON started with ordinary
objects. `getArticleDraftForEdit` passes this canonical content to the form.
Actual `renderToReadableStream` / `createFromReadableStream` experiments reject
these raw attrs in the Server-to-Client direction as well.

Converting **trusted editor output** to plain JSON before action encoding
preserves nodes, marks, attrs, Vietnamese text and code newlines, and passes the
actual action codec. Converting the **already validated canonical document** to
plain JSON also passes both Flight directions and preserves reopened content.

## Minimal implementation

| File | Reason for change |
|---|---|
| `src/features/cms/components/ArticleDraftForm.tsx` | Clone trusted `editor.getJSON()` output to plain JSON before create/update actions. Move locking and payload preparation inside the existing `try` so preparation/serialization errors use the existing error handling and `finally` unlock path. |
| `src/features/cms/editor-schema.ts` | Serialize the canonical ProseMirror output after strict validation, reuse that serialization for the existing byte limit, and parse it to ordinary JSON after all checks before returning it to actions/queries. |
| `tests/cms-editor-flight.test.mjs` (new) | Reproduce the raw failure with real installed codecs; cover plain/canonical/stored output in both directions and preserve strict invalid-input rejection. |
| `tests/cms-article-draft-form.test.mjs` (new) | Exercise actual form callbacks with real TipTap output on create/update, preparation failures, explicit retry, double-submit protection, navigation locking and concurrency tokens. |
| `tests/cms-article-draft-actions.test.mjs` | Check the actual query return value before any clone can hide its prototype; verify reopened content, scoped read, timestamp token and absence of writes for five document types. |
| `docs/cms/reports/CMS-005-rich-text-transport-fix.md` (new) | Record this fix, evidence, validation and remaining review/staging work. |

Untrusted input is **not** stringified or parsed before validation. Descriptor,
key/type, schema, URL, byte and text checks remain in place. New rejection tests
include NaN/undefined attrs, unknown keys, accessors, `toJSON`, cycles, custom
prototypes, symbol keys, unsupported heading level and unsafe links. Accessor and
`toJSON` invocation counts remain zero. Stored invalid documents still return
`UNSUPPORTED_DOCUMENT`.

The content schema, limits, URL policy, RBAC, ownership, editable states,
optimistic concurrency, timestamp precision, dirty state and action/query policy
code are unchanged. Existing E2E scenarios, native clipboard paste, assertions,
timeouts, retries, diagnostics and staging controls are unchanged. No dependency,
Prisma schema, migration, auth, CRM or publishing change is included.

## Regression: before and after

The new tests ran against the original application source before either source
fix, using the already prepared Node 22.23.2. The source was not reset or swapped
to manufacture the red result.

| Test file | Before fix | After fix |
|---|---|---|
| `cms-editor-flight.test.mjs` | 3 PASS / 4 FAIL: canonical rich attrs remain non-plain | 7/7 PASS |
| `cms-article-draft-form.test.mjs` | 4 PASS / 10 FAIL: eight rich create/update payloads plus two preparation failures | 14/14 PASS |
| `cms-article-draft-actions.test.mjs` | 22 PASS / 4 FAIL: reopened rich document attrs remain non-plain | 26/26 PASS |

The raw Flight reproduction intentionally continues to demonstrate the failing
unconverted payload; its companion assertions prove preservation after conversion.
The focused post-fix run also includes the existing draft validation and route
tests: **73/73 PASS**. The full suite adds 26 tests to the previous 411 and passes
**437/437**, with no failed, cancelled, skipped or todo tests.

The first Flight test setup attempt failed to resolve the compiled React alias;
after correcting the test-only resolver to return the resolved file URL directly,
the recorded 3 PASS / 4 FAIL run above reached the actual application assertions.
The setup failure is not evidence of an application defect.

Form tests adapt React scheduling, framework/action I/O and the editor view, but
execute the actual form callbacks and retain original action argument references.
Query tests adapt authentication/Prisma I/O and inspect original returned data.
Flight tests use real codecs in memory. These are not browser, hydration, HTTP or
real-database tests; no real accounts or persisted fixtures are involved.

## Local validation and isolation

All validation used the prepared executable, without `npm exec` or installation:

```text
C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe
```

Each validation child received an OS-variable allowlist and explicit dummy
configuration, including `DATABASE_URL=mysql://build:build@127.0.0.1:3306/build`,
`DOTENV_CONFIG_PATH=NUL`, dummy auth settings, blank sheet/mail integration
settings and disabled telemetry/browser downloads. Inherited staging settings
were not forwarded. A process-local preload blocks `.env*` reads and database
socket ports 3306/3307; npm configuration paths point to unused local files.
No environment dump, `.env` read or secret read occurred.

Below, `$Node22` denotes that exact executable and `$NpmCli` its sibling npm CLI.
These launch the already installed CLIs and existing scripts with that environment.

| Check | Actual result |
|---|---|
| `$Node22 --version` | **PASS**, v22.23.2 |
| `$Node22 node_modules/prisma/build/index.js validate` | **PASS**, exit 0 |
| `$Node22 node_modules/prisma/build/index.js generate` | **PASS**, exit 0, Prisma Client 7.8.0 |
| Focused five-file test run | **PASS**, exit 0, 73/73 |
| `$Node22 $NpmCli run test:unit` | **PASS**, exit 0, 437/437 |
| `$Node22 $NpmCli run lint` | **PASS**, exit 0 |
| `$Node22 node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS**, exit 0 |
| `$Node22 $NpmCli run build` in isolated snapshot | **PASS**, exit 0, production compilation, type checking and prerendering |
| `$Node22 $NpmCli run test:e2e:list` | **PASS discovery**, exit 0, exactly 20 cases; no browser run |
| `git diff --check` | **PASS**, exit 0 for tracked changes |
| Explicit whitespace/conflict-marker checks for all three new files | **PASS**, exit 0 |

Fresh ignored local logs and build artifacts are under
`.next/cms005-flight-local-20260925-7d80a1/`. The build snapshot is
`build-node22/` within that directory, with 144 allowlisted current tracked source,
public and named configuration files, and a junction to the installed
`node_modules`. It contains no copied `.env` or staging credentials. Old staging
snapshots and cleanup state were untouched. Next reports the existing multiple
lockfile/workspace-root warning; no configuration was changed to suppress it.
The build completed successfully, and a byte comparison confirmed that all 144
build input files still match the workspace (zero mismatches).

## Pending work and Claude review handoff

| Activity | Status |
|---|---|
| Claude independent review of this fix | **PENDING** |
| Commit/push and CI for this fix | **NOT RUN**; outside this turn's authorization |
| Browser E2E for the fixed source | **NOT RUN / STAGING PENDING** |
| MariaDB concurrency/precision and verified cleanup on the fixed build | **NOT RUN / STAGING PENDING**; earlier PASS evidence is separate |
| CMS-005 overall | **NOT COMPLETE** |

Claude should review the actual null-prototype/temporary-reference reproduction,
the two normalization boundaries, preservation of all content values, strict
validation before canonical conversion, payload preparation error recovery, the
test adapters and before/after results, and the unchanged security/concurrency/
browser assertions. After review and separately authorized commit/CI, staging
must verify the exact fixed commit, both previously failing save/reload cases,
the full suite including EDIT-13/14, and actual cleanup/provenance. Local PASS
must not be reported as staging PASS.

## Final Git state and confirmations

Final `git status --short`:

```text
 M src/features/cms/components/ArticleDraftForm.tsx
 M src/features/cms/editor-schema.ts
 M tests/cms-article-draft-actions.test.mjs
?? docs/cms/reports/CMS-005-rich-text-transport-fix.md
?? tests/cms-article-draft-form.test.mjs
?? tests/cms-editor-flight.test.mjs
```

Three modified tracked files and three new untracked files; nothing staged.
HEAD remains `8e19a8f1d6176858b0aa41e082a0807e568c400b`. Git emits the existing
global-ignore permission and LF-to-CRLF notices; no line-ending or Git
configuration change was made.

No git add, commit, push, merge or deploy. No database connection/query, real
account use, fixture creation, SSH, staging run, migration, reset, seed or cleanup.
No CMS-004 cleanup, package/browser install, or deletion of an old snapshot.
