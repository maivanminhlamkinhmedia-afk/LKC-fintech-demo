# CMS-009 production media storage — operator runbook (prepared, not executed)

This runbook supplements [the storage contract](cms009-media-storage.md). It is **not** evidence that production storage is provisioned. The release head is `12cc768b1316d0af992a69a6e77f6a556e724d26`. Obtain Claude review of this unstaged runbook and tool before running any write command.

## Observed target and unresolved identity

Read-only SSH on 2026-10-04 verified the host `vdc-whm-cheaphosting-1112.vinahost.org`, account `edpmjmha`, Passenger `AppRoot` `/home/edpmjmha/lkcfintech.com.vn/deploy`, document root `/home/edpmjmha/public_html`, and `PassengerNodejs` `/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node` (22.18.0). The deploy workflow purges/replaces `.next`, `public`, `node_modules`, `prisma`, `server.js`, `package.json`, and `prisma.config.ts` under AppRoot. The example `/home/edpmjmha/private/cms-media` and its parent did **not** exist at survey time. No production `CMS_MEDIA_ROOT` value or Passenger service UID/GID was established. Do not equate the SSH login UID with Passenger's identity without provider/cPanel evidence.

The exact `.htaccess` at the document root binds Passenger to AppRoot. `uapi PassengerApps list_applications` returned an empty application list, so the cPanel Application Manager cannot be assumed to manage this app. First identify whether this Passenger binding is managed by CloudLinux Node.js Selector or another host control plane. Do not add `CMS_MEDIA_ROOT` to a repository file, `.env`, public artifact, or a guessed cPanel UI. The owner/provider must identify the actual runtime env control, record the **name** and non-empty status of `CMS_MEDIA_ROOT` there, and confirm it is scoped to this app. The value is the approved private root, with `CMS_MEDIA_ROOT_MODE` unset. After deploy, verify the running app actually receives it through an authorized server-side check or authenticated synthetic media smoke; a shell export is not proof.

## Gate 1 — approve the exact root and service identity before merge

The proposed path is `/home/edpmjmha/private/cms-media`, **not** an observed path. Operator/provider must approve or replace it after checking all domain aliases and document roots, realpaths, backup coverage, and the runtime service UID/GID. The root must be a direct grandchild of `/home/edpmjmha`, outside the document root and AppRoot; no symlink in the path. A missing parent is created owner-only by the tool. Existing roots, including a partial prior attempt, are rejected rather than adopted. The tool never runs recursive `chmod`, `chown`, or cleanup.

The [preflight CLI](../../../scripts/cms-media/production-storage-preflight.mjs) has `inspect`, `provision`, `probe`, `retain`, `verify`, and `remove`. All write commands require Linux, the exact effective/real UID/GID provided, an explicit root identity where applicable, and a command-specific confirmation. It checks marker version 1, purpose `cms-media`, 32-hex identity, and private `objects/tmp/operations/locks`. It does not access the DB or application API. Run it only from a review-approved checkout at the exact release head, outside AppRoot and the document root. It must not be copied from an unreviewed working tree. The Node binary must be the exact Passenger path above, subject to rechecking on the host.

On **the production SSH shell**, after the operator has independently confirmed that the shell account is the same UID/GID as the Passenger worker and approved the proposed root, use a complete command block of this form. This is a future write operation, **not executed in this preflight turn**. The checkout path is a proposed isolated location and must first be created/verified by a separately authorized transfer; the block refuses a missing or wrong checkout.

```bash
set -euo pipefail
RELEASE_HEAD=12cc768b1316d0af992a69a6e77f6a556e724d26
SOURCE_CHECKOUT=/home/edpmjmha/private/cms009-source-12cc768
REVIEWED_TOOL=/home/edpmjmha/private/cms009-reviewed-tool/production-storage-preflight.mjs
REVIEWED_TOOL_SHA256=PASTE_REVIEWED_64_HEX_SHA256
ROOT=/home/edpmjmha/private/cms-media
NODE=/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node
test -x "$NODE"
test -d "$SOURCE_CHECKOUT/.git"
test "$(git -C "$SOURCE_CHECKOUT" rev-parse HEAD)" = "$RELEASE_HEAD"
test -f "$REVIEWED_TOOL"
test "$(sha256sum "$REVIEWED_TOOL" | cut -d ' ' -f 1)" = "$REVIEWED_TOOL_SHA256"
test "$(id -un)" = edpmjmha  # only after Passenger identity is independently confirmed
"$NODE" "$REVIEWED_TOOL" provision \
  --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html \
  --root "$ROOT" --uid "$(id -u)" --gid "$(id -g)" \
  --confirm "provision:$ROOT"
```

**Important provenance constraint:** the tool is a new unstaged file and is **not** in release head `12cc768…`. Before running the block, a separately reviewed and authorized tool package and exact-head source checkout must be supplied to the proposed isolated paths. Replace the placeholder SHA-256 with the reviewed tool package digest. Do not merge this tool into the release head merely to satisfy the block. If either artifact is unavailable, this gate remains blocked. A partial provision failure must be inspected manually; do not rerun against or recursively delete the partial root.

