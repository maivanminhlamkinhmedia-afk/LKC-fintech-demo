# REC-PRODUCT-MODES — Bổ sung năm sản phẩm, ba nhóm khuyến nghị

Ngày ghi nhận: 08/10/2026 (UTC+7). Phiên bản phụ lục: 0.1.
Trạng thái: PO_REQUIREMENT_RECORDED / UI_DELTA_PROPOSED / TECHNICAL_ACK_PENDING / NOT_IMPLEMENTED.
Owner phạm vi đề xuất: luồng Portal/Recommendations trong cuộc trò chuyện này, PC độc lập với luồng CMS. Không giao lại toàn bộ phần khuyến nghị cho CMS.

## 1. Yêu cầu mới được ghi nhận

Product Owner yêu cầu năm sản phẩm: **Chứng khoán cơ sở; Chứng khoán phái sinh; Hàng hóa phái sinh; Vàng; Tài sản số**.

Trong mỗi sản phẩm có đủ ba nhóm để khách lựa chọn:
1. **Khuyến nghị thủ công** — nhân viên nhập và cập nhật.
2. **Khuyến nghị tự động** — nhận từ server/hệ thống máy hoặc webhook bên ngoài.
3. **Vùng và xu hướng xác suất** — nội dung vùng giá, xu hướng và xác suất.

**Mua gói của sản phẩm nào, khi quyền được kích hoạt và còn hiệu lực, khách sử dụng cả ba nhóm của sản phẩm đó.** Không bán riêng ba tab, không yêu cầu mua thêm nhóm tự động hoặc nhóm xác suất. Khách mua nhiều sản phẩm được truy cập cả ba nhóm của từng sản phẩm đã mua; không tự mở các sản phẩm chưa mua.

Đây là bổ sung phạm vi so với baseline trước chỉ có khuyến nghị nhập tay. Không áp dụng câu “tất cả khuyến nghị đều nhập tay” cho hai nhóm mới. Bản thủ công vẫn giữ nghiệp vụ và thuật ngữ cũ. Bản UI v3 gốc và hash của nó được giữ làm lịch sử; bố cục mới trong phụ lục là đề xuất cần phản hồi UI, không nhận đã dựng HTML hoặc được duyệt từng chi tiết.

## 2. Ma trận quyền sản phẩm

| Sản phẩm khách mua | Thủ công | Tự động | Vùng và xu hướng xác suất |
|---|---|---|---|
| Chứng khoán cơ sở | Bao gồm | Bao gồm | Bao gồm |
| Chứng khoán phái sinh | Bao gồm | Bao gồm | Bao gồm |
| Hàng hóa phái sinh | Bao gồm | Bao gồm | Bao gồm |
| Vàng | Bao gồm | Bao gồm | Bao gồm |
| Tài sản số | Bao gồm | Bao gồm | Bao gồm |

Định danh Product lấy từ catalog chung. ProductPlan là gói/kỳ của Product; giá, kỳ hạn và chính sách thương mại chưa được PO cung cấp trong yêu cầu này. Không tự tạo tên gói VIP, giá hoặc tỷ lệ chia phí. Ba nhóm là quyền lợi đi kèm, không phải ba ProductPlan có giá riêng.

Quyền đọc: tài khoản hợp lệ + kỳ quyền sản phẩm còn hiệu lực/chưa thu hồi + nội dung đã được phép phân phối + nội dung thuộc sản phẩm được cấp. Chỉ đăng nhập hoặc có mã giới thiệu không đủ. Hết quyền một sản phẩm chặn các yêu cầu đọc mới ở cả ba nhóm của nó; sản phẩm khác còn quyền vẫn hoạt động. Không hứa xóa dữ liệu khách đã tải hợp lệ.

Nếu triển khai capability nội bộ, mọi gói của năm sản phẩm trong phạm vi này phải mang cả ba capability. Feature flag vận hành không được biến thành phí mở khóa từng nhóm. Lưu snapshot quyền lợi của đơn/kỳ và version điều khoản để tránh thay cấu hình gói làm mất quyền lợi đã bán.

