# CMS-007 — Handoff cho Codex implementation local

Prepared: 2026-09-27. Task: Sources/citations.
Spec bắt buộc: [CMS-007.md](CMS-007.md).
Branch: `feature/cms-007-sources-citations`.
Base: main merge CMS-006 `6c74acbc25a8b7f76d48f376b075d9c2d2225831` + commit tài liệu CMS-007.

## 1. Chỉ thị và phạm vi được giao

Product Owner yêu cầu “Triển khai cms 007”. Được triển khai source, tests, runbook và implementation report theo spec này trong workspace local; xử lý các vấn đề kỹ thuật trong phạm vi mà không dừng ở kế hoạch.

CMS-006 đã DEPLOYED, local/Claude review/CI/staging/cleanup/public smoke/monitoring PASS trong phạm vi ghi nhận. CMS-006 authenticated production smoke/autosave vẫn PENDING; CMS-005 authenticated smoke vẫn DEFERRED. Chỉ thị tiếp tục CMS-007 cho phép bắt đầu task mới, không coi các mục nghiệm thu còn thiếu là PASS. Xem [release checkpoint CMS-006](../reports/CMS-006-release-checkpoint.md).

Đặc tả đã chốt Sources v1 là metadata/dẫn chứng gắn từng bài, trang riêng và lưu thủ công. Không thêm inline citation node/mark, fetch URL, thay schema/dependency, triển khai preview/public/fact-check hoặc âm thầm mở rộng autosave sang nguồn.

Trong lượt local: không chạy SSH/DB/staging/fixtures/cleanup/migration/production; không commit/push/PR/merge/deploy implementation. Branch/commit tài liệu chuẩn bị là checkpoint đầu vào, không phải implementation đã review.

## 2. Đọc trước coding

Kiểm tra repo/branch/HEAD/status. Giữ mọi thay đổi bất ngờ; không reset/clean/stash tự động, không implementation trên main. Xác nhận branch bắt đầu đúng merge CMS-006 và commit tài liệu từ bàn giao.

Đọc đầy đủ:
1. AGENTS.md, CLAUDE.md, TECH_STACK.md; phân biệt phần stale của CLAUDE.md với schema/package/role/test runner thực tế.
2. docs/cms/ROADMAP.md, reports/CMS-006-release-checkpoint.md.
3. tasks/CMS-007.md và tài liệu handoff này; các phần quyền/đồng bộ/DoD của CMS-002/005/006.
4. prisma/schema.prisma: Article, SourceReference, SourceType, User; FK Restrict và field limits.
5. src/lib/authz.ts, auth.ts, roles.ts; src/features/cms/access.ts.
6. article-draft-actions.ts, article-draft.ts, article-draft-query.ts, article-autosave.ts, ArticleDraftForm.tsx và routes/list hiện có.
7. fixtures.mjs, cleanup.mjs, run.mjs, guard.mjs, diagnostics.mjs, safe-reporter, E2E README, harness/form/action tests.
8. Reports và actual diff của AUTO-21/FMT fixes nếu chạm tests/navigation; giữ hai bản sửa ở main.

Theo AGENTS.md, đọc guides tại node_modules/next/dist/docs về Server Actions, params, revalidation, Client Components trước khi viết code. Đối chiếu installed API/pins; không upgrade thư viện vì thấy tài liệu web khác phiên bản.

Dùng Node 22.23.2 đã có. CMS005_NODE_EXE là tên biến lịch sử của môi trường, không cần đổi để làm CMS-007. Không npm exec tải Node, không cài packages hoặc Chromium mới khi bản pin đã có.

## 3. Thứ tự triển khai

1. Định nghĩa Source DTO/errors, strict field/token/ID validation, URL normalization và date codec UTC+7↔UTC. Viết tests bất biến/biên/hostile input thực sự kiểm hành vi.
2. Scoped read query nhất quán Article token + sources; readonly permissions/unsupported-document; không source lookup trước parent scope.
3. Source actions dùng shared Article token transaction: fresh actor, editable Article/schema, parent CAS, source write, persisted token/list, rollback và revalidation warning. Không copy ra đường ghi yếu hơn draft action.
4. Manual source panel và route; single-flight, pending/dirty/error barriers, destructive confirmation, canonical ACK, a11y/responsive. Bổ sung links editor/list và /new hint.
5. Form/action/query regressions cùng source↔autosave concurrency; giữ controller autosave nguyên semantics. Chỉ refactor helper nhỏ khi cần và cover contract cũ.
6. Mở rộng fixtures/manifest v2/recovery/cleanup source exact IDs trước khi viết browser suite mới. Negative cleanup tests local là bắt buộc trước staging.
7. Thêm source browser scenarios, allowlist diagnostics/static steps và runbook. Discovery local; browser/DB thật để lượt staging sau review+CI.

Không thêm dependency/schema flag/toggle test vào product. Nếu thấy vấn đề chưa rõ trong phạm vi, tự điều tra source và local tests rồi giải quyết; báo blocker khi thật sự cần đổi contract/schema/quyền hoặc thiếu runtime, không hỏi lại việc spec đã giao.

## 4. Những điểm Claude sẽ review kỹ

