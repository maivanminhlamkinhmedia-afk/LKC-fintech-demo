# LKC Financial Publishing — roadmap và checkpoint

Updated: 2026-09-30 (UTC+7)

Repository: maivanminhlamkinhmedia-afk/LKC-fintech-demo.
Nguồn: bàn giao Product Owner, GitHub và các báo cáo triển khai trong phiên. Checkpoint mới thay thế trạng thái cũ; giữ báo cáo lịch sử, không chạy lại gate đã hoàn tất chỉ vì tài liệu cũ còn pending.

**CMS-001..004 COMPLETE; CMS-005..008 DEPLOYED về kỹ thuật.** Manual authenticated UAT vẫn DEFERRED tới cuối dự án theo PO, không phải PASS và không chặn roadmap; xem [ACCEPTANCE](ACCEPTANCE.md).

**CMS-008 đã phát hành:** PR23 merged, main 89269dc806a9800f6582ea1a37a909aa60c944cd. Tested head3a5b135ac94a34bc21708cf232981ca452aa01ea; CI36582559834 SUCCESS với788tests; staging Claude thực chạy/PO cung cấp90/90PASS, runId33b5edd2e7ebaafd3070f220 / BUILD_ID XYB-lSk-r07z_FlL16mnx,13zero/exit0/VERIFIED. Deploy36592082460 SUCCESS đúng actual merge; anonymous9/9 và monitoring12/12 trong304giây PASS trong phạm vi báo cáo. Nguồn/giới hạn và lịch sử tại [release checkpoint](reports/CMS-008-release-checkpoint.md). CMS-008 chưa COMPLETE.

**Bước hiện tại: CMS-009 — Media library, LOCAL REVIEW-FIX HANDOFF.** Branch `feature/cms-009-media-library` từ main `89269dc…`, checkpoint tài liệu `b68f83f…`. [Spec40AC/36MED](tasks/CMS-009.md), [handoff Codex](tasks/CMS-009-IMPLEMENTATION.md), [storage runbook](operations/cms009-media-storage.md), [báo cáo implementation](reports/CMS-009-implementation.md), [báo cáo sửa sau review](reports/CMS-009-review-fixes.md). Claude independent review do Product Owner cung cấp đã xác định BUG-001 và các khoảng trống kiểm chứng; bản sửa local cần Claude delta review. CI/browser staging NOT RUN. Production storage chưa provision/verify; manual authenticated production UAT DEFERRED. Không đánh dấu COMPLETE.

## Quy trình delivery

ChatGPT spec/Acceptance Criteria → feature branch → Codex implementation + local validation → Claude Code independent review ONLY → Codex fix/Claude regression nếu có bug → PR/CI → automated staging/browser validation → final triage → merge main → production deploy → anonymous smoke/monitoring.

Manual UAT đăng nhập/thao tác thực hiện tập trung cuối dự án theo [quyết định PO](ACCEPTANCE.md). Khi PO yêu cầu, chuẩn bị bộ tài liệu để người khác kiểm chứng toàn bộ chức năng/yêu cầu. Hoãn manual UAT không bỏ technical gates hoặc biến kết quả chưa kiểm thử thành PASS.

Codex implementation và Claude Code review chạy trong VS Code theo cách làm của Product Owner; Claude không sửa code trong lượt review. Khối lệnh PowerShell dán vào terminal PowerShell, prompt nhiệm vụ dán vào chat Codex/Claude tương ứng; không kèm dấu nhắc terminal. npm.cmd/npx.cmd dùng khi cần tránh PowerShell execution-policy shim. Không yêu cầu secrets trong chat.

## Roadmap cố định