After provision, record the emitted root identity in the restricted operations record. A separate explicit `inspect` call must use that expected identity and the confirmed UID/GID. For a synthetic filesystem probe, use a fresh SSH shell and a self-contained block, replacing `PASTE_RECORDED_32_HEX_ROOT_IDENTITY` with the recorded marker identity. Do not take the identity from an arbitrary existing marker as permission to adopt it.

```bash
set -euo pipefail
TOOL=/home/edpmjmha/private/cms009-reviewed-tool/production-storage-preflight.mjs
REVIEWED_TOOL_SHA256=PASTE_REVIEWED_64_HEX_SHA256
NODE=/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node
ROOT=/home/edpmjmha/private/cms-media
ROOT_IDENTITY=PASTE_RECORDED_32_HEX_ROOT_IDENTITY
test "${#ROOT_IDENTITY}" -eq 32
test "$(sha256sum "$TOOL" | cut -d ' ' -f 1)" = "$REVIEWED_TOOL_SHA256"
"$NODE" "$TOOL" inspect --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html --root "$ROOT" \
  --uid "$(id -u)" --gid "$(id -g)" --identity "$ROOT_IDENTITY"
"$NODE" "$TOOL" probe --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html --root "$ROOT" \
  --uid "$(id -u)" --gid "$(id -g)" --identity "$ROOT_IDENTITY" \
  --confirm "probe:$ROOT_IDENTITY"
```

`probe` uses only synthetic bytes: exclusive create, write, file fsync, rename and directory fsync, read/hash, hardlink from `tmp` to `objects`, read/hash, then exact unlink. On any identity/content drift it stops and leaves evidence instead of broad cleanup. The owner-only root assumption is necessary; this is not protection from a malicious process with the same OS UID.

## Gate 2 — candidate bundle on Linux/cPanel, without serving traffic

The existing `scripts/cms-media/smoke-standalone.mjs` needs more than `.next/standalone`: it reads the candidate bundle's traced `media-storage.ts` and `media-contract.ts`, worker, `pngjs` and `jpeg-js`, and the source checkout's `tests/browser-local/cms-media-lifetime-child.mjs`. It creates a synthetic scratch root under the Node temp directory and tests two process lifetimes. Merely copying the standalone archive is insufficient. It must be run from the exact-head source checkout with an assembled candidate bundle and a sanitized process environment; never inherit staging/prod `DATABASE_URL` into this local-like probe. The executable must be the actual Passenger Node binary. Record source SHA, bundle archive SHA-256, Node version, `CMS_MEDIA_STANDALONE_READY worker=1 codecs=2`, smoke result, and the paths checked without printing secrets. The present CI PASS and Windows staging PASS do not constitute this Linux/cPanel runtime gate.

This candidate checkout and archive are **not available on the host yet**. An operator/release task must supply them in an isolated directory outside AppRoot/document root, verify exact SHA/digest, and run the existing smoke with allowlisted environment. Do not replace the live APP or run `server.js` for this check. If the source checkout, traced inputs, codecs, or exact provenance cannot be established, stop and leave the gate NOT VERIFIED.

After those artifacts are supplied, the future **production SSH shell** command is self-contained and runs the existing smoke without serving traffic. It cannot be run in the current checkpoint because the candidate checkout/bundle does not exist on the host. The dummy URLs below are local-only; the smoke does not make DB queries.

```bash
set -euo pipefail
RELEASE_HEAD=12cc768b1316d0af992a69a6e77f6a556e724d26
SOURCE_CHECKOUT=/home/edpmjmha/private/cms009-source-12cc768
NODE=/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node
test -x "$NODE"
test -d "$SOURCE_CHECKOUT/.git"
test "$(git -C "$SOURCE_CHECKOUT" rev-parse HEAD)" = "$RELEASE_HEAD"
test -d "$SOURCE_CHECKOUT/.next/standalone"
test -f "$SOURCE_CHECKOUT/tests/browser-local/cms-media-lifetime-child.mjs"
cd "$SOURCE_CHECKOUT"
env -i HOME=/home/edpmjmha PATH=/usr/bin:/bin NODE_ENV=production \
  DATABASE_URL=mysql://build:build@127.0.0.1:3306/build \
  NEXTAUTH_URL=http://127.0.0.1:3000 \
  "$NODE" scripts/cms-media/smoke-standalone.mjs "$SOURCE_CHECKOUT/.next/standalone"
```

## Gate 3 — request limit, capacity, and backup before merge