- Article hiện có là parent authorization boundary; source.createdById không quyết định ownership.
- CanUpdateArticle của admin rộng hơn editable draft; source mutation vẫn giới hạn DRAFT/CHANGES_REQUESTED.
- Một transaction đổi parent token và child row; CAS thất bại hoặc child failure không để partial write.
- Expected token là Article.updatedAt, không source.updatedAt hoặc Date.now() của client.
- Không refresh token rồi tự retry stale source/autosave; cả hai hướng giữ input.
- Lost ACK CREATE không dẫn đến double create; unknown result khóa manual mutations tới explicit reload.
- Source action không redirect khi session mất; current DB actor phải ACTIVE và role khớp.
- UPDATE không đổi createdById/createdAt/articleId; DELETE không xóa nhầm source thuộc Article khác.
- URL chỉ link được kiểm tra, không fetch nội dung; ghi chú/title React text, unsafe URL đã có trong DB không trở thành href.
- Codec timezone không dùng implicit browser timezone; giữ seconds/ms; null không tự thành now.
- Revalidation/late response không làm mất source draft; thêm link không bypass dirty guard của editor.
- Source fixture phải có cả parent và creator trong run, không chỉ một phía; count allowlist khớp identities.
- Cleanup nguồn trước Article/User, 5 counters zero trong/sau transaction, manifest v1 không được nâng quyền xóa sources.
- SRC registry không UNKNOWN_CASE, không nới stdout để có debug; step location đủ phân loại điểm fail.

## 5. Môi trường local và validation

VS Code có thể đang kế thừa DATABASE_URL staging từ lượt trước. Không dùng môi trường đó cho local commands. Dựng process con với allowlist biến hệ thống cần thiết và DATABASE_URL/NEXTAUTH_* giả; không đọc .env hay dump environment. Build dùng snapshot riêng theo quy trình đã có, không auto-load file .env của repo. Không sửa/xóa env của người dùng hoặc các phiên terminal khác.

Không kết nối database thật qua Prisma khi validate/generate/unit/build. Không chạy npm install/npm ci/postinstall ngoài phạm vi cài đặt đã cho; dùng dependencies đang có, kiểm package/lock nếu thiếu rồi báo chính xác.

Khi implementation ổn định, chạy:
- Focused validator/URL/date, source action/query/form, parent concurrency và harness cleanup tests.
- Full npm run test:unit (baseline 493; báo count thực tế sau thêm tests, không ép một con số đoán).
- Prisma validate/generate với dummy/env-free configuration.
- Lint, TypeScript, production build cô lập dummy env.
- Playwright discovery; tổng 36 baseline + SRC cases thực tế. Không chạy browser staging.
- git diff --check và whitespace/conflict markers cho file mới.

Không lặp lại full suite/build sau đó nếu chỉ viết report và không có rủi ro mới. Không skip case, tăng timeout/retry, bỏ DB assertion hoặc thay native input/paste để giữ số PASS.

## 6. Báo cáo implementation và điểm dừng

Tạo `docs/cms/reports/CMS-007-implementation.md`:
- Branch/base HEAD, file list, scope/no-schema/no-dependency đúng thực tế.
- Source routes/data contracts/manual state; timestamp semantics và URL safety.
- Pseudocode/actual code pointers chứng minh transaction parent CAS + child write + persisted token và rollback.
- RBAC/session/current actor/parent-child scoping; error/recovery/barrier behavior.
- Manifest schema/recovery/cleanup diff; proof chống relation ngoài fixture và zero 5 counters.
- Mapping đủ CMS007-AC-01..30 và SRC-01..24, tách LOCAL PASS / BROWSER NOT RUN / tầng khác.
- Mapping giữ 36 EDIT/AUTO baseline, mọi legacy delta kèm lý do và assertion thay thế.
- Node/commands/counts thật; full suite/discovery khác nhau; Claude review/CI/staging NOT RUN.
- Những điểm cần Claude independent review; git status/index cuối.

Cập nhật ROADMAP đúng checkpoint implementation, giữ CMS-005 DEFERRED/CMS-006 PENDING. Để mọi source/test/runbook/report implementation UNSTAGED; không git add/commit/push. Không ghi CMS-007 COMPLETE hay DEPLOYED.

Sau local report: Claude chỉ review, không tự sửa implementation; Codex sửa findings, Claude regression; commit/push/CI và staging có nhiệm vụ riêng. Không yêu cầu PO nhập lại DB password/tạo tunnel để làm local task.

## 7. Hướng dẫn Yes / No cho lượt implementation local

| Hộp thoại có thao tác | Lựa chọn trong lượt này |
|---|---|
| Đọc source/spec/installed docs/git diff và metadata runtime | Yes |
| Sửa source/tests/runbook/report thuộc CMS-007 | Yes |
| Local unit/lint/tsc/discovery/Prisma validate-generate/build đã cô lập dummy env | Yes |
| Đọc/in .env, DATABASE_URL thật, secrets/cookies/raw environment | No |
| npm install/upgrade, thay lockfile/schema/migration | No; báo nhu cầu cụ thể nếu thật sự cần |
| SSH, DB thật, staging runner, fixtures/cleanup/reset/seed | No; thuộc bước staging sau |
| Git add/commit/push/merge/production deploy implementation | No; chưa tới gate đó |

Đọc toàn bộ lệnh và môi trường đi kèm; từ khóa riêng lẻ không đủ để quyết định. Ưu tiên Yes cho một lệnh đã kiểm tra, không bật blanket allow cho toàn project chỉ để giảm hộp thoại.
