# Roadmap đồng bộ — các đợt nhỏ chạy được xuyên suốt

Trạng thái phần mới: chưa triển khai trong lượt tài liệu. Không thay lịch sử/roadmap CMS. Không có deadline hoặc người nhận task được tự gán. Chỉ bắt đầu code khi task spec, dependency và quyền sở hữu file rõ.

## 1. Mốc tích hợp

**M0 — thống nhất giao tiếp:** nhận checkpoint CMS/Portal, ACK C01–C07 cần dùng, xác nhận schema/role/route ownership. UI baseline đã duyệt, kỹ thuật chưa tự READY.

**M1 — nguồn khách:** đăng ký CLIENT + mã giới thiệu + xác minh + CRM đọc đúng nguồn/phạm vi. Không tiền giả, không paid access từ mã.

**M2 — quyền nội dung:** catalog sản phẩm và service entitlement; CMS công bố free/paid có snapshot; test free anonymous và paid fail closed. Test quyền dùng fixtures staging, không mở admin cấp quyền production tùy tiện.

**M3 — thu phí dùng được:** một sản phẩm/gói/phương thức đã được PO duyệt → đơn có nguồn → verified payment → một kỳ quyền → đọc paid article và khuyến nghị. Dữ liệu test phải có sản phẩm khác và negative users để kiểm tách quyền.

**M4 — hoàn thiện baseline:** đủ 19 màn nghiệp vụ, UI thật desktop/mobile, states, history, refund/revocation chính sách đã chốt và hồi quy.

**M5 — release có phép:** CI/staging/migration/rollback/security/paid-flow nghiệm thu có bằng chứng; PO cho mở bán. Test mock/duyệt UI không thay mốc này.

Mỗi mốc gồm nhiều task/PR nhỏ, không là prompt làm cả hệ thống một lần.

## 2. Registry task

Owner dưới đây là lane; người cụ thể/branch/HEAD nhận việc ở COORDINATION. Trạng thái ban đầu các task mới là PLANNED; riêng SUB-001 có tài liệu để review, chưa đóng task.

| Task | Giao phẩm v1 | Phụ thuộc implementation | Lane / UI |
|---|---|---|---|
| SUB-001 | Chốt contract/decisions/route/data và kế hoạch migration; nhận ACK | Checkpoint CMS + Portal | Integrator + hai lane; docs ready for review |
| SUB-002 | Product/Plan, quản trị tối thiểu và trang giới thiệu; price/benefit version | SUB-001 C01; migration slot | Portal; 01–02 |
| REF-001 | Mã và nguồn, revision/audit, contract đăng ký/CRM | SUB-001 C04; schema slot | Portal/CRM; nền 03/12/13 |
| SUB-003 | Đăng ký CLIENT có mã, xác minh/reset, tích hợp login và user cũ | REF-001 contract+implementation; Auth slot | Portal; 03–04 và xác minh |
| CRM-REF-001.A | Mã của tôi, referral summary và khối nguồn; giữ CRM scope | REF-001 + SUB-003 | Portal/CRM; 12–13 |
| SUB-004 | Quyền theo product/kỳ, check read, grant/revoke service | SUB-002; C02/C05 | Portal; nền 06/18/19 |
| PAY-001.A | Order snapshot gói/nguồn; sổ tiền, service xác nhận idempotent | SUB-002/003/004, REF-001; C04/C05 | Portal/Billing; 05/08/11 |
| PAY-001.B | Phương thức nhận tiền được chọn; đối soát/retry/refund theo policy | PAY-001.A + các quyết định tiền bắt buộc | Portal/Billing; 05/08/11 |
| CRM-REF-001.B | Đơn/tiền đọc từ Billing, không tính commission khi chưa có rule | CRM-REF-001.A + PAY-001.A | Portal/CRM; 12–13 |
| CMS-ACCESS-001.A | Thẻ quyền + lưu nháp/autosave/mapping products | C01/C03 ACK, SUB-002; CMS owner nhận slot | CMS; 14 |
| CMS-ACCESS-001.B | Audience review và published snapshot | A + các capability CMS-011/012/013/015 cần dùng đã đạt gate | CMS; 15 |
| CMS-ACCESS-001.C | Reader/feed/media/SEO quyền chung | B + SUB-004 + C06; capability CMS-016/019 và hồi quy liên quan | CMS; 16–19 |
| REC-001 | Khuyến nghị nhập tay, validation/preview/draft concurrency | SUB-002, staff scope, C01/C07 | Portal/REC; 09 |
| REC-002 | Review/publish/version/history/audience/media | REC-001 + SUB-004 + C06/C07 | Portal/REC; 07/10 |
| PORTAL-001.A | Shell/navigation, gói/đơn và states thật | SUB-003/004 + PAY-001.A; shared shell slot | Portal; 05/06/08 |
| PORTAL-001.B | Khuyến nghị và bài CMS của khách dùng reader chung | A + REC-002 + CMS-ACCESS-001.C | Portal + CMS; 07/18/19 |
| QA-PAID-001 | Test liên thông + threat/rollback/release evidence | Các phần baseline trên đã có; test viết dần không đợi cuối | QA + hai lane; mọi màn |
| COMM-001 | Rule/ledger/đối soát/chi trả phí giới thiệu | Ngoài đợt đầu; PO chốt chính sách + nguồn Billing/Referral đủ bằng chứng | DEFERRED_BY_SCOPE |

Suffix .A/.B/.C là subtasks của ID cũ, không phải cấp mã CMS chính thức mới. Developer CMS giữ quyền xác định task CMS hiện tại đã ở đâu; không khởi tạo lại code đã triển khai.

## 3. Việc có thể song song

Sau contract: CMS làm workflow/version phù hợp và Portal làm Products/Referral/Onboarding. Sau C02: Portal làm Subscription/Billing, CMS làm reader sử dụng contract cùng test double trong tests. REC có thể làm draft UI/validation song song CMS, nhưng không tự sửa shared media/schema. Consumer chỉ bật thật khi producer đã đạt gate trên commit tích hợp.

Không bắt CMS đợi dashboard hoa hồng. Không bắt mọi module đợi câu chữ tiếp thị cuối. Ngược lại, không cho reader trả phí mở trước authorization chỉ để đạt tiến độ UI.

## 4. Thứ tự merge và DB

Hợp đồng và migration nền nhỏ trước; cập nhật producer; cập nhật consumer sau. Mọi PR ghi depends-on PR/commit cụ thể, không chỉ tên task. Reviewer xác nhận schema/role imports build được ở từng điểm main; không để main import hàm chưa merge.

CMS và Portal không cùng ghi schema/migration/roles/editor writer/media/PortalShell trong hai PR không phối hợp. Một integrator cấp thứ tự. Khi main thay đổi sau review, kiểm diff/dependency và chạy lại gate bị ảnh hưởng trên commit mới. Không merge cùng lúc để tận dụng CI của base cũ.

## 5. Theo dõi trạng thái

PLANNED → SPEC_READY → CLAIMED → IMPLEMENTING → LOCAL_VALIDATED → REVIEWED → CI_VERIFIED → STAGING_VERIFIED → MERGED → DEPLOYED_TECHNICAL. COMPLETE chỉ khi DoD task và ngoại lệ nghiệm thu được ghi đúng. UI_APPROVED là chiều khác, không thuộc trạng thái test.

BLOCKED ghi nguyên nhân, contract/dependency, owner xử lý và việc độc lập vẫn làm được. Gate chưa chạy ghi NOT_RUN; test fail giữ lịch sử. Không auto đánh dấu mọi task COMPLETE khi PR docs được merge.
