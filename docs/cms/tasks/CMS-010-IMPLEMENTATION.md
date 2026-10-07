# CMS-010 — Handoff Codex implementation và local validation

Updated: 2026-10-06 (UTC+7).
Task: triển khai Preview theo [spec CMS-010](CMS-010.md), đủ 28 AC và 24 scenario groups.
Branch: `feature/cms-010-preview`, base kỹ thuật main `5cbe3b8e0b456e701f7d9be820b94803546e98b4`.
Checkpoint hiện tại chỉ có spec/tài liệu; **chưa có implementation CMS-010**.

## 1. Nhiệm vụ được giao

Triển khai code và các kiểm thử local cần thiết, không dừng ở phân tích/kế hoạch. Đọc code thật, giữ phạm vi Preview của bản bài đã lưu và giao toàn bộ diff **UNSTAGED** để Claude independent review. Sau review mới đến checkpoint commit/push/PR/CI/staging riêng. Không xin lại xác nhận cho các thao tác local thông thường đã nằm trong nhiệm vụ.

Manual authenticated production smoke/UAT **DEFERRED đến khi xây xong toàn bộ CMS**, theo [ACCEPTANCE](../ACCEPTANCE.md) và chỉ thị PO 06/10/2026. Không yêu cầu PO đăng nhập/xem preview/upload/xóa ảnh. Hai ảnh smoke CMS-009, receipts và sentinel còn giữ không thuộc phạm vi task; không dọn hay thử lại chúng.

## 2. Checkpoint Git trước sửa

Workspace dự kiến: `D:\lkc_phase1_rbac_patch\LKC-fintech-demo`. Không dùng QA worktree cũ làm workspace implementation.

1. Đọc `AGENTS.md`, branch/HEAD/index/status và tài liệu CMS-010 từ remote checkpoint mới. Fetch origin bình thường.
2. Xác minh main/ancestry của branch CMS-010 bắt đầu từ merge CMS-009 ở trên. Spec commit chỉ đổi bốn tài liệu CMS; không dùng branch CMS-009 còn ở head `71ffe1b8…` để implementation.
3. Switch sang local tracking `feature/cms-010-preview` nếu chưa có; nếu đã có, kiểm upstream/HEAD trước khi tiếp tục. Không force/reset/clean, không tự stash hoặc ghi đè thay đổi người khác. Nếu local đang có công việc khác, dùng worktree mới theo cơ chế đã được phép và không sao chép secrets.
4. `next.config.ts` có thể vẫn status-only M như các lượt trước. Đọc diff và blob Git-normalized; baseline blob `4d0d963d45e57b949a3add6a600832ce14efbce6`. Nếu vẫn bằng HEAD, ghi nhận và giữ nguyên; không stage/reset file đó để làm sạch.
5. Nếu phát hiện thay đổi nội dung ngoài bàn giao hoặc branch drift, bảo toàn dữ liệu, đọc/xác định trước. Chỉ dừng phần có nguy cơ ghi đè; không suy status-only là content patch.

Không commit/push implementation, tạo PR implementation, merge/deploy, SSH, mở tunnel, truy cập DB thật hoặc khởi guarded staging trong lượt local này.

## 3. Những nguồn bắt buộc đọc trước viết code

- `AGENTS.md`: Next 16 trong repo có khác biệt; đọc guide liên quan trong `node_modules/next/dist/docs/` về Server Components, dynamic params, auth/redirect/notFound, caching và Metadata **trước khi viết code**. Ghi guide thực đã đọc vào report. Không chỉ dựa vào kiến thức Next phiên bản khác.
- `docs/cms/ROADMAP.md`, `docs/cms/ACCEPTANCE.md`, `CMS-010.md`.
- Quyền/auth: `src/features/cms/access.ts`, `src/lib/roles.ts`, `authz.ts`, callbacks trong `auth.ts`.
- Schema: `prisma/schema.prisma`, `src/features/cms/editor-schema.ts`, `article-draft.ts`, `article-draft-query.ts`.
- UI: `src/app/creator/articles/page.tsx`, `[id]/edit/page.tsx`, `ArticleDraftForm.tsx`, `ArticleEditor.module.css`, `article-autosave.ts`; PortalShell/FloatingContact/root layout và CSS thực.
- Quan hệ: article-source/classification query/store/helpers, public AuthorProfile projection, `media-store.ts`, `media-query.ts`, route content GET/HEAD và cover component.
- Harness: `tests/README.cms-e2e.md`, `playwright.config.ts`, `scripts/cms-e2e/{guard,run,fixtures,media-fixtures,taxonomy-fixtures,diagnostics}.mjs`, SafeReporter và các spec/support files hiện có.

