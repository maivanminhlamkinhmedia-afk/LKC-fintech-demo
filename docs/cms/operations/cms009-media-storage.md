# CMS-009 — Private media storage: thiết kế, provision và recovery

Prepared: 2026-09-30 (UTC+7). Adapter và CLI local đã được thêm trên branch CMS-009; chúng **chưa được Claude review, CI, staging hoặc production xác minh**. Phần production dưới đây là gate vận hành trước release, không phải bằng chứng root đã được provision.

## 1. Vì sao cần root riêng

Workflow deploy hiện tại xóa/thay .next, public, node_modules trong /home/edpmjmha/lkcfintech.com.vn/deploy. Upload trong public/deploy sẽ mất khi release. Next images.unoptimized và workflow loại sharp/@img; runtime không có cam kết native codec.

CMS_MEDIA_ROOT phải là absolute private persistent directory ngoài APP và mọi webroot, không phải .next/tmp của một release. Ví dụ layout dự kiến /home/edpmjmha/private/cms-media; đây KHÔNG phải đường dẫn đã kiểm tồn tại/quyền. Operator xác nhận root thực khi được giao provision, không tự suy từ tên thư mục “private”.

Không cần S3/CDN/account hoặc migration cho scope đã chốt. MediaAsset.url chỉ là protected app route, không công bố absolute path và không URL file public.

## 2. Ba môi trường

| Môi trường | Root và quyền |
|---|---|
| Local unit/probe | Temp root dưới workspace/scratch; marker dummy/local; synthetic files; fake DB |
| Guarded staging | Runner tự tạo exclusive .next/cms-e2e-media/<runId> dưới repo, marker runId/commit; override inherited CMS_MEDIA_ROOT; không nhận prod root |
| Production | Operator provision explicit ngoài webroot/release, service owner access; env runtime cPanel; không ghi vào Git/.env bởi agent |

Local implementation không đọc .env, không SSH, không truy cập DB thật. Thiếu production provision không chặn unit/build bằng temp root. Staging runner thực hiện tạo/xóa đúng private run root khi đã được giao QA; không cần operator tự tạo root production để chạy staging.

## 3. Provision gate trước release CMS-009

Sau source review/CI và staging đạt, nhiệm vụ release phải có evidence riêng:
- Xác minh root absolute/realpath, ngoài app/public/.next/document roots; không symlink/junction/hardlink bất thường.
- Xác định đúng service user/group/ACL; POSIX directory0700/file0600 hoặc private group tương đương, không777. Windows local dùng ACL phù hợp, không claim chmod là toàn bộ bảo vệ.
- Marker/root version phù hợp; không adopt populated folder chưa biết owner.
- Service có thể exclusive-create/write/fsync/rename/read/unlink một sentinel synthetic trong đúng root; đây là probe vận hành được giao riêng, không seed MediaAsset/Article production.
- Chứng minh root không nằm trong list workflow purge/tar extraction; check lần release đầu giữ sentinel và remove chính sentinel sau kiểm.
- Kiểm free disk/quota và backup/restore plan DB + canonical files + operation receipts đồng bộ về identity; không in paths/secrets trong public evidence.
- Runtime CMS_MEDIA_ROOT cấu hình qua cPanel; không đưa giá trị vào build artifact/client NEXT_PUBLIC_*.
- Proxy/Apache/cPanel cho phép request cần thiết tới raw upload route; application cap5MiB vẫn bắt buộc. Chưa đo request cap thì ghi chưa xác minh, không tự sửa webserver global.
- App build/start khi thiếu root vẫn không ghi temp fallback; media UI trả lỗi cấu hình có kiểm soát.
- `npm run build` phải báo `CMS_MEDIA_STANDALONE_READY worker=1 codecs=2`: postbuild chép worker vào `src/features/cms/media-codec-worker.cjs` và hai codec exact-pinned vào standalone. Xác minh worker chạy từ bundle Linux/cPanel, không lệ thuộc source/node_modules ở máy phát triển.

Nếu chưa có evidence root/proxy/codec gate, không merge rồi hy vọng upload chạy. Hoãn manual UAT không miễn kiểm hạ tầng storage cần thiết cho release.

## 4. Layout và bảo vệ

objects/ chứa canonical image đã encode; tmp/ chứa file giới hạn dung lượng; operations/ giữ immutable intent + các phase atomic; locks/ giữ owner/operation lifecycle. Implementation có thể chọn layout tương đương nhưng phải map rõ bốn counters filesystem.

Tên file server-generated, exact allowlist theo journal. Không dùng originalFilename hoặc đường dẫn client/DB url để resolve filesystem. Normalization/path-containment phải kiểm cả Windows và POSIX; private root chỉ service owner/operator ghi.

Receipt là quyền kiểm chứng operation, không tự là quyền xóa. Recovery luôn đối chiếu DB, actor/asset immutable identity, digest/size, path/regular-file, reverse cover refs và active operations. PID/age riêng lẻ không đủ chứng minh stale lock do PID reuse; không steal lock tự động theo TTL.

Giới hạn pending intents/quota phải atomic liên process. Intent chưa dispatch expire30phút; không prune intent đã dispatch/unknown vì TTL. Không đưa filesystem rename/delete vào transaction rồi tự gọi đó là rollbackable.

## 5. Check-only và apply recovery