Sản phẩm thương mại và mã tài sản phân tích độc lập. Không tự suy GOLD hoặc nhóm hàng hóa từ symbol rồi cấp quyền chéo: cùng tài sản có thể liên quan nhiều sản phẩm nhưng chỉ phân phối chéo khi người có quyền cấu hình rõ. Hợp đồng/sàn/kỳ hạn, đơn vị giá và tiền tệ phải đủ để phân biệt dữ liệu khi tài sản cần chúng; không chỉ dùng chuỗi symbol làm danh tính.

## 3. Đề xuất điều chỉnh giao diện, giữ nhận diện đã duyệt

Màn 01/02 giới thiệu đúng năm sản phẩm; trên mỗi thẻ/trang chi tiết ghi: “Gói bao gồm khuyến nghị thủ công, khuyến nghị tự động, vùng và xu hướng xác suất”. Tách trạng thái sẵn sàng cung cấp khỏi quyền lợi, không quảng cáo ba nhóm đang hoạt động nếu mới có prototype hoặc chưa kết nối nguồn.

Màn 06 Sản phẩm của tôi hiển thị sản phẩm, kỳ quyền, ngày hết hạn và nút vào khuyến nghị. Khách chưa mua xem giới thiệu/đăng ký; khách đã đủ quyền không gặp nút nâng cấp để vào một trong ba nhóm.

Màn 07 Khuyến nghị giữ khung gốc, thêm hai cấp lựa chọn:

```text
Sản phẩm đang xem: [ Chứng khoán cơ sở v ]
Quyền sử dụng: [ Còn hiệu lực / Hết hạn / ... ]

[ Khuyến nghị thủ công ] [ Khuyến nghị tự động ] [ Vùng và xu hướng xác suất ]

Bộ lọc theo nhóm được chọn
Danh sách nội dung                Chi tiết nội dung đang chọn
```

Danh sách/chi tiết desktop kế thừa tỷ lệ khoảng 1/3–2/3; mobile xếp dọc hoặc dùng tab cuộn với nhãn đầy đủ. Đổi sản phẩm phải kiểm lại quyền và xóa dữ liệu cũ không còn hợp lệ khỏi trạng thái hiển thị; không lóe nội dung sản phẩm trước khi tải dữ liệu mới. Giữ lựa chọn trong URL là đề xuất UX, không dùng query string làm quyền truy cập.

Ba trạng thái phải khác nhau: **Không có quyền**; **Có quyền nhưng chưa có nội dung**; **Có quyền nhưng nguồn đang gián đoạn/chưa sẵn sàng**. Hai trạng thái sau không dẫn đến yêu cầu mua thêm gói. Dữ liệu đã quá hạn có nhãn rõ và cách xem lịch sử được định nghĩa, không giả là khuyến nghị hiện hành.

### 3.1. Nhóm thủ công

Giữ mức giá/vùng vào/SL/TP, điều kiện, thời hạn, tác giả, lịch sử; xác suất chuyên viên ước tính cho phép trống; phần trăm mục tiêu nhập tay không bị công thức đối chiếu ghi đè. Màn 09/10 tiếp tục luồng nhập liệu, xem trước và duyệt của Recommendations, không mượn editor CMS để dựng lại.

### 3.2. Nhóm tự động

Đề xuất hiển thị mã tài sản, loại/hướng tín hiệu, mức giá nếu có, khung thời gian, tên nguồn/chiến lược được phép công khai, thời điểm dữ liệu, thời điểm nhận, thời hạn và trạng thái. Thông báo “Đã nhận dữ liệu” khác “Đã được công bố”; không gọi là realtime nếu chưa có bằng chứng độ trễ và tần suất.

Dữ liệu máy không bắt buộc có phần trăm xác suất. Không tự tạo 0%, 100% hoặc một tỷ lệ minh họa để lấp trường trống. Giữ định danh nguồn và phiên bản; điều chỉnh thủ công phải có nguồn gốc riêng, không sửa đè bản máy đã nhận.

