# CMS-006 — Release checkpoint và nghiệm thu còn lại

Updated: 2026-09-27 (UTC+7).
Trạng thái: **DEPLOYED — authenticated production smoke/autosave PENDING; chưa COMPLETE**.

Product Owner ngày 2026-09-27 yêu cầu tiếp tục “Triển khai cms 007”. Cho phép chuẩn bị và triển khai CMS-007 từ main đã phát hành CMS-006; không thay đổi kết quả nghiệm thu còn thiếu thành PASS. CMS-005 authenticated smoke giữ DEFERRED theo quyết định trước.

## 1. Provenance và nguồn bằng chứng

| Mốc | Bằng chứng |
|---|---|
| Reviewed/tested head | `230f46c02b80d9257541dc955160c332857e4163` |
| Parent head | `aaa2ae8b8cff98f706f82ad99f37986af1a6d47b` |
| PR #21 | MERGED, giữ feature/cms-006-autosave |
| Merge commit main | `6c74acbc25a8b7f76d48f376b075d9c2d2225831` |
| Local + Claude review | PASS theo báo cáo Codex/Claude PO cung cấp; bao gồm AUTO-21 và FMT_CODE_BLOCK fixes |
| CI | Run 36254153773, attempt 1, validate job 108437632721 SUCCESS; 493 tests và các gate PASS theo logs/checkpoint đã đối chiếu |
| Staging | Claude thực chạy, PO cung cấp, không nhận là ChatGPT/Codex tự chạy |
| Deploy | Run 36286530195, attempt 1, build-and-deploy job 108528239508 SUCCESS, event push/main, head đúng merge SHA |
| Public production evidence | Codex smoke/monitoring thực chạy theo báo cáo PO và PR; không phải ChatGPT browser verification |
| Local git cuối release | main tại merge SHA, tree/index sạch, ahead/behind 0/0 theo báo cáo local PO cung cấp |

Người chuẩn bị checkpoint này đã đọc trực tiếp GitHub PR #21 và workflow run/jobs ngày 27/09/2026: PR merged đúng SHA, run deploy completed/success đúng push/main/head và bước Deploy to cPanel via SSH success. Không truy cập Windows workspace hay tự chạy lại CI/staging/production để viết tài liệu.

## 2. Staging cuối cùng

- Task Claude `bjsezgfgn` đã hoàn tất; không khởi động runner mới.
- Commit `230f46c02b80d9257541dc955160c332857e4163`.
- runId `843639a9bf993d961757c40a`.
- BUILD_ID `OFJWgyIEWte6fprp_D77b`; Codex local đối chiếu metadata và file BUILD_ID theo báo cáo phát hành.
- Node 22.23.2, Playwright 1.63.0.
- 36 passed / 0 failed / 0 timedOut / 0 skipped: 20 EDIT + 16 AUTO.
- FMT_CODE_BLOCK → FMT_DB → reload và AUTO-21 cùng PASS trên lượt này.
- EDIT-13/14, single-flight/lost-ACK/two-tab/revocation/precision PASS.
- CMS006_QA_EXIT_CODE=0.
- Cleanup articles/profiles/users/logs = 0/0/0/0; lock release, app 3001 dừng, git sạch.

```text
CMS_E2E VERIFIED runId=843639a9bf993d961757c40a commit=230f46c02b80d9257541dc955160c332857e4163
CMS_E2E RESULT {"status":"passed"}
```

Các lượt 35/36 trước là lịch sử điều tra, không bằng chứng lỗi còn tồn tại trên head cuối. DIAGNOSTIC failed của expect.poll nội bộ không tự đồng nghĩa CASE failed; report dựa CASE cuối cùng.

## 3. Merge/deploy và kiểm tra production

- PR merge lúc 08:46:02 ngày 27/09/2026 UTC+7.
- Deploy tự kích hoạt từ push main, không dispatch trùng/SSH thủ công/migration.
- Bước SSH deploy success; mọi bước job success.
- Smoke lúc 08:49:20–08:49:35 UTC+7:
  - / và /dang-nhap: HTTP 200, render đúng.
  - /creator, /creator/articles, /creator/articles/new, synthetic edit ID: 307 về /dang-nhap rồi 200, khớp anonymous guard trước lookup bài.
- Monitoring 08:49:35–08:54:38 UTC+7 ngày 27/09/2026 (5 phút 3 giây): 6 vòng × 2 trang công khai = 12/12 mẫu PASS.
- Không unhandled JS error, HTTP >=400 hoặc request failure ngoài bộ lọc trong phạm vi quan sát.
- Smoke + monitoring có 18 POST /cdn-cgi/rum bị công cụ GET/HEAD-only chặn và 18 console errors tương ứng, đã đối chiếu/tách khỏi lỗi ứng dụng theo report.
- Không credentials, đăng nhập, gõ editor, ghi dữ liệu production hoặc đọc runtime logs.

Giới hạn: không suy kết quả anonymous/5 phút thành mọi route/server/browser đều không lỗi, hoặc thành production autosave đã được kiểm thử bằng tài khoản đăng nhập.

## 4. Nghiệm thu còn lại — không chặn bắt đầu CMS-007

| ID | Trạng thái | Việc cần xác minh sau | Người thực hiện |
|---|---|---|---|
| CMS006-PROD-AUTH-01 | PENDING | Tài khoản có quyền mở CMS/list/editor đúng scope trên production | PO hoặc người kiểm thử được PO chỉ định |
| CMS006-PROD-AUTH-02 | PENDING | Trên bài nháp thử được phép, sửa nội dung → autosave ACK → reload giữ dữ liệu; manual save vẫn hoạt động | PO hoặc người kiểm thử được PO chỉ định |
| CMS006-PROD-AUTH-03 | PENDING | Tài khoản ngoài CMS bị chặn direct route đúng policy | PO hoặc người kiểm thử được PO chỉ định |
| CMS005-PROD-AUTH | DEFERRED | Checklist đăng nhập CMS-005 theo release checkpoint riêng | Theo quyết định PO trước |

Không đặt deadline hoặc tự tạo tài khoản/bài production. Autosave có thể ghi DB ngay khi gõ, nên smoke có dữ liệu phải có phạm vi record được phép. Không cần lặp lại 36 browser cases trên production chỉ để nghiệm thu smoke. Kết quả thực tế được bổ sung sau; COMPLETE không được suy từ việc đã deploy.

## 5. Bước tiếp theo và liên kết

CMS-007 — Sources/citations theo [spec](../tasks/CMS-007.md) và [implementation handoff](../tasks/CMS-007-IMPLEMENTATION.md). Đặc tả CMS-007 cập nhật roadmap với checkpoint này trong feature branch riêng, không tạo deploy mới hoặc sửa source CMS-006.

- [PR #21 — release evidence](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/21)
- [CI 36254153773](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36254153773)
- [Production deploy 36286530195](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36286530195)
- [Deploy job](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36286530195/job/108528239508)
- [CMS-005 release checkpoint](CMS-005-release-checkpoint.md)
- [CMS-006 implementation report — lịch sử](CMS-006-implementation.md)
- [AUTO-21 fix](CMS-006-auto21-navigation-fix.md)
- [FMT_CODE_BLOCK fix](CMS-006-fmt-codeblock-fix.md)
