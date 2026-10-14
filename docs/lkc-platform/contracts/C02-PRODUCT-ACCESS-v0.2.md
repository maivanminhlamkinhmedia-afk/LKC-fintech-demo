# C02 — Product Access v0.2 — R0 contract draft

Ngày: 14/10/2026 (Asia/Saigon). Task: `CODEX2B_R0_CONTRACT_DRAFT_AUTHORING`.
Trạng thái: **DRAFT_FOR_OWNER_ACK / C02_RUNTIME_HOLD**.
Integrator-of-record: ChatGPT / LKC Integrator coordination. Writer được PO chỉ định: Codex 2B, đúng ba R0 documents. Reviewer: Claude 2B.

## 1. Provenance, revision và giới hạn thẩm quyền

Document được soạn trên provisional local integration base `1b941b3d855e3d422147ec61dbc25bb2795561c6`, tree `99a477edb585c2036136a85cd43ddc46644ca4c2`. Ordered parents: PR #27 `bd903b784976eb0a147844cac72fd7295a79c00b`, rồi PR #31 `a0e8e6d7f4b41ba417783e751f6d13daee90992c`; common ancestor `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`.

PO đã chuyển Claude 2B independent integration review PASS cho exact base/tree. Đây là reviewer evidence do PO cung cấp, không phải Codex tự review. Base vẫn local-only. #27/#31 được kiểm OPEN/DRAFT, unmerged trong preflight 14/10/2026. Dùng base này để author DRAFT không phê duyệt nội dung các PR, merge main hoặc runtime activation.

Runtime proposal và REV1 trước đây được review từ nội dung nguyên văn chuyển qua conversation; không khẳng định các bản đó tồn tại ở một local report path. Document này là artifact mới của authorized R0 authoring; source review của document mới vẫn **PENDING_CLAUDE2B_REVIEW**. Không tự đóng findings `CLAUDE2B-RT-00` đến `RT-04`.

Nguồn đối chiếu: [C01 v0.1](C01-PRODUCT-CATALOG-v0.1.md), [C02 v0.1](C02-PRODUCT-ACCESS-v0.1.md), [architecture](../ARCHITECTURE-CONTRACTS.md), [CMS integration](../CMS-INTEGRATION.md), [REC Product modes](../REC-PRODUCT-MODES-ADDENDUM.md), [C05 draft](C05-BILLING-ENTITLEMENT-v0.1.md) và [runtime task](../tasks/SUB-004-RUNTIME.md).

C01/C02 semantic ACK đã nhận được bảo toàn theo [registry tại e855d1e](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/blob/e855d1e4a5eeee0618d4b6b1f0edf7dc9d5335f9/docs/lkc-platform/COORDINATION.md). Trạng thái ACK chưa ghi nhận trong v0.1/base registry là lịch sử. ACK semantic này không phê duyệt toàn bộ runtime signature, composition, schema, locking, revision/cache hoặc reader delivery; delta cần ACK riêng.

Không có runtime API, port signature, physical model hay migration được APPROVED bởi document này. Không triển khai các proposal bằng cách copy pseudocode/type từ tài liệu.

## 2. Invariants được bảo toàn

- Product ID ổn định, opaque, không tái dùng cho Product khác. Product không phải ProductPlan, FinancialInstrument, symbol, label, slug, tab hoặc source origin.
- Năm Product: Chứng khoán cơ sở; Chứng khoán phái sinh; Hàng hóa phái sinh; Vàng; Tài sản số. Tên không trở thành production ID/seed.
- Mỗi Product bao phủ cả ba nhóm: `MANUAL_RECOMMENDATION`, `AUTOMATED_RECOMMENDATION`, `PROBABILITY_OUTLOOK`. Không paywall hoặc thu phí riêng từng nhóm. STAFF/WEBHOOK không là entitlement capability.
- Audience PAID phải là tập Product IDs hợp lệ, không rỗng. Missing/malformed/duplicate/unknown policy không thành wildcard/PUBLIC; không âm thầm bỏ ID lỗi để tạo ALLOW.
- Với valid published audience, nhiều Product dùng OR: ít nhất một Product có period hợp lệ theo approved policy mới đạt Product access. A-only không mở B-only.
- Xét mọi period liên quan; expired/revoked period không tự phủ định period khác hợp lệ. Hết quyền A không khóa account hoặc làm mất B.
- `saleStopped` không tự revoke period đã cấp. Content selectability cho lựa chọn mới không phải subscriber-read entitlement. Retirement/retained/historical effects còn cần policy.
- Outage của research source không đồng nghĩa mất entitlement hoặc phải mua thêm nhóm. Outage của entitlement authority phải fail closed.