CLI hiện tại: `node scripts/cms-media/recover.mjs`. Nó không tự tải `.env`; người vận hành phải cung cấp `CMS_MEDIA_ROOT` và `DATABASE_URL` qua cơ chế secret runtime đã được duyệt. Không chạy CLI này trong local validation với DB thật. Mặc định là **CHECK-ONLY**; cần `--apply` và confirmation exact để ghi. Flags check-only: `--operation <32-hex> --root-identity <32-hex> --database-name <name> --database-user <user>`. Khi apply, thêm `--confirm-operation <same-operation-id> --asset <32-hex> --actor <actor-id> --key <32-hex.png|jpg>`. CLI đối chiếu `DATABASE()`/`CURRENT_USER()` và marker root trước khi đọc journal; output chỉ gồm operation ID, state, applied. Không in SQL, credentials, bytes, metadata hay path riêng.

Giao thức local đã implement:

| Operation | Pha và side effect | Kết quả khi thiếu ACK |
|---|---|---|
| Upload | `intent` được fsync; `dispatched` trước body; `canonical-ready` trước temp/file; `file-ready` trước `MediaAsset.create` trong Serializable TX; `committed` sau ACK DB | GET status đọc exact row/identity, không tự sửa. Nếu row tồn tại trả DTO cùng operation; nếu không rõ trả UNKNOWN_OUTCOME. |
| Upload invalid đã xác định | Trước DB/file publish, journal thành `abandoned`; giữ receipt, nhả pending quota | Client giữ File và hiển thị safe error. |
| Delete | `intent` và `dispatched` trước Serializable TX/row lock/cover count; `db-deleted` sau ACK DB; unlink exact digest; `complete` sau unlink | Unknown commit giữ file/journal. Sau DB ACK nhưng unlink lỗi trả `storagePending`, không giả rollback. |
| Delete bị từ chối chắc chắn | Journal thành `rejected`; DB/file không thay đổi | Client giữ trạng thái và error; chỉ lần lưu mới có token hợp lệ mới thử lại. |

Intent upload chưa dispatch hết hạn sau 30 phút và không tính vào quota 4 pending/actor; `dispatched`/`file-ready` giữ đến khi xác minh. Receipt/tombstone đã hoàn tất giữ lại, chưa có background pruning; cần kế hoạch backup và quota trước release. `withMediaLock` dùng mkdir exclusive; không tự steal lock theo tuổi/PID. Bản kiểm local không chứng minh atomic DB+FS hoặc zero orphan sau crash.

Check-only/apply có:
- Default CHECK-ONLY, không DB mutation, file unlink, lock removal hay journal update. Regression local đã kiểm bytes/journal không đổi.
- Explicit --apply + exact operation selection + root/DB identity/provenance + confirmation scope.
- Không cho web client gọi apply; status GET không ngầm recovery mutation.
- Không recursive cleanup root, không prefix-wide DB/file delete, không auto adopt orphans.
- Unknown/unavailable DB, identity drift, foreign reference hoặc active/uncertain lock => STOP, giữ evidence.
- Nếu operation đã commit upload: xác nhận asset và canonical file, không create lại.
- Upload chắc chắn chưa có DB row: chỉ bỏ orphan/temp được ownership proof cho phép.
- Delete DB absent sau confirmed commit: chỉ bỏ canonical file đúng recorded identity.
- Nếu file expected đã absent và DB state hợp lệ: idempotent report, không tìm file khác thay thế.
- Apply từng phase ghi journal bằng temp fsync + rename, chạy lại sau interruption chỉ nhắm exact identity. Không xóa lock active/uncertain.
- Log chỉ safe code/counter/opaque ids cần thiết, không bytes/metadata/private full paths/raw errors.

Production recovery là nhiệm vụ vận hành riêng, không nằm trong local implementation hoặc QA mặc định. Staging recovery dùng guarded runner/cleanup review, same SQL target/current manifest/root; không reuse production CLI credentials.

## 6. Staging v4 cleanup

15 DB counters:
articles, profiles, users, logs, sources, categories, topics, tags, instruments,
categoryLinks, topicMappings, tagMappings, articleInstruments, mediaAssets, coverLinks.

4 filesystem counters:
mediaFiles, mediaTempFiles, mediaJournals, mediaLocks.

15 DB kiểm trong TX và sau commit; 4 filesystem sau exact cleanup. Có thể DB đã0 nhưng file còn => CLEANUP_NOT_VERIFIED; không đổi thành PASS. Giữ manifest, root marker và journal cần thiết để recovery. Chỉ19 counters bằng 0 + toàn bộ suite/provenance/exit gates đạt mới emit CMS_E2E VERIFIED.

Cleanup không thể dựa nội dung manifest đơn lẻ khi có foreign reverse refs/unknown file. Preflight toàn graph/inventory trước destructive action; legacy manifests không có quyền file mới. App/worker riêng của run phải dừng trước final cleanup; không kill process ngoài phạm vi.

## 7. Giới hạn và trạng thái

Tại checkpoint local implementation: production root/ACL/proxy/backup và assembled Linux runtime vẫn NOT VERIFIED; Claude review/CI/staging/browser cũng NOT RUN. Windows isolated standalone worker smoke local PASS không thay thế Linux/cPanel gate. Nội dung này không chứng minh storage được provision hoặc release CMS-009 đã sẵn sàng. Manual authenticated UAT vẫn DEFERRED.

Xem [CMS-009 spec](../tasks/CMS-009.md) và [handoff](../tasks/CMS-009-IMPLEMENTATION.md).
