# LKC Financial Publishing — roadmap và checkpoint

Updated: 2026-09-24

Repository: maivanminhlamkinhmedia-afk/LKC-fintech-demo.
Nguồn: bản bàn giao do Product Owner cung cấp ngày 2026-09-24, đối chiếu với GitHub và tiến độ trong chat triển khai. Bằng chứng mới hơn thay thế checkpoint cũ; không thực hiện lại thao tác đã hoàn tất chỉ vì bản bàn giao cũ còn ghi pending.

Checkpoint mới nhất: CMS-004 COMPLETE. PR #19 đã merge/deploy, production smoke PASS và Product Owner đã chạy cleanup staging thành công: CLEANUP_COMMITTED = YES, remaining_articles/profiles/users = 0, RESULT = CLEANUP_VERIFIED. CMS-001 đến CMS-004 đã hoàn tất (4/20 nhiệm vụ, không phải ước lượng phần trăm khối lượng). CMS-005 đã có implementation local theo phạm vi Product Owner duyệt ngày 2026-09-24: editor/lưu thủ công, scoped actions, unit/action tests và Playwright/runbook. Xem [báo cáo implementation CMS-005](reports/CMS-005-implementation.md) để đối chiếu từng kết quả. Bước tiếp theo là Claude independent review; CI và browser/MariaDB staging vẫn chưa chạy. CMS-005 chưa COMPLETE.

## Quy trình delivery

ChatGPT spec/Acceptance Criteria → feature branch → Codex implementation + local validation → Claude Code independent review ONLY → Codex fix/Claude regression nếu có bug → PR/CI → staging/browser validation → final triage → merge main → production deploy → smoke/monitoring.

Claude không sửa code trong lượt review. Hướng dẫn PowerShell dùng npm.cmd, npx.cmd, claude.cmd; không kèm dấu nhắc terminal. Không yêu cầu secrets trong chat.

## Roadmap cố định

| Task | Nội dung | Trạng thái tại checkpoint |
|---|---|---|
| CMS-001 | Financial publishing domain schema | COMPLETE theo bàn giao; PR #15 |
| CMS-002 | Creator/Admin publishing RBAC | COMPLETE; PR #17 |
| CMS-003 | Author profiles | COMPLETE; PR #18 |
| CMS-004 | Creator dashboard | COMPLETE; PR #19, deploy/production smoke/staging cleanup PASS |
| CMS-005 | Draft editor + TipTap | IMPLEMENTED LOCAL; chuyển Claude review; CI NOT RUN, browser/MariaDB STAGING PENDING; xem implementation report |
| CMS-006 | Autosave | Planned |
| CMS-007 | Sources/citations | Planned |
| CMS-008 | Category/Topic/Tags/Instruments | Planned |
| CMS-009 | Media library | Planned |
| CMS-010 | Preview | Planned |
| CMS-011 | Editorial review workflow | Planned |
| CMS-012 | Fact-check/request changes | Planned |
| CMS-013 | Revision history | Planned |
| CMS-014 | SEO/structured data | Planned |
| CMS-015 | Publish/schedule/unpublish | Planned |
| CMS-016 | Public article page | Planned |
| CMS-017 | Correction/update history | Planned |
| CMS-018 | Audit integration | Planned |
| CMS-019 | Search/archive/related | Planned |
| CMS-020 | Playwright RBAC + editorial workflow full regression | Planned; CMS-005 đã chuẩn bị nền tảng Chromium/runbook, chưa thực thi staging |

## CMS-004: trạng thái đã đối chiếu

