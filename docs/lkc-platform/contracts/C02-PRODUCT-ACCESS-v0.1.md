# C02 — Product access v0.1

Ngày: 08/10/2026 (UTC+7). Trạng thái: **PROPOSED_FOR_ACK**. Producer: Codex số 2 — Portal/Subscriptions. Consumers: CMS và Recommendations reader. Tên hàm/type/model mới là **PROPOSAL**, chưa có service/API entitlement thực trên main đã kiểm.

Nguồn: [architecture baseline](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform/ARCHITECTURE-CONTRACTS.md), [CMS-INTEGRATION](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform/CMS-INTEGRATION.md), [REC addendum](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform/REC-PRODUCT-MODES-ADDENDUM.md). Companion: [C01](C01-PRODUCT-CATALOG-v0.1.md), [task](../tasks/SUB-001-PORTAL.md).

## Trust và outcome

Một producer entitlement dùng chung cho CMS/REC, từ kỳ quyền đã cấp có nguồn/revision; không từ User.isPaid, role CLIENT đơn lẻ, mã giới thiệu, plan sale flag, browser receipt hoặc provider payment redirect. Actor đang hợp lệ và clock do server xác minh; userId/role/time/allow từ browser không phải trusted input. Việc cấp/renew/revoke thuộc SUB-004/C05/Billing sau, không làm trong C02 docs hoặc pure catalog task.

```text
decideContentRead({ serverActor, requiredProductIds, atServer, capability? }) ->
  { allow: boolean, reason: AccessReason, asOf: serverInstant, entitlementRevision?: opaqueRevision }
AccessReason = ALLOW | UNAUTHENTICATED | INVALID_INPUT | FORBIDDEN |
               NO_ENTITLEMENT | NOT_STARTED | EXPIRED | REVOKED |
               PRODUCT_UNAVAILABLE | POLICY_UNRESOLVED | INTERNAL_ERROR
```

Đây là tên port đã được CMS đề nghị ở spec a37abc99; exact signature/vị trí shared library/error union/revision availability còn cần consumer ACK. `serverActor` là principal đã resolve/revalidate phía server, không serialized browser DTO; `atServer` do trusted clock inject, chỉ tests mới dùng fixture time. `requiredProductIds` từ policy content/version trusted, không từ query/payload khách. Validate policy dù producer ở server; thiếu actor hoặc actor inactive không cho ALLOW.

Return chỉ là quyết định, không body/title/asset/raw row/payment/contact; lý do chi tiết dùng nội bộ. Consumer map denied response theo safe policy, không dùng reasons để tiết lộ có bài nháp hay Product audience riêng. `asOf` không là expiry token hoặc bằng chứng grant; revision nếu có giúp cache/invalidation, không là quyền lâu dài. Không giả revision nếu provider chưa hỗ trợ.

## Quy tắc quyết định đề xuất

| Case | Hành vi |
|---|---|
| requiredProductIds thiếu/rỗng/sai/duplicate/unknown; capability sai | INVALID_INPUT hoặc PRODUCT_UNAVAILABLE cho lỗi producer; allow=false. Empty PAID không thành PUBLIC/all-products |
| Actor chưa authenticated/inactive/quyền actor không còn hợp lệ | UNAUTHENTICATED/FORBIDDEN; không quyết định từ client userId |
| Nhiều Product trong audience | **OR**: ít nhất một Product đúng có kỳ quyền đang hiệu lực/chưa thu hồi -> ALLOW; A không mở B độc lập |
| Một Product có nhiều kỳ quyền | Xét nguồn authoritative cho từng kỳ/revoke scope. Một kỳ hết hạn không tự phủ định kỳ khác hợp lệ; revoke task phải chốt chính xác kỳ/Product trước runtime |
| Chưa có kỳ / kỳ chưa bắt đầu / hết hạn / thu hồi đúng scope | Deny nếu không có kỳ hợp lệ nào cho tập required IDs; reason an toàn theo adapter. Precedence của nhiều deny reasons OPEN, không quyết định commercial policy bằng ordering tests |
| Producer entitlement chưa triển khai/lỗi/không đọc được revision nhất quán | Fail closed PRODUCT_UNAVAILABLE/INTERNAL_ERROR; không fallback login/role/mock/public |
| Sale stopped nhưng kỳ đã cấp còn hiệu lực | Không deny chỉ bởi stopped sale; không sửa entitlement snapshot cũ |
| Policy chưa chốt cho operation cụ thể | POLICY_UNRESOLVED, deny operation đó; không chặn draft/catalog spec độc lập |

