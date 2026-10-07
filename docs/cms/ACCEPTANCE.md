# Nghiệm thu thủ công — quyết định và sổ theo dõi

Updated: 2026-10-06 (UTC+7).
Decision owner: Product Owner (Minh LKC), chỉ thị 28/09/2026, tái xác nhận ngày 06/10/2026.

## 1. Quyết định có hiệu lực

PO sẽ giao người khác kiểm chứng các thao tác đăng nhập, chỉnh sửa và thực hiện tác vụ như người dùng sau khi hoàn thiện dự án. Khi đó PO sẽ yêu cầu ChatGPT viết bộ tài liệu kiểm thử toàn dự án.

Từ checkpoint này:
- Các mục manual authenticated production smoke/UAT chưa thực hiện được ghi **DEFERRED — chờ đợt nghiệm thu cuối dự án**.
- Quyết định này áp dụng CMS-005/006/007 và những phần phát triển tiếp theo; PENDING trong báo cáo lịch sử vẫn là trạng thái tại thời điểm viết, current state dùng bảng dưới.
- Không đánh manual UAT PASS khi chưa có bằng chứng. DEPLOYED không tự đồng nghĩa COMPLETE.
- Không chặn tiếp tục roadmap hoặc release kỹ thuật khi review/CI/staging/cleanup và điều kiện release của task đã đạt.
- Review code, unit/action tests, CI, automated browser/MariaDB staging/fixture cleanup vẫn giữ nguyên quy trình từng CMS.
- Không tự tạo lịch/đặt deadline hoặc chạy nghiệm thu production khi PO chưa giao tài khoản, môi trường và dữ liệu thử.
- PO tái xác nhận 06/10: xây xong CMS rồi thuê người khác test thủ công. **Toàn bộ phần manual authenticated production smoke**, kể cả đối chiếu UI/asset ID và xóa dữ liệu thử CMS-009 chưa hoàn tất, thuộc DEFERRED; không yêu cầu PO thực hiện tiếp để mở khóa CMS-010. Automated staging và anonymous release smoke vẫn giữ.

## 2. Sổ theo dõi hiện hành

| ID | Phạm vi nghiệm thu thủ công | Trạng thái | Bằng chứng hiện có / giới hạn |
|---|---|---|---|
| CMS005-PROD-AUTH | Đăng nhập, dashboard/list/new/editor, quyền CREATOR và role ngoài CMS | DEFERRED — cuối dự án | Đã có review/CI/staging và anonymous release; chưa thay bằng manual PASS |
| CMS006-PROD-AUTH-01 | Tài khoản có quyền mở CMS/list/editor đúng scope trên production | DEFERRED — cuối dự án | Chuyển từ PENDING theo quyết định PO mới |
| CMS006-PROD-AUTH-02 | Autosave/manual save/reload trên bài thử được phép | DEFERRED — cuối dự án | Chuyển từ PENDING; staging automated PASS không phải manual production evidence |
| CMS006-PROD-AUTH-03 | Tài khoản ngoài CMS bị chặn direct route | DEFERRED — cuối dự án | Giữ scenario, chưa đánh PASS |
| CMS007-PROD-AUTH-01 | Sources route/list/read, owner/foreign và quyền quản lý nguồn của bài | DEFERRED — cuối dự án | CMS-007 đã deploy, staging 55 PASS, anonymous route guard PASS |
| CMS007-PROD-AUTH-02 | Source create/update/delete/reload và tương tác token với autosave | DEFERRED — cuối dự án | Chưa thao tác production bằng tài khoản đăng nhập |
| CMS008-MANUAL-UAT | Quản trị danh mục; chọn category/topic/tag/instrument/primary; quyền và xung đột | DEFERRED — cuối dự án | DEPLOYED; review/CI788/staging90/cleanup13/deploy/anonymous smoke/monitoring PASS; chưa authenticated production UAT |
| CMS009-MANUAL-UAT | Upload/thư viện PNG-JPEG, alt/caption, delete-unused, Article cover và quyền | DEFERRED — cuối dự án | DEPLOYED kỹ thuật (PR24/merge5cbe3b8e); CI884 pass/1 OS skip, staging122 PASS tại12cc768, storage/deploy/anonymous smoke đạt theo phạm vi báo cáo; không đồng nghĩa manual UAT PASS |
| CMS009-MANUAL-SMOKE-CLEANUP | Nối đúng hai thẻ ảnh thử với receipt/object; read/reload/content URL; xóa đúng asset qua app và hậu kiểm | DEFERRED — cuối dự án | Có bằng chứng một phần PNG/JPEG committed/object đúng root; UI-to-ID và cleanup hai asset live chưa xác nhận. Giữ hồ sơ riêng, không xóa trực tiếp file/receipt/sentinel, không ghi cleanup PASS |
| CMS010-MANUAL-UAT | Preview bản đã lưu, định dạng/cover/sources/classification, own/foreign và new-tab khi editor còn input chưa lưu | DEFERRED — cuối dự án | SPEC READY; chưa implementation/review/CI/staging/deploy CMS-010. Checklist 24 scenario groups trong spec là kế hoạch coverage tự động/local, không phải manual PASS |
| FUTURE-MANUAL-UAT | Các task/module tiếp theo thực sự được triển khai | DEFERRED — áp dụng khi có chức năng | Thêm case IDs theo scope thật; không tự bịa trạng thái module chưa đọc |

Các ID CMS005/CMS006 được giữ để nối với release checkpoint cũ. Bảng này thay trạng thái pending/deferred hiện hành, không sửa kết quả lịch sử hay xóa các lỗi/giới hạn đã ghi.

## 3. Bộ tài liệu sẽ chuẩn bị khi PO yêu cầu cuối dự án

Mục tiêu: người kiểm thử không cần đọc code vẫn làm theo được.
- Mapping yêu cầu → module/chức năng → case ID → vai trò và tiền đề.
- Môi trường/phiên bản được kiểm thử; tài khoản và bài/dữ liệu thử được PO cho phép, không ghi mật khẩu trong tài liệu.
- Các bước thao tác cụ thể, input mẫu, kết quả mong đợi ở UI và tiêu chí PASS/FAIL; phân biệt trường hợp được phép/bị từ chối.
- Thao tác tạo/sửa/xóa, lưu/khôi phục, cancel/navigation, quyền/ownership, responsive và lỗi nghiệp vụ phù hợp từng module.
- Biểu mẫu kết quả thực tế, screenshot/bằng chứng đã che dữ liệu nhạy cảm, BUG-xxx, severity và regression sau sửa.
- Setup/reset/dọn dữ liệu thử có phạm vi rõ; không hướng dẫn xóa chung production.
- Checklist tổng hợp coverage và những mục chưa kiểm chứng.

Đây là kế hoạch bàn giao tài liệu, chưa phải bộ test case cuối cùng hoặc bằng chứng UAT đã chạy. Automated technical gates tiếp tục ghi ở report/PR riêng.

## 4. Liên kết

- [Roadmap](ROADMAP.md)
- [CMS-005 release](reports/CMS-005-release-checkpoint.md)
- [CMS-006 release](reports/CMS-006-release-checkpoint.md)
- [CMS-007 release](reports/CMS-007-release-checkpoint.md)
- [CMS-008 release](reports/CMS-008-release-checkpoint.md)
- [CMS-008 spec](tasks/CMS-008.md)
- [CMS-009 spec](tasks/CMS-009.md)
- [CMS-010 spec](tasks/CMS-010.md)
- [CMS-010 handoff Codex](tasks/CMS-010-IMPLEMENTATION.md)
