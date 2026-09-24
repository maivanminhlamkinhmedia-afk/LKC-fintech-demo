# LKC Financial Publishing — roadmap và checkpoint

Updated: 2026-09-24

Repository: maivanminhlamkinhmedia-afk/LKC-fintech-demo.
Nguồn: bản bàn giao do Product Owner cung cấp ngày 2026-09-24, đối chiếu với GitHub và tiến độ trong chat triển khai. Bằng chứng mới hơn thay thế checkpoint cũ; không thực hiện lại thao tác đã hoàn tất chỉ vì bản bàn giao cũ còn ghi pending.

## Quy trình delivery

ChatGPT spec/Acceptance Criteria → feature branch → Codex implementation + local validation → Claude Code independent review ONLY → Codex fix/Claude regression nếu có bug → PR/CI → staging/browser validation → final triage → merge main → production deploy → smoke/monitoring.

Claude không sửa code trong lượt review. Hướng dẫn PowerShell dùng npm.cmd, npx.cmd, claude.cmd; không kèm dấu nhắc terminal. Không yêu cầu secrets trong chat.

## Roadmap cố định

| Task | Nội dung | Trạng thái tại checkpoint |
|---|---|---|
| CMS-001 | Financial publishing domain schema | COMPLETE theo bàn giao; PR #15 |
| CMS-002 | Creator/Admin publishing RBAC | COMPLETE; PR #17 |
| CMS-003 | Author profiles | COMPLETE; PR #18 |
| CMS-004 | Creator dashboard | Merged/deployed; còn xác nhận hồ sơ đóng task bên dưới |
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
| CMS-020 | Playwright RBAC + editorial workflow full regression | Planned; nền tảng E2E bắt đầu trong CMS-005 |

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

## Hồ sơ đóng CMS-004 còn thiếu

1. Chưa nhận được output cleanup staging chứng minh remaining_articles = 0, remaining_profiles = 0, remaining_users = 0. Không kết luận cleanup đã thành công và không chạy lại xóa dữ liệu một cách mù quáng. Nếu đã có output, chỉ bổ sung bằng chứng; nếu chưa có, kiểm tra read-only đúng staging trước.
2. Cần xác nhận smoke tối thiểu theo handoff đã đủ: homepage, login, /dashboard, /creator bằng tài khoản quản trị có sẵn. Login/dashboard/admin creator đã có ảnh hoặc ngữ cảnh; homepage chưa có xác nhận riêng.

Không bắt tạo thêm tài khoản production để đóng CMS-004. Không bắt test lại staging responsive/ownership. Có thể chuẩn bị spec CMS-005 trong lúc bổ sung hồ sơ; chưa ghi CMS-004 COMPLETE hoặc công bố 4/20 completed cho tới khi đủ bằng chứng.

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
