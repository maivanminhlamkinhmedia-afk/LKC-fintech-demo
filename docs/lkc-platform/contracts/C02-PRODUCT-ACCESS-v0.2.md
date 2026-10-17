# C02 — Product Access v0.2 — R0 contract draft

Baseline: 14/10/2026. Delta: 17/10/2026 (Asia/Bangkok), task `LKC-C4-R1-R0-DELTA-CORRECTION-001`.
Trạng thái delta: **WAITING_CLAUDE4_REVIEW / PENDING_OWNER_ACK / C02_RUNTIME_HOLD**.
Integrator-of-record: ChatGPT / LKC Integrator coordination. PO xác nhận Codex 4 tương ứng Codex 2B, writer lịch sử #69, và cấp quyền sửa cục bộ đúng ba tài liệu. Reviewer delta: Claude 4. Grant tài liệu không cấp claim/source implementation R1.

## 1. Provenance, revision và giới hạn thẩm quyền

Document được soạn trên provisional local integration base `1b941b3d855e3d422147ec61dbc25bb2795561c6`, tree `99a477edb585c2036136a85cd43ddc46644ca4c2`. Ordered parents: PR #27 `bd903b784976eb0a147844cac72fd7295a79c00b`, rồi PR #31 `a0e8e6d7f4b41ba417783e751f6d13daee90992c`; common ancestor `5e6b14f006453da7f9b1554c210e9ad85a9f8c0c`.

