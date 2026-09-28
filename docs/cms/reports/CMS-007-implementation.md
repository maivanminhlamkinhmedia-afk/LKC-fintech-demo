# IMPLEMENTATION REPORT — CMS-007

Ngày: 2026-09-27. Checkpoint: **LOCAL IMPLEMENTATION / VALIDATION PASS — bàn giao diff UNSTAGED cho Claude independent review**. CMS-007 chưa COMPLETE.

## 1. Provenance và phạm vi

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Workspace thực: `D:\lkc_phase1_rbac_patch\LKC-fintech-demo`.
- Branch: `feature/cms-007-sources-citations`.
- HEAD tài liệu: `36cca5f7a70371326d3008087950a11fc1c1845f`; parent: `6c74acbc25a8b7f76d48f376b075d9c2d2225831`.
- Preflight bắt đầu sạch trên main; fetch origin, đối chiếu feature remote đúng SHA, tạo tracking branch local. HEAD/parent vẫn giữ nguyên sau implementation. Index rỗng; ahead/behind tracking là `0/0`.
- Đã đọc AGENTS, installed Next guides về Server Actions, Server/Client Components, dynamic params, revalidatePath; spec/handoff CMS-007, ROADMAP, release checkpoint CMS-006, policy/DoD CMS-002/005/006 và source hiện hành. Thông tin cũ trong CLAUDE.md không thay thế package/schema/roles/test runner hiện có.
- Không sửa schema, migration, dependencies/lockfile, auth/role matrix, workflow deploy hoặc logic autosave/draft backend/editor schema.
- Không đọc `.env`, dùng credential thật, SSH, kết nối DB thật, chạy staging/browser, fixture/cleanup thực tế hoặc migration. Không git add/commit/push/PR/merge/deploy.
- CMS-005 authenticated production smoke **DEFERRED**; CMS-006 authenticated production smoke/autosave **PENDING**. Không coi việc tiếp tục CMS-007 là nghiệm thu hai phần này.

## 2. File list

28 file implementation/documentation, đều UNSTAGED (12 modified + 16 untracked):

| File | Thay đổi |
|---|---|
| `src/features/cms/article-sources.ts` | Mới: DTO, errors, strict payload/ID/token, URL, UTC+7 codecs, limits |
| `src/features/cms/article-source-store.ts` | Mới: server-only fresh actor, scoped parent, explicit selects, snapshot/date checks |
| `src/features/cms/article-source-query.ts` | Mới: uncached scoped read transaction |
| `src/features/cms/article-source-actions.ts` | Mới: manual create/update/delete, parent CAS, child mutation, persisted ACK |
| `src/features/cms/article-source-panel.ts` | Mới: controller manual-only, synchronous single-flight, lifecycle/error/navigation state |
| `src/features/cms/components/ArticleSources.tsx` | Mới: form/list, safe links, confirmations, accessibility, responsive layout |
| `src/app/creator/articles/[id]/sources/page.tsx` | Mới: protected thin route, await params, safe error/read-only rendering |
| `src/features/cms/components/ArticleDraftForm.tsx` | Thêm persisted sources link hoặc /new hint; dùng dirty guard hiện có |
| `src/app/creator/articles/page.tsx` | Sources link cho các bài đã ở read scope, giữ edit-link policy |
| `tests/cms-article-source-validation.test.mjs` | Mới: 29 tests validation/URL/datetime/errors |
| `tests/cms-article-source-actions.test.mjs` | Mới: 26 action/query/auth/rollback/concurrency/Flight tests |
| `tests/cms-article-source-panel.test.mjs` | Mới: 23 controller tests |
| `tests/cms-article-source-form.test.mjs` | Mới: 9 component/effects tests |
| `tests/cms-article-source-routes.test.mjs` | Mới: 4 route tests |
| `tests/cms-source-browser-support.test.mjs` | Mới: 5 protocol/barrier tests |
| `tests/cms-article-draft-form.test.mjs` | Hai regression mới cho /new hint và dirty sources link; helper mở rộng với default cũ |
| `tests/cms-article-draft-routes.test.mjs` | Thêm assertion sources links, giữ mọi assertion edit links |
| `tests/e2e/cms-sources.spec.ts` | Mới: 19 browser cases, chỉ discovery trong lượt này |
| `tests/e2e/cms-sources-support.ts` | Mới: source action counter và hold/drop ACK thật |
| `scripts/cms-e2e/fixtures.mjs` | Manifest v2, source ownership/recovery/exact deletion/counts, guarded metadata setup |
| `scripts/cms-e2e/cleanup.mjs` | Recovery v2 khi --apply; check-only vẫn read-only |
| `scripts/cms-e2e/run.mjs` | V2 recovery trong finally trước cleanup; giữ provenance/lock/build guards |
| `scripts/cms-e2e/diagnostics.mjs` | SRC identities/static step allowlist |
| `tests/cms-e2e-harness.test.mjs` | 18 tests mới + baseline expected five counters |
| `tests/cms-e2e-diagnostics.test.mjs` | 3 tests mới cho SRC registry/location/suppression |
| `tests/README.cms-e2e.md` | Mapping 55 cases, v2/5-counter recovery runbook, local/browser distinction |
| `docs/cms/ROADMAP.md` | Checkpoint local thực tế, giữ pending/deferred |
| `docs/cms/reports/CMS-007-implementation.md` | Báo cáo này |

