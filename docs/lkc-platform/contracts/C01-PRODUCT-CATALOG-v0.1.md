# C01 — Product catalog v0.1

Ngày: 08/10/2026 (UTC+7). Trạng thái: **PROPOSED_FOR_ACK**. Owner producer: Codex số 2 — Portal. Consumer: CMS, Recommendations và Billing theo phần cần dùng. Tất cả tên type/hàm/path/model mới bên dưới là **PROPOSAL**, chưa tồn tại thành API/schema hoặc được cấp slot implementation.

Nguồn: [architecture tại baseline](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform/ARCHITECTURE-CONTRACTS.md), [phụ lục năm Product × ba nhóm](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/bd903b784976eb0a147844cac72fd7295a79c00b/docs/lkc-platform/REC-PRODUCT-MODES-ADDENDUM.md), [CMS handoff đúng spec](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/a37abc99c2057e4b100b4955694d4f62460e32a7/docs/cms/tasks/CMS-011-IMPLEMENTATION.md). Companion: [task](../tasks/SUB-001-PORTAL.md), [C02](C02-PRODUCT-ACCESS-v0.1.md).

## Identity và ownership

| Khái niệm | Identity / nguồn authoritative | Không dùng thay thế |
|---|---|---|
| Product | ID opaque, ổn định, không tái sử dụng sau retire; Portal quản lý catalog thương mại dùng chung | label/slug, ProductPlan ID, FinancialInstrument ID, symbol hoặc tab |
| ProductPlan | Gói/kỳ/giá/quyền lợi của một Product; có version price/term/benefit/terms cho snapshot đơn và kỳ quyền | Product identity hoặc bằng chứng entitlement |
| FinancialInstrument | Tài sản phân tích; model đã có canonicalKey, symbol, exchange/type/currency | Product thương mại; không suy entitlement từ GOLD/BTC hay canonicalKey |

Đổi tên/slug Product không đổi ID; không tái gán Product ID cũ cho sản phẩm khác. Mapping Product ↔ instrument là phân phối do actor được phép cấu hình, không suy tự động từ symbol. Billing snapshot giữ Product ID + plan/version đã bán; CMS chỉ giữ Product references trong audience/version, không copy catalog sống hoặc tự tạo Product thứ hai. Nhãn lịch sử là metadata hiển thị nếu được C01/C03 ACK riêng, không thay ID hoặc selectability hiện tại.

Năm Product trong phạm vi: **Chứng khoán cơ sở; Chứng khoán phái sinh; Hàng hóa phái sinh; Vàng; Tài sản số**. ID vật lý/code/slug cuối cùng OPEN trước migration/seed; ví dụ fixture không trở thành production ID. Mỗi Product có đủ **Khuyến nghị thủ công; Khuyến nghị tự động từ hệ thống ngoài; Vùng và xu hướng xác suất**. Một quyền Product bao phủ cả ba nhóm; không ba ProductPlan/đơn thanh toán riêng theo tab, không mở Product khác.

`displayGroup` (nhóm hiển thị) khác `origin` (STAFF/EXTERNAL_SERVER/WEBHOOK). Dự phóng/xác suất có thể từ STAFF hoặc WEBHOOK, không vì nguồn WEBHOOK mà nhân bản sang tab tự động. Product/plan benefits không là webhook credential hoặc publication permission. Chưa xây webhook, thuật toán xác suất hay hệ thống giao dịch.

## DTO tối thiểu và port semantic đề xuất

Giữ tên đề nghị CMS để đối chiếu; server context/permission, exact signature và vị trí shared port vẫn cần ACK trước adapter chung. Không public endpoint; browser không tự gọi port trusted.

```text
ProductCatalogItem = { id: ProductId, name: string, selectableForContent: boolean }
getSelectableProducts({ cursor?, limit }) ->
  Result<{ catalogVersion: opaqueRevision, items: ProductCatalogItem[], nextCursor?: opaqueCursor }, CatalogError>
validateArticleProducts(ids, { usage: 'new-selection' | 'retained-reference' }) ->
  Result<{ productIds: ProductId[], catalogVersion: opaqueRevision }, CatalogError>
CatalogError = VALIDATION_ERROR | PRODUCT_INVALID | PRODUCT_UNAVAILABLE |
               POLICY_UNRESOLVED | FORBIDDEN | INTERNAL_ERROR
```

CMS cần ID/name/selectableForContent, pagination và catalog revision; không cần price/payment/Subscription/User/contact. `getSelectableProducts` chỉ trả items selectable; retained ID lookup phải được producer giải quyết qua validation, không coi không có trong trang hiện tại là ID không tồn tại. Pagination thứ tự ổn định, cursor opaque, limit dương có cap; cursor/limit sai trả VALIDATION_ERROR, không query tùy ý. Exact cap/order/cursor encoding OPEN cho adapter task.

