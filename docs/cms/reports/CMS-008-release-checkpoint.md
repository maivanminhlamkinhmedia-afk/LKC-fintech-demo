# CMS-008 — Technical release checkpoint

Recorded: 2026-09-30 (UTC+7).
Status: DEPLOYED; NOT COMPLETE. Manual authenticated production UAT: DEFERRED tới cuối dự án theo Product Owner.

## 1. GitHub evidence đã đối chiếu trực tiếp

- [PR23](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/23): MERGED, không draft.
- Tested head: 3a5b135ac94a34bc21708cf232981ca452aa01ea.
- Actual merge/main: 89269dc806a9800f6582ea1a37a909aa60c944cd; parents gồm base9bd3ec8e7cc55ebcaf8a9782868a3ac93fcc7a34 và tested head.
- [CI36582559834](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36582559834), attempt1: SUCCESS; validate109454247735, Node 22.23.2/npm10.9.8,788/788 tests,0failed/skipped/cancelled; install/Prisma / lint / TypeScript / build PASS.
- CI synthetic merge fc2b769dc32eb926d09a5e471bc38d25f6db43c4 khác actual merge, đã đối chiếu parents.
- [Deploy36592082460](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36592082460), attempt1, push/main, head đúng89269dc…: SUCCESS.
- build-and-deploy job109487474357 và Deploy to cPanel via SSH đều SUCCESS. Không dispatch deploy thêm.

## 2. Staging evidence — Claude thực chạy, PO cung cấp

Người ghi checkpoint không tự chạy lại staging.
- Task bbpvbi3ju, runId33b5edd2e7ebaafd3070f220, BUILD_ID XYB-lSk-r07z_FlL16mnx.
- Commit3a5b135… khớp active.lock lúc chạy và snapshot metadata theo report.
- 90/90PASS =20EDIT+16AUTO+19SRC+35TAX;0failed/timedOut/skipped/interrupted.
- TAX-08 body61030ms và TAX-10/11 body81940ms cùng PASS trong MỘT run, đủ graph/recovery/snapshot/REPLACE/CLEAR/DB/reload assertions.
- CMS008_QA_EXIT_CODE=0.
- Cleanup13 counters articles/profiles/users/logs/sources/categories/topics/tags/instruments/categoryLinks/topicMappings/tagMappings/articleInstruments đều0.
- CMS_E2E VERIFIED runId=33b5edd2e7ebaafd3070f220 commit=3a5b135ac94a34bc21708cf232981ca452aa01ea.
- Lock release, app3001 dừng, Git/index sạch theo report.

120s là bounded test budget của riêng TAX-08/TAX10, không chuẩn hiệu năng production hoặc bằng chứng đã xác định nguồn latency. TIMING.testTimeoutMs theo-step có thể stale60000. Lịch sử stagingFAIL vẫn được giữ ở PR/reports; không ghép các partial runs thành PASS và không biến lịch sử thành đãPASS.

## 3. Production observation — Codex báo cáo, PO cung cấp

Không nhận là người ghi checkpoint tự chạy browser/đọc runtime logs.
- Anonymous Chromium mới:9/9route checks PASS. Homepage/login200/render đúng;7CMS routes307→login200 đúng auth guard.
- Smoke ngày29/09/2026 khoảng22:47:08–22:47:21 UTC+7.
- Monitoring22:47:47–22:52:51 UTC+7,304 giây,6 vòng / 12 homepage-login samples:HTTP200/renderPASS,0 unhandled JavaScript errors.
- Tool chủ động chặn8 RUM POST trong smoke và12 trong monitoring; matching request/console errors được tách riêng. Không loại lỗi ứng dụng bằng quy tắc chung.
- Probe đầu bị ERR_NETWORK_ACCESS_DENIED trước HTTP do sandbox; probe được cấp network sau đó PASS. Không gọi lỗi công cụ đó là production outage.
- Không runtime logs, không authenticated CRUD/production UAT; không suy toàn server hoặc mọi chức năng production đều đã kiểm.

Local main fast-forward tới merge89269dc…, tree/index sạch,ahead/behind0/0 và giữ feature branch theo báo cáo PO, không phải filesystem Windows được người ghi trực tiếp truy cập.

## 4. Chuyển sang CMS-009

Không rerun CI/staging/cleanup/deploy của CMS-008 chỉ để cập nhật docs. Tài liệu này thay checkpoint local stale trong ROADMAP; giữ historical reports nguyên trạng.

CMS-009 Media library bắt đầu từ actual merge89269dc… trên feature branch riêng. CMS-005..008 manual UAT vẫn DEFERRED theo [ACCEPTANCE](../ACCEPTANCE.md), không chặn roadmap, không tự đổi DoD/COMPLETE.
