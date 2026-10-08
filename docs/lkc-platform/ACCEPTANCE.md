# Nghiệm thu liên thông và điều kiện phát hành

**Toàn bộ test/case dưới đây: NOT_RUN trong lượt tài liệu.** UI baseline được duyệt không có nghĩa phần mềm đang chạy. Kế thừa nguyên văn nghiệp vụ/tiêu chí CMS-ACCESS và Referral của blueprint v3 trong gói tham chiếu; bảng này bổ sung cách nhóm nghiệm thu, không xóa các case cũ hoặc thay lịch sử FAIL.

## 1. Evidence record cho mỗi gate

Ghi task/case IDs, repo HEAD/base, dependency versions, OS/Node, environment, DB/media fixture ownership, command, exit code, counts pass/fail/skip kèm lý do, artifacts đã che bí mật và người thực chạy. Staging thêm runId/BUILD_ID và cleanup counters thực của graph mới. “Discovery” không phải execute; “UI approved” không phải E2E; CI PASS không phải production UAT.

Mỗi PR UI map ID 01–19 và trạng thái của màn; so với reference đúng hash. Không copy bảng trạng thái Chưa duyệt của tệp gốc làm phủ định phê duyệt mới trong UI-BASELINE.

## 2. Các case cross-module tối thiểu

| ID | Kịch bản | Kết quả phải chứng minh |
|---|---|---|
| LKC-E2E-01 | Đăng ký có mã Sales A → verify → hồ sơ CRM | User/profile/nguồn nhất quán; không cấp subscription, không ghi hoa hồng |
| LKC-E2E-02 | Mã trống/sai/dừng; email trùng; retry; mã bị khóa đồng thời | Không partial writes/chiếm tài khoản; không âm thầm bỏ mã hoặc đổi nguồn cũ |
| LKC-E2E-03 | Đổi chăm sóc A → B / chuyển team | Tasks/scope chăm sóc theo workflow cũ; attribution và snapshot order giữ đúng |
| LKC-E2E-04 | Sales có referral nhưng ngoài chăm sóc | Chỉ DTO tối thiểu; notes/contact/tasks/export/hóa đơn không lộ |
| LKC-E2E-05 | Server tạo đơn từ gói; browser giả amount/product/user/referrer | Đơn đúng actor/price/term/referral version; không tin input cấp quyền |
| LKC-E2E-06 | Callback/confirm lặp, hai người xác nhận, mất ACK/restart | Một order cấp một kỳ; audit/event được dedupe; không mất tiền thật trùng cần đối soát |
| LKC-E2E-07 | Callback giả/sai merchant/amount/currency, muộn/đảo thứ tự | Không mở quyền sai; đối soát có trạng thái; success cũ không hồi sinh quyền revoked |
| LKC-E2E-08 | Gia hạn trước/sau hết kỳ, hai đơn đồng thời, refund một kỳ | Thời gian/currency nhất quán theo policy; không xóa quyền khác hoặc lịch sử |
| LKC-E2E-09 | Một CMS free và paid A; guest/client B/client A | Free đọc anonymous; paid chỉ A còn quyền; không CMS nội bộ cho CLIENT |
| LKC-E2E-10 | Draft/approved-only/scheduled/withdrawn; revision đang chờ | Không body ngoài; khách thấy đúng snapshot công bố cũ cho tới publish mới |
| LKC-E2E-11 | Free↔paid hoặc đổi products sau duyệt | Duyệt lại/version/audit, không source/body stale trong cache/prefetch |
| LKC-E2E-12 | Hết hạn đúng endsAt/revoke/disable user khi tab mở | Request mới chặn; no shared authorization cache/JWT paid flag; không hứa xóa bản đã tải |
| LKC-E2E-13 | Paid body qua HTML/Flight/API/search/OG/email/export/media | Negative response không có body/notes hay metadata chưa duyệt công khai |
| LKC-E2E-14 | Asset draft/phiên bản khác/delete-unused | Context guard đúng; không xóa references lịch sử; private storage không mở rộng |
| LKC-E2E-15 | Kèo B link bài A, bài free link kèo paid | Mỗi resource tự kiểm quyền; không embed dữ liệu vượt scope |
| LKC-E2E-16 | Giá/SL/TP/xác suất trống/sai, hai người sửa, unknown ACK | Validation rõ, giữ số nhập/nháp, conflict không mất dữ liệu, lịch sử không sửa đè |
| LKC-E2E-17 | UI 01–19 desktop/mobile/keyboard; guest/empty/error/locked | Nhận diện đúng, không tràn/hỏng action, labels/status dễ hiểu |
| LKC-E2E-18 | Build production không chứa công cụ duyệt | Không màn 00/menu giả quyền/confirm tiền demo/data mẫu hoặc prototype public |
| LKC-E2E-19 | Migration/rollback/mixed versions | Không bulk PUBLIC, không mất attribution/payment, reader cũ không bypass paywall |
| LKC-E2E-20 | CMS/CRM/Sheets/landing/auth regression và cleanup | Chức năng cũ giữ đúng, fixture mới được dọn đúng scope, không production writes |

## 3. Gắn lại tiêu chí CMS đã có trong dự thảo

CMS-ACCESS-AC01–03: thẻ, persistence, incomplete draft. AC04–11: free/paid/publish/entitlement và nội bộ. AC12–19: no-leak, cache, revisions, CAS, media, historical refs và liên kết chéo. AC20–24: referral độc lập quyền, thanh toán thống nhất, migration/rollback, regression/cleanup. Teaser tùy chọn trong AC18 của dự thảo cũ không nằm baseline UI hiện tại; test bản mặc định tắt, không xây tính năng teaser chưa duyệt.

REF-AC từ bản v3 giữ nguyên về code nguồn/verification/race/assignment/scope/order/retry/fee/refund. Không thay bằng việc field có mặt trên UI. Mỗi implementation task phải trích danh sách case áp dụng và bổ sung phần thiếu, không chỉ ghi “đã có test”.

## 4. Gate theo loại thay đổi

Docs-only: link/path/hash/source/consistency/no runtime delta và diff-check; không chạy migration hay full staging chỉ để duyệt văn bản. Nếu CI tự chạy khi mở PR thì ghi actual result khi đọc được, không tự đánh PASS.

Code: unit/action/contract, lint, TypeScript, build, independent review và staged integration theo scope. Commands phải đọc package/AGENTS/docs cục bộ ở phiên bản hiện tại, không dùng lệnh stale từ CLAUDE legacy. Nếu thay schema hoặc media, có runbook và fixtures tương ứng. Không skip gate tiền/quyền vì feature nhỏ.

Release: migration preflight+staging+rollback compatibility; đúng commit và build; closed feature gate tới khi đủ điều kiện; monitor/smoke theo phạm vi được giao. Không tự mở thêm runner hoặc thực hiện production UAT bằng tài khoản thật chưa được phép.

Manual authenticated UAT theo quyết định PO hiện hoãn tới đợt nghiệm thu cuối vẫn ghi DEFERRED. **Mở bán thật là quyết định riêng** sau paid flow kiểm tra đủ và các quyết định thương mại được chốt. Không giải thích DEFERRED thành PASS hoặc tự đổi lịch nghiệm thu.

## 5. Trạng thái hoàn tất

Có thể hoàn tất v1 của một task đúng phạm vi và chuyển sang task kế; không cần mọi feature tương lai. Nhưng module giả lập/thiếu auth/persistence/tiền không được gọi COMPLETE. Bảng kết quả phải tách UI approval, implementation, CI, staging, deploy và UAT; việc đạt một cột không tự điền các cột còn lại.
