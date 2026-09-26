# CMS-005 — Release checkpoint và nghiệm thu được hoãn

Updated: 2026-09-26 (UTC+7).
Status: **DEPLOYED — authenticated production smoke DEFERRED by Product Owner; chưa COMPLETE**.

## 1. Quyết định tiếp tục

Product Owner ngày 2026-09-26 chỉ thị “Tiếp tục lộ trình và kiểm thử đăng nhập sau”. Cho phép bắt đầu CMS-006 Autosave trên implementation đã merge. Đây là quyết định hoãn có ghi nhận; không phải xác nhận CREATOR/ANALYST đã kiểm thử production, không thay kết quả chưa chạy bằng giả định PASS. Không yêu cầu thực hiện lại smoke đã hoãn để mở task tiếp theo.

## 2. Bằng chứng triển khai

| Mốc | Bằng chứng |
|---|---|
| Implementation ban đầu | `7bdee2e22891942235c3f1eb2c01dfc414a473bf`; baseline staging 18/20, hai failure |
| Diagnostic patch | `8e19a8f1d6176858b0aa41e082a0807e568c400b`; hai failure cùng bước save→edit navigation |
| Root-cause fix | `cdb5a1b630ae416b6c600314c87e924643e31014`; attrs ProseMirror null prototype qua Flight, chuẩn hóa JSON ở hai chiều |
| Claude independent local review | PASS theo báo cáo PO cung cấp; 73/73 focused, 437/437 full tests; source/prototype/codec được xác minh độc lập |
| CI đúng fix head | [run 36131235754](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36131235754), [validate job 108058717723](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36131235754/job/108058717723), SUCCESS; Node 22.23.2, 437/437 tests |
| Merge | [PR #20](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/20), merge commit `6a726baa29f18df184497c3389d69a68d9086d44` |
| Production deploy | [run 36134885752](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36134885752), [build-and-deploy job 108070472232](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/36134885752/job/108070472232), SUCCESS gồm SSH deploy; event push/main, đúng merge SHA |

Các báo cáo local/staging/smoke/monitoring dưới đây là kết quả Codex/Claude do PO chuyển vào chat triển khai, không phải lượt kiểm thử do người soạn checkpoint này chạy lại. Repo main/base/merge ancestry đã được đối chiếu read-only trước khi tạo nhánh CMS-006. Không sao chép secrets hoặc raw artifacts vào hồ sơ này.

## 3. Staging xác minh fix

- Commit: `cdb5a1b630ae416b6c600314c87e924643e31014`.
- runId: `2bcd94fd6be0872026f7b9a1`.
- BUILD_ID: `b6vuICVMKMRjFv7X7R0Wq`.
- Node 22.23.2, Playwright 1.63.0, Chromium chromium-1243.
- **20 passed / 0 failed / 0 skipped**, exit 0.
- EDIT-04/05/06/21 và EDIT-18: save→navigation→DB→reload và kiểm tra nội dung định dạng/paste đều PASS; không chỉ pass bước click.
- EDIT-13 concurrency và EDIT-14 DATETIME(3) PASS trên MariaDB staging thật.

```text
CMS_E2E RESULT {"status":"passed"}
CMS_E2E CLEANUP {"articles":0,"profiles":0,"users":0,"logs":0}
CMS_E2E VERIFIED runId=2bcd94fd6be0872026f7b9a1 commit=cdb5a1b630ae416b6c600314c87e924643e31014
```

Lock released, app 3001 stopped, working tree clean theo báo cáo. Không chạy lại staging/cleanup để viết tài liệu này. Các lượt 50edda4dd148bf115c08eb60 và d58634e712b8c54e58ce5575 là lịch sử pre-fix, không dùng chúng làm bằng chứng fix PASS.

## 4. Production smoke và monitoring đã có

- Homepage: HTTP 200 và nội dung trang chủ render.
- `/dang-nhap`: HTTP 200 và form đăng nhập render.
- Phiên Chromium chưa đăng nhập: `/creator`, `/creator/articles`, `/creator/articles/new`, edit route với ID tổng hợp đều HTTP 307 về `/dang-nhap`, rồi login HTTP 200; chỉ GET/HEAD. Synthetic ID chỉ chứng minh auth guard trước route lookup, không chứng minh mở bài thật.
- Monitoring **22:25:25–22:30:29 ngày 25/09/2026 UTC+7**, 5 phút 4 giây: hai tab chưa đăng nhập, mỗi phút một lượt, mỗi trang 6 lượt HTTP 200/render bình thường.
- 0 unhandled JavaScript errors, render-error pages, HTTP >=400 hoặc unexpected failed requests trong phạm vi quan sát.
- 12 POST `/cdn-cgi/rum` bị công cụ GET/HEAD-only chủ động chặn, kèm 12 console BLOCKED_BY_CLIENT; đã đối chiếu request và ghi rõ, không tính là lỗi ứng dụng.
- Không có runtime logs trong bằng chứng monitoring; không kết luận toàn bộ server không có lỗi hoặc mọi trang authenticated đã được quan sát.

## 5. Phần DEFERRED — không ghi PASS

Owner: Product Owner hoặc tester được chỉ định sau. Thời hạn: chưa ấn định; không tự tạo lịch/reminder. Trước khi làm lại, ghi commit/deploy đang thực sự được kiểm tra; nếu site đã lên CMS-006 thì kết quả là cumulative smoke của phiên bản mới, không gán ngược thành smoke đã chạy trên bản CMS-005 cũ.

| ID | Thao tác bằng account production hiện có | Kết quả mong đợi | Trạng thái |
|---|---|---|---|
| CMS005-PROD-AUTH-01 | CREATOR đăng nhập, mở dashboard và /creator | Đúng role, điều hướng CMS và dashboard render bình thường | DEFERRED |
| CMS005-PROD-AUTH-02 | CREATOR mở /creator/articles | List/empty state và Tạo bài nháp hiển thị đúng scope | DEFERRED |
| CMS005-PROD-AUTH-03 | CREATOR mở /creator/articles/new | Form và editor render, không tạo bài chỉ vì mở trang | DEFERRED |
| CMS005-PROD-AUTH-04 | Nếu có nháp được phép, mở Chỉnh sửa mà không nhập/lưu | Nội dung persisted render đúng; nếu không có nháp ghi N/A với lý do | DEFERRED / conditional |
| CMS005-PROD-AUTH-05 | Đăng xuất CREATOR, đăng nhập ANALYST; nhập trực tiếp 3 CMS URLs trên | Đều về /dashboard, không hiển thị CMS | DEFERRED |

Không tạo tài khoản/fixture production. Không ghi bài test khi PO chưa chỉ định bài phù hợp. Sau CMS-006, gõ trên bài đã có có thể autosave; kiểm tra read-only phải chỉ mở/xem, không gõ rồi giả định chưa bấm Lưu là chưa có mutation.

Chỉ cập nhật trạng thái từng dòng sau bằng chứng thực tế. Hoàn tất bảng này cùng các gate đã đạt mới đóng nghiệm thu CMS-005 theo DoD hiện có, trừ khi PO ban hành quyết định nghiệm thu thay đổi được ghi rõ. Quyền tiếp tục CMS-006 đã được cung cấp, không cần yêu cầu PO xác nhận lại việc hoãn.
