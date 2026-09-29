# CMS-007 — Release checkpoint và nghiệm thu thủ công còn lại

Updated: 2026-09-28 (UTC+7).
Current status: **DEPLOYED — manual authenticated production UAT DEFERRED theo PO; chưa COMPLETE**.

Báo cáo phát hành lúc trước ghi authenticated smoke PENDING. Quyết định PO lúc 18:11 ngày 28/09/2026 dời toàn bộ nghiệm thu thủ công đăng nhập/thao tác người dùng tới cuối dự án; status hiện hành xem [ACCEPTANCE](../ACCEPTANCE.md). PO tiếp tục giao “Triển khai cms 008”; đây không phải phép đổi nghiệm thu chưa chạy thành PASS.

## 1. Nguồn bằng chứng và provenance

| Mốc | Bằng chứng |
|---|---|
| Reviewed/tested implementation | `fe61d3dcd826e0b58586b8224c0afbf440096fcd` |
| Parent tài liệu | `36cca5f7a70371326d3008087950a11fc1c1845f` |
| PR #22 | MERGED, feature/cms-007-sources-citations được giữ |
| Actual merge main | `9bd3ec8e7cc55ebcaf8a9782868a3ac93fcc7a34` |
| Base trước merge | `6c74acbc25a8b7f76d48f376b075d9c2d2225831` |
| Local + Claude review/addendum | PASS theo reports do PO cung cấp; no blocking finding |
| CI | Run 36293810946, attempt 1, job 108548799648 validate SUCCESS; Node 22.23.2/npm 10.9.8; 612 tests và các gates PASS |
| CI synthetic merge | `8cbd38ea25c2ab33d8c03fd9fbe244ee5874ab28`, parents base 6c74acbc… + head fe61d3dc…; không phải actual release merge |
| Staging cuối | Claude thực chạy, PO cung cấp; không nhận là ChatGPT/Codex tự chạy |
| Production deploy | Run 36401463356, attempt 1, job 108860076040 build-and-deploy SUCCESS, push/main/head đúng actual merge |
| Anonymous production | Codex thực chạy theo báo cáo PO và PR; không phải ChatGPT browser verification |
| Git local sau phát hành | main đúng merge, tree/index sạch, ahead/behind 0/0 theo báo cáo PO; branch local/remote giữ |

Người chuẩn bị checkpoint đã trực tiếp đối chiếu GitHub PR #22 và run/job deploy trong phiên ngày 28/09: PR merged đúng head/merge SHA, deploy completed/success đúng push/main, bước Deploy to cPanel via SSH success. Main tiếp tục được đọc trực tiếp làm base CMS-008. Không tự chạy CI/staging/browser/SSH/DB để viết tài liệu này.

## 2. Lượt staging fail và recovery riêng

Run `144c0bc66b8e1ad5c085b747`, task b1r2mbbjc, BUILD_ID `eahugRG5HapiLXs6qldvz`, đúng fe61d3d…:
- 55 CASE: 10 passed / 4 failed / 1 timedOut / 40 skipped; Node exit 1.
- AUTO-14-REVOKED timeout tại login toHaveURL(/dashboard$/); các nhóm sau fail trước step hoặc skipped, không đủ bằng chứng để gán lỗi ứng dụng.
- STOP CLEANUP_NOT_VERIFIED; không có counters/VERIFIED của lượt gốc.
- Tunnel được ghi nhận không LISTENING sau đó, chưa có dữ liệu xác định thời điểm/nguyên nhân cascade.
- Sau khi mở lại tunnel, recovery đúng manifest có CHECK_ONLY exit 0:
  articles 20 / profiles 0 / users 6 / logs 11 / sources 0.
- APPLY qua guarded cleanup exit 0, CLEANUP_VERIFIED cả năm bằng 0; giữ manifest; không cleanup SQL thủ công.
- Recovery không biến verdict lượt gốc thành PASS. Nguyên nhân cascade cũ giữ UNDETERMINED.

## 3. Lượt staging cuối PASS

