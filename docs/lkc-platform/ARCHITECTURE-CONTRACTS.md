# Hợp đồng kiến trúc liên module — đề xuất để hai luồng review

Trạng thái: PROPOSED_FOR_INTEGRATION_REVIEW. Giao diện đã duyệt không tự duyệt schema vật lý, tên hàm, policy thương mại hoặc migration bên dưới. SUB-001 ghi ACK owner trước khi contract được dùng cho production.

## 1. Hướng tổ chức

Giữ Next.js/Prisma/MySQL hiện hữu, feature-based trong cùng repo. Không thêm microservices, message broker hoặc server quant chỉ để có đăng ký trả phí. Pages mỏng; logic server tách khỏi UI. Tái sử dụng User, CustomerProfile, FinancialInstrument, AuditLog; không tạo một hệ khách hàng thứ hai.

Các nhóm mới dự kiến: `src/features/products`, `subscriptions`, `billing`, `referrals`, `recommendations`. CMS/CRM hiện hữu giữ chủ sở hữu. Contracts dùng chung có thể ở `src/lib/contracts`; orchestration server-only có thể ở `src/lib/application`. Đây là ranh giới đề xuất, tên đường dẫn được xác nhận ở SUB-001. Không import chéo implementation của feature; contract/port chung và composition phía server nối chúng. Không refactor hàng loạt import legacy trong cùng task.

Một datum có một nơi ghi nguồn. Bản chụp lịch sử có chủ đích giữ source ID/version/time, không là nguồn sống thứ hai. Các status sau độc lập: User, CRM, Payment, Subscription, Article publication, Recommendation publication, Trade lifecycle, Referral, Commission.

## 2. Sở hữu dữ liệu

| Domain | Model hiện có / đề xuất | Quyền ghi và ranh giới |
|---|---|---|
| Identity / CRM | User, CustomerProfile, SalesTeam hiện có | Đăng ký tạo CLIENT và profile cùng transaction; CRM chỉ đổi chăm sóc/task theo scope |
| Referrals | SalesReferralCode, CustomerReferral, ReferralRevision | Code owner bất biến; nguồn không suy từ assignedSalesId; điều chỉnh có reason/version |
| Products | Product, ProductPlan | ID sản phẩm ổn định; gói có price/term/benefit version; ngừng bán không tự thu hồi quyền cũ |
| Billing | PurchaseOrder, PaymentTransaction, PaymentEvent, OrderReferralSnapshot | Snapshot gói/giá/nguồn tại lập đơn; giao dịch xác minh; không gắn tiền vào Article |
| Subscriptions | Subscription, SubscriptionPeriod | Quyền theo user/product/kỳ; mỗi order cấp một kỳ; thời hạn/thu hồi truy nguyên |
| CMS | Article, ArticleVersion, ArticleProduct và published pointer/snapshot | Owner CMS chốt physical schema; nội dung + audience của bản công bố nhất quán |
| Recommendations | Recommendation, RecommendationVersion, RecommendationProduct, attachments | Kèo và version riêng; liên kết bài CMS không vượt policy của bài |
| Media | MediaAsset/storage hiện có + context references | Byte/integrity và quyền context; tham chiếu version chặn delete-unused |
| Commission (sau) | rule version/ledger/reversal/payout | Chỉ triển khai khi chốt chính sách; lỗi phí không chặn cấp quyền khách |

Không tạo tất cả bảng tương lai trước một lần. Migration nhỏ theo task, expand-compatible; kiểm tra toàn bộ onDelete graph, nhất là User → CustomerProfile. Không xóa cascade lịch sử tiền/nguồn/công bố. Physical schema, precision tiền/giá, index và retention cần review trong task, không chép thẳng bảng trên thành migration.

## 3. Registry hợp đồng cần ACK

