# LKC — Điểm vào chung cho phát triển cổng trả phí và CMS

Phiên bản bàn giao: 1.0, 08/10/2026 (UTC+7).

**Giao diện/chức năng v3: PO_APPROVED. Kiến trúc kỹ thuật: PROPOSED_FOR_INTEGRATION_REVIEW. Triển khai các phần mới: NOT_STARTED trong sổ này.** Không chuyển kết quả duyệt UI thành kết quả test, quyền chạy migration, merge hoặc thu tiền thật.

## Bắt đầu ở đây

1. Đọc [phạm vi đã duyệt](UI-BASELINE.md), nhất là danh mục màn hình và phần không đưa lên web.
2. Đọc [hợp đồng kiến trúc](ARCHITECTURE-CONTRACTS.md) và [bàn giao riêng cho developer CMS](CMS-INTEGRATION.md).
3. Chọn đúng việc ở [roadmap](ROADMAP.md); đăng ký phạm vi theo [quy tắc phối hợp](COORDINATION.md).
4. Viết task nhỏ theo [mẫu bàn giao](TASK-HANDOFF.md), đối chiếu [tiêu chí kiểm thử](ACCEPTANCE.md) và [quyết định còn mở](DECISIONS.md).

Các tài liệu này là đầu vào cho developer/Codex/Claude đọc trong repository. GitHub không tự hiểu nghiệp vụ, không tự chạy roadmap và không tự bảo đảm hai developer đã đọc cùng tài liệu. Phải có người nhận task, xác nhận contract và ghi bằng chứng.

## Phạm vi và thẩm quyền

PO đã duyệt chức năng, bố cục và hướng triển khai giao diện v3 trong cuộc trò chuyện. Bản này chuyển chúng thành hợp đồng triển khai và kế hoạch phối hợp. Không thiết kế lại trang chủ, không tạo website thứ hai, không thay CMS đang làm bằng một CMS khác.

Màn **00 — Tổng quan & hướng dẫn duyệt**, menu đổi màn, bộ chọn vai trò/quyền giả lập, ghi nhận xét và xuất phiếu duyệt chỉ là dụng cụ review prototype. **Không là chức năng production.** Bảng tổng quan tài khoản của khách và màn duyệt bài của nhân viên là chức năng thật, không được nhầm với màn 00.

Giữ nghiệp vụ: sản phẩm trả phí theo kỳ; đăng ký tài khoản có mã giới thiệu; CRM tách nguồn giới thiệu và người chăm sóc; đơn/thanh toán cấp quyền; khuyến nghị nhập tay có lịch sử; CMS miễn phí/trả phí dùng chung quyền sản phẩm. Chia phí tự động, quant, dữ liệu giá thật và đặt lệnh không thuộc đợt đầu.

## Snapshot GitHub đã kiểm tra khi soạn

- Repository: `maivanminhlamkinhmedia-afk/LKC-fintech-demo`.
- Main: `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`; tree `7311f80f23a95387b0ddd48bc315421b3f20425a`.
- Main mới là merge PR #26 về deploy/SSH; parent main `b1c822c9...` đã chứa merge CMS-010/PR #25. Không kết luận UAT/COMPLETE từ thông tin merge.
- Truy vấn PR mở trả về rỗng trước khi tạo PR tài liệu này. Các branch được trả về không xác định một task CMS-011 mới đang chạy. **PO cho biết có developer khác đang làm CMS; branch/local diff/task cụ thể chưa được người đó xác nhận.** Không coi không có PR là không có công việc song song.
- `docs/cms/ROADMAP.md` còn checkpoint CMS-010 local cũ; giữ lịch sử này, không dùng nó để phủ định merge đã quan sát.
- `CLAUDE.md` chứa mô tả legacy, bao gồm câu chưa có test runner; `package.json` hiện có `test:unit`, Playwright và guarded runner. Khi có mâu thuẫn trạng thái, kiểm tra source/package/workflow hiện hành; không xóa hay khởi tạo lại chức năng dựa vào mô tả cũ.
- `deploy.yml` chạy khi push main, không có lọc docs ở trigger đã đọc. **Merge PR chỉ tài liệu cũng có thể kích hoạt deploy.** Lượt bàn giao không tự merge hoặc dispatch.

Nguồn chính: [main đã đối chiếu](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/tree/5e6b14f006453da7f9b1554c210e9ad85a9f8c0c), [roadmap CMS](../cms/ROADMAP.md), [nghiệm thu CMS](../cms/ACCEPTANCE.md), [package](../../package.json), [deploy](../../.github/workflows/deploy.yml). CI/staging/production không được chạy lại trong lượt soạn tài liệu.

## Thứ tự nguồn sự thật

Yêu cầu PO đã duyệt xác định phạm vi mong muốn; code/commit và bằng chứng test xác định thực trạng đã triển khai. Không dùng một loại để thay thế loại kia. Với phần mới: UI-BASELINE xác định giao diện đã duyệt; contract/decision đã được cả hai owner ACK xác định giao tiếp; task spec xác định delta được làm. Roadmap CMS vẫn là sổ riêng của luồng CMS, không đổi số hoặc ghi đè trạng thái từ roadmap này.

Xung đột giữa tài liệu hoặc contract phải được ghi vào DECISIONS và đưa cho đầu mối tích hợp, không tự chọn phương án thuận tiện hoặc viết thêm hệ thống song song.

## Tài liệu tham chiếu giao diện

Bản HTML và các bản dự thảo gốc được giữ trong **gói bàn giao kèm cho PO**, với tên/hash tại UI-BASELINE. PR văn bản này không chứa toàn bộ HTML/ảnh gốc; không tuyên bố chúng đã được commit. Trước khi làm việc pixel/layout, developer cần bản tham chiếu đúng hash từ gói bàn giao. Không dùng sandbox URL trong code hoặc tài liệu triển khai production.

Không copy HTML prototype vào `public/`, iframe hoặc một production route. Prototype chứa dữ liệu giả và công cụ giả lập quyền, không phải mã ứng dụng an toàn.

## Việc tiếp theo

Developer CMS gửi checkpoint chỉ-đọc theo TASK-HANDOFF; người phụ trách portal gửi checkpoint tương tự. Đầu mối tích hợp chốt SUB-001 và các contract C01–C07 trước khi có thay đổi vào schema, quyền, writer Article hoặc media dùng chung. Đọc tài liệu/chụp checkpoint không yêu cầu bỏ công việc CMS độc lập đang làm.