Wrapper/config/log/hash/build snapshot dưới `.next/` là artifact local bị ignore, không nằm trong diff bàn giao.

## 3. Thiết kế và invariants

### Dữ liệu, validation và quyền

Trang riêng `/creator/articles/[id]/sources` gọi `requirePermission('cms:access')` trước domain read. Query server-only tiếp tục kiểm actor DB ACTIVE/role hiện tại trong transaction. Parent luôn `id AND articleCmsScope(actor)`; child update/delete chỉ được lookup sau parent scope và bind cả `id + articleId`.

CREATOR quản lý nguồn theo owner Article; ADMIN/SUPER_ADMIN theo any scope hiện có. `source.createdById` không cấp quyền. Mọi role chỉ mutation DRAFT/CHANGES_REQUESTED với `validateStoredEditorDocument` hợp lệ. Noneditable/unsupported được xem danh sách read-only. Session mất trong mutation trả safe FORBIDDEN, không redirect làm mất input.

Payload chỉ own enumerable data properties của plain/null-prototype object. Reject unknown keys, getter/setter, symbols, non-enumerable, class/array/function/toJSON trước normalization; không stringify đầu vào. CREATE/UPDATE thay đủ metadata, DELETE chỉ expectedUpdatedAt. Các nullable field được bỏ qua/null/blank theo codec; enum/Unicode code-point bounds và giới hạn 100 nguồn được giữ. Duplicate title/URL hợp lệ.

URL trim/canonicalize HTTP(S), hostname bắt buộc, không credentials/raw control/backslash/whitespace nội bộ, giới hạn sau `URL.href`. Không fetch/DNS/preview. Legacy URL unsafe giữ nguyên text/cảnh báo; href chỉ từ kiểm tra server. React render text cho title/publisher/note, không raw HTML. Ba timestamp độc lập; UTC canonical `.sssZ`, calendar round-trip, năm UTC 1000..9999. UI fixed UTC+7, `step=0.001`, không dùng timezone máy/browser. UTC cuối năm 9999 có thể hiển thị local năm 10000 và round-trip về UTC hợp lệ.

Read snapshot gồm parent token và sources trong cùng Serializable transaction; explicit selects, thứ tự `createdAt ASC, id ASC`. Dates chuyển strings, không truyền contentJson/relation objects. Stored date malformed hoặc ngoài codec range thất bại an toàn ở server, tránh ném lỗi khi render client. Safe error mapping chỉ whitelist messages; không expose raw Prisma error, không gán unique error thành slug conflict.

### Atomic mutation và shared token

Luồng thật trong `article-source-actions.ts`:

1. Session/policy → strict IDs/payload.
2. Serializable transaction → fresh actor → scoped Article → editable status/document → child binding nếu cần.
3. So expected token; conditional `Article.updateMany` gồm id, scope, current author/status, editable statuses, expectedUpdatedAt, editorSchemaVersion=1. Data **chỉ updatedAt**, dùng `nextArticleUpdatedAt` hiện có, count=1.
4. CREATE kiểm count<100 trong transaction rồi gắn Article/current actor; UPDATE chỉ 8 metadata fields; DELETE exact child/parent, count=1.
5. Read parent persisted token (phải > previous) và canonical sources trong transaction. Child/count/FK/read/precision/commit failure rollback cả parent và source.
6. Sau commit revalidate creator/list/edit/sources. Cache failure vẫn success + safe warning + token/list persisted.