### 3.3. Nhóm vùng và xu hướng xác suất

Đề xuất phần chi tiết gồm tài sản, khung phân tích, vùng dưới–trên và ý nghĩa vùng, hướng xu hướng, định nghĩa sự kiện, xác suất, thời hạn, điều kiện mất hiệu lực, mốc dữ liệu và phương pháp/nguồn.

Nguồn cụ thể của nhóm này chưa được PO chốt: hỗ trợ hợp đồng để nhận từ nhân viên hoặc hệ thống ngoài, không mặc định đã có mô hình tính toán. Phân biệt “xác suất chuyên viên ước tính” và “xác suất từ mô hình <phiên bản>”; không đổi điểm tín hiệu thành xác suất. Xác suất giá tăng, xác suất giữ vùng và xác suất TP trước SL là các sự kiện khác nhau; không dùng chung một con số. Chỉ yêu cầu tổng bằng 100% cho một tập kịch bản loại trừ nhau và bao phủ đầy đủ đã được định nghĩa.

Dự phóng không bắt buộc là kèo có điểm vào/SL/TP. Không ép mọi vùng/xu hướng thành một lệnh hoặc dùng dự phóng giá để khẳng định khách có lợi nhuận. Chưa có dữ liệu/phương pháp hiển thị trạng thái thiếu, không lấy dữ liệu giả làm kết quả thật.

## 4. Tách nhóm khách xem khỏi nguồn tạo dữ liệu

Đây là thiết kế đề xuất, chưa là Prisma schema:
- `productId`/audience: nội dung thuộc sản phẩm nào.
- `displayGroup`: MANUAL_RECOMMENDATION / AUTOMATED_RECOMMENDATION / PROBABILITY_OUTLOOK.
- `origin`: STAFF / EXTERNAL_SERVER / WEBHOOK.
- Phân biệt lifecycle tiếp nhận, lifecycle công bố, lifecycle kịch bản và độ mới dữ liệu.

Nhóm PROBABILITY_OUTLOOK có thể có origin STAFF hoặc WEBHOOK. Một dự báo máy được xếp mặc định vào nhóm xác suất khi đúng loại đó; không tự tạo hai bản độc lập ở hai tab và không lẫn nguồn với quyền trả phí. Quy tắc hiển thị chéo nếu cần là thay đổi UX riêng; dùng cùng ID/version, không nhân bản nghiệp vụ.

Lưu danh tính nguồn, external entity ID, event ID, revision/sequence khi có, occurredAt/asOf/receivedAt/validUntil và schemaVersion theo contract đã chốt. Những tên trên là ngữ nghĩa, không phải lệnh tạo mọi bảng tương lai. Tái sử dụng User/FinancialInstrument/Product và service quyền chung, không tạo ba tài khoản, ba hệ subscription hoặc ba kho khách hàng.

## 5. Kết nối hệ thống ngoài — phạm vi thuộc nhánh này

**Tự động ở đây là tiếp nhận/cập nhật nội dung nghiên cứu, không phải tự đặt lệnh, copy trading, giữ API broker hoặc quản lý vốn khách.** Website nhận kết quả từ hệ thống công ty đã có hoặc nguồn được cấp phép; yêu cầu này không tự giao xây thuật toán quant hay hạ tầng Market Data đầy đủ.

Có hai hướng tích hợp tùy nguồn thực tế: hệ thống ngoài đẩy webhook/server API vào LKC, hoặc LKC gọi API của nguồn đã cấu hình. Chưa chọn provider, endpoint, lịch gọi hay cơ chế xác thực cụ thể; không tạo outbound webhook theo tài khoản khách. Khách chỉ chọn nhóm xem, không nhập URL/secret nguồn.