| ID | Producer → Consumer | Nội dung tối thiểu | Owner phải ACK |
|---|---|---|---|
| C01 | Products → CMS/REC/Billing | Product ID/name/selectability, plan/benefit version; tách ngừng bán và entitlement cũ | Portal + CMS cho phần dùng chung |
| C02 | Subscriptions → CMS/REC reader | user được xác thực ở server, requiredProductIds, capability khi có, giờ server; allow/deny có lý do | Portal + CMS |
| C03 | CMS publishing → reader/media/portal | version ID, revision token, body/audience/public metadata/assets, trạng thái hiệu lực | CMS + Portal |
| C04 | Onboarding/Referrals → CRM/Billing | code kiểm tra, attribution version hoặc NONE; order snapshot | Portal/CRM + Billing |
| C05 | Billing → Subscriptions | verified payment/order ID, snapshot kỳ; một order một lần cấp quyền | Billing + Subscriptions |
| C06 | Content → Media | content/version ID, asset ID, quyền context, lịch sử references | CMS + REC + người giữ media |
| C07 | Domain mutation → Audit/outbox | event ID/version, entity, actor, reason, timestamps và metadata tối thiểu | các owner liên quan |

Shape dưới đây là semantic contract, không phải API công khai sẵn có. Không nhận userId/quyền/giờ từ browser rồi xem là trusted. C02 chỉ trả quyết định; không trả body. Bài PUBLIC hợp lệ không gọi Billing/CRM hoặc cổng thanh toán. Reader PAID chỉ dùng quyền đã cấp, không gọi provider ở mỗi lượt đọc.

## 4. Luồng đăng ký → nguồn → đơn

Server chuẩn hóa input, luôn gán CLIENT; mã giới thiệu optional. Mã không hợp lệ phải lỗi trường, không âm thầm bỏ. Public lookup không trả thông tin riêng của Sales, phải chống dò/lạm dụng. Tạo user/profile/referral/audit nhất quán; email trùng/retry không chiếm tài khoản hoặc ghi đè attribution. Email verification/reset token một lần có thời hạn; gửi email sau commit qua cách retry bền vững đã được task xác nhận. Migration bảo vệ user cũ.

Sales đổi người chăm sóc hoặc chuyển team không đổi nguồn gốc. Gán referrer làm người chăm sóc ban đầu là policy chưa chốt. Referral summary có DTO/scope riêng; không sửa customerSalesScope thành assigned OR referrer, không mở notes/contact/tasks/hóa đơn ngoài quyền.

Tại lập đơn, server chụp ProductPlan/price/term/benefit/terms và referral version hoặc NONE. Không đến lúc tính phí mới lấy Sales đang chăm sóc. Sửa nguồn sau lập đơn không tự viết lại snapshot; cần nghiệp vụ điều chỉnh có audit. Không tính doanh thu/hoa hồng khi chỉ đăng ký tài khoản.

## 5. Tiền → quyền

Cả đối soát thủ công và adapter provider dùng chung order ledger và service cấp quyền. Browser redirect, ảnh biên lai hoặc nút đã chuyển tiền không là bằng chứng nhận tiền. Kiểm tra signature/merchant/order/amount/currency/state theo hợp đồng phương thức được chọn. Không lưu secret/card data trong repo/log.

Dùng tiền dạng exact (integer theo unit hoặc Decimal có precision xác nhận), không float. Unique business key cho giao dịch/sự kiện và kỳ quyền từ order. Xác nhận tiền, trạng thái đơn, kỳ quyền và audit có transaction cục bộ hoặc orchestration bền vững được chứng minh. Trùng callback hoặc hai người xác nhận không cấp đôi; hai payment thật cho một order không bị xóa nhầm là một event trùng. Đối soát tiền thừa/muộn/mất callback/đảo thứ tự; success cũ không làm sống lại quyền bị thu hồi. Không claim exactly-once delivery; thiết kế effect idempotent.