Đọc để tái sử dụng contract thực. Không refactor hàng loạt các module trên chỉ vì được yêu cầu đọc.

## 4. Cách triển khai

### Query, DTO và route

Thêm module preview server-only và route `/creator/articles/[id]/preview`. Chọn tên file theo conventions hiện có; dự kiến `article-preview.ts`, `article-preview-query.ts`, `ArticlePreview.tsx` và CSS module nếu cần.

- Query fresh actor ACTIVE/role/permission và parent AND scope trước children, cùng transaction/snapshot. Dùng scope đọc, không policy sửa draft.
- Select và DTO tối thiểu theo bảng spec. Không để toàn User/Source note/Media row chảy vào client payload. Profile public optional; không tạo profile để preview chạy.
- Validate schema thật, map lỗi an toàn. Giữ Next redirect/notFound ngoài generic catch.
- Dynamic/private/no shared cache; kiểm HTML/RSC semantics trên Next đã cài. Metadata generic/noindex/nofollow, không draft SEO hay article JSON-LD.
- Không action ghi, no-op update, `updatedAt` bump hoặc audit event preview mới.

### Renderer, cover, nguồn và phân loại

Renderer React read-only từ validated document, đúng mọi node/mark hiện có; không raw CMS HTML hoặc editor contenteditable. Test list start/type/nesting và code whitespace. JSX text escaping và validator safe links cùng được kiểm bằng dữ liệu hostile.

Tái sử dụng managed media endpoint/authorization hiện có. Legacy/missing/unavailable cover có fallback, không external fetch hoặc filesystem cleanup. Chỉ client island tối thiểu nếu cần xử lý lỗi ảnh; không bundle Prisma/server-only/worker vào client.

Hiển thị assigned taxonomy/inactive/primary và sources có order; safeSourceUrl, dates Asia/Ho_Chi_Minh, bỏ note/private fields. Empty data có fallback.

### Link vào Preview

- List: bài readable có “Xem trước”, không ràng buộc editable.
- Editor persisted: “Xem bản đã lưu”, new tab, noopener/noreferrer, prefetch=false. Note rõ unsaved buffer không nằm trong preview.
- New article chưa có persisted ID: hướng dẫn lưu lần đầu, không tạo placeholder preview ID.
- Không sửa autosave controller để force save hoặc nhận ACK; không call leave, không clear dirty, không truyền content qua URL/window/storage.
- Native click và keyboard trên layout thật; không force click/bỏ actionability hoặc ẩn FloatingContact trong test.

## 5. Test và fixture

Dùng 24 nhóm PREV trong spec làm coverage map. Một nhóm có thể tách nhiều registrations; báo **N thực tế**, không đếm nhóm như số cases. Tên/step mới đăng ký exact trong diagnostics/SafeReporter; không wildcard protocol, không raw Playwright output hoặc sensitive values.

Giữ nguyên 122 registrations baseline (EDIT20/AUTO16/SRC19/TAX35/MED32) và các assertion, gồm MED search exact-ID gate, transport/ABORTED semantics đã review, quota/journal/recovery guards. Không tăng retries/timeout. Default60s/expect10s, workers1/retries0; giữ overrides TAX-08/TAX-10/11 đã có. Discovery phải side-effect free.

Staging suite mới dùng helpers có quyền, auth contexts riêng và setup có journal; không phụ thuộc case trước tình cờ để lại body/cover/source. Restore các mutation role/status/owner được phép và giữ recovery evidence nếu lỗi. Không generic DB update hoặc prefix delete.

Manifest v4 đòi profiles rỗng: **không thêm AuthorProfile staging hoặc nới cleanup**. PREV-08 profile projection dùng real query/renderer qua local adapters, nêu rõ boundary; staging chỉ missing-profile fallback. Legacy/schema-v2/media fixtures dùng helpers sẵn có. Các negative payload không thể được tạo hợp lệ qua UI dùng local validation/render tests thay vì lách staging guard.

Read-only assertions phải so Article fields/token và relations trước/sau preview, không gom AUTH_LOGIN hoặc fixture setup thành “preview ghi”. Dirty/new-tab test kiểm soát debounce của editor như hỗ trợ hiện có; không dùng thay đổi timeout để né autosave. Browser request/body checks không log nội dung fixture/credential.

## 6. Local validation được phép và yêu cầu

