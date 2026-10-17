# Bàn giao riêng cho developer đang làm CMS

**Mục tiêu:** tiếp tục CMS theo roadmap hiện hữu, đồng thời tránh phải làm lại quyền bài/phiên bản khi portal trả phí được nối vào. Không yêu cầu dừng toàn bộ CMS, không takeover nhánh của developer khác.

## 1. Checkpoint bắt buộc trước vùng giao nhau

PO báo CMS đang được triển khai ở một developer khác. Tại lúc soạn, main là `5e6b14f0...`, không thấy PR mở trước PR docs; chưa xác nhận branch/task/local changes của developer đó. Gửi ACK theo mẫu trong TASK-HANDOFF với task CMS hiện tại, branch, HEAD, base, dirty/staged paths, schema/migrations đang làm, publish/version contract và gate gần nhất. Không gửi secrets. Không reset, stash, checkout hoặc cleanup hộ người khác.

Đang làm CMS độc lập thì tiếp tục phần đó theo scope được giao. Chỉ chặn file/contract dùng chung khi chưa thống nhất, không chặn mọi công việc chỉ vì acknowledgment chưa có.

## 2. Những gì đã được PO duyệt và cần CMS hỗ trợ

Màn 14 có thẻ quyền đọc ngay editor hiện hữu. PUBLIC: đọc ngoài khi xuất bản; PAID_PRODUCT: login + sản phẩm còn quyền. Cấu hình chưa xong được lưu nháp nhưng không publish. Nhiều products áp dụng OR. Màn 15 người duyệt thấy audience. Màn 16/17 public feed/reader; màn 18 khách xem theo gói; màn 19 locked/readable states.

Không đưa màn 00 hoặc selector giả quyền của prototype lên web. Không thêm CLIENT vào quyền quản trị CMS. Không biến saved preview CMS-010 thành public reader. Không lấy nội dung giả trong HTML làm seed thật.

## 3. Ghép vào roadmap CMS — không renumber

| CMS hiện hữu | Bổ sung cần phối hợp | Ai giữ implementation |
|---|---|---|
| CMS-005/006 | Metadata trong form/query/validator/writer/autosave/CAS, không writer thứ hai đua nhau | CMS owner, task delta CMS-ACCESS-001.A |
| CMS-009/010 | Quan hệ asset/version và private preview giữ nguyên phạm vi | CMS/media owner; Portal cung cấp contract đọc subscriber |
| CMS-011/012 | Reviewer nhìn audience; nội dung/audience đổi sau duyệt thì duyệt lại | CMS owner |
| CMS-013 | Snapshot accessMode/products cùng nội dung; immutable revision và published view | CMS owner, ACK C03 |
| CMS-014 | Public metadata không leak body/paid title ngoài chính sách | CMS owner |
| CMS-015 | Publish/schedule/unpublish áp dụng policy của chính bản duyệt | CMS owner |
| CMS-016 | Một reader chính tắc cho free/paid, public/internal scopes tách | CMS owner, consume C02 |
| CMS-017/018 | Correction/audit không lộ notes hoặc thay lịch sử audience âm thầm | CMS owner |
| CMS-019 | Feed/search/archive/related từ published DTO theo quyền | CMS owner |
| CMS-020 | Hồi quy CMS + phần quyền mới; liên thông QA-PAID-001 | CMS + QA |

CMS-ACCESS-001 là nhãn phối hợp bổ sung, các suffix A/B/C trong ROADMAP chỉ chia nhỏ phạm vi; không tạo một hệ CMS khác hoặc tái định nghĩa CMS-011..020.

## 4. Inputs Portal phải giao CMS

- C01: catalog Product thật, ID ổn định, policy chọn/hết bán. CMS không tự tạo catalog sản phẩm thứ hai.
- C02: service entitlement server-only với allow/deny; fake version chỉ test. Chủ thể và time không lấy từ form.
- C06: agreement media đọc theo bài/version; không truyền raw path hoặc bỏ kiểm integrity.
- C07: contract event/audit và consumer hook cần thiết; không tự thêm service thanh toán trong CMS.

Nếu Products chưa có, vẫn làm form với test doubles trong local nhưng production phải thể hiện chưa cấu hình; không tự mặc định mọi người hoặc mọi gói. Free reader chỉ được bật khi publish/version/media đủ gate; paid vẫn khóa đến lúc entitlement thực sẵn sàng.

## 5. Outputs CMS phải giao Portal

- Reader/published view tách khỏi raw draft, với article ID/slug/version/revision/status/policy/products/public metadata/asset references.
- Quy tắc hiệu lực và rút bài, xử lý trạng thái CORRECTED và lịch publish theo CMS hiện hành; Portal không tự suy từ publishedAt != null.
- Cách list/search chỉ trả metadata được phép, link chính tắc và safe deny DTO.
- Migration owner, thứ tự merge, version tương thích; đổi contract có người nhận xác nhận.

## 6. Checklist điểm dễ xung đột

1. `ArticleDraftForm.tsx`, `article-draft.ts`, `article-draft-actions.ts`, `article-draft-query.ts`, `article-autosave.ts`: đưa quyền vào cùng snapshot/save, allowlist rõ, update atomic, giữ expectedUpdatedAt/single-flight/unknown ACK/conflict behavior.
2. AccessMode là metadata, không tự tăng editorSchemaVersion TipTap. Không viết ownership/status/subscription từ input.
3. Nếu chọn panel lưu riêng thay vì save chung, cần spec token/coordination riêng trước code. Không có hai writer độc lập gây ghi đè audience.
4. `prisma/schema.prisma` và migrations: một integrator tuần tự hóa; không sửa migration đã áp dụng; không auto backfill mọi bài cũ PUBLIC.
5. `media-store`/storage/cleanup: thêm references của published versions; không xóa ảnh lịch sử, không nới guard production để test pass.
6. `/goc-nhin`, SEO và PortalShell: phân công rõ ai sửa file; giữ video/Sheets và style gốc.

## 7. Định nghĩa điểm giao sẵn sàng

C01/C02/C03/C06 phải có version, signature thực được cả producer/consumer ACK, task/PR sở hữu, tests contract và lỗi dự kiến. “Đã nói trong chat” hoặc có mock UI không đủ. Người tích hợp ghi READY/ACK ở COORDINATION; trạng thái hiện tại là WAITING_ACK.

Các thay đổi đã nằm trong công việc CMS local chưa push phải được nêu trong checkpoint. Tránh cherry-pick toàn bộ feature chưa review để lấy một field. Có thể tách một PR nền tảng nhỏ được cả hai bên review; sau merge, mỗi bên cập nhật base và chạy regression của phạm vi mình.
