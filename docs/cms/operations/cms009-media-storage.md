# CMS-009 — Private media storage: thiết kế, provision và recovery

Prepared: 2026-09-30 (UTC+7). Đây là runbook thiết kế cho CMS-009; chưa có adapter/CLI đã implement tại checkpoint spec. Không thực thi lệnh recovery tưởng tượng. Codex phải thay phần interface bằng tên/flags thật và regression trước bàn giao.

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
- Worker/codec traced trong standalone Linux bundle, không lệ thuộc node_modules/source ở máy phát triển.

Nếu chưa có evidence root/proxy/codec gate, không merge rồi hy vọng upload chạy. Hoãn manual UAT không miễn kiểm hạ tầng storage cần thiết cho release.

## 4. Layout và bảo vệ

objects/ chứa canonical image đã encode; tmp/ chứa file giới hạn dung lượng; operations/ giữ immutable intent + các phase atomic; locks/ giữ owner/operation lifecycle. Implementation có thể chọn layout tương đương nhưng phải map rõ bốn counters filesystem.

Tên file server-generated, exact allowlist theo journal. Không dùng originalFilename hoặc đường dẫn client/DB url để resolve filesystem. Normalization/path-containment phải kiểm cả Windows và POSIX; private root chỉ service owner/operator ghi.

Receipt là quyền kiểm chứng operation, không tự là quyền xóa. Recovery luôn đối chiếu DB, actor/asset immutable identity, digest/size, path/regular-file, reverse cover refs và active operations. PID/age riêng lẻ không đủ chứng minh stale lock do PID reuse; không steal lock tự động theo TTL.

Giới hạn pending intents/quota phải atomic liên process. Intent chưa dispatch expire30phút; không prune intent đã dispatch/unknown vì TTL. Không đưa filesystem rename/delete vào transaction rồi tự gọi đó là rollbackable.

## 5. Check-only và apply recovery

Implement CLI/entrypoint có:
- Default CHECK-ONLY, không DB mutation, file unlink, lock removal hay journal update.
- Explicit --apply + exact operation selection + root/DB identity/provenance + confirmation scope.
- Không cho web client gọi apply; status GET không ngầm recovery mutation.
- Không recursive cleanup root, không prefix-wide DB/file delete, không auto adopt orphans.
- Unknown/unavailable DB, identity drift, foreign reference hoặc active/uncertain lock => STOP, giữ evidence.
- Nếu operation đã commit upload: xác nhận asset và canonical file, không create lại.
- Upload chắc chắn chưa có DB row: chỉ bỏ orphan/temp được ownership proof cho phép.
- Delete DB absent sau confirmed commit: chỉ bỏ canonical file đúng recorded identity.
- Nếu file expected đã absent và DB state hợp lệ: idempotent report, không tìm file khác thay thế.
- Apply từng phase có durable progress, chạy lại sau interruption không mở rộng scope.
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

Tại checkpoint spec: production root/ACL/proxy/backup và media pipeline đều NOT VERIFIED/NOT IMPLEMENTED. Nội dung này không chứng minh storage được provision hoặc release CMS-009 đã sẵn sàng. Manual authenticated UAT vẫn DEFERRED.

Xem [CMS-009 spec](../tasks/CMS-009.md) và [handoff](../tasks/CMS-009-IMPLEMENTATION.md).