- Dùng Node 22 đã chuẩn bị, ưu tiên Node **22.23.2** theo môi trường local trước; ghi đúng binary/runtime thực. Không tự nâng Node/Next/Prisma/Playwright/lockfile.
- Filtered env/dummy DB/auth và guard chặn đọc .env/kết nối DB theo wrapper hiện có. Windows allowlist phải giữ TEMP/TMP/WINDIR/USERPROFILE/LOCALAPPDATA cần thiết; không dùng env -i thiếu OS fields gây lỗi giả như trước.
- Nếu npm wrapper thoát sau banner hoặc lỗi, ghi đúng failure và dùng entrypoint Node tương ứng trong cùng env đã kiểm soát; không nhận exit code không có tests là PASS.
- Focused tests quyền/query/renderer/link/harness và full unit/action suite.
- ESLint, TypeScript noEmit, Playwright discovery qua SafeReporter, git diff --check; quét file mới riêng (Git diff chưa gồm untracked).
- Product code thay đổi nên build Next + media assembly trong snapshot cô lập với dummy env và standalone smoke hiện có. Không build vào nơi xóa artifacts QA/ops cũ. Dependencies là real directory/hardlink file theo cơ chế đã có; không tái tạo top-level junction thoát root Turbopack.
- Browser local probe dùng renderer/layout/CSS thật và khi cần Next production local để kiểm auth/cache semantics bằng adapters tổng hợp; ghi rõ thiếu MariaDB/Server Action thật nếu có. Không dùng image screenshot làm bằng chứng quyền hay DB.
- Chỉ mở rộng testing để phủ risk còn lại hoặc gate bắt buộc. Không rerun các gate lịch sử CMS-009, Linux candidate/provision/host smoke nếu không bị thay đổi.

Baseline CI cuối CMS-009 trên head71ffe là 884 PASS/1 SKIP (non-Linux guard). Đó là số lịch sử, không phải count bắt buộc của local Windows hoặc CI CMS-010. Các skip theo OS phải được giải thích và Linux CI thực chạy nhánh tương ứng sau review.

## 7. Báo cáo bàn giao local

Tạo `docs/cms/reports/CMS-010-implementation.md` trong diff UNSTAGED, gồm:

1. Base/branch/HEAD, file list đầy đủ modified/new, index/status và next.config normalized evidence.
2. Mapping 28 AC + 24 scenario groups → implementation/test thực tế; layer và giới hạn mocks rõ ràng.
3. Query/renderer/privacy/permission/no-write reasoning có source references; những lựa chọn implementation khác spec phải nêu cụ thể.
4. Commands, runtime, số pass/fail/skip/discovery và validation fail đã gặp/cách xử lý, không chỉ các lượt PASS.
5. Các case regression meaningful trước/sau nếu sửa bug; các nhánh chưa chạy Linux/Next/MariaDB ghi NOT RUN.
6. Ranh giới: local PASS không phải CI/staging/production PASS; Claude review/CI/staging cho CMS-010 chưa chạy; manual authenticated production smoke/UAT DEFERRED.
7. Bàn giao checklist Claude: read full diff/new files; fresh scope/all-status; renderer/XSS; private bytes; autosave/new-tab; no-write/cache; registry/manifest/19 counters.

Dừng khi diff local đã hoàn tất và validation đủ bằng chứng cho Claude, không stage. Nếu có blocker thật cần nguồn ngoài quyền hiện tại, ghi rõ phần đã làm và đúng blocker; không tự đòi production login/test thủ công.

## 8. Những checkpoint tiếp theo (chưa thực hiện trong nhiệm vụ này)

Claude independent review → Codex fix/Claude regression nếu có → commit/push reviewed delta và PR mới base main → CI exact head → automated guarded full **122+N** staging, provenance mới và 19 zero cleanup counters → ChatGPT final triage → merge/deploy → anonymous smoke/monitoring.

Nếu cần operator chạy guarded runner ở checkpoint sau, chuẩn bị một khối PowerShell hoàn chỉnh, tự khai báo biến, đúng commit/parent/Node/lock/tunnel/env/SQL identity; credential nhập kín trong terminal. Không đưa các mảnh lệnh phụ thuộc shell state như các sự cố trước. Đây là nhiệm vụ staging sau, không phải yêu cầu chạy ngay.

Không coi phần production manual chưa làm là blocker của task kế tiếp, không mở lại CMS-009 chỉ để lấy manual PASS. Chưa đánh CMS-010 COMPLETE khi mới local/spec.
