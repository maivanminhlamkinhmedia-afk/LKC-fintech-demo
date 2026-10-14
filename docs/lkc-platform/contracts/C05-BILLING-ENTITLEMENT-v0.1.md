# C05 — Billing to Entitlement v0.1 — R0 semantic contract draft

Ngày: 14/10/2026 (Asia/Saigon). Task: `CODEX2B_R0_CONTRACT_DRAFT_AUTHORING`.
Trạng thái: **DRAFT_FOR_OWNER_ACK / BILLING_AND_C02_RUNTIME_HOLD**.
Integrator-of-record: ChatGPT / LKC Integrator coordination. Authorized writer: Codex 2B. Reviewer: Claude 2B.

## 1. Provenance và giới hạn

Soạn trên provisional local integration commit `1b941b3d855e3d422147ec61dbc25bb2795561c6`, tree `99a477edb585c2036136a85cd43ddc46644ca4c2`. Ordered parents: PR #27 `bd903b784976eb0a147844cac72fd7295a79c00b`, rồi PR #31 `a0e8e6d7f4b41ba417783e751f6d13daee90992c`; common ancestor `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`.

PO chuyển Claude 2B integration review PASS cho exact base/tree. Điều này không phải review PASS cho draft mới. #27/#31 vẫn OPEN/DRAFT, unmerged tại preflight 14/10/2026; base local-only, không cho phép merge main. Proposal/REV1 trước đây được review từ nội dung nguyên văn qua conversation, không khẳng định có local artifact chưa kiểm chứng.

Đối chiếu [C02 v0.2 draft](C02-PRODUCT-ACCESS-v0.2.md), [C01 v0.1](C01-PRODUCT-CATALOG-v0.1.md), [architecture C05/C07](../ARCHITECTURE-CONTRACTS.md), [roadmap](../ROADMAP.md) và [runtime task](../tasks/SUB-004-RUNTIME.md). C01/C02 semantic ACK lịch sử được bảo toàn; Billing runtime delta cần ACK riêng. Không định nghĩa approved exported API, payment adapter, schema, queue, grant/revoke service hoặc live policy.

## 2. Authority và source facts tối thiểu

Billing owner chịu trách nhiệm xác thực payment/order provenance. C02 chỉ nhận effect từ producer đã được duyệt, không coi callback HTTP, browser redirect, receipt, CRM, research webhook hoặc object có verified=true là bằng chứng thanh toán.

| Fact | Authoritative producer và review requirement |
|---|---|
| Payment event | Verify provider authenticity theo protocol thực tế, merchant/account/environment, stable event/payment identity, status và replay rules; không tự chọn HMAC hay tin header đơn lẻ |
| Order | Authoritative server order identity và state; bind payment với đúng order, amount/currency và scope đã duyệt; browser không chọn beneficiary/Product/term |
| Beneficiary | Server-resolved User reference, eligibility và lifecycle; tách purchaser khỏi beneficiary nếu business cho phép, hiện POLICY_UNRESOLVED |
| Product | Stable Product ID; không dùng symbol, label, plan ID hoặc FinancialInstrument thay Product |
| ProductPlan | Authoritative immutable/versioned order-time plan/benefit reference được Product/Billing ACK; không đọc current plan để âm thầm đổi entitlement đã mua |
| Term/period | Approved policy version và provenance của activation/bounds; không suy từ amount, arrival time hoặc fixture |
| Grant source | Stable accepted business scope của order và source operation, có durable mapping tới effect đã áp dụng |
| Audit/revision | C07/audit integration và entitlement revision cùng mutation protocol; bảo vệ raw financial/contact data khỏi reader DTO |

Các hàng là yêu cầu semantic; không khẳng định các models/fields này đã tồn tại. ProductPlan, verified Billing producer và C07 integration còn **PENDING_COMMIT** trong dependency inventory đã khảo sát. Không tạo fake source/foreign key, dùng CRM làm payment authority hoặc ghi dữ liệu tài chính vào public Product access DTO.

## 3. Idempotency và one-order effect

One order → one grant effect là invariant planning theo scope được chấp nhận trong roadmap; exact business-key composition, order cardinality và adjustment model cần Billing/Product ACK. Không tự suy mọi order chỉ có một line hoặc một payment. Multiple-Product/bundle/partial-payment scope chưa duyệt thì operation unresolved; không bẻ order thành grants tùy ý.

| Identity layer | Ý nghĩa | Không thay thế được |
|---|---|---|
| Payment-event identity | Nhận biết delivery/retry của cùng event từ verified producer | Grant business key của order |
| Provider payment identity | Theo dõi payment thực, kể cả nhiều event/status deliveries | Order effect identity |
| Grant business key | Ngăn cùng accepted order scope tạo effect thứ hai | Event dedupe; hai event khác nhau vẫn có thể cho cùng order |
| Operation/result identity | Durable lookup cho effect, revision, audit và reconciliation | Receipt ở memory hoặc HTTP ACK |