| Task | Nội dung | Trạng thái tại checkpoint |
|---|---|---|
| CMS-001 | Financial publishing domain schema | COMPLETE theo bàn giao; PR #15 |
| CMS-002 | Creator/Admin publishing RBAC | COMPLETE; PR #17 |
| CMS-003 | Author profiles | COMPLETE; PR #18 |
| CMS-004 | Creator dashboard | COMPLETE; PR #19, deploy/production smoke/staging cleanup PASS |
| CMS-005 | Draft editor + TipTap | DEPLOYED; technical release gates PASS; manual authenticated UAT DEFERRED tới cuối dự án; chưa COMPLETE |
| CMS-006 | Autosave | DEPLOYED; CI 493/staging 36/cleanup/release PASS; manual authenticated UAT/autosave DEFERRED theo PO ngày 28/09; chưa COMPLETE |
| CMS-007 | Sources/citations | DEPLOYED; CI 612 / staging 55 / cleanup 5 counters bằng 0 / deploy/anonymous smoke/monitoring PASS; manual authenticated UAT DEFERRED; chưa COMPLETE |
| CMS-008 | Category/Topic/Tags/Instruments | DEPLOYED; CI788/staging90/cleanup13/deploy/anonymous smoke/monitoring PASS; manual UAT DEFERRED; chưa COMPLETE |
| CMS-009 | Media library | LOCAL REVIEW-FIX HANDOFF; 40AC/36MED cập nhật trong delta report; Claude delta review/CI/staging NOT RUN; production root gate pending |
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
| CMS-020 | Playwright RBAC + editorial workflow full regression | Planned; nền tảng CMS-005 đã staging 20/20 PASS; không thay thế full workflow regression CMS-020 |

## CMS-008: checkpoint implementation lịch sử 2026-09-29

- Hai surfaces manual-only: `/creator/taxonomy` và `/creator/articles/[id]/classification`, dùng schema/quyền hiện có. Catalog identity bất biến/CAS/delete-used; Article CAS + category/mapping atomic, inactive retention, no-op và preserved body/source/owner.
- Controller giữ draft khi offline/conflict/unknown ACK, single-flight và dirty navigation; thêm links qua guard hiện có, không đổi autosave/native paste/AUTO-21/FMT fixes.
- Harness v3 kiểm ownership cả hai endpoints, reserved create intent và lost-ACK recovery; legacy v1/v2 không tăng quyền cleanup. Local mocks kiểm đủ 13 counters và rollback, chưa phải cleanup DB thật PASS.
- Local gates PASS; 761/761 tests, discovery 55 EDIT/AUTO/SRC baseline +35 TAX. [Báo cáo](reports/CMS-008-implementation.md) có file list, mapping 36 AC/32 TAX, lệnh/runtime và giới hạn. Không đổi schema/dependency/auth/deploy workflow.
- Chưa stage/commit/push. Tiếp theo: Claude independent review → commit/PR/CI khi được phép → automated guarded staging trên đúng commit CI PASS. Manual UAT DEFERRED theo ACCEPTANCE không chặn bước này, không được ghi PASS.

## CMS-007 → CMS-008: checkpoint lịch sử 2026-09-28