Local adapter chạy **actions thật**, thực thi predicates, mô phỏng Serializable queue và rollback. Hai source requests cùng token chỉ một winner; 99 nguồn không thành 101. Source vs `updateArticleDraft` thật kiểm cả hai thứ tự; loser conflict và không có partial child/body write. Future parent timestamp +1 giờ tăng đúng +1ms qua create/update/delete. P2034/adapter TransactionWriteConflict map conflict, không retry.

Đây là bằng chứng orchestration/where/data/rollback **local**, không chứng minh SQL locks hoặc DATETIME(3) của MariaDB thật. Các phần đó chờ SRC-12/13/17 staging.

### Giao diện và recovery

Controller không có timer/scheduler; chỉ explicit Save/Delete dispatch. Một synchronous pending gate cho toàn panel, payload/token snapshot tại dispatch; form nhỏ pending bị khóa. ACK thành công thay list/token/baseline canonical. Dirty/pending/blocked không bị same-Article revalidation thay token; clean snapshot có thể sync. Article ID khác dùng instance khác; cleanup/generation bỏ late ACK cũ, không giả nhận server đã rollback.

Offline giữ input, không dispatch, online không tự save. Validation/limit cho sửa và manual retry cùng token. Conflict/forbidden/notfound/noteditable/unsupported khóa mutations và giữ input. Throw/network/INTERNAL_ERROR coi là unknown commit, không retry/create trùng; explicit reload có confirm. Dirty add/edit/cancel/delete/navigation cần xác nhận; delete có tên nguồn và không request khi cancel. Native beforeunload + capture link guard, accepted leave không thêm request; external safe links mở tab mới.

Form có labels, per-field errors/aria-invalid/describedby, polite status, focus khi add/edit/cancel/error, layout wrap dài. Persisted editor link đi qua guard cũ; /new chỉ hướng dẫn lưu nháp trước. List source links không thay read scope hoặc cho phép mở editor ở status read-only.

### Fixture/harness

Manifest v2 có `sources: [{id, articleId, createdById}]` exact identities. V1 đọc được nhưng không authorize source recovery/deletion hoặc injected sources. Recovery tìm Article run trước, truy vấn source theo parent IDs **hoặc** creator IDs **hoặc known source IDs**; cả parent và creator phải qua fixture verification. Known identity không được đổi dù cả hai endpoints đã trôi ra ngoài. Chỉ journal sau toàn bộ candidate/relations hợp lệ; deleted IDs giữ tombstone phục vụ recovery checks.

Allowlist relation counts nguồn phải khớp exact identities; các relation khác vẫn zero. Guarded alter chỉ cho metadata nguồn được quy định; không đổi source parent/creator/createdAt. Article owner/status/schema setup dùng graph preflight, không mở quyền ra ngoài fixture.

Cleanup trong cùng Serializable transaction: exact source triple/count=1 trước Article/User; remaining `articles/profiles/users/logs/sources` phải zero cả trong và sau commit. Failure/unknown ownership/count mismatch/rollback/journal failure không tạo VERIFIED. Check-only không update manifest. **Không có cleanup thực tế hoặc actual five-zero evidence trong lượt này.**

Registry hiện có 55 identities/86 static step codes. Reporter/runner vẫn suppress stdout/stderr/raw assertion payload, giữ original verdict và HEAD/BUILD_ID/lock guards. Browser support chỉ đếm POST có next-action tới exact sources path; hold/drop phản hồi từ `route.fetch()` thật, không synthesize success.

## 4. Validation thực chạy

Runtime **Node v22.23.2**, npm **10.9.8**, Prisma Client **7.8.0**, Next **16.2.6**; dùng dependencies đã cài. Mọi local subprocess chạy qua wrapper allowlist OS environment + dummy DATABASE_URL/NEXTAUTH; không kế thừa staging URL. Guard chặn `.env*` reads và socket DB ports 3306/3307. Prisma dùng config riêng không import dotenv. Build snapshot chỉ src/public/config allowlist, không copy `.env`; node_modules junction dùng dependencies hiện có.

Node executable:
`C:\Users\MTA-PC\AppData\Local\Temp\lkc-cms005-node22-00196409975547fc87941b685d445bf7\node-v22.23.2-win-x64\node.exe`

Wrapper: `.next/cms006-local-20260926-05e7d1/run.cjs` (tên lịch sử, dùng filtered env cho CMS-007). Cú pháp lệnh thực: `<Node22> <wrapper> <label> <CLI args>`. `npm` trong wrapper mở npm CLI của chính Node22.