- Spec c74db740f37784870284a7218790a7559a1b0c73; implementation 45280cf9caab22282bb3c99f66944b60fe09223c.
- Bản bàn giao và mô tả PR ghi Codex/Claude PASS: dashboard 26/26, full suite 331/331, Prisma validate/generate, lint, TypeScript, build, diff-check.
- CI validate run 35850510814 SUCCESS, đã kiểm tra qua GitHub. CI ở checkpoint CMS-004 chưa chạy unit tests; không nhầm kết quả local 331/331 thành kết quả test trong CI. CMS-005 bổ sung bước unit tests sau Prisma generate; lượt CI mới chưa chạy.
- Staging ownership/profile PASS theo bàn giao: own articles 4, draft 1, editorial 1, published 1; foreign article không xuất hiện.
- Staging responsive desktop/mobile 390px/tablet 768px PASS theo bàn giao. Không yêu cầu chạy lại các kiểm tra này nếu không có thay đổi liên quan.
- PR #19 đã MERGED, merge commit 9bb1a289526726e494243fb14a597345b27bfd3b.
- Production deploy run 35887183245 SUCCESS, gồm bước SSH deploy.
- Product Owner đã fast-forward main local đến 9bb1a28.
- Ảnh production: SUPER_ADMIN mở được Creator Dashboard, empty state/profile missing render được; cửa sổ ẩn danh hiển thị /dang-nhap; CLIENT ở /dashboard, không có menu CMS.
- Ảnh CLIENT xác minh navigation; kết luận direct-route denial còn phụ thuộc việc ảnh được chụp sau truy cập /creator, không chỉ sau login.
- Browser của phiên triển khai bị ERR_BLOCKED_BY_CLIENT khi mở production; không tính là production outage hoặc bằng chứng smoke FAIL.

## Production smoke đã đạt

- Homepage — PASS theo xác nhận trực tiếp của Product Owner: “xác nhận bình thường” sau yêu cầu mở https://lkcfintech.com.vn. Cùng bằng chứng login/dashboard, SUPER_ADMIN, CREATOR và ANALYST trong chat, phần production smoke đã đạt. Không phải kết quả browser automation của agent.

- CREATOR — PASS truy cập/giao diện: ảnh tài khoản content, role Người tạo nội dung, tại /dashboard có menu và thẻ Khu người tạo nội dung; /creator mở được, bốn metrics bằng 0, danh sách bài và hồ sơ tác giả có empty states đúng. Bằng chứng: hai ảnh 1679866a-a3aa-4669-942a-9833217662cb.png và 56075950-5cca-4e96-abcc-2d8984538c34.png do Product Owner gửi trong chat.
- Empty state không tự chứng minh ownership isolation. Kiểm tra own/foreign có dữ liệu đã PASS ở staging theo bàn giao, không yêu cầu làm lại trên production.
- ANALYST — PASS navigation: ảnh tài khoản ANALYST, role Chuyên viên phân tích, tại /dashboard không có menu/thẻ Khu người tạo. Ảnh 8f47f301-13d8-4bb0-b442-290d2134cfd3.png là sau login, chỉ dùng làm bằng chứng navigation.
- ANALYST — PASS manual direct-route check theo thao tác được hướng dẫn và phản hồi người dùng: sau yêu cầu nhập trực tiếp https://lkcfintech.com.vn/creator rồi Enter, Product Owner báo “trang vẫn đứng như thế” và gửi ảnh e8de0772-f30b-4cbd-9f58-37544311b501.png với địa chỉ /dashboard, đúng role ANALYST, không có CMS. Ghi nhận kết quả trả về dashboard; đây là manual smoke do người dùng thực hiện, không phải browser automation/network trace của agent.

## Cleanup staging — PASS

Read-only staging check trước cleanup do Product Owner chạy đã xác minh:

- SSH tunnel 127.0.0.1:3307 kết nối được.
- DATABASE_URL target: host 127.0.0.1, port 3307, database edpmjmha_lkcstage, user edpmjmha_lkcstg.
- SELECT DATABASE()/CURRENT_USER() trả đúng staging identity.
- Trước cleanup: remaining_articles = 5, remaining_profiles = 1, remaining_users = 2.

Product Owner đã chạy --apply trên đúng staging và gửi output thành công trong chat ngày 2026-09-24. Bộ fixture đã dọn gồm 5 slug cms004-qa-draft/submitted/published/archived/foreign-draft, hồ sơ cms004-qa-creator, user ids cms004_qa_creator và cms004_qa_other, cùng 1 AUTH_LOGIN fixture log.

