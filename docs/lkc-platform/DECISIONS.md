# Sổ quyết định và các điều chưa được phép tự suy

Ngày 08/10/2026. Chỉ D-001/D-002 dưới đây ghi nhận phạm vi giao diện từ PO; thiết kế chi tiết kỹ thuật còn cần ACK và chính sách thương mại còn cần PO. Tài liệu không gán tỷ lệ, giá hoặc kết quả kiểm thử.

| ID | Quyết định / câu hỏi | Trạng thái | Owner / ảnh hưởng |
|---|---|---|---|
| D-001 | Dùng giao diện chức năng v3, 19 màn chính; giữ nhận diện website và bổ sung referral/CMS rights | PO_UI_APPROVED | UI-BASELINE |
| D-002 | Màn 00 và thanh công cụ duyệt không đưa lên website; chúng chỉ giúp chọn màn/giả lập/ghi ý kiến | RECORDED_PROTOTYPE_BOUNDARY | Giữ đúng tài liệu mẫu; không loại bỏ tổng quan khách/review bài thật |
| D-003 | CMS task/branch/HEAD/local paths thực sự đang làm; ai là Integrator và owner mỗi lane | WAITING_CHECKPOINT | CMS + Portal + PO; chặn shared-file claim, không chặn đọc/spec |
| D-004 | C01–C07: tên port/path/signature, schema vật lý, revision/published pointer và lock order | WAITING_TECHNICAL_ACK | CMS + Portal + Integrator; chặn implementation boundary tương ứng |
| D-005 | Tên sản phẩm/gói, giá/currency/tax, quyền lợi, ngày hay tháng lịch, activation/grace/cancellation/history | WAITING_PO | Chặn mở bán gói; không chặn test với fixtures ghi rõ giả |
| D-006 | Phương thức thanh toán thật, đơn vị nhận, merchant/provider, quyền đối soát/refund, giao dịch muộn/trùng | WAITING_PO_AND_PROVIDER_CONTRACT | Chặn live PAY; sandbox/mock tách production |
| D-007 | Tỷ lệ/cơ sở phí, lần đầu/gia hạn/mua thêm, holding period, thuế/hoàn tiền/nhân viên nghỉ và approval payout | DEFERRED_COMMISSION | COMM-001; không chặn ghi nguồn hoặc paid access hợp lệ |
| D-008 | Gán khách mới cho referrer chăm sóc tự động; quyền team xem referral lịch sử khi chuyển đội | WAITING_PO_SCOPE | Không bật autoassign/team financial view bằng mặc định ngầm |
| D-009 | Onboarding existing users, email verification migration, retention/tombstone lịch sử | WAITING_TECHNICAL_AND_PO_POLICY | Chặn migration liên quan; không khóa hàng loạt user cũ |
| D-010 | Quyền lợi đọc lịch sử CMS/REC, điều chỉnh audience, hoàn tiền khi thay quyền lợi | WAITING_COMMERCIAL_POLICY | CMS mặc định không phát mọi body version cũ; scope v1 theo contract tạm rõ |
| D-011 | Release paid-flow, người nghiệm thu, môi trường và tài khoản được phép | NOT_AUTHORIZED_BY_UI_APPROVAL | Chặn thu phí/production UAT tự phát |

## Đề xuất kỹ thuật được giữ từ blueprint nhưng chưa biến thành điều khoản bán hàng

Khoảng quyền `[startsAt, endsAt)`, gia hạn bằng max(now, kỳ hiện hữu), fixed-day plan cho đợt đầu, snapshot attribution tại lúc lập đơn và dùng DB outbox/retry đều là hướng đề xuất để chốt trong task liên quan. Các điểm nghiệp vụ đã rõ như referrer khác assignee, paid cần product access và không sửa đè lịch sử không được phá vỡ khi chốt implementation.

## Mẫu ghi thay đổi

D-ID; ngày/actor; nguồn yêu cầu; trạng thái trước/sau; quyết định chính xác; UI/task/contract impacted; migration/test cần thay; producer/consumer ACK; PO approval khi đổi phạm vi/tiền/quyền. Không thay lịch sử entry bằng cách xóa; thêm revision/correction liên kết.

Không dùng việc PO duyệt giao diện để điền Approved cho mọi dòng. Không ngầm sửa kiến trúc khi chỉ yêu cầu đổi chữ/nút.