- Application raw upload cap is 5,242,880 bytes. Confirm each proxy/Passenger/Apache/cPanel body limit permits that payload (plus any transport overhead) and the app still returns its own safe 413 above cap. The surveyed document-root `.htaccess` has no `LimitRequestBody`, `RequestReadTimeout`, or `client_max_body_size` directive; that does **not** establish effective limits elsewhere. Provider/cPanel evidence or a separately authorized synthetic request is needed. Do not change server-global proxy settings as part of this preflight.
- At survey, `uapi Quota get_quota_info` returned 24,576 MB limit, 3,085.61 MB used, 21,490.39 MB remaining, under quota. `df` on the APP mount showed 1,081,797,824 1-KiB blocks and 329,050,242 inodes available. These are point-in-time capacity observations, not a reserved media allocation or growth policy. Establish alert thresholds and account for immutable canonical objects plus long-lived receipts/tombstones.
- `uapi Backup list_backups` returned an empty list. This does not prove the provider has no backups or that DB and the proposed private root are covered. Obtain a backup/restore plan that captures DB rows, canonical `objects`, `operations` receipts, root marker/identity, and relevant locks consistently. Quiesce media writes or use a coordinated snapshot; test restore to an isolated target before claiming recoverability. Never use live production restore as a preflight probe.

## Gate 4 — persistence across first deploy (post-deploy, not a pre-merge prerequisite)

Once root/service/env are ready, `retain` creates one owner-only root-level synthetic sentinel and outputs its ID and SHA-256. Record both outside the public PR. Keep it across the first deploy; after deployment, run `verify` with the recorded ID/hash and unchanged root identity. Only after a successful verification may `remove` unlink exactly that sentinel. These commands are a future authorized write task. No production media Article/MediaAsset is created. A failed persistence check stops release triage; do not delete or recreate the marker/root to hide it.

Before deploy, on the **production SSH shell**, run the complete block below only after the earlier gates and a separate write authorization. The tool digest and identity are values from the reviewed package and provision record, not values discovered from an unknown directory.

```bash
set -euo pipefail
TOOL=/home/edpmjmha/private/cms009-reviewed-tool/production-storage-preflight.mjs
REVIEWED_TOOL_SHA256=PASTE_REVIEWED_64_HEX_SHA256
ROOT_IDENTITY=PASTE_RECORDED_32_HEX_ROOT_IDENTITY
NODE=/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node
test "$(sha256sum "$TOOL" | cut -d ' ' -f 1)" = "$REVIEWED_TOOL_SHA256"
"$NODE" "$TOOL" retain --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html \
  --root /home/edpmjmha/private/cms-media \
  --uid "$(id -u)" --gid "$(id -g)" --identity "$ROOT_IDENTITY" \
  --confirm "retain:$ROOT_IDENTITY"
```

After deploy, on a **new production SSH shell**, paste this full block with the recorded ID/hash. `verify` is read-only; `remove` is an exact write that needs its own authorization. Stop after `verify` if deployment/runtime evidence is still being investigated.

```bash
set -euo pipefail
TOOL=/home/edpmjmha/private/cms009-reviewed-tool/production-storage-preflight.mjs
REVIEWED_TOOL_SHA256=PASTE_REVIEWED_64_HEX_SHA256
ROOT_IDENTITY=PASTE_RECORDED_32_HEX_ROOT_IDENTITY
SENTINEL_ID=PASTE_RECORDED_32_HEX_SENTINEL_ID
SENTINEL_SHA256=PASTE_RECORDED_64_HEX_SENTINEL_SHA256
NODE=/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node
test "$(sha256sum "$TOOL" | cut -d ' ' -f 1)" = "$REVIEWED_TOOL_SHA256"
"$NODE" "$TOOL" verify --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html \
  --root /home/edpmjmha/private/cms-media \
  --uid "$(id -u)" --gid "$(id -g)" --identity "$ROOT_IDENTITY" \
  --id "$SENTINEL_ID" --sha256 "$SENTINEL_SHA256"
"$NODE" "$TOOL" remove --home /home/edpmjmha \
  --app /home/edpmjmha/lkcfintech.com.vn/deploy \
  --webroot /home/edpmjmha/public_html \
  --root /home/edpmjmha/private/cms-media \
  --uid "$(id -u)" --gid "$(id -g)" --identity "$ROOT_IDENTITY" \
  --id "$SENTINEL_ID" --sha256 "$SENTINEL_SHA256" \
  --confirm "remove:$ROOT_IDENTITY"
```

The post-deploy task must also confirm the Passenger process receives `CMS_MEDIA_ROOT`, worker/codecs start from the deployed bundle, authenticated media smoke and public anonymous routes behave as expected, and monitoring is stable. Manual authenticated project-wide UAT remains DEFERRED by PO; it is not PASS. Rollback or restore is a separate decision and authorization, with DB/files/journals consistency checks before any action.

Official references: [cPanel Application Manager environment variables](https://docs.cpanel.net/cpanel/software/application-manager/), [cPanel Passenger applications](https://docs.cpanel.net/knowledge-base/web-services/using-passenger-applications/), and the installed `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md` guidance on runtime environment and proxy limits. Those generic documents do not identify this host's active app manager.