- PO yêu cầu triển khai CMS-008 đúng roadmap. Base là merge CMS-007 `9bd3ec8e7cc55ebcaf8a9782868a3ac93fcc7a34`; không implementation trên main.
- CMS-007 local/review/addendum/CI đã PASS; PR #22 và deploy metadata đã đối chiếu trực tiếp GitHub. Staging/browser observations do Claude/Codex thực chạy, PO cung cấp, không nhận là ChatGPT tự chạy.
- Lượt staging đầu `144c0bc66b8e1ad5c085b747` giữ FAIL (10 passed/ 4 failed/ 1 timedOut/ 40 skipped; CLEANUP_NOT_VERIFIED). Recovery sau đó qua guarded script CHECK_ONLY/APPLY exit 0, năm counters bằng 0. Nguyên nhân cascade chưa xác định chắc chắn.
- Lượt mới `b27c36765fec1e586f51b5ab`, BUILD_ID `Mo8ODgdwdymem1iN-zNAc`, đúng head fe61d3d…: 55/55 PASS, Node exit 0, five-counter cleanup 0/0/0/0/0 và VERIFIED. Không trộn số liệu hai lượt.
- Deploy run 36401463356/job 108860076040 SUCCESS đúng push/main/actual merge, gồm SSH deploy. Anonymous 7/7 HTTP/render; monitoring 16:13:42–16:18:45 ngày 28/09 UTC+7, 12/12 mẫu PASS. Raw smoke exit 1 do telemetry classifier thiếu .Inspector được giữ và attribution cụ thể, không ghi raw exit 0 giả.
- Nghiệm thu thủ công đăng nhập/source CRUD/autosave của CMS-005/006/007 chuyển DEFERRED cuối dự án theo chỉ thị PO mới; xem [ACCEPTANCE](ACCEPTANCE.md). Không suy từ anonymous/staging sang manual production PASS.
- CMS-008: quản trị catalogs bằng cms:admin, article classification bằng own/any + editable state, manual save, shared Article.updatedAt, không migration/dependency mới. Blueprint manifest v3 thêm exact catalog intents, category edges và composite mappings; không cấp quyền cleanup danh mục thật.
- Baseline local 612 / browser 55. Codex bổ sung tests theo actual coverage; discovery =55+N TAX, không cố định count chưa triển khai. Technical stages còn NOT RUN; dừng local với diff UNSTAGED cho Claude review.

## CMS-006 → CMS-007: checkpoint lịch sử 2026-09-27

- PO yêu cầu “Triển khai cms 007”; được tiếp tục từ implementation CMS-006 đã phát hành, giữ CMS-005 authenticated smoke DEFERRED và CMS-006 authenticated smoke/autosave PENDING.
- CMS-006 reviewed head `230f46c02b80d9257541dc955160c332857e4163`, PR #21 merge `6c74acbc25a8b7f76d48f376b075d9c2d2225831`. CI run 36254153773 SUCCESS, 493 tests và các gate PASS.
- Staging Claude thực chạy, PO cung cấp: runId `843639a9bf993d961757c40a`, BUILD_ID `OFJWgyIEWte6fprp_D77b`, 36/36 PASS, Node exit 0, VERIFIED đúng head, cleanup 0/0/0/0. AUTO-21 và FMT_CODE_BLOCK/FMT_DB/reload cùng PASS ở lượt cuối.
- Deploy run 36286530195/job 108528239508 SUCCESS đúng push/main/merge SHA, gồm Deploy to cPanel via SSH. Không migration/dispatch trùng.
- Anonymous smoke PASS; monitoring 08:49:35–08:54:38 ngày 27/09/2026 UTC+7, 12/12 mẫu PASS trong phạm vi homepage/login, 18 blocked RUM requests + console errors của toàn smoke/monitoring được đối chiếu theo report. Không runtime logs, không authenticated functional evidence.
- GitHub PR/deploy metadata được người chuẩn bị tài liệu đối chiếu trực tiếp; local tests/Claude staging và production browser results là bằng chứng PO cung cấp hoặc đã ghi trong PR, không nhận là tự chạy lại.
- CMS-007 local đã dùng schema hiện có; nguồn là danh mục tham chiếu của từng bài, không inline citation mark/public rendering/URL metadata fetch. Source mutations atomic với Article.updatedAt qua Serializable/CAS; local action/controller/harness tests PASS. Harness đã mở rộng exact SourceReference ownership cả hai đầu và cleanup thành 5 counters; chưa chạy fixture/cleanup thực tế. Giữ toàn bộ 36 EDIT/AUTO baseline, thêm19 SRC cases mới discovery. Report map đủ30 AC/24 SRC và tách LOCAL PASS/BROWSER NOT RUN.
- Thực hiện local implementation → Claude review → commit/PR/CI → staging đủ baseline + SRC mới → release như workflow hiện có. Không chạy lại gate của CMS-006 chỉ để cập nhật tài liệu, không mở lại cleanup cũ.

Các PENDING/NOT RUN trong checkpoint lịch sử phía trên được thay bằng trạng thái mới nhất ở đầu ROADMAP; quyết định DEFERRED ngày 28/09 nằm tại ACCEPTANCE.