Cần stable namespaces theo provider/merchant/environment và order source để tránh collision; exact key/constraint chưa approved. Không key theo request nonce ngẫu nhiên, callback arrival time hoặc hash payload đơn thuần.

- Duplicate event, cùng canonical facts: trả/đối chiếu durable prior outcome, không tạo period, revision hoặc audit effect thứ hai. Delivery-attempt diagnostics không phải business effect.
- Cùng event identity nhưng khác order, beneficiary, Product, amount/currency hoặc status facts: reject/quarantine theo approved conflict contract; không last-write-wins hoặc silent upsert. Provider status transitions cần protocol riêng, không mặc định mọi khác biệt là duplicate hợp lệ.
- Hai event IDs cho cùng verified payment/order: event dedupe riêng; business-key guard vẫn ngăn double grant.
- Hai payment thực cho cùng order: giữ financial evidence cho reconciliation; không tạo entitlement thứ hai hoặc tự refund khoản thứ hai. Billing/PO quyết định xử lý.
- Source replay sau revoke/refund không tự tạo lại entitlement. Sửa lỗi/cấp lại là operation mới với authority, provenance và policy riêng; không xóa dedupe record để retry.

## 4. Lost ACK, reconciliation và concurrent mutation

Lost ACK sau commit không chứng minh operation thất bại. Caller phải query durable outcome bằng stable source/operation identity theo approved producer protocol trước retry. Nếu outcome chưa xác định, giữ pending/reconciliation; không đổi key hoặc blind regrant. Reconciliation phải phân biệt received, verified, applied, conflicting và unresolved outcomes về mặt semantic; đây không phải approved database enum/state machine.

Protocol implementation cần chứng minh atomicity của effect, business-key claim, source mapping, entitlement revision và required audit. Nếu Billing và C02 khác transaction/store, phải review durable handoff/outbox/inbox/reconciliation protocol; không hứa distributed exactly-once bằng một DB transaction hoặc network ACK. Chưa chọn outbox schema hay broker.

Concurrent grant cùng accepted order scope chỉ được có một business effect; concurrent grant khác order không bị dedupe nhầm. Unique violation/deadlock/timeout không tự thành success: phải lookup committed result, verify facts, hoặc giữ unresolved. Retry policy/bounds và lock ordering cần owner approval và fault evidence.

Concurrent renewal/overlap cho cùng User/Product là **POLICY_UNRESOLVED**. Không mặc định cộng tháng, extend latest end, overwrite period hoặc cho latest callback thắng. Hai Product độc lập không bị gộp chỉ vì cùng user. Multi-period safety và Product OR của C02 được giữ nguyên.

Late success, out-of-order status, refund/revoke đến trước success hoặc retry sau revoked period cần approved transition policy. Chưa có policy thì không resurrect, không grant bằng receipt cũ và không tự reverse financial state. `saleStopped` không tự revoke period đã cấp; ảnh hưởng tới order/payment đang xử lý còn cần Product/Billing decision.

Clock/order/payment event timestamps có mục đích khác nhau. Provider occurredAt và callback receivedAt không tự thành trusted entitlement clock/activation instant. C05 writer phải tham gia consistency protocol [R0-CONS-01..07](C02-PRODUCT-ACCESS-v0.2.md), gồm revision anchor khi chưa có period, clock sampling và concurrent readers. Actor/store/clock proof vẫn cần cho request đọc sau grant.

## 5. Policy register và fail-closed boundary

| Decision | Status và điều kiện mở operation |
|---|---|
| Term/calendar/timezone, activation và bounds | POLICY_UNRESOLVED; cần Product/PO approved version |
| Renewal/overlap, proration và order ordering | POLICY_UNRESOLVED; không dùng fixture để chọn live behavior |
| Grace | POLICY_UNRESOLVED; không mặc định zero hoặc vô hạn |
| Refund/partial refund/chargeback | POLICY_UNRESOLVED; payment fact không tự định nghĩa revoke scope |
| Revoke authority, effective instant, restoration và in-flight behavior | POLICY_UNRESOLVED |
| Historical content access | POLICY_UNRESOLVED; không suy từ payment thành perpetual access |
| Retirement/benefit changes và stopped-sale order handling | POLICY_UNRESOLVED |
| Entitlement revision/cache invalidation | POLICY_UNRESOLVED; revision-only cache không giải quyết expiry |
| Deny precedence/public privacy mapping | POLICY_UNRESOLVED; không trả payment/recipient facts ra reader |