| Gate / CLI args sau label | Kết quả thực tế | Evidence label |
|---|---|---|
| `--test tests/cms-article-source-validation.test.mjs tests/cms-article-source-actions.test.mjs tests/cms-article-source-panel.test.mjs tests/cms-article-source-form.test.mjs tests/cms-article-source-routes.test.mjs tests/cms-source-browser-support.test.mjs tests/cms-e2e-harness.test.mjs tests/cms-e2e-diagnostics.test.mjs` | **151/151 PASS**, fail/skipped/cancelled=0 | `cms007-focused-final` |
| `npm run test:unit` | **612/612 PASS**, fail/skipped/cancelled=0 | `cms007-unit` |
| `node_modules/prisma/build/index.js validate --config .next/cms007-local-20260927/prisma.config.ts` | **PASS**, schema valid, no DB access | `cms007-prisma-validate` |
| `node_modules/prisma/build/index.js generate --config .next/cms007-local-20260927/prisma.config.ts` | **PASS**, Client 7.8.0 | `cms007-prisma-generate` |
| `npm run lint` | **PASS** | `cms007-lint-final` |
| `node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS** | `cms007-tsc-final` |
| `.next/cms007-local-20260927/build-local.cjs` → isolated `npm run build` | **PASS**, 152 input hashes unchanged, dynamic sources route present | `cms007-build` |
| `npm run test:e2e:list` | **PASS discovery 55 = 36 EDIT/AUTO + 19 SRC** | `cms007-discovery-final` |
| `git diff --check` + new-file whitespace/conflict scan | **PASS** | Final diff checks |
| Claude independent review / CI CMS-007 | **NOT RUN** | Bàn giao local diff |
| Browser/app/MariaDB staging / fixtures / cleanup / VERIFIED | **NOT RUN / STAGING PENDING** | Không dùng historical baseline PASS làm bằng chứng mới |

Full suite delta: 493 baseline +119 =612. New validation29 + actions/query26 + panel23 + component9 + route4 + browser-support5 + harness18 + diagnostics3 + draft-link2 =119. Focused151 bao gồm harness35 và diagnostics20 (có baseline).

Trong quá trình triển khai đã sửa TypeScript union narrowing ở action và bổ sung malformed stored-date server guard. Test invalid Date ban đầu vấp cách Node22 `deepStrictEqual` so sánh Invalid Date/TAP reporter; regression chuyển sang so timestamp số (kể cả NaN) và mọi field còn lại, không bỏ rollback assertion. Focused/full cuối đều PASS. Sau full suite chỉ chỉnh tên SRC trong hai file root tests để khớp scenario mapping; không đổi assertion/hành vi/count. Build không bị thay source sau hash verification.

Build có warning Next suy ra workspace root do snapshot và repo đều có package-lock; build exit0, compiled thành công, static generation27/27, hash mismatch=[]; không đổi Next config để che warning. Git có cảnh báo LF→CRLF và user-global ignore không đọc được trong sandbox; repo status/diff lệnh vẫn exit0. Không đọc nội dung global ignore hoặc secrets.

## 5. Acceptance Criteria mapping

LOCAL PASS là source/local test evidence; không thay thế BROWSER/MariaDB PASS. Các AC cần staging vẫn chưa nghiệm thu đầy đủ.

| ID | Implementation / local evidence | Trạng thái còn lại |
|---|---|---|
| CMS007-AC-01 | LOCAL PASS: model/enum cũ, protected-path diff rỗng | Không schema/deps/migration |
| CMS007-AC-02 | LOCAL PASS: route auth trước query; scoped parent trước child | BROWSER NOT RUN |
| CMS007-AC-03 | LOCAL PASS: role/ownership/status/document matrix | BROWSER NOT RUN |
| CMS007-AC-04 | LOCAL PASS: fresh actor + CAS current owner/status/schema | BROWSER NOT RUN |
| CMS007-AC-05 | LOCAL PASS: transaction snapshot, explicit DTO/order, empty/readonly UI | BROWSER NOT RUN |
| CMS007-AC-06 | LOCAL PASS: server-owned Article/creator và metadata ACK | Save/reload BROWSER NOT RUN |
| CMS007-AC-07 | LOCAL PASS: exact metadata write, immutable identities/Article content | BROWSER NOT RUN |
| CMS007-AC-08 | LOCAL PASS: confirm/cancel/scope/count/delete guard | BROWSER NOT RUN |
| CMS007-AC-09 | LOCAL PASS: all enum/Unicode/null/bounds/cap/duplicate rules | Cap/concurrent SQL STAGING PENDING |
| CMS007-AC-10 | LOCAL PASS: hostile payload/ID/token/error tests | Strict validation retained |
| CMS007-AC-11 | LOCAL PASS: URL policy, safe React text/link, no fetch code | Browser execution/layout NOT RUN |
| CMS007-AC-12 | LOCAL PASS: fixed UTC+7/canonical range/seconds/ms round-trip | Real DB/browser timezone NOT RUN |
| CMS007-AC-13 | LOCAL PASS: actual action predicates/Serializable/atomic rollback adapter | MariaDB STAGING PENDING |
| CMS007-AC-14 | LOCAL PASS: persisted token/precision rollback/+1ms tests | DATETIME(3) STAGING PENDING |
| CMS007-AC-15 | LOCAL PASS: same-token source winners/loser rollback | Two tabs BROWSER NOT RUN |
| CMS007-AC-16 | LOCAL PASS: real draft/source actions both winner orders; loser controller barrier | BROWSER NOT RUN |
| CMS007-AC-17 | LOCAL PASS: no scheduler, manual-only, shared synchronous gate | Browser request counts NOT RUN |
| CMS007-AC-18 | LOCAL PASS: validation/limit/offline retains input and no automatic retry | BROWSER NOT RUN |
| CMS007-AC-19 | LOCAL PASS: unknown ACK barrier, stale create no duplicate | Real dropped ACK BROWSER NOT RUN |
| CMS007-AC-20 | LOCAL PASS: no mutation redirect, safe actor/parent/document denial | BROWSER NOT RUN |
| CMS007-AC-21 | LOCAL PASS: lifecycle/late ACK/revalidation/navigation confirmation tests | Native browser navigation NOT RUN |
| CMS007-AC-22 | LOCAL PASS: revalidation exception remains success+warning/canonical ACK | L-only scenario covered |
| CMS007-AC-23 | LOCAL PASS: new hint/persisted/list links + old dirty controller regression | BROWSER NOT RUN |
| CMS007-AC-24 | LOCAL PASS component labels/status/focus handlers/wrap classes | Visual/keyboard390/768/desktop BROWSER NOT RUN |
| CMS007-AC-25 | LOCAL PASS baseline suite; 36 baseline discovered, E2E source files unchanged | Baseline browser rerun NOT RUN |
| CMS007-AC-26 | LOCAL PASS: v2 exact endpoint ownership/recovery/alter tests | Actual fixtures STAGING PENDING |
| CMS007-AC-27 | LOCAL PASS: transactional source-first delete/five counts/failure safety | Actual cleanup STAGING PENDING |
| CMS007-AC-28 | LOCAL PASS: registry55/steps86/protocol tests/discovery and guards | Run HEAD/BUILD_ID evidence STAGING PENDING |
| CMS007-AC-29 | LOCAL report/mapping PASS | Claude review/CI NOT RUN, required before staging |
| CMS007-AC-30 | Release gate preserved; no premature COMPLETE | Staging/release/production acceptance NOT RUN |

## 6. SRC scenario mapping

V=`cms-article-source-validation`, A=`cms-article-source-actions`, P=`cms-article-source-panel`, F=`cms-article-source-form`, R=`cms-article-source-routes`, H=`cms-e2e-harness`, D=`cms-e2e-diagnostics`; tất cả là `tests/*.test.mjs`. Browser case names/step codes đầy đủ trong `tests/README.cms-e2e.md`.

| Scenario | Local evidence — PASS | Browser evidence |
|---|---|---|
| SRC-01 | A/R auth roles, scope, mismatched IDs | NOT RUN: sources route denies anonymous/non-CMS/foreign |
| SRC-02 | A/P create/update/null metadata | NOT RUN: full metadata + CHANGES_REQUESTED/null cases |
| SRC-03 | A server creator/Article ownership | NOT RUN: admin + super cases, creator edits their source |
| SRC-04 | A/R/F eight readonly statuses + unsupported doc | NOT RUN: excluded statuses/unsupported case |
| SRC-05 | V/A hostile descriptors/IDs/tokens/overposting | L-only |
| SRC-06 | V/A bounds/types/null/cap100/99 competing create | L-only; no claim of SQL proof |
| SRC-07 | V/F safe URLs/unsafe legacy text, no fetch | NOT RUN: safe links/legacy URL case |
| SRC-08 | F React text escaping, A Unicode metadata | NOT RUN: HTML-like title/publisher/note case |
| SRC-09 | V/P/A fixed zone/dates/precision | NOT RUN: timezone America/Los_Angeles metadata reload |
| SRC-10 | A/P/F scoped snapshot/order/no idle dispatch | NOT RUN: manual idle/order case |
| SRC-11 | P/F shared single-flight; source protocol helper | NOT RUN: manual create/update pending and delete pending |
| SRC-12 | A two source mutations; P conflict barrier | NOT RUN: two-tab winner/loser case |
| SRC-13 | A real draft/source actions both orders | NOT RUN: source-first + autosave-first cases |
| SRC-14 | A current actor/parent revoked, safe no redirect | NOT RUN: actor/session + parent owner/status cases |
| SRC-15 | A exact child delete; P/F confirm/cancel | NOT RUN: delete-only-selected case |
| SRC-16 | A seven fault injections + child count/FK/CAS/errors | L-only |
| SRC-17 | A future token +1ms each operation, persisted ACK | NOT RUN: MariaDB precision/editor stale case |
| SRC-18 | P/F offline/unknown barrier; A stale lost ACK; response helper | NOT RUN: real response drop/reload case |
| SRC-19 | A cache exception; P canonical ACK/warning/no retry | L-only |
| SRC-20 | P/F transitions, beforeunload/links, late ACK/lifecycle | NOT RUN: navigation cancel/accept case |
| SRC-21 | Draft form/route regressions, source R/F links | NOT RUN: editor source-link autosave guard case |
| SRC-22 | A installed Flight both directions, malformed stored dates/doc/URL; V errors | L-only |
| SRC-23 | F/R labels/keyboard handlers/focus/errors/status | NOT RUN: 390/768/1280 layout/keyboard case |
| SRC-24 | H35/D20 + source protocol5; ownership/recovery/rollback/suppression | NOT RUN: guarded runner hooks/provenance/five-zero cleanup |

19 L+B scenarios và 5 L-only (05/06/16/19/22), 19 actual new browser `test()` cases; không ép một scenario = một case. SRC-24 qua toàn guarded run, không tạo dữ liệu ngoài fixture để negative-test staging.

## 7. Legacy mapping và review handoff

- 20 EDIT +16 AUTO browser specs không sửa. Giữ AUTO-21 native reload trigger/assertions, FMT_CODE_BLOCK focus synchronization/raw textContent assertion, FMT_DB/reload, native clipboard paste và thời gian chờ/retries hiện có.
- `ArticleEditor`, editor schema/Flight fix, article draft actions/query/validation, autosave controller, Playwright config không thay đổi.
- Draft form chỉ thêm link/hint. Legacy form helper thêm `nodes()` và navigation href optional (default giữ nguyên); thêm hai test, không bỏ/nới assertion cũ. Legacy route test thêm sources links; edit-link deny assertions giữ nguyên.
- Harness baseline17 tests vẫn giữ negative safety checks; expected cleanup object thêm `sources: 0`, plan mới v2. Thêm18 tests cho nguồn. Diagnostics baseline17 giữ suppression tests; thêm3 SRC tests. Không đổi timeout/retry/skip để lấy PASS.
- Form/action tests dùng mocked framework/Prisma boundary; Flight dùng installed codec thật in-memory. Chưa có browser render thật cho CMS-007; không coi discovery là E2E PASS.

Claude cần review kỹ: parent CAS/source atomicity và actor scope; count100 race và MariaDB precision assumptions; malformed stored-data/strict URL+date codecs; same-Article revalidation/lifecycle/unknown ACK barrier; fixture both-endpoint ownership, v1 deletion denial và source tombstones; 19 browser cases/55 discovery và response barriers trước staging.

Git cuối: branch/HEAD không đổi, **index rỗng**, **28 file UNSTAGED**, tracking **ahead0/behind0**. Protected paths schema/migrations/dependency/auth/workflows/36 baseline specs không có diff. Không tạo commit. Không có blocker local còn mở.

Bước tiếp theo: Claude independent review diff → sửa findings nếu có → review regression → commit/push/PR CI ở nhiệm vụ riêng → staging full55 trên đúng head CI PASS, fresh runId/BUILD_ID, exit0, five-zero cleanup và VERIFIED. Release/production smoke sau final triage; giữ các nghiệm thu CMS-005/006 đang deferred/pending.