## CMS-005 → CMS-006: quyết định và bằng chứng lịch sử

- Reviewed head CMS-005: `cdb5a1b630ae416b6c600314c87e924643e31014`; merge commit `6a726baa29f18df184497c3389d69a68d9086d44`, PR #20.
- CI run 36131235754 SUCCESS, Node 22.23.2, 437/437 tests. Staging mới runId `2bcd94fd6be0872026f7b9a1`, BUILD_ID `b6vuICVMKMRjFv7X7R0Wq`: 20/20 cases, exit 0, VERIFIED, cleanup articles/profiles/users/logs = 0/0/0/0; hai failure cũ đã hết.
- Deploy production run 36134885752 SUCCESS gồm SSH deploy, đúng merge commit. Không migration.
- Public/anonymous smoke PASS; monitoring 22:25:25–22:30:29 ngày 25/09/2026 UTC+7 PASS trong phạm vi hai trang chưa đăng nhập. Không có runtime logs; không mở rộng kết luận sang mọi trang/server.
- Nguồn kết quả review/staging/smoke/monitoring là báo cáo Codex/Claude do PO cung cấp; người cập nhật roadmap không nhận là đã tự chạy lại.
- Authenticated smoke CREATOR/ANALYST: **DEFERRED**, không giả định PASS. Checklist có IDs và người phụ trách tại [release checkpoint](reports/CMS-005-release-checkpoint.md). Được thực hiện sau theo quyết định PO, không chặn bắt đầu CMS-006.
- Checkpoint lịch sử implementation CMS-006: đã triển khai local tự lưu bài persisted sau 2.000 ms ngừng nhập; create đầu tiên thủ công, manual/auto chung single-flight, latest snapshot và ACK token; giữ draft khi conflict/offline/unknown result/session hết hạn. Không migration/dependency mới. Report map 30 AC/24 AUTO scenarios. Mốc local này đã được thay bằng review/CI/staging/deploy PASS ở checkpoint 2026-09-27 phía trên; report cũ giữ làm bằng chứng lịch sử.
- CMS-005 DoD và bằng chứng lịch sử được giữ; việc tiếp tục task sau không tự đóng nghiệm thu task trước. Không tạo lịch kiểm thử hoặc deadline khi PO chưa chỉ định.

## CMS-004: trạng thái đã đối chiếu

- Spec c74db740f37784870284a7218790a7559a1b0c73; implementation 45280cf9caab22282bb3c99f66944b60fe09223c.
- Bản bàn giao và mô tả PR ghi Codex/Claude PASS: dashboard 26/26, full suite 331/331, Prisma validate/generate, lint, TypeScript, build, diff-check.
- CI validate run 35850510814 SUCCESS, đã kiểm tra qua GitHub. CI ở checkpoint CMS-004 chưa chạy unit tests; không nhầm kết quả local 331/331 thành kết quả test trong CI. CMS-005 sau đó bổ sung bước unit tests sau Prisma generate; CI của transport fix đã 437/437 PASS, xem release checkpoint mới.
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

Không yêu cầu kiểm tra lại CREATOR/ANALYST hoặc staging responsive/ownership đã đạt khi không có thay đổi liên quan. Không bắt tạo thêm tài khoản production. CMS-004 COMPLETE. Product Owner đã chốt phạm vi CMS-005 gồm draft editor/lưu thủ công, quyền theo spec, chống ghi đè và Playwright foundation. Codex được triển khai theo [đặc tả](tasks/CMS-005.md) và [hướng dẫn implementation](tasks/CMS-005-IMPLEMENTATION.md). Dependency installation cần npm metadata/peer gate, không cần xin lại phê duyệt phạm vi. Các bước review, CI, staging và deploy CMS-005 sau đó đã PASS; authenticated production smoke được PO hoãn. Checkpoint 2026-09-26 ở đầu tài liệu thay thế trạng thái pending cũ.

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