Luồng đề xuất: nhận/xác thực -> lưu sự kiện bền vững -> kiểm schema, tài sản và phạm vi nguồn -> chuẩn hóa -> quyết định công bố -> lưu phiên bản và audit -> hiển thị theo quyền sản phẩm.

Yêu cầu thiết kế an toàn cho task tích hợp:
- HTTPS, credential riêng theo nguồn; xác thực theo khả năng thực tế của provider. Dùng chữ ký/HMAC và timestamp/nonce khi được hỗ trợ; không giả định mọi provider hỗ trợ cùng giao thức. Chưa có cơ chế tin cậy được duyệt thì chưa bật nguồn. Không để secret trong URL public, log, client hoặc Git.
- Quyền ghi của nguồn tách khỏi quyền đọc của khách. Server cấu hình source được ghi sản phẩm/nhóm/chiến lược nào; payload không được tự nâng quyền, chọn khách, gán PAID/PUBLIC hay xác nhận thanh toán.
- Bản nhận có khóa xử lý lặp và kiểm phiên bản/thứ tự. Retry không tạo nhiều kèo; event cũ không ghi đè bản mới; rút/hủy không bị callback cũ làm sống lại. Cùng ID/version nhưng payload khác phải được kiểm tra xung đột, không im lặng bỏ qua như bản trùng hợp lệ.
- Giới hạn kích thước/tần suất, validation theo schemaVersion, content an toàn, xử lý lỗi có mã không lộ bí mật. Thừa nhận receipt chỉ sau khi đã giữ sự kiện đủ bền vững; không nhận 2xx rồi mất dữ liệu trong bộ nhớ.
- Khả năng retry/replay và đối soát được chốt theo nguồn; không mặc định provider tự gửi lại. Nhật ký nguồn và bản công bố giữ được nguồn gốc; không cho webhook ghi SQL thẳng vào Article hoặc Subscription.
- Nếu gọi URL nguồn hoặc tải media: chỉ những đích do Admin được phép cấu hình và được kiểm tra; chống SSRF/redirect sang đích không hợp lệ. Không fetch mọi URL do webhook gửi.
- Đề xuất mặc định nguồn mới vào REVIEW_REQUIRED. AUTO_PUBLISH chỉ được bật khi người có quyền duyệt policy cho chính source/product/group; server áp dụng policy, không tin cờ publish từ payload. Tự động nhận không đồng nghĩa tự động công bố vô điều kiện. Có nút dừng nguồn/công bố khẩn cấp với audit.
- Theo dõi asOf/validUntil/lastReceivedAt để hiển thị độ mới. Mất nguồn không tự sinh khuyến nghị, không ngầm chuyển sang nguồn khác hoặc đổi quyền sản phẩm. Tiền, referral và CMS không bị webhook thay đổi.

Giữ ứng dụng hiện hữu; DB inbox/outbox và worker là hướng kỹ thuật để review, không mặc định bắt buộc thêm broker/microservice. Cần chốt cách vận hành worker và compatibility với hosting thật trước task chạy nền; lượt tài liệu không triển khai hoặc theo dõi nền.

## 6. Ranh giới với CMS, CRM và tài liệu hiện có

Nhánh Portal này làm catalog/gói/quyền, ba nhóm nội dung khuyến nghị, biểu mẫu nhập liệu, tiếp nhận server/webhook và màn quản lý nguồn cần thiết. Bổ sung CRM về mã giới thiệu/nguồn/đơn vẫn ở nhánh này; không làm lại CRM đã có và không đổi cách quy công chỉ vì có ba nhóm.

CMS ở PC khác giữ màn 14/15, workflow Article, phiên bản/xuất bản/trình đọc, media nội bộ theo tài liệu bàn giao. Nhánh này không giao ba nhóm Recommendations cho CMS và không tự sửa core CMS. Trao đổi shared files/migrations chỉ tại boundary thực sự cần thiết.