[PR #67](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/67), source `6b27993cb76f52a307dfdcbf8fd09ab017a14b7a`, vẫn là pure supplied-snapshot evaluator. Mọi decision giữ `basis: SUPPLIED_SNAPSHOTS_ONLY` và `runtimeAuthorized: false`, kể cả hypothetical ALLOW. Ba source/test files của #67 không thuộc R0 MODIFY scope và không được sửa. Không chuyển synthetic ALLOW thành production authority bằng cách đổi cờ hoặc truyền policy `SYNTHETIC` vào reader.

## 3. Trust và ownership boundaries

| Boundary | Requirement cho runtime tương lai | Không chấp nhận làm authority |
|---|---|---|
| Actor | Resolve session phía server; đọc lại User identity/status trong consistency protocol; account eligibility theo approved policy | Browser userId/role/allow, CLIENT role đơn lẻ, paid flag trong JWT hoặc object có verified=true |
| Store | Authoritative SubscriptionPeriod facts, source identities, policy/benefit versions và revision nhất quán | Receipt/redirect, CRM attribution, supplied snapshots, root-client shape hoặc mock |
| Clock | Server-controlled clock authority được ACK; clock sampling gắn với decision protocol và clock health | Browser timestamp, Date object do request gửi, client header hoặc injection flag tự khai trusted |
| Content | CMS/REC owner resolve đúng published version, audience và publication revision | Raw working Article, preview/reviewer queue, publishedAt đơn lẻ hoặc client product list |
| Policy | Versioned policy với approval provenance do server quản lý | Browser approved=true, fallback/default chưa được PO chốt |

NextAuth/User hiện hữu là candidate actor source. Không thêm CLIENT vào `cms:access`; staff role không tự có paid entitlement. C01 producer ở PR #42 có CMS-staff guard, nên không gọi trực tiếp bằng subscriber hoặc nới guard để phục vụ C02. Product owner phải ACK bounded Product-reference validation phù hợp reader, không tái dùng selectable-list như bằng chứng quyền đọc.

Clock từ primary DB UTC là phương án để review, chưa là lựa chọn implementation đã duyệt. Authoritative clock, precision, drift detection, lock ordering/isolation và missing-revision behavior cần chốt ở minimal subset/implementation contract. Một marker Serializable, Clock interface hoặc transaction-client shape không chứng minh nguồn tin cậy hoặc DB isolation.

## 4. Decision và publication boundary

Decision tương lai chỉ chứa kết quả tối thiểu và safe internal reason theo contract được ACK; không body/title/asset, raw rows/errors, payment/contact hoặc storage path. Tên `asOf`/entitlement revision ở v0.1 là semantic proposal, không expiry token hoặc bearer credential. Không giả revision khi store chưa cung cấp consistency proof.

Safe categories gồm unauthenticated/forbidden, invalid policy, no usable entitlement, unavailable authority và `POLICY_UNRESOLVED`; exact public error union, HTTP mapping, reason precedence và existence-disclosure policy là **PENDING_OWNER_ACK / POLICY_UNRESOLVED**. Consumer không serialize internal reason/raw exception để tiết lộ draft hoặc private audience. Không định nghĩa public endpoint hay runtime function signature trong R0.

Published PUBLIC hợp lệ do consumer xử lý, không gọi Billing/CRM/C02 chỉ để đọc free. PAID phải kiểm C02. UNCONFIGURED, draft, approved-only, scheduled tương lai hoặc withdrawn không phát body dù Product access ALLOW. C02 không publish, không cấp CMS permission và không thay C03/C06.

Reader chọn publication/version/audience coherent trước protected serialization; body và asset relationship phải thuộc chính version đã kiểm. Working revision mới không tự thay published snapshot. Kèo B link bài A phải kiểm A riêng; không embed body A vào DTO B. Historical/version URL không bypass policy lịch sử.

## 5. Consistency acceptance criteria

Tất cả AC dưới đây là **design requirements; REAL_MARIADB_EVIDENCE_NOT_RUN**. Không ghi PASS từ docs, pure tests hoặc CI #67.

| AC | Requirement có thể kiểm chứng | Evidence bắt buộc trước runtime liên quan |
|---|---|---|
| R0-CONS-01 | Xác định authoritative store/clock, policy version và authorization decision point | Exact implementation/config, approved target/version và protocol review |
| R0-CONS-02 | Period facts, subject/Product scope và entitlement revision thuộc một coherent observation; không ghép snapshot/replica/transaction khác | Two-session tests, missing-state cases và fault injection trên MariaDB khớp target |
| R0-CONS-03 | Clock sampling xét lock waits/query delay; không ALLOW bằng instant cũ sau temporal boundary | Fixed-clock pure cases cộng delayed-lock/read tests trên target DB |
| R0-CONS-04 | Grant/revoke, revision và audit effect tuân thủ cùng writer protocol; xử lý cả khi chưa có period/revision anchor | Real uniqueness/FK/locking, rollback/crash/reconciliation evidence |
| R0-CONS-05 | Chốt hành vi khi grant/revoke commit trước/sau decision point và đối với request đang chạy | Approved in-flight semantics; concurrent read/write interleavings |
| R0-CONS-06 | Actor/store/clock/revision unavailable, malformed hoặc consistency không chứng minh được phải deny/unresolved | Adapter negatives và real outage/clock-health/consistency tests |
| R0-CONS-07 | Decision không là token lâu dài; publication/audience đổi hoặc request vượt boundary cần revalidation theo protocol | Reader/RSC/HTTP/cache tests gắn đúng content/policy/revision |

Protocol cần nêu transaction boundary, common serialization/revision anchor, lock order, isolation, clock sampling và last authorization check trước protected emission. Same transaction tự nó chưa đủ: replica lag, statement timing, missing rows và clock skew đều phải được xét. Nếu không giữ được assumptions, operation không được ALLOW bằng snapshot cũ.

Revoke latency và in-flight semantics chưa được chọn; không hứa network emission atomic với DB commit hoặc thu hồi bytes đã tải hợp lệ. Expiry phải được đánh giá theo approved interval tại request, không chờ cron. Khoảng `[startsAt, endsAt)` chỉ là fixture hypothesis cho tới khi PO chốt live policy.

Revision không thay actor revalidation, trusted time hoặc publication checks. Expiry có thể xảy ra mà không có mutation event; revision-only cache không đủ. Missing/contradictory revision không được giả thành revision 0 hoặc durable ALLOW.

## 6. Cache, reader và delivery threats

Đề xuất v1 để owner review: không có authorization cache xuyên request. Đây chưa là cache implementation approval. Request-time rendering, server/data/full-route cache, browser Router Cache và CDN phải được kiểm độc lập theo Next version trên integration source; private/no-store header không chứng minh end-to-end safety.

| Surface | Threat/test control dự kiến |
|---|---|
| HTTP/API/JSON | Recheck authority trước DTO/body; URL không chọn actor/allow/time; denied response không raw reason/body; authorize trước conditional 304 |
| RSC/Flight/HTML | Không select/serialize protected body vào client props, parallel component hoặc streamed segment trước authorization |
| Prefetch/Router Cache | Không prefetch paid body bằng stale authorization; kiểm navigation, logout/account switch, expiry/revoke và cached payload |
| Media GET/HEAD/conditional/Range nếu hỗ trợ | Kiểm content/version/asset + C02; không mở staff-media route cho mọi CLIENT; giữ integrity/private storage |
| Search/related/OG/sitemap | Chỉ approved public metadata; linked resource kiểm riêng; không draft/paid snippets hoặc count disclosure ngoài privacy policy |
| RSS/feeds/public Sheets | Anonymous projection không chứa paid body hoặc private metadata; private-feed token/URL cần auth/revocation contract riêng |
| Exports/download jobs | Kiểm subject/resource khi tạo và khi tải theo approved policy; stale job/signed URL không bypass revoke hoặc version checks |
| Email/notification/push | Kiểm recipient và entitlement trước dispatch do app kiểm soát; subject/preview/lock-screen payload có allowlist riêng |
| Digest/batch/retry | Kiểm từng resource/recipient; không dùng aggregate ALLOW từ thời điểm enqueue cho cả batch hoặc lần retry sau revoke |
| Inbound research webhook | Source write authority riêng; payload user/Product/payment flags không cấp quyền; không dùng C02 làm webhook authentication |
| Outbound webhook nếu có | Recipient/redistribution scope riêng; subscription không tự authorize relay paid body; recheck trước app-controlled dispatch |
| Logs/DLQ/artifacts | Không raw body/contact/payment/credential/token trong diagnostics; metadata tối thiểu với retention/access review |

Inventory tại source #67: có contact-consultation email, public Sheets/Góc nhìn/sitemap và CRM CSV export; chúng không phải paid delivery implementation. CRM permission/scope giữ độc lập. Chưa xác nhận subscriber digest/RSS/webhook delivery trong source inventory đã khảo sát; future surfaces chỉ là conditional requirements, không permission tạo feature mới.

Payload tối thiểu và link tới guarded reader là phương án để review cho notifications; không phê duyệt gửi paid body ra ngoài. Dữ liệu đã giao provider/người nhận hoặc đã public không được hứa thu hồi. Paid redistribution/retention chưa rõ thì operation `POLICY_UNRESOLVED`.

Nếu owner sau này đề xuất cache, cần key binding actor/content-version/audience/policy/revision, temporal cap, invalidation và concurrency proof; TTL hoặc invalidation event đơn lẻ không đủ. Không áp dụng cache proposal trước ACK/evidence.

## 7. Business policy và ACK register

| Decision | Trạng thái hiện tại |
|---|---|
| Term/calendar/timezone, activation và interval boundaries | POLICY_UNRESOLVED |
| Renewal/overlap/stacking và concurrent order ordering | POLICY_UNRESOLVED |
| Grace | POLICY_UNRESOLVED; không mặc định zero grace |
| Refund/revoke scope, authority và in-flight semantics | POLICY_UNRESOLVED |
| Historical content access | POLICY_UNRESOLVED |
| Retirement/benefit changes | POLICY_UNRESOLVED |
| Entitlement revision/cache invalidation | POLICY_UNRESOLVED |
| Deny precedence/public privacy mapping | POLICY_UNRESOLVED |

R0 có thể được review với các decisions còn mở. Operation phụ thuộc decision chưa được duyệt phải deny/unresolved; fixtures không tạo live default. Không chặn module độc lập bằng một decision không thuộc operation đó.

| Owner | Minimal delta ACK cần ghi nhận | Status |
|---|---|---|
| Product | Stable identity, plan/benefit snapshot semantics, reader reference validation, sale/selectability separation | PENDING_OWNER_ACK |
| Billing | C05 verified source, one-order effect, duplicate/conflict/reconciliation và mutation consistency boundary | PENDING_OWNER_ACK |
| CMS | Published audience/version, safe decision consumption, C03/C06, reader/cache/delivery obligations | PENDING_OWNER_ACK |
| REC | Product OR/ba nhóm, published scope, linked-resource checks, source/delivery separation | PENDING_OWNER_ACK |
| Integrator | Exact minimal subset, dependency/source revision, shared ownership và implementation sequencing | PENDING_INTEGRATOR_ACK |
| PO | Business decisions theo operation và implementation/activation scope riêng | POLICY_UNRESOLVED / IMPLEMENTATION_HOLD |

ACK evidence cần actor/role, exact document revision/commit, accepted subset, exclusions, OPEN items và provenance (owner trực tiếp hoặc PO-relayed). Không dùng im lặng, DRAFT authoring grant hoặc semantic ACK lịch sử để điền APPROVED cho runtime delta. Subset chưa có exact published commit ghi PENDING_COMMIT.

## 8. Dependency và readiness gates

C01 #42 `6bd8b7222180dce82ed2d13c813606efed94e046`, Product persistence #36 `0bbbd3ef768e3f44a3cb9d061744526316d535d7`, CMS audience #53 `78fc4bdb82e83e9cb3c7fe671a080b1668841026`, W0 #55 `5321f28673eeee11ed8f913c78c7cdcb38896f9e` và queue #56 `61c5591bb875bffaeb3d71d2f734d39d1e87faf7` vẫn Draft/unmerged tại preflight. Schema/draft writer/queue không chứng minh published reader hoặc entitlement readiness.

ProductPlan, verified Billing/C05 producer, C07 integration, CMS published producer và REC-002 published reader: PENDING_COMMIT trong source inventory đã khảo sát. Không tạo fake producer, FK hoặc source SHA để lấp gap. Task document giữ proposed slot order và owner boundaries.

R1 chỉ được implementation sau R0 minimal approved contract subset, exact acknowledged document commit/revision, relevant policy decisions và PO authorization riêng cho R1. Document DRAFT này không đáp ứng gate đó. R4/R5 shared paths phải recheck claims/collisions tại slot grant và trước first write.

Real MariaDB consistency/constraints/concurrency, auth/HTTP/RSC/cache/media/delivery integration, staging và activation: NOT_RUN. C02 runtime/shared port/paid reader: NOT_READY.

**Gate: R0_DRAFT_ONLY / PENDING_OWNER_ACK / R1_IMPLEMENTATION_HOLD / C02_RUNTIME_HOLD / DB_HOLD / STAGING_HOLD / PRODUCTION_NO_GO.**