Khoảng kỳ `[startsAt, endsAt)` là **đề xuất chờ PO**, chưa điều khoản live: fixture test boundary chỉ xác minh proposal, không chốt term/calendar/grace/activation/renewal. Khi không có policy approved, không bật production reader có kỳ tính theo giả định này. Hết quyền Product không khóa tài khoản hoặc revoke Product khác.

Một Product hợp lệ bao phủ **thủ công, tự động từ hệ thống ngoài, vùng và xu hướng xác suất** của chính Product đó. capability, nếu dùng, chỉ kiểm đúng nhóm/benefit đã cam kết; không paywall/tab riêng. Flag vận hành/source unavailable không biến thành yêu cầu mua thêm; allow entitlement có thể true trong khi reader trả EMPTY hoặc SOURCE_UNAVAILABLE không body mới. `origin` WEBHOOK/STAFF không là entitlement capability; payload nguồn không cấp quyền.

## Boundary với nội dung, CMS và media

Consumer phải kiểm content/version đã được phép phân phối và audience authoritative trước C02; ALLOW không tự publish, không cấp CMS internal permissions và không authorize đọc raw Article/preview. PUBLIC hợp lệ do published policy consumer xử lý riêng, không gọi Billing/C02 chỉ để đọc; không truyền empty required IDs để né paid guard. UNCONFIGURED/NOT_PUBLISHED vẫn không phát body kể cả user có Product.

CMS giữ màn 14–15/workflow/version/reader. CMS-011.0 không tiêu thụ C02. Khi CMS-016/019 hoặc REC reader thật tiêu thụ, body chỉ serialize sau checks, kể cả HTML/Flight/JSON/list/prefetch/cache/media. Kèo B liên kết bài A phải authorize bài A riêng; không embed body A vào DTO B. C03/C06 version/published/media checks không được thay bằng C02 ALLOW và chưa READY trong delta này.

Paid reader không gọi provider thanh toán/CRM mỗi request. Producer entitlement dự kiến đọc authoritative store đã được grant/revoke; source outage của research khác outage producer quyền. Cache paid private/no-store hoặc policy/revision invalidation tương đương phải được chứng minh trong task integration; không cache ALLOW lâu dài đến khi cron expire, không dùng client clock.

## Contract tests dự kiến — NOT_RUN

| ID | Case / expectation |
|---|---|
| C02-T01 | Browser userId/role/time/allow bị bỏ qua; guest/inactive deny, server clock dùng |
| C02-T02 | A hợp lệ, A+B audience OR allow; B-only deny; năm × ba matrix đúng |
| C02-T03 | Empty/missing/duplicate/malformed/unknown policy không wildcard; invalid capability deny |
| C02-T04 | Boundary fixture trước startsAt, tại startsAt, trước/tại endsAt cho proposal; ghi policy live OPEN |
| C02-T05 | Revoke đúng kỳ A, kỳ B còn valid; nhiều kỳ không bị deny sai; unresolved revoke scope deny, không chọn policy ngầm |
| C02-T06 | Producer chưa có/outage/mất consistency deny; stopped sale không tự revoke quyền valid |
| C02-T07 | Result DTO không body/title/private data; ALLOW không publish hoặc cấp CMS permission |
| C02-T08 | A+B grants -> cả sáu nhóm; expire A chỉ chặn A; source down != no entitlement/upsell |
| C02-T09 | Paid cache/revision/recheck, Flight/media/related no leak; linked article audience khác phải kiểm riêng |

T01–T08 có phần pure/test doubles khi được giao slot riêng; không phải source đã làm. T09 cần reader/C03/C06 + producer implementation trên commit tích hợp, không thể certify bằng mock. Chưa chạy tests C02 hoặc paid flow.

## ACK và OPEN

Codex số 2 ACK **producer semantic scope mình sở hữu**: server trust, Product OR, ba nhóm cùng quyền, fail closed, decision không body. C02 toàn bộ vẫn PROPOSED_FOR_ACK; CMS consumer ACK v0.1 **CHƯA GHI NHẬN**. Không lấy scope ACK CMS-011.0/C03 thay C02 ACK; không hỏi lại slot CMS đã cấp.

OPEN (PO): term/calendar/timezone/grace/activation, renewal/refund/revoke scope, historical reading và benefit changes; chỉ chặn live operations phụ thuộc quyết định đó. OPEN (producer+consumer): exact port/error union, reason precedence/privacy mapping, revocation/revision consistency và cache strategy. OPEN (Integrator): slot schema/shared contract/reader đúng task sau. Không bắt C01 pure catalog, CMS-011.0 hoặc toàn Billing/REC chờ full C02 implementation.