Validator nhận tập ID có giới hạn, không rỗng cho PAID_PRODUCT; đề xuất reject duplicate/malformed ID, UNKNOWN ID -> PRODUCT_INVALID. Không dùng wildcard; không bỏ ID lỗi để biến PAID thành PUBLIC. IDs phải được kiểm lại khi submit/approval theo CMS scope, không tin options đã tải. catalogVersion là revision quan sát catalog, không thay Article.updatedAt CAS, approval version hoặc entitlement revision. PUBLIC không gọi validator PAID; draft UNCONFIGURED vẫn được CMS lưu theo writer hiện hữu.

Billing cần port/snapshot khác: Product ID + ProductPlan ID, price/term/benefit/terms version, sale availability và currency/precision theo quyết định PO. Không thêm giá vào CMS DTO để dùng nó thay plan snapshot. Exact Billing DTO, số tiền/kỳ/thuế/renewal còn OPEN và ngoài bước pure catalog đầu tiên. Không gọi provider thanh toán khi CMS tải catalog.

## Sale, selectability và quyền đã cấp

| Tình huống | Đề xuất hành vi / boundary |
|---|---|
| Product/plan ngừng bán | Chặn mua mới theo sale policy; không tự revoke quyền đã cấp hoặc đổi snapshot quyền lợi |
| Product không selectable cho content mới | New-selection trả PRODUCT_INVALID; không xóa reference lịch sử, không cấp Product khác |
| Retained reference tới Product đã retire | Không tự drop hoặc fallback PUBLIC. Policy có được submit/approve lại với retained ID hay không OPEN, trả POLICY_UNRESOLVED cho operation đó tới khi owner chốt |
| Catalog producer chưa có/lỗi | PRODUCT_UNAVAILABLE, không catalog giả trên production; giữ draft/input, không giả empty-success |
| Catalog thay đổi giữa load và submit | Validate lại ID/selectability trong operation server; CMS CAS vẫn bảo vệ working copy. Adapter atomicity/revision recheck cần task riêng trước runtime |
| Quyền Product cũ còn hiệu lực khi ngừng bán | C02 xét kỳ quyền/revoke; không deny chỉ do sale flag. Quyền lợi ba nhóm đã bán không bị thu hẹp bởi config mới |

Sale state và content selectability là hai quyết định riêng. Tên enum/schema và các trường cụ thể OPEN; không thêm isActive duy nhất rồi suy cả sale/content/entitlement. Chưa tuyên bố schema, migration, approval/published pointer READY.

## Contract tests dự kiến — NOT_RUN

| ID | Case / expectation |
|---|---|
| C01-T01 | Rename giữ ID; cùng symbol ở hai Product không mở quyền chéo |
| C01-T02 | Năm Product × ba nhóm; mọi benefit fixture đủ ba, không charge/tab |
| C01-T03 | Missing/empty/malformed/duplicate/unknown ID -> safe validation failure |
| C01-T04 | New non-selectable deny; retired retained unresolved rõ, không PUBLIC/drop |
| C01-T05 | Ngừng bán không revoke grant fixture; đổi plan không sửa snapshot cũ |
| C01-T06 | Producer lỗi/unavailable != empty catalog success; không body/price/private fields trong CMS DTO |
| C01-T07 | Pagination ổn định/cursor-limit invalid; changed catalog recheck trước mutation, CAS không bị thay |
| C01-T08 | Billing dùng ProductPlan version khác Product ID; không instrument/label làm identity |

T01–T04/T06/T08 có phần pure làm trước; pagination/source recheck, persistence/transaction và snapshot integration cần producer adapter/migration và consumer task sau. Pure tests không chứng minh production catalog hoặc policy thương mại đã được PO duyệt.

## ACK và quyết định còn mở

Codex số 2 ACK **phạm vi producer semantic đề xuất do mình sở hữu**: catalog chung, stable Product identity, phân biệt plan/instrument, năm × ba và fail closed. Trạng thái toàn C01 vẫn PROPOSED_FOR_ACK: exact signatures/schema/selectability/retained policy cần review và consumer ACK trước dùng chung. CMS_ACK v0.1 **CHƯA GHI NHẬN**; ACK CMS-011.0 tại PR #29 chỉ cho ba file và C03 semantics, không phải ACK C01.

OPEN: consumer CMS xác nhận usage/retained-reference và DTO; Portal/Billing chốt plan snapshot khi task dùng; PO chốt giá/kỳ/benefit commercial/retire ảnh hưởng nội dung cũ; Integrator cấp slot schema/shared library riêng. Không chặn bước pure policy proposal vì Billing hoặc CMS reader chưa hoàn thành. Không sửa C03/C06 trong delta này.