Khoảng kỳ đề xuất `[startsAt, endsAt)`; request tại endsAt bị chặn, không chờ cron. Kỳ gia hạn đề xuất bắt đầu tại max(grantedAt, kỳ hết hiệu lực hiện tại), nhưng term/calendar/grace/refund phải được PO chốt ở DECISIONS trước live. Thu hồi/hoàn tiền chỉ tác động kỳ chính xác, giữ lịch sử, không sửa số ngày tùy ý. Hết hạn gói không khóa tài khoản; khách còn login để xem đơn/gia hạn.

Commission là consumer tương lai, không precondition của Subscription. Lưu event thu/hoàn và order attribution từ đầu. Chưa có rule hiện Chưa cấu hình chính sách; không tạo ledger giả hoặc tính 0 như đã quyết toán.

## 6. Nội dung và quyền đọc chung

CMS giữ quyền soạn/duyệt nội bộ; CLIENT không được cms:access. Một service entitlement dùng chung cho bài và khuyến nghị, nhưng mỗi content/version kiểm tra audience riêng. Có quyền kèo B không tự có quyền bài A liên kết. Không embed body A vào DTO B để vượt guard.

CMS: accessMode PUBLIC / PAID_PRODUCT, unconfigured/null cho draft chưa chọn. Empty product set của PAID không có nghĩa mọi người. Published snapshot giữ body, products, policy, assets, metadata được duyệt. Approved mà chưa publish, scheduled tương lai, withdrawn, draft không được phát body. Owner CMS chốt trạng thái thật với roadmap CMS; không tạo state machine thay thế.

Bản sửa chưa duyệt không đổi bản đang phục vụ. Đổi audience/body sau duyệt làm invalid approval cũ; publish cùng version được duyệt trong transaction. Lịch sử công khai không tự trả toàn bộ version cũ; kiểm tra version và policy lịch sử phù hợp. CMS mặc định body hiện hành, không raw Article đang sửa.

Giá/SL/TP/xác suất/biên mục tiêu của khuyến nghị nhập tay, validation và nhãn theo UI baseline. Publication và trade state độc lập; TP1 không mặc định kết thúc cả kèo. Giữ kế hoạch gốc và cập nhật reason/version, không cam kết kết quả khớp lệnh của khách.

## 7. Không rò dữ liệu qua đường phụ

Chỉ serialize body sau authorization. HTML, RSC/Flight, JSON, prefetch, cache, exports, search, related, OG/JSON-LD, emails và media dùng đúng published view. Không gửi đầy đủ rồi blur/CSS. Reader riêng private/no-store hoặc cơ chế tương đương đã kiểm thử; key policy/version, invalidation và recheck cần đảm bảo không trả cache từ audience trước. Prototype dữ liệu client không là mẫu security.

Media route kiểm content/version/asset relationship và quyền người đọc; không mở route private CMS cho mọi CLIENT. Asset được dùng công khai ở nơi khác không thể gọi là bí mật; chính sách phải thừa nhận điều đó. Tham chiếu lịch sử chặn xóa nhầm media; fixture graph/cleanup mở rộng có owner. Không đụng production root/sentinel vì thêm metadata quyền.

Đổi PUBLIC thành PAID không thu hồi các bản đã phát công khai. Default baseline không có teaser trả phí; không đưa paid body vào Sheets công khai hoặc sitemap. Public free feed độc lập provider thanh toán/referral để tránh phụ thuộc không cần thiết.

## 8. Bật/tắt, tương thích và mở rộng sau

Cổng mới và reader trả phí có gate server-side; chưa có provider entitlement thực thì PAID fail closed, không mở tạm cho mọi user login. Mocks chỉ local/test, không trong production. Không cần tất cả CMS-020 xong mới làm spec Products, nhưng không mở reader ngoài trước publish/rights/media gates.

Rollback không xóa đơn/referral/policy; không quay về reader cũ không hiểu paywall trong khi vẫn phát body. Nhánh app cùng DB phải có compatibility được chứng minh. Kiến trúc cho phép mở rộng sau nhưng không xây generic plugin engine, ledger phí hoặc quant vượt scope đã duyệt.