C01: CMS tiêu thụ catalog chung có năm sản phẩm, ID ổn định; nếu năm sản phẩm đã có ở producer tương lai thì tái sử dụng, không seed trùng. C02: quyền cả ba nhóm của Product được dùng trong REC; bài CMS vẫn kiểm audience sản phẩm của chính bài. Không thêm ba mức thu phí vào CMS, không yêu cầu người viết bài chọn tab khuyến nghị để quyết định quyền. C03 phiên bản Article không bị thay bằng lifecycle nguồn webhook. C06 tiếp tục bảo vệ media theo content/version; nếu REC thêm reference phải phối hợp chủ media.

Một bài CMS phân phối cho A không tự xuất hiện ở mọi tab hoặc cho B vì webhook có cùng mã tài sản. Việc mua cả ba nhóm khuyến nghị không tự mở CMS nội bộ. Nguồn giới thiệu và đơn vẫn chỉ ghi giao dịch thật của sản phẩm, không nhân ba doanh số/hoa hồng vì có ba nhóm.

Phạm vi ưu tiên của phụ lục: bổ sung đúng yêu cầu năm sản phẩm × ba nhóm; điều chỉnh các câu chỉ có nhập tay trong README/UI-BASELINE/ARCHITECTURE-CONTRACTS/ROADMAP/ACCEPTANCE khi viết task REC mới. Những phần còn lại và phê duyệt UI cũ giữ nguyên. Đây không phải hợp đồng kỹ thuật đã có đủ ACK, không tự đánh dấu C01–C07 READY hoặc CMS-011 hoàn tất.

## 7. Chia nhỏ task và điều còn cần chốt

Không đổi số roadmap CMS. Các nhãn sau là đề xuất phân rã cho luồng Portal, chưa tạo branch implementation:

| Phần việc | Đầu ra | Phụ thuộc |
|---|---|---|
| SUB-001 / C01-C02 delta | Năm Product, ba nhóm cùng quyền, contract phân phối | Người giữ producer/consumer ACK, schema slot |
| REC-001/002 delta | Giữ thủ công, thêm phân nhóm, provenance và query scope | Product/entitlement và UI bổ sung |
| REC-INGEST-001 (mới đề xuất) | Nguồn ngoài, xác thực, inbox/dedupe/revision và publish policy | Provider/payload/auth thật được chốt, tests nguồn |
| REC-OUTLOOK-001 (mới đề xuất) | Vùng/xu hướng/xác suất, validation và nguồn dữ liệu | Định nghĩa sự kiện, phương pháp và mapping |
| PORTAL-001 delta | Chọn sản phẩm và ba tab, empty/stale/error/locked, mobile | Các reader và entitlement thực |
| QA-PAID-001 delta | Test năm sản phẩm × ba nhóm, nguồn lặp/gián đoạn và hồi quy | Các phần liên quan trên commit tích hợp |

Có thể phát triển tuần tự từng phần trên staging; thiết kế quyền vẫn gồm cả ba. Trước khi bán/công bố một gói là đã có đủ ba nhóm, các nhóm đó phải đạt điều kiện vận hành đã cam kết. Chưa có nguồn thì thể hiện chưa sẵn sàng, không gọi là đã hoàn thành chỉ vì có tab. Không tự ấn định tần suất, độ trễ hoặc cam kết có kèo liên tục.

Cần chốt trong các task tương ứng, không phải câu hỏi chặn ghi nhận yêu cầu: endpoint/provider và payload mẫu đã loại secret; auth và khả năng replay; nguồn/chiến lược cho từng sản phẩm; nguồn của nhóm xác suất; định nghĩa sự kiện/khung thời gian; chính sách công bố máy; thời hạn dữ liệu/lịch sử; giá/kỳ và thứ tự mở bán. Không yêu cầu khách chọn chỉ một trong ba khi mua.

## 8. Tiêu chí nghiệm thu dự kiến — toàn bộ NOT_RUN

