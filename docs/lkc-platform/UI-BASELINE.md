# UI-BASELINE — Giao diện chức năng được duyệt

Mốc: 08/10/2026. Trạng thái: **PO_APPROVED cho bố cục và chức năng v3**. Không phải nghiệm thu phần mềm, giá bán hay phê duyệt một migration cụ thể.

## A. Bằng chứng phê duyệt và nguồn

PO nói trong cuộc trò chuyện: “duyệt chức năng và cách triển khai giao diện như trên giờ viết tài liệu để cho github hiểu và triển khai theo lộ trình đồng bộ ... cms cũng đang triển khai ở developer khác chung vào github”. Bản ghi này cập nhật trạng thái phê duyệt; các tệp prototype gốc vẫn được giữ nguyên, có thể còn chữ CHỜ DUYỆT. Không sửa tệp gốc để giả thay lịch sử.

Tham chiếu đi kèm gói bàn giao, SHA-256 tính trên bytes:

| Tệp gốc | SHA-256 |
|---|---|
| LKC-giao-dien-chuc-nang-v3-cho-duyet.html | `54e9a8b28903cc3e809fe7ede30880d234b1c5acc8586ef49429b2f00a6b984f` |
| LKC-phieu-duyet-giao-dien-v3.md | `696869ae10f93284be95f05df5731d6f8e8621ac1c6bca51032dbbdd04628d66` |
| LKC-paid-research-blueprint-v3-cms-access.md | `7c74278085e46a4470cf893c9e8f9ece1b37a1647f85a0bce1436d54d3aeff4d` |
| CMS-ACCESS-001-draft.md | `931151a263f9c755f654b1090696858caef73c35009f0e1094f204206d15ceef` |
| Văn bản đã dán (1)(20261007-074954).txt | `82a3a308a8fd758ed0bea19ee6d1ebf1b5061d4f730bfd47182980ded5cabd66` |

Các bản blueprint cũ là lịch sử thiết kế, không bằng chứng feature đã có trên main. Các lựa chọn thương mại chưa duyệt vẫn ở DECISIONS. Tài liệu này bảo tồn thuật ngữ và bố cục đã thống nhất; phần route/owner dưới đây là đề xuất ánh xạ kỹ thuật, cần xác nhận với route hiện hành trước code.

## B. Nhận diện và phần tái sử dụng

- Giữ Navbar, Logo, Footer, PortalShell và nhận diện gốc. Public navbar gradient `#1B4FA0 → #2BAD97 → #5DC9A0`; sidebar navy `#071528`, mục đang chọn `#2BAD97`; nội dung nền sáng và thẻ bo tròn theo prototype.
- Giữ typography của website hiện hữu; không thêm font, thay logo hoặc import một bộ UI khác chỉ để giống ảnh minh họa. Logo chuẩn lấy từ component/tài nguyên repo.
- Desktop: danh sách khuyến nghị khoảng 1/3 và chi tiết khoảng 2/3. Form phân tích bên trái, preview bên phải. Mobile xếp dọc, không phụ thuộc hover.
- CMS: giữ editor TipTap và hành vi lưu hiện hữu; thẻ quyền ở cột cài đặt phải trên desktop, xếp dọc trên mobile. Không dựng editor thứ hai.
- Không xóa video/Google Sheets của Góc nhìn; thêm vùng CMS đã xuất bản bên cạnh nguồn cũ.

## C. Danh mục màn hình và ánh xạ

Owner là luồng công việc, chưa phải đã gán cho một tài khoản GitHub.

