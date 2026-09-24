# LKC Financial Publishing — roadmap và checkpoint

Updated: 2026-09-24

Repository: maivanminhlamkinhmedia-afk/LKC-fintech-demo.
Nguồn: bản bàn giao do Product Owner cung cấp ngày 2026-09-24, đối chiếu với GitHub và tiến độ trong chat triển khai. Bằng chứng mới hơn thay thế checkpoint cũ; không thực hiện lại thao tác đã hoàn tất chỉ vì bản bàn giao cũ còn ghi pending.

Checkpoint mới nhất: production smoke CMS-004 đã PASS theo ảnh, thao tác kiểm tra role và xác nhận trang chủ bình thường của Product Owner. CMS-004 đã merge/deploy; chỉ còn xác nhận cleanup staging để đóng task. CMS-005 chỉ có bản đề xuất, chưa triển khai.

## Quy trình delivery

ChatGPT spec/Acceptance Criteria → feature branch → Codex implementation + local validation → Claude Code independent review ONLY → Codex fix/Claude regression nếu có bug → PR/CI → staging/browser validation → final triage → merge main → production deploy → smoke/monitoring.

Claude không sửa code trong lượt review. Hướng dẫn PowerShell dùng npm.cmd, npx.cmd, claude.cmd; không kèm dấu nhắc terminal. Không yêu cầu secrets trong chat.

## Roadmap cố định

| Task | Nội dung | Trạng thái tại checkpoint |
|---|---|---|
| CMS-001 | Financial publishing domain schema | COMPLETE theo bàn giao; PR #15 |
| CMS-002 | Creator/Admin publishing RBAC | COMPLETE; PR #17 |
| CMS-003 | Author profiles | COMPLETE; PR #18 |
| CMS-004 | Creator dashboard | Merged/deployed; production smoke PASS; còn xác nhận cleanup staging |
| CMS-005 | Draft editor + TipTap | DRAFT SPEC; chưa implementation |
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
| CMS-020 | Playwright RBAC + editorial workflow full regression | Planned; nền tảng E2E cùng CMS-005 mới là đề xuất, chưa phê duyệt |

## CMS-004: trạng thái đã đối chiếu

- Spec c74db740f37784870284a7218790a7559a1b0c73; implementation 45280cf9caab22282bb3c99f66944b60fe09223c.
- Bản bàn giao và mô tả PR ghi Codex/Claude PASS: dashboard 26/26, full suite 331/331, Prisma validate/generate, lint, TypeScript, build, diff-check.
- CI validate run 35850510814 SUCCESS, đã kiểm tra qua GitHub. CI hiện chưa chạy unit tests; không nhầm kết quả local 331/331 thành kết quả test trong CI.
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

## Hồ sơ đóng CMS-004 còn thiếu

Read-only staging check do Product Owner chạy đã xác minh:
- SSH tunnel 127.0.0.1:3307 kết nối được.
- DATABASE_URL target: host 127.0.0.1, port 3307, database edpmjmha_lkcstage, user edpmjmha_lkcstg.
- SELECT DATABASE()/CURRENT_USER() trả đúng staging identity.
- remaining_articles = 5, remaining_profiles = 1, remaining_users = 2.

Cleanup chưa hoàn tất. Bộ fixture trong handoff gồm 5 slug cms004-qa-draft/submitted/published/archived/foreign-draft, hồ sơ cms004-qa-creator, user ids cms004_qa_creator và cms004_qa_other.

Đã chuẩn bị [script vận hành CMS-004](operations/cms004-staging-cleanup.cjs), commit 443d6762ea184a8d48a55dcd72e1e93ea85fff91. Mặc định --check chỉ đọc; --apply kiểm tra lại staging identity, counts, slug/owner/status, profile/user identity và quan hệ trước khi xóa trong transaction Serializable. Dừng khi có liên kết ngoài fixture hoặc audit event ngoài AUTH_LOGIN của chính hai tài khoản QA. Xóa theo exact record ids; xử lý cả các AUTH_LOGIN fixture logs; không tự mở rộng phạm vi, retry, tắt FK hoặc reset/seed. Kết quả cuối cần RESULT = CLEANUP_VERIFIED và cả ba remaining_* = 0.

Validation của script: node --check PASS; 13 kiểm tra cô lập bằng Prisma mock PASS cho default read-only, sai URL/server identity, owner/profile/count/relations/audit mismatch, giữ dữ liệu ngoài fixture, rollback mô phỏng, hậu kiểm sau commit lỗi và already-clean rerun. Không kết nối database thật trong validation của agent; chưa có kết quả thực thi cleanup trên staging. Chờ output của Product Owner trước khi ghi CMS-004 COMPLETE.

Không yêu cầu kiểm tra lại CREATOR/ANALYST hoặc staging responsive/ownership đã đạt khi không có thay đổi liên quan. Không bắt tạo thêm tài khoản production. Ưu tiên hoàn tất CMS-004; giữ CMS-005 ở trạng thái DRAFT SPEC, chưa cài package hoặc triển khai. Chưa ghi CMS-004 COMPLETE hoặc công bố 4/20 completed cho tới khi đủ bằng chứng.

## Vận hành và giới hạn

- Production: https://lkcfintech.com.vn. Push main tự chạy .github/workflows/deploy.yml.
- CMS-001 staging/production migrations đã chạy và verify theo handoff. CMS-004 không có migration.
- Không chạy lại migrations/backup đã hoàn tất khi chưa có căn cứ mới.
- Không chạm danhgia.lkcfintech.com.vn hoặc evaluation database.
- Không tái tạo fixtures cms004-qa-* đã cleanup. Fixtures mới của CMS-005 phải có namespace riêng, dùng staging và có cleanup kiểm chứng.
- Không cài TipTap/Playwright trước khi spec CMS-005 được chốt.

## Bug ngoài CMS-004 được ghi nhận

Quản lý User: Product Owner xác nhận tạo email trùng khiến /admin/users hiện lỗi server; tạo email khác thành công. Cần fix riêng: trả lỗi EMAIL_CONFLICT với thông báo tại form, giữ input không nhạy cảm, không trả raw database diagnostics. Chưa có patch/regression/deploy cho bug này. Không ghi bug này là đã sửa; không tự gộp vào implementation editor.

## Liên kết bằng chứng

- [PR #19](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/19)
- [CMS-004 CI](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/35850510814)
- [Production deploy](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/35887183245)
- [CMS-005 draft spec](tasks/CMS-005.md)