| ID | Điều cần chứng minh |
|---|---|
| RPM-01 | Mỗi một trong năm sản phẩm có đủ ba nhóm trong quyền lợi; gói không bỏ bớt/thu thêm tiền từng nhóm |
| RPM-02 | Khách chỉ mua A xem được cả ba của A, bị chặn cả ba của B; kiểm cả API/URL/media/prefetch và cache |
| RPM-03 | Khách mua A+B xem cả sáu phạm vi; hết hạn/thu hồi A không ảnh hưởng B |
| RPM-04 | Chưa đăng nhập/chờ tiền/sai sản phẩm không có nội dung; có quyền nhưng không dữ liệu không bị báo cần nâng cấp |
| RPM-05 | Đổi product/tab đúng trạng thái và query scope, không lóe dữ liệu cũ; desktop/mobile giữ nhận diện |
| RPM-06 | Thủ công giữ số nhập, nhãn xác suất đúng và phiên bản gốc; dữ liệu máy không ghi đè kèo thủ công |
| RPM-07 | Nguồn giả/sai xác thực/sai product/group/schema/quá hạn/quá cỡ bị chặn; không thể ghi quyền hoặc tiền |
| RPM-08 | Retry/lặp/đảo thứ tự/cùng version khác payload/rút rồi nhận event cũ không tạo trùng hay phục hồi nhầm |
| RPM-09 | Nhận sự kiện khác công bố; policy AUTO_PUBLISH chỉ hoạt động trong scope đã duyệt, nguồn mới không tự mở |
| RPM-10 | Source lỗi/mất kết nối/dữ liệu cũ hiện rõ; recovery/replay không nhân nội dung hoặc thông báo |
| RPM-11 | Vùng, đơn vị, kỳ hạn, xác suất và sự kiện hợp lệ; ô trống không biến thành 0/100%; xác suất không là điểm hay lợi nhuận đảm bảo |
| RPM-12 | Nhóm xác suất nhận từ STAFF/WEBHOOK có provenance đúng; không tự nhân bản thành hai kèo ở hai tab |
| RPM-13 | URL nguồn/media không fetch đích tùy ý; secrets/payload thô riêng không ra UI/log public |
| RPM-14 | Mua một gói không nhân ba đơn/giao dịch/hoa hồng; referral và CRM scope cũ giữ đúng |
| RPM-15 | CMS audience/free/paid/preview và dữ liệu cũ không bị mở rộng; không thêm checkout/CMS thứ hai |
| RPM-16 | Migration/rollback/fixtures/cleanup có chủ sở hữu; kết quả mock/discovery không được gọi là staging hoặc nguồn thật PASS |

## 9. Nguồn và giới hạn của lượt bổ sung

Nguồn nghiệp vụ chính là yêu cầu PO trong cuộc trò chuyện ngày 08/10/2026 về năm sản phẩm và ba loại đều đi kèm gói. Tài liệu gốc `Văn bản đã dán (1)(20261007-074954).txt`, dòng 1–3/73–80/98–126, là cơ sở giữ nguyên nhóm nhập tay, không phải bằng chứng hệ thống máy đã có.

Đã đọc lại PR #27, README, AGENTS và ARCHITECTURE-CONTRACTS trên docs head `9e627f94080322f59df990734ae2739a6e344cb6` trước thay đổi. Không kiểm tra source của hệ thống bên ngoài, không xác minh mọi branch hoặc worktree hai PC. Không sửa runtime, schema, tests, docs/cms hay prototype HTML trong lượt này; không merge, deploy hoặc chạy migration.

Nguồn kỹ thuật công khai tham khảo ngày 08/10/2026, chỉ dùng cho đề xuất an toàn, không chứng minh LKC dùng GitHub làm nguồn tín hiệu hoặc mọi provider có cùng giao thức:
- GitHub Docs — Best practices for using webhooks: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- OWASP — Server Side Request Forgery Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

Tất cả schema/signature/UI chi tiết và tests mới còn cần review theo task. Kết quả CI của head docs cũ không tự áp dụng cho commit mới; lượt này không dispatch CI/staging hay khai báo nguồn đã kết nối.