- Task `bot5q3nfs`.
- runId `b27c36765fec1e586f51b5ab`.
- BUILD_ID `Mo8ODgdwdymem1iN-zNAc`, build metadata commit đúng fe61d3d…; Codex release đã đối chiếu provenance theo PR.
- Node 22.23.2, Playwright 1.63.0.
- **55 passed / 0 failed / 0 timedOut / 0 skipped**: 20 EDIT + 16 AUTO + 19 SRC.
- CMS007_QA_EXIT_CODE=0.
- AUTO-14-REVOKED, AUTO-21, FMT_CODE_BLOCK→FMT_DB→reload, EDIT-13/14 cùng PASS.
- Source metadata/UTC+7/ms, unsafe URL/XSS, two tabs, hai commit orders source↔autosave, revocation, delete, +1ms, lost ACK, navigation/a11y đều có CASE PASS.
- Failed diagnostic attempts của expect.poll nội bộ không được tính thành case fail.

```text
CMS_E2E RESULT {"status":"passed"}
CMS_E2E CLEANUP {"articles":0,"profiles":0,"users":0,"logs":0,"sources":0}
CMS_E2E VERIFIED runId=b27c36765fec1e586f51b5ab commit=fe61d3dcd826e0b58586b8224c0afbf440096fcd
```

Lock release/app 3001 dừng/git sạch. Các mẫu listener 15:29:40–15:40:22 UTC+7 có PID 22296 / LISTENING; báo cáo nêu các khoảng không quan sát và listener không chứng minh DB khỏe liên tục. PASS thật do CASE/exit/SQL cleanup/VERIFIED, không do suy từ tunnel. Không khẳng định root cause của run cũ chỉ vì run mới PASS.

## 4. Merge/deploy/production observations

- PR #22 merge 16:07:06 ngày 28/09/2026 UTC+7.
- Workflow tự chạy push main, run 36401463356; SSH deploy SUCCESS 16:08:08–16:09:08, job hoàn tất 16:09:10 theo PR.
- Không dispatch trùng, manual SSH hoặc migration.
- Production https://lkcfintech.com.vn, Chromium mới chưa đăng nhập, chỉ GET/HEAD.
- Anonymous smoke 16:09:42–16:09:56: **7/7 HTTP/navigation/render checks PASS**.
  - Homepage và /dang-nhap HTTP 200/render đúng.
  - /creator, /creator/articles, /creator/articles/new, synthetic edit và synthetic sources route: 307 → login 200, auth guard trước article lookup.
- Raw smoke observer exit 1 do classifier thiếu suffix .Inspector. Bằng chứng gốc giữ nguyên; offline attribution đối chiếu 7 console errors/request failures với 7 POST /cdn-cgi/rum bị công cụ chặn. Không ghi raw observer exit 0 giả, không rerun để thay verdict gốc.
- Monitoring 16:13:42–16:18:45 UTC+7 (303 giây), 6 vòng × 2 trang: **12/12 HTTP 200/render PASS**, observer exit 0.
- Monitoring: 0 unhandled JS errors / HTTP >=400 / unexpected failures ; 12 blocked RUM POST khớp 12 console errors + request failures theo attribution cụ thể, không broad suppression.
- Không đăng nhập/tạo account/bài/sources hoặc đọc runtime logs. Anonymous checks không chứng minh authenticated CRUD/autosave hay toàn bộ server không lỗi.

## 5. Note và nghiệm thu còn lại

NOTE-01 vẫn nonblocking/không sửa: test-only alterFixture URL limit 4000 trong khi production 2048; chưa có test dùng 2049–4000. Không tự nhận intent legacy hay sửa ngoài scope CMS-008.

CMS-005/006/007 manual authenticated production acceptance hiện **DEFERRED — cuối dự án** theo PO mới. Danh mục case và nguồn lịch sử ở [ACCEPTANCE](../ACCEPTANCE.md). Technical release CMS-007 đã hoàn tất; CMS-007 chưa COMPLETE về toàn bộ nghiệm thu.

## 6. Bước tiếp theo

[CMS-008 Category/Topic/Tags/Instruments](../tasks/CMS-008.md), [handoff](../tasks/CMS-008-IMPLEMENTATION.md), base đúng merge này. Không chạy lại gate CMS-007 hay cleanup các run đã sạch để viết tài liệu.

- [PR #22](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/22)
- [CI 36293810946](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36293810946)
- [Deploy 36401463356](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36401463356)
- [Deploy job 108860076040](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36401463356/job/108860076040)