| ID | Màn đã duyệt | Route đề xuất / tái sử dụng | Owner và task |
|---|---|---|---|
| 01 | Sản phẩm | `/san-pham` — bổ sung vùng nghiên cứu trả phí | Portal / SUB-002 |
| 02 | Chi tiết và kỳ sử dụng | `/san-pham/[slug]` | Portal / SUB-002 |
| 03 | Tạo tài khoản + mã giới thiệu | `/dang-ky`; xác minh email là bước phụ thật | Portal / SUB-003 + REF-001 |
| 04 | Đăng nhập | `/dang-nhap` hiện hữu | Portal / SUB-003, owner Auth review |
| 05 | Đơn và thanh toán | `/client/orders/[id]` hoặc checkout nội bộ liên kết cùng order | Portal / PAY-001 |
| 06 | Sản phẩm của tôi | `/client/subscriptions`; `/client` dẫn tổng quan | Portal / SUB-004 + PORTAL-001 |
| 07 | Khuyến nghị: danh sách/chi tiết | `/client/recommendations` và `/client/recommendations/[id]` | Portal / REC-002 + PORTAL-001 |
| 08 | Đơn hàng | `/client/orders` | Portal / PAY-001 + PORTAL-001 |
| 09 | Nhập khuyến nghị, preview | `/analyst/recommendations` và route new/edit thống nhất trong task | Portal / REC-001 |
| 10 | Duyệt khuyến nghị | luồng review của Recommendations, không mượn Article workflow | Portal / REC-002 |
| 11 | Đối soát thanh toán | `/admin/billing` | Portal / PAY-001 |
| 12 | CRM mã và khách giới thiệu | `/sales/referrals` | Portal/CRM / CRM-REF-001 |
| 13 | CRM nguồn và đơn | khối mới trong `/sales/customers/[id]`; referral summary ngoài scope ở màn 12 | Portal/CRM / CRM-REF-001 |
| 14 | CMS soạn bài + quyền xem | `/creator/articles/new`, `/creator/articles/[id]/edit` | CMS / CMS-ACCESS-001.A |
| 15 | CMS duyệt và xuất bản | route do developer CMS xác nhận; dùng workflow đang xây | CMS / CMS-011/012/013/015 + CMS-ACCESS-001.B |
| 16 | Góc nhìn: bài miễn phí | thêm nguồn Article tại `/goc-nhin` | CMS / CMS-016/019 + CMS-ACCESS-001.C |
| 17 | Đọc bài miễn phí | reader chính tắc, đề xuất `/goc-nhin/[slug]` | CMS / CMS-016 |
| 18 | Bài viết của tôi | `/client/articles` dẫn cùng reader, không lưu bản body thứ hai | Portal shell + CMS reader / PORTAL-001 |
| 19 | Đọc bài trả phí / khóa | cùng reader của màn 17, quyết định bằng server | CMS + Subscriptions / CMS-ACCESS-001.C |

Mỗi màn là capability UX, không bắt buộc đúng một route hoặc đúng một PR. Đổi route nội bộ không được đổi hành trình được duyệt mà không có mapping cập nhật.

## D. Những hành vi đã chốt ở mức UX

Đăng ký và giới thiệu: mã tự nhập, không bắt buộc như bản đã duyệt; mã sai phải sửa hoặc chủ động xóa. Tạo tài khoản không tự cấp sản phẩm. Phân biệt người giới thiệu và Sales chăm sóc; đổi chăm sóc không tự đổi nguồn. Phí chưa cấu hình phải hiện chữ, không hiện hoa hồng bằng 0 như kết quả đã tính.

Nội dung nhập tay: vùng vào, giá tham chiếu, SL, TP, xác suất, phần trăm mục tiêu và trạng thái do chuyên viên nhập. Nhãn **Xác suất chuyên viên ước tính** không thay bằng tỷ lệ thắng kiểm chứng. Ô trống hiện **Chưa có ước tính**. Phép đối chiếu không ghi đè số nhập. Ghi chú nội bộ không thuộc preview khách.

CMS: hai lựa chọn **Miễn phí — Công khai** và **Trả phí — Theo sản phẩm**. Bản mới chưa cấu hình lưu nháp được, chưa xuất bản. Trả phí cần ít nhất một sản phẩm; nhiều sản phẩm có nghĩa khách còn quyền của ít nhất một sản phẩm. Bài miễn phí chỉ ra ngoài khi đã công bố; bài trả phí không tự xuất hiện tiêu đề/body trong danh sách công khai. Teaser tiếp thị trả phí nằm ngoài baseline này.

Reader thể hiện đủ sáu trạng thái màn 19: khách vãng lai; login chưa có sản phẩm; còn quyền đúng sản phẩm; hết hạn; bị thu hồi; bài chưa công bố. Thông báo ngoài không tiết lộ nháp hoặc metadata bí mật. Link quay lại sau login/checkout chỉ nhận đích nội bộ an toàn và kiểm tra lại quyền.

## E. Không đưa lên production

Màn 00; thanh chọn 19 màn; bộ đổi vai trò/quyền/tài khoản giả; nút ghi nhận xét/xuất duyệt; dữ liệu `LKC-DEMO01` và gói A/B minh họa; công tắc giả trả tiền; dữ liệu giá giả; mã HTML prototype. Không cho CLIENT chọn quyền ACTIVE hoặc tự xác nhận tiền.

Không nhầm công cụ ghi nhận xét UI với chức năng editorial review thật của CMS/Recommendations. Không nhầm tổng quan duyệt với tổng quan tài khoản thật.

## F. Bằng chứng UI khi triển khai

Từng PR ghi ID màn, ảnh desktop/mobile của bản thật, các trạng thái empty/loading/error/success và sai quyền, file/route thay đổi, nội dung chênh so với baseline. Dùng kích thước tham chiếu 1440×1024 và 390×844; kiểm tra keyboard, focus, nhãn form và tràn ngang. Đây là điều kiện dự kiến, không phải test đã chạy. Câu chữ tiếp thị và chi tiết khoảng cách được cải tiến theo revision; tên trường về tiền/quyền/xác suất không được đổi sai nghĩa.