Baseline đã công bố tại [PR #69](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/pull/69), exact SHA `7744a89e5053e7838ea93069f1affb969ccaa783`, trên base `1b941b3d855e3d422147ec61dbc25bb2795561c6`. PR ghi integration, R0 draft source, commit provenance và publication review PASS do PO chuyển; đây không phải GitHub-authenticated approval hoặc runtime owner ACK. Trạng thái local-only/PENDING_CLAUDE2B_REVIEW của lần authoring là lịch sử. #27/#31 OPEN/DRAFT tại preflight 14/10/2026 không phải kiểm tra trạng thái mới.

Delta cục bộ này chưa có commit riêng, chưa được Claude 4 review hoặc owner ACK. Review baseline không bao phủ delta; phải review exact diff/fingerprints, có grant publication riêng, rồi pin revision mới cho ACK. Runtime proposal/REV1 trước đây là nội dung PO chuyển qua conversation; không tự đóng findings `CLAUDE2B-RT-00` đến `RT-04` hoặc gán chúng cho unverified report path.

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

### 2a. Candidate minimal R1 delta — pure nội bộ, chưa APPROVED

R1 chỉ đề xuất bổ sung cách biểu diễn supplied read facts, xác định policy prerequisites của operation và truyền trạng thái `POLICY_UNRESOLVED`. Không phải một Product access evaluator thứ hai, không có runtime signature/shared port hoặc live ALLOW.

| Phần | Kế thừa #67 | R1 mới đề xuất |
|---|---|---|
| Supplied facts | Actor, catalog/Product IDs, audience/group, periods và fixture instant chỉ là dữ liệu được truyền vào; shape không chứng minh provenance | Mô tả operation đọc và những policy facts nó cần; tham chiếu domain #67, không giả actor/store/clock đáng tin cậy |
| Product validation/evaluation | ID hợp lệ trong supplied catalog, unknown IDs fail-closed; Product OR, ba nhóm, multi-period và stopped-sale independence | Giữ nguyên evaluator và các tests #67; không sao chép parser/OR/period algorithm hoặc lấy selectable-list làm read authorization |
| Policy prerequisites | #67 đã giữ history/revision/unresolved policy và mixed deny reasons ở trạng thái unresolved | Nêu rõ prerequisite nào cần cho operation thuộc accepted subset; thiếu quyết định được duyệt thì truyền `POLICY_UNRESOLVED`, không suy từ default hoặc thứ tự facts |
| Output boundary | `basis: SUPPLIED_SNAPSHOTS_ONLY`, `runtimeAuthorized: false`, kể cả hypothetical ALLOW | Kết quả prerequisite nội bộ không là permission, token hoặc public DTO; đủ supplied prerequisites cũng không tạo quyền đọc |

#### Ma trận operation → policy prerequisites — CANDIDATE_FOR_OWNER_ACK

F2 correction: `LKC-C4-R1-R0-DELTA-F2-FIX-002`. Toàn bộ ma trận và cách phối hợp dưới đây là đề xuất chờ owner ACK trên exact revision, không phải policy đã duyệt hoặc API signature.

`REQUIRED`: cần cho mọi operation của hàng đó. `CONDITIONAL`: cần khi điều kiện nêu trong hàng có liên quan; nếu supplied facts/accepted subset không đủ xác định điều kiện có áp dụng hay không, giữ `POLICY_UNRESOLVED`, không mặc định “không áp dụng”. `OUT_OF_R1`: không thực thi trong pure R1; không miễn nghĩa vụ runtime tương lai. Thiếu ACK hoặc facts cần thiết cho prerequisite đang áp dụng thì đề xuất `POLICY_UNRESOLVED`. Supplied facts chỉ mô tả snapshot; không tự chứng minh ACK.

| Operation | Phân loại | Prerequisite và điều kiện áp dụng |
|---|---|---|
| CURRENT read | REQUIRED | Product identity/audience hợp lệ trong supplied catalog; unknown IDs fail-closed theo #67. Không dùng selectable-list làm read authorization. Cần Product ACK cho phạm vi supplied facts, không thêm parser/OR evaluator vào R1. |
| CURRENT read | REQUIRED | Policy interval, activation và ý nghĩa thời gian: cần quyết định được ACK về cách hiểu supplied startsAt/endsAt và instant đọc; không tự chọn term, activation event hoặc interval thương mại. R1 không tính lại period. |
| CURRENT read | REQUIRED | Revocation scope và ý nghĩa revoked đối với period/Product đang xét phải được ACK; không tự coi revoke một period là revoke toàn Product/account hoặc chọn deny precedence. |
| CURRENT read | CONDITIONAL | Grace: cần ACK nếu quyền đọc tại instant được cung cấp có thể phụ thuộc grace quanh/sau endsAt, gồm trường hợp #67 báo EXPIRED. Chưa xác định được applicability cũng unresolved; không mặc định zero grace hoặc tự gia hạn. |
| CURRENT read | CONDITIONAL | Renewal/overlap: cần ACK nếu quyền đọc phụ thuộc cách renewal sinh/đổi period, carry-over hoặc effect của overlap chưa được xác định. OR trên các period đã cung cấp vẫn do #67 xử lý; chỉ có nhiều period không tự cho phép R1 tính renewal hay cộng term. |
| CURRENT read | CONDITIONAL | Refund/adjustment/chargeback: cần ACK nếu supplied snapshot/operation cho biết effect đó có thể thay đổi hiệu lực period hoặc phạm vi quyền đọc, hoặc chưa đủ facts để loại trừ ảnh hưởng. Không suy refund thành revoke hay giữ quyền; không đọc payment/order provenance. |
| CURRENT read | CONDITIONAL | Retirement/benefit effects: cần ACK nếu Product retirement hoặc thay đổi benefit/version có thể tác động quyền đọc đang xét. saleStopped đơn thuần giữ invariant không tự revoke; không suy từ đó policy retirement/retained access. |
| CURRENT read, revision NOT_REQUESTED | CONDITIONAL | Nếu operation vẫn phụ thuộc policy/benefit/publication revision hoặc tính nhất quán giữa supplied facts, cần prerequisite về revision/coherence được ACK và facts tương ứng. NOT_REQUESTED không chứng minh freshness và không được dùng để bỏ revision mà operation thực sự yêu cầu. |
| HISTORICAL read | REQUIRED | Kế thừa các REQUIRED của CURRENT: Product identity, interval/activation/thời gian và revocation scope; thêm ACK historical-content access và published-version semantics, hiện còn mở. Không chuyển HISTORICAL thành CURRENT để né unresolved. |
| HISTORICAL read | CONDITIONAL | Kế thừa grace, renewal/overlap, refund/adjustment/chargeback, retirement/benefit và revision/coherence theo cùng điều kiện của CURRENT; cần policy quyết định chúng ảnh hưởng historical access ra sao khi liên quan. Không tự chọn quyền hiện tại hay quyền tại thời điểm xuất bản làm chuẩn. |
| CURRENT hoặc HISTORICAL, revision REQUIRED | REQUIRED | Cần policy/revision prerequisite được ACK: revision nào ràng buộc policy, entitlement và published version, cách đối chiếu supplied facts, xử lý missing/mismatch. Hiện chưa đủ cơ sở cho access; giữ POLICY_UNRESOLVED, không dựng revision 0 hoặc đổi thành NOT_REQUESTED. |
| CURRENT/HISTORICAL, mọi revision mode | OUT_OF_R1 | Authoritative clock/store, live revision validation, cache invalidation/revalidation, in-flight read/write ordering và protected emission thuộc runtime tương lai. R1 chỉ nhận diện prerequisite của snapshot, không chứng minh freshness, lock, transaction hoặc quyền phát body. |
| Renewal/refund/chargeback/grant/revoke execution | OUT_OF_R1 | Không phát effect, period hoặc mutation. Chỉ mô tả policy dependency của read khi liên quan; không thay C05 runtime hoặc gọi Billing. |

#### Phối hợp với #67 — CANDIDATE_FOR_OWNER_ACK

Đối chiếu trực tiếp `src/features/subscriptions/product-access-contract.ts` và `product-access-policy.ts` tại `6b27993cb76f52a307dfdcbf8fd09ab017a14b7a`: #67 chỉ có policy UNRESOLVED hoặc SYNTHETIC với interval START_INCLUSIVE_END_EXCLUSIVE và revocationScope PERIOD (mỗi trường cũng có thể UNRESOLVED). Đây là giả định fixture, không phải giá trị thương mại đã ACK. #67 không tính grace/renewal/refund; HISTORICAL và revision REQUIRED luôn thêm POLICY_UNRESOLVED trước vòng period/OR. Mixed failure reasons cũng unresolved.

**R1 không import trực tiếp evaluator hoặc types #67 và không triển khai lại parser/Product OR/period evaluator.** R1 đứng độc lập, chỉ mô tả và đánh giá prerequisites thuần nội bộ. Tham chiếu #67 trong tài liệu không tạo dependency source đã tích hợp. Không có wrapper/shared port hay consumer mới trong scope này.

Đề xuất cụ thể tại **integration boundary tương lai**, chỉ sau khi Integrator duyệt compatible base, dependency mapping và contract cùng owner ACK:

1. Xác định operation, supplied snapshot và các prerequisites đang áp dụng theo ma trận; dùng R1 kiểm prerequisites trước khi sử dụng kết quả #67. Thiếu ACK/facts cần thiết, applicability chưa rõ hoặc facts mâu thuẫn thì dừng phối hợp ở POLICY_UNRESOLVED, không suy quyết định access.
2. Chỉ khi prerequisites đã rõ và mapping tương thích mới xem xét gọi evaluator #67 không sửa đổi cho pure fixture. Không truyền thêm trường R1 vào strict input của #67; input validation vẫn do #67 đảm nhiệm. Không chuyển parsing failure/unknown Product thành một commercial policy decision.
3. Kết quả #67 vẫn phải giữ unresolved nếu chính #67 không hỗ trợ semantics đó; prerequisites đầy đủ không biến thành ALLOW và không sửa reading/revisionRequirement để đi qua evaluator. Không ánh xạ policy thương mại đã ACK thành SYNTHETIC để tạo production authority. Mapping/semantics không biểu diễn được ở #67 vẫn unresolved, cần Integrator quyết định riêng.
4. Mọi kết quả phối hợp chỉ là pure/supplied-snapshot, giữ `basis: SUPPLIED_SNAPSHOTS_ONLY` và `runtimeAuthorized: false`; không cấp reader authorization. Đề xuất này không phê duyệt integration implementation.

Các cases semantic để Claude 4/owner review, **chưa là tests đã chạy**:

| Kết quả/facts được đối chiếu | Kết quả phối hợp đề xuất |
|---|---|
| #67 trả EXPIRED nhưng read có thể phụ thuộc grace chưa được quyết định | POLICY_UNRESOLVED, không chốt EXPIRED thắng grace, không tự ALLOW hay zero grace. Theo thứ tự đề xuất, integration boundary dừng ở prerequisite; EXPIRED có sẵn chỉ là kết quả fixture để đối chiếu. |
| #67 cho hypothetical ALLOW nhưng R1 còn prerequisite cần thiết chưa ACK/thiếu facts | POLICY_UNRESOLVED; hypothetical ALLOW không bỏ qua R1 và không thành quyền đọc. |
| interval/revocationScope giả định của #67 không nhất quán với supplied policy facts R1 | Fail-closed/POLICY_UNRESOLVED; không mặc định chọn nguồn có lợi cho ALLOW, không sửa period/revoked hoặc ép facts khớp. Integrator/owner phải giải quyết compatibility. |
| R1 không còn prerequisite thiếu, nhưng #67 trả POLICY_UNRESOLVED (gồm HISTORICAL/revision REQUIRED) | Bảo toàn POLICY_UNRESOLVED; không đổi HISTORICAL thành CURRENT hoặc REQUIRED thành NOT_REQUESTED. |
| Nhiều prerequisites unresolved hoặc đổi thứ tự facts | Vẫn POLICY_UNRESOLVED; không tự chọn commercial deny precedence hoặc public error mapping. |
| Prerequisites đầy đủ và #67 cho hypothetical ALLOW trong fixture tương thích | Chỉ là kết quả pure với runtimeAuthorized: false; không chứng minh provenance, không mở paid reader. |

Facts có thể mô tả nhu cầu current/historical reading, revision và các policy liên quan tới operation, nhưng đây là mô tả semantic, không là exported API/type signature được duyệt. Không thêm `approved=true`/trust flag để xác thực policy. Invalid/unknown Product input vẫn fail-closed theo boundary #67; không đổi parsing failure thành commercial decision. Khi nhiều policy cần thiết chưa duyệt, giữ `POLICY_UNRESOLVED`, không chọn deny precedence hoặc tạo HTTP/privacy mapping.

Term/activation, renewal/overlap, grace, refund/chargeback, revoke, history, retirement/benefit changes và revision/cache chưa duyệt vẫn `POLICY_UNRESOLVED`. Không mặc định zero grace, tính lại period, gia hạn, hoàn tiền hoặc phục hồi quyền. R1 không nhận payment/order provenance, không grant/revoke, không DB/auth/clock adapter, không consumer CMS/REC hoặc quyền phát hành nội dung. Hypothetical ALLOW của #67 không được nâng thành live ALLOW.

ACK giới hạn R1 theo [task §2](../tasks/SUB-004-RUNTIME.md); trust/consistency/delivery requirements dưới đây dành cho runtime sau này, không biến toàn bộ R0–R10 thành prerequisite implementation của pure R1. Compatible ancestry, exact accepted subset và single-writer claim vẫn phải được Integrator pin trước source grant.

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

Ma trận sau là ACK cho runtime tương lai. ACK minimal R1 chỉ theo task §2, không tự đánh dấu các hàng runtime này APPROVED.

| Owner | Minimal delta ACK cần ghi nhận | Status |
|---|---|---|
| Product | Stable identity, plan/benefit snapshot semantics, reader reference validation, sale/selectability separation | PENDING_OWNER_ACK |
| Billing | C05 verified source, one-order effect, duplicate/conflict/reconciliation và mutation consistency boundary | PENDING_OWNER_ACK |
| CMS | Published audience/version, safe decision consumption, C03/C06, reader/cache/delivery obligations | PENDING_OWNER_ACK |
| REC | Product OR/ba nhóm, published scope, linked-resource checks, source/delivery separation | PENDING_OWNER_ACK |
| Integrator | Exact minimal subset, dependency/source revision, shared ownership và implementation sequencing | PENDING_INTEGRATOR_ACK |
| PO | Business decisions theo operation và implementation/activation scope riêng | POLICY_UNRESOLVED / IMPLEMENTATION_HOLD |

ACK evidence cần actor/role, exact document revision/commit, accepted subset, exclusions, OPEN items và provenance (owner trực tiếp hoặc PO-relayed). Không dùng im lặng, DRAFT authoring grant hoặc semantic ACK lịch sử để điền APPROVED cho runtime delta. Baseline đã có exact published commit `7744a89e5053e7838ea93069f1affb969ccaa783`; delta mới phải được review và pin revision riêng trước ACK, không dùng SHA baseline để nhận ACK cho bytes đã đổi.

## 8. Dependency và readiness gates

C01 #42 `6bd8b7222180dce82ed2d13c813606efed94e046`, Product persistence #36 `0bbbd3ef768e3f44a3cb9d061744526316d535d7`, CMS audience #53 `78fc4bdb82e83e9cb3c7fe671a080b1668841026`, W0 #55 `5321f28673eeee11ed8f913c78c7cdcb38896f9e` và queue #56 `61c5591bb875bffaeb3d71d2f734d39d1e87faf7` vẫn Draft/unmerged tại preflight. Schema/draft writer/queue không chứng minh published reader hoặc entitlement readiness.

ProductPlan, verified Billing/C05 producer, C07 integration, CMS published producer và REC-002 published reader: PENDING_COMMIT trong source inventory đã khảo sát. Không tạo fake producer, FK hoặc source SHA để lấp gap. Task document giữ proposed slot order và owner boundaries.

R1 chỉ được implementation sau R0 minimal approved contract subset, exact acknowledged document commit/revision, relevant policy decisions và PO authorization riêng cho R1. Document DRAFT này không đáp ứng gate đó. R4/R5 shared paths phải recheck claims/collisions tại slot grant và trước first write.

Real MariaDB consistency/constraints/concurrency, auth/HTTP/RSC/cache/media/delivery integration, staging và activation: NOT_RUN. C02 runtime/shared port/paid reader: NOT_READY.

**Gate: R0_DRAFT_ONLY / PENDING_OWNER_ACK / R1_IMPLEMENTATION_HOLD / C02_RUNTIME_HOLD / DB_HOLD / STAGING_HOLD / PRODUCTION_NO_GO.**