One-order effect không tự giải quyết các policy trên. R0 minimal subset có thể giữ chúng OPEN; chỉ operation không phụ thuộc policy mở mới đủ điều kiện được xét slot sau ACK. Payment đang được xác minh không mở access. Thiếu authority, inconsistent facts hoặc policy cần thiết thì giữ deny/unresolved, không provisional ALLOW.

## 6. Test matrix và evidence levels

Toàn bộ cases bên dưới là kế hoạch **NOT_RUN** cho C05 runtime. Pure fixtures không thay producer, DB constraints hay real provider verification.

| Case | Expected invariant | Evidence cần trước activation |
|---|---|---|
| Valid verified event + matching approved order scope | Một effect và durable mapping; read chỉ theo C02 protocol | Pure policy + producer integration + real DB |
| Anonymous/forged callback, wrong merchant/environment/signature | Không grant; không raw secrets/errors | Provider-specific negative integration |
| Wrong order/user/Product/plan, amount/currency mismatch | Reject/unresolved; không sửa source facts để khớp | Producer/adapter negatives |
| Browser success redirect hoặc CRM/research event | Không là payment authority; không grant | Boundary/security tests |
| Same event same facts, sequential/concurrent | Một business effect, stable prior result | Pure dedupe model + real uniqueness/locks |
| Same event conflicting payload | Conflict visible trong protected reconciliation; không overwrite | Negative integration + real race |
| Different events same payment/order | Event ledger có thể khác; chỉ một grant effect | Real concurrent transactions |
| Two real payments one order | Không double grant; giữ evidence, refund chưa tự chạy | Billing reconciliation + PO policy |
| Two orders same User/Product; renewal race | Không lost update hoặc chọn overlap policy ngầm | Policy approval + real interleavings |
| Lost ACK/crash before/after apply | Lookup/reconcile; không regrant hoặc orphan revision/audit | Fault injection tại transaction boundaries |
| Late success sau refund/revoke | Không resurrection từ replay; transition unresolved khi chưa duyệt | Policy + order/outcome permutation tests |
| Grant/revoke đồng thời reader; missing revision anchor | Coherent periods/revision/time; không torn ALLOW | R0-CONS-02..06 real MariaDB proof |
| Rollback, unavailable audit/store/clock, deadlock | Không partial committed effect hoặc invented success | Failure/retry/rollback integration |
| Stopped sale sau valid grant | Không tự revoke; new-order handling vẫn unresolved | C02 pure + approved C05 policy |
| Notification/reconciliation retry hoặc export/webhook | Không lộ paid body, payment/contact/token vào public payload | Recipient/surface tests và owner ACK |

Real tests cần MariaDB version/config/isolation/constraints khớp approved target, independent connections, controlled barriers và commit/rollback evidence. SQLite/in-memory/mock pass không được gắn nhãn MariaDB concurrency PASS. Hiện **REAL_MARIADB_EVIDENCE_NOT_RUN**; không truy cập DB trong R0.

## 7. ACK và dependencies

| Owner | Minimal ACK cần bổ sung | Status |
|---|---|---|
| Billing | Verified source, event vs business key, accepted one-order scope, conflicts/lost ACK/reconciliation và mutation protocol | PENDING_OWNER_ACK |
| Product | ProductPlan/order-time benefit references, immutable identity, sale/retirement separation | PENDING_OWNER_ACK |
| CMS | Read/delivery chỉ consume C02; không receipt/notification shortcut; publication boundary | PENDING_OWNER_ACK |
| REC | Ba nhóm trong cùng Product, OR, linked-resource và source independence | PENDING_OWNER_ACK |
| Integrator | C05 producer owner, C07/store boundaries, minimal subset/exact dependency revision và slot claims | PENDING_INTEGRATOR_ACK |
| PO | Relevant commercial/transition policies và implementation/activation scope | POLICY_UNRESOLVED / IMPLEMENTATION_HOLD |

ACK phải chỉ rõ actor/role, exact document commit/revision, accepted subset/exclusions, OPEN decisions và nguồn evidence. Draft này chưa có committed document revision: **PENDING_COMMIT / PENDING_CLAUDE2B_REVIEW**. Không coi semantic ACK C01/C02 hoặc grant viết docs là ACK C05 runtime.

Product persistence #36 `0bbbd3ef768e3f44a3cb9d061744526316d535d7` và C01 #42 `6bd8b7222180dce82ed2d13c813606efed94e046` là dependency candidates, Draft/unmerged tại preflight; không chứng minh ProductPlan/Billing producer đã merge. R6/R7 theo task chỉ là proposed slots sau schema/consistency, C05/C07 và policy approval; không được thực thi từ R0.

**Gate: C05_DRAFT_ONLY / PENDING_OWNER_ACK / GRANT_REVOKE_HOLD / PAYMENT_HOLD / C02_RUNTIME_HOLD / DB_HOLD / STAGING_HOLD / PRODUCTION_NO_GO.**