```text
MODE = APPLY
TARGET = {"host":"127.0.0.1","port":3307,"database":"edpmjmha_lkcstage","user":"edpmjmha_lkcstg"}
STAGING_IDENTITY = OK
FIXTURE_PREFLIGHT = OK
fixture_articles = 5
fixture_profiles = 1
fixture_users = 2
fixture_login_logs = 1
CLEANUP_COMMITTED = YES
remaining_articles = 0
remaining_profiles = 0
remaining_users = 0
RESULT = CLEANUP_VERIFIED
```

Đây là bằng chứng thực thi do Product Owner cung cấp. Không yêu cầu chạy lại cleanup đã hoàn tất.

Đã dùng [script vận hành CMS-004](operations/cms004-staging-cleanup.cjs), commit 443d6762ea184a8d48a55dcd72e1e93ea85fff91. Mặc định --check chỉ đọc; --apply kiểm tra lại staging identity, counts, slug/owner/status, profile/user identity và quan hệ trước khi xóa trong transaction Serializable. Dừng khi có liên kết ngoài fixture hoặc audit event ngoài AUTH_LOGIN của chính hai tài khoản QA. Xóa theo exact record ids; xử lý cả các AUTH_LOGIN fixture logs; không tự mở rộng phạm vi, retry, tắt FK hoặc reset/seed. Kết quả cuối đã đạt RESULT = CLEANUP_VERIFIED và cả ba remaining_* = 0.

Validation của script: node --check PASS; 13 kiểm tra cô lập bằng Prisma mock PASS cho default read-only, sai URL/server identity, owner/profile/count/relations/audit mismatch, giữ dữ liệu ngoài fixture, rollback mô phỏng, hậu kiểm sau commit lỗi và already-clean rerun. Agent chỉ kiểm tra cô lập; kết quả thực thi staging do Product Owner cung cấp riêng ở trên. Cùng PR/CI, staging validation, deploy và production smoke đã ghi nhận, hồ sơ đóng CMS-004 đã đủ.

Không yêu cầu kiểm tra lại CREATOR/ANALYST hoặc staging responsive/ownership đã đạt khi không có thay đổi liên quan. Không bắt tạo thêm tài khoản production. CMS-004 COMPLETE. Product Owner đã chốt phạm vi CMS-005 gồm draft editor/lưu thủ công, quyền theo spec, chống ghi đè và Playwright foundation. Codex được triển khai theo [đặc tả](tasks/CMS-005.md) và [hướng dẫn implementation](tasks/CMS-005-IMPLEMENTATION.md). Dependency installation cần npm metadata/peer gate, không cần xin lại phê duyệt phạm vi. Các bước review, CI, staging và deploy CMS-005 vẫn chưa thực hiện.

## Vận hành và giới hạn

- Production: https://lkcfintech.com.vn. Push main tự chạy .github/workflows/deploy.yml.
- CMS-001 staging/production migrations đã chạy và verify theo handoff. CMS-004 không có migration.
- Không chạy lại migrations/backup đã hoàn tất khi chưa có căn cứ mới.
- Không chạm danhgia.lkcfintech.com.vn hoặc evaluation database.
- Không tái tạo fixtures cms004-qa-* đã cleanup. Fixtures mới của CMS-005 phải có namespace riêng, dùng staging và có cleanup kiểm chứng.
- Spec CMS-005 đã chốt; Codex được cài đúng TipTap/Playwright pins sau metadata/peer check. Nếu version không có hoặc xung đột, báo blocker để điều chỉnh; không tự force, đổi runtime hoặc nới scope.

## Bug ngoài CMS-004 được ghi nhận

Quản lý User: Product Owner xác nhận tạo email trùng khiến /admin/users hiện lỗi server; tạo email khác thành công. Cần fix riêng: trả lỗi EMAIL_CONFLICT với thông báo tại form, giữ input không nhạy cảm, không trả raw database diagnostics. Chưa có patch/regression/deploy cho bug này. Không ghi bug này là đã sửa; không tự gộp vào implementation editor.

## Liên kết bằng chứng

- [PR #19](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/19)
- [CMS-004 CI](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/35850510814)
- [Production deploy](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/35887183245)
- [CMS-005 approved spec](tasks/CMS-005.md)
