#!/usr/bin/env bash
set -euo pipefail

: "${SSH_HOST:?SSH_HOST is required}"
: "${SSH_USER:?SSH_USER is required}"
key_file="${SSH_KEY_FILE:-$HOME/.ssh/id_ed25519}"
known_hosts="${SSH_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
archive="${DEPLOY_ARCHIVE:-lkc-deploy.tar.gz}"

if [[ ! -f "$key_file" || ! -f "$archive" ]]; then
  echo 'SSH key file or deploy archive is missing' >&2
  exit 1
fi

# Only a successful keyscan opens the three-second pause before upload.
if scanned_keys=$(ssh-keyscan -T 15 -p 22 -H "$SSH_HOST"); then
  :
else
  scan_status=$?
  echo "SSH host-key scan failed (exit $scan_status); upload was not attempted" >&2
  exit "$scan_status"
fi
if [[ -z "$scanned_keys" ]]; then
  echo 'SSH host-key scan returned no keys; upload was not attempted' >&2
  exit 1
fi
printf '%s\n' "$scanned_keys" >> "$known_hosts"
chmod 600 "$known_hosts"
sleep 3

# Repeating an archive upload cannot invoke the APP replacement below.
# A failed upload may leave a partial archive, which the next upload replaces;
# the remote command verifies the complete archive before touching the APP.
for attempt in 1 2 3; do
  if scp \
    -P 22 \
    -i "$key_file" \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o "UserKnownHostsFile=$known_hosts" \
    -o ConnectTimeout=15 \
    -o ConnectionAttempts=1 \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    "$archive" \
    "$SSH_USER@$SSH_HOST:/home/$SSH_USER/lkc-deploy.tar.gz"; then
    echo "Archive upload succeeded on attempt $attempt/3"
    break
  else
    upload_status=$?
    echo "Archive upload attempt $attempt/3 failed (exit $upload_status)" >&2
    if (( attempt == 3 )); then
      echo 'Archive upload exhausted; remote deployment was not invoked' >&2
      exit "$upload_status"
    fi
    if (( attempt == 1 )); then sleep 5; else sleep 15; fi
  fi
done

# This invocation is deliberately single-shot. Exit 255 here does not prove
# the remote command was never run: a lost ACK can leave APP state unknown.
remote_command=$(cat <<'REMOTE_ACTIVATION'
# bash -s parses this entire compound command before executing any of it.
# Keep every activation command inside it: EOF before the final brace must
# never install a trap, acquire a lock, or mutate APP.
{
set -euo pipefail
umask 077
unset TAR_OPTIONS

APP="/home/edpmjmha/lkcfintech.com.vn/deploy"
ARCHIVE="/home/edpmjmha/lkc-deploy.tar.gz"
STATE_ROOT="/home/edpmjmha/.lkc-deploy-state"
HEALTH_URL="https://lkcfintech.com.vn/login"

# Only release artifacts are replaced. Runtime env, tmp, private media and DB
# are not part of this restore point. No migrations or data rollback occur here.
managed=(.next public node_modules prisma src server.js package.json prisma.config.ts)
activation_started=0
activation_completed=0
lock_owned=0
keep_lock=0
run_dir=""

fail() { echo "$1" >&2 || true; exit 1; }

record_state() { printf '%s\n' "$1" > "$run_dir/status"; }

# These are deliberately unconfigured integration boundaries, not environment
# overrides. Wiring a host quota reader and an approved policy requires review.
# df is shared filesystem headroom, never evidence of effective cPanel quota.
load_capacity_policy() {
  return 1
}

# Matching st_dev cannot identify same-device bind mounts. A reviewed host
# reader must prove APP/STATE_ROOT share one mount identity and no nested/bind
# mounts exist under managed APP paths or STATE_ROOT (candidate/restore/state).
# The mount topology must remain stable throughout activation and recovery.
verify_capacity_topology() {
  return 1
}

# A verified reader must include every effective account/group/project/provider
# limit (including soft limits), return conservative byte AND inode headroom,
# and bind its fresh sample to policy ID, account UID and filesystem device.
# Unknown or ambiguous "unlimited"/zero quota limits cannot authorize a release.
read_effective_quota() {
  return 1
}

capacity_fail() { fail "CAPACITY_POLICY_BLOCKED: $1"; }

# Arithmetic representation limit, not a production quota or reserve policy.
capacity_max=9007199254740991
capacity_uint() {
  local LC_ALL=C
  [[ "$1" =~ ^(0|[1-9][0-9]{0,15})$ ]] && (( $1 <= capacity_max ))
}

capacity_add() {
  (( $1 <= capacity_max - $2 )) || capacity_fail 'Capacity arithmetic overflow'
  capacity_sum=$(( $1 + $2 ))
}

capacity_multiply() {
  if (( $2 == 0 )); then capacity_sum=0; return; fi
  (( $1 <= capacity_max / $2 )) || capacity_fail 'Capacity arithmetic overflow'
  capacity_sum=$(( $1 * $2 ))
}

capacity_round() {
  capacity_add "$1" "$(( $2 - 1 ))"
  capacity_sum=$(( capacity_sum / $2 * $2 ))
}

validate_capacity_policy() {
  local LC_ALL=C
  local name value
  [[ "${capacity_policy_id:-}" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || capacity_fail 'Missing approved capacity policy ID'
  for name in reserve_bytes reserve_inodes scratch_bytes scratch_inodes \
    retention_max_bytes retention_max_inodes retention_max_releases quota_max_age_seconds; do
    value="${!name:-}"
    capacity_uint "$value" && (( value > 0 )) || capacity_fail "Missing or invalid approved policy threshold: $name"
  done
  # No deletion policy is inferred from these admission caps. All old releases,
  # including HEALTHY, UNKNOWN and ROLLBACK_FAILED, remain untouched. Any future
  # cleanup needs separate approval of age/count/byte limits, eligible states,
  # protected restore points and verified recovery/ownership before deletion.
}

capacity_filesystems() {
  local state_device
  capacity_device=$(LC_ALL=C stat -c %d -- "$APP") || capacity_fail 'Cannot identify APP filesystem'
  state_device=$(LC_ALL=C stat -c %d -- "$STATE_ROOT") || capacity_fail 'Cannot identify STATE_ROOT filesystem'
  capacity_uint "$capacity_device" && capacity_uint "$state_device" || capacity_fail 'Unknown filesystem identity'
  [[ "$capacity_device" == "$state_device" ]] || capacity_fail 'APP and STATE_ROOT are on different filesystems'
  verify_capacity_topology || capacity_fail 'Host mount topology is not verified'
  capacity_block=$(LC_ALL=C stat -f -c %S -- "$APP") || capacity_fail 'Cannot measure filesystem allocation unit'
  capacity_uint "$capacity_block" && (( capacity_block > 0 )) || capacity_fail 'Unknown filesystem allocation unit'
}

# NUL records preserve spaces; control-character paths and special files are
# rejected. Count every path (including hard links) conservatively, and use
# the larger of allocated and logical size so preallocation and sparse files
# cannot understate retained/restore allocation. Directory
# allocation plus approved scratch budgets cover metadata/listing/temp growth.
capacity_tree_stream() {
  # Scope byte counting/filtering to this parser; never change tar's filename
  # locale, which must preserve printable UTF-8 rather than escape its bytes.
  local LC_ALL=C
  local entry device kind size blocks path bytes=0 inodes=0 tar_bytes=0 part
  while IFS= read -r -d '' entry; do
    device="${entry%% *}"; entry="${entry#* }"
    kind="${entry%% *}"; entry="${entry#* }"
    size="${entry%% *}"; entry="${entry#* }"
    blocks="${entry%% *}"; path="${entry#* }"
    [[ "$device" == "$capacity_device" ]] || capacity_fail 'Managed or retained tree crosses filesystems'
    [[ "$kind" == f || "$kind" == d || "$kind" == l ]] || capacity_fail 'Cannot bound a special filesystem entry'
    [[ "$path" != *[[:cntrl:]]* ]] || capacity_fail 'Cannot bound a control-character path'
    capacity_uint "$size" && capacity_uint "$blocks" || capacity_fail 'Unknown filesystem entry size'
    capacity_round "$size" "$capacity_block"; part=$capacity_sum
    capacity_multiply "$blocks" 512
    if (( capacity_sum > part )); then part=$capacity_sum; fi
    if [[ "$kind" == d ]] && (( part < capacity_block )); then part=$capacity_block; fi
    capacity_add "$bytes" "$part"; bytes=$capacity_sum
    capacity_add "$inodes" 1; inodes=$capacity_sum
    # GNU tar: file header/data plus a conservative long-name header/data for
    # every entry. Full absolute path length bounds the shorter archived name.
    capacity_round "$size" 512; part=$capacity_sum
    capacity_add "$tar_bytes" "$part"; tar_bytes=$capacity_sum
    capacity_round "$(( ${#path} + 1 ))" 512; part=$capacity_sum
    capacity_add "$tar_bytes" "$part"; tar_bytes=$capacity_sum
    capacity_add "$tar_bytes" 1024; tar_bytes=$capacity_sum
    if [[ "$kind" == l ]]; then
      capacity_round "$(( size + 1 ))" 512; part=$capacity_sum
      capacity_add "$tar_bytes" "$part"; tar_bytes=$capacity_sum
      capacity_add "$tar_bytes" 512; tar_bytes=$capacity_sum
    fi
  done
  capacity_add "$tar_bytes" 1024
  capacity_round "$capacity_sum" 10240
  # The backup uses GNU tar's fixed 20-block records. Twice the complete tar
  # stream bounds gzip expansion; do not assume compression saves any space.
  capacity_multiply "$capacity_sum" 2
  printf '%s %s %s\n' "$bytes" "$inodes" "$capacity_sum"
}

capacity_tree() {
  local metrics
  if ! metrics=$(LC_ALL=C find "$@" -printf '%D %y %s %b %p\0' | capacity_tree_stream); then
    capacity_fail 'Cannot safely measure filesystem tree'
  fi
  read -r measured_bytes measured_inodes measured_backup_bound <<< "$metrics"
}

capacity_live_tree() {
  local name paths=()
  for name in "${managed[@]}"; do
    if [[ -e "$APP/$name" ]]; then paths+=("$APP/$name"); fi
  done
  if (( ${#paths[@]} == 0 )); then
    capacity_restore_bytes=0
    capacity_restore_inodes=0
    capacity_backup_bound=0
    return
  fi
  capacity_tree "${paths[@]}"
  capacity_restore_bytes=$measured_bytes
  capacity_restore_inodes=$measured_inodes
  capacity_backup_bound=$measured_backup_bound
}

capacity_candidate() {
  local archive_path="$1" names types member path permissions owner size rest part
  capacity_candidate_bytes=0
  capacity_candidate_inodes=0
  # Keep filename listings in the caller's locale. Only the numeric size
  # listing needs C; its quoted filename suffix is not used for path checks.
  names=$(tar -tzf "$archive_path") || capacity_fail 'Cannot measure candidate archive paths'
  types=$(LC_ALL=C tar --numeric-owner -tvzf "$archive_path") || capacity_fail 'Cannot measure candidate archive sizes'
  while IFS= read -r member; do
    [[ -n "$member" ]] || continue
    # Counting every implicit parent for every entry overestimates duplicates,
    # rather than missing directories omitted from the tar member list.
    path="$member"
    capacity_add "$capacity_candidate_inodes" 1; capacity_candidate_inodes=$capacity_sum
    while [[ "$path" == */* ]]; do
      capacity_add "$capacity_candidate_inodes" 1; capacity_candidate_inodes=$capacity_sum
      path="${path#*/}"
    done
  done <<< "$names"
  while read -r permissions owner size rest; do
    [[ -n "$permissions" ]] || continue
    capacity_uint "$size" || capacity_fail 'Unknown candidate archive member size'
    capacity_round "$size" "$capacity_block"; part=$capacity_sum
    capacity_add "$capacity_candidate_bytes" "$part"; capacity_candidate_bytes=$capacity_sum
  done <<< "$types"
  capacity_multiply "$capacity_candidate_inodes" "$capacity_block"
  capacity_add "$capacity_candidate_bytes" "$capacity_sum"; capacity_candidate_bytes=$capacity_sum
}

capacity_df() {
  local output value extra lines
  output=$(LC_ALL=C df "$@" -- "$STATE_ROOT") || capacity_fail 'Filesystem free-space probe failed'
  mapfile -t lines <<< "$output"
  (( ${#lines[@]} == 2 )) || capacity_fail 'Unknown filesystem free-space output'
  read -r value extra <<< "${lines[1]}" || capacity_fail 'Empty filesystem free-space output'
  [[ -z "$extra" ]] && capacity_uint "$value" || capacity_fail 'Unknown filesystem free-space or inode value'
  capacity_available=$value
}

capacity_headroom() {
  local required_bytes="$1" required_inodes="$2" fs_bytes fs_inodes name value now uid
  capacity_df -B1 --output=avail; fs_bytes=$capacity_available
  capacity_df --output=iavail; fs_inodes=$capacity_available
  # Discard previous samples so a partial/failed reader cannot reuse evidence.
  unset quota_policy_id quota_uid quota_device quota_sampled_at quota_available_bytes quota_available_inodes
  read_effective_quota || capacity_fail 'Effective account quota is not verified'
  for name in quota_uid quota_device quota_sampled_at quota_available_bytes quota_available_inodes; do
    value="${!name:-}"
    capacity_uint "$value" || capacity_fail "Unknown effective account quota field: $name"
  done
  uid=$(LC_ALL=C id -u) || capacity_fail 'Cannot identify quota account'
  now=$(LC_ALL=C date +%s) || capacity_fail 'Cannot establish quota sample freshness'
  capacity_uint "$now" || capacity_fail 'Unknown quota sample clock'
  [[ "${quota_policy_id:-}" == "$capacity_policy_id" && "$quota_uid" == "$uid" && "$quota_device" == "$capacity_device" ]] || capacity_fail 'Quota evidence does not match policy, account or filesystem'
  (( quota_sampled_at <= now && now - quota_sampled_at <= quota_max_age_seconds )) || capacity_fail 'Quota evidence is stale or future-dated'
  (( fs_bytes >= required_bytes )) || capacity_fail 'Filesystem free bytes are insufficient'
  (( fs_inodes >= required_inodes )) || capacity_fail 'Filesystem free inodes are insufficient'
  (( quota_available_bytes >= required_bytes )) || capacity_fail 'Effective account quota bytes are insufficient'
  (( quota_available_inodes >= required_inodes )) || capacity_fail 'Effective account quota inodes are insufficient'
}

capacity_limits() {
  local pending_bytes="$1" pending_inodes="$2" required_bytes required_inodes release_count
  capacity_add "$pending_bytes" "$reserve_bytes"; required_bytes=$capacity_sum
  capacity_add "$pending_inodes" "$reserve_inodes"; required_inodes=$capacity_sum
  capacity_headroom "$required_bytes" "$required_inodes"
  capacity_tree "$STATE_ROOT"
  capacity_add "$measured_bytes" "$pending_bytes"
  (( capacity_sum <= retention_max_bytes )) || capacity_fail 'Retained release byte budget is exhausted; no automatic cleanup'
  capacity_add "$measured_inodes" "$pending_inodes"
  (( capacity_sum <= retention_max_inodes )) || capacity_fail 'Retained release inode budget is exhausted; no automatic cleanup'
  release_count=$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -name 'release.*' -printf x | LC_ALL=C wc -c) || capacity_fail 'Cannot count retained releases'
  read -r release_count <<< "$release_count"
  capacity_uint "$release_count" || capacity_fail 'Unknown retained release count'
  (( release_count <= retention_max_releases )) || capacity_fail 'Retained release count budget is exhausted; no automatic cleanup'
}

capacity_preflight() {
  local archive_path="$1" phase="$2" pending_bytes pending_inodes archive_bytes
  capacity_filesystems
  capacity_live_tree
  capacity_candidate "$archive_path"
  capacity_add "$capacity_candidate_bytes" "$capacity_restore_bytes"; pending_bytes=$capacity_sum
  capacity_round "$capacity_backup_bound" "$capacity_block"
  capacity_add "$pending_bytes" "$capacity_sum"; pending_bytes=$capacity_sum
  capacity_add "$pending_bytes" "$scratch_bytes"; pending_bytes=$capacity_sum
  capacity_add "$capacity_candidate_inodes" "$capacity_restore_inodes"; pending_inodes=$capacity_sum
  capacity_add "$pending_inodes" "$scratch_inodes"; pending_inodes=$capacity_sum
  # One additional inode for backup.tar.gz; approved scratch includes receipts,
  # checksum/member lists, temporary files and operational metadata growth.
  capacity_add "$pending_inodes" 1; pending_inodes=$capacity_sum
  if [[ "$phase" == prepare ]]; then
    archive_bytes=$(LC_ALL=C stat -c %s -- "$archive_path") || capacity_fail 'Cannot measure uploaded archive'
    capacity_uint "$archive_bytes" || capacity_fail 'Unknown uploaded archive size'
    capacity_round "$archive_bytes" "$capacity_block"
    capacity_add "$pending_bytes" "$capacity_sum"; pending_bytes=$capacity_sum
    capacity_add "$pending_inodes" 1; pending_inodes=$capacity_sum
  fi
  capacity_limits "$pending_bytes" "$pending_inodes"
}

capacity_before_activation() {
  # Prepared candidate, backup and restore already occupy space. Recheck fresh
  # headroom/reserves, retained evidence and subtree devices just before APP
  # mutation. This is not a host reservation against concurrent account writes.
  capacity_filesystems
  capacity_live_tree
  capacity_limits "$scratch_bytes" "$scratch_inodes"
}

capacity_before_rollback() {
  local required_bytes required_inodes
  # Reuse the prepared restore on the same filesystem. Recovery never needs
  # admission for another candidate/backup or permission to prune old releases.
  capacity_filesystems
  capacity_live_tree
  capacity_tree "$run_dir/restore"
  capacity_add "$scratch_bytes" "$reserve_bytes"; required_bytes=$capacity_sum
  capacity_add "$scratch_inodes" "$reserve_inodes"; required_inodes=$capacity_sum
  capacity_headroom "$required_bytes" "$required_inodes"
}

valid_bundle() {
  local root="$1" name
  for name in server.js package.json .next/BUILD_ID; do
    [[ -f "$root/$name" && -s "$root/$name" && ! -L "$root/$name" ]] || return 1
  done
  for name in .next .next/static public node_modules prisma; do
    [[ -d "$root/$name" && ! -L "$root/$name" ]] || return 1
  done
}

restart_app() {
  # Passenger observes restart.txt's mtime; separate consecutive restarts even
  # on filesystems with one-second timestamp resolution. Never follow a link.
  [[ ! -L "$APP/tmp" && ! -L "$APP/tmp/restart.txt" ]] || return 1
  (umask 022; mkdir -p -- "$APP/tmp") || return 1
  sleep 1 || return 1
  (umask 022; printf 'release restart at %s\n' "$(date -u +%FT%TZ)" > "$APP/tmp/restart.txt") || return 1
}

health_check() {
  local attempt code
  # This is bounded HTTP availability, not authenticated UAT or proof of the
  # running build identity. Do not follow redirects or accept a cached 3xx/4xx.
  for attempt in 1 2 3 4 5 6; do
    if code=$(curl --disable --silent --show-error --connect-timeout 5 --max-time 15 \
      --output /dev/null --write-out '%{http_code}' --proto '=https' \
      --header 'Cache-Control: no-cache' \
      "$HEALTH_URL?release_check=${run_dir##*/}-$attempt"); then
      [[ "$code" == 200 ]] && return 0
    fi
    if (( attempt < 6 )); then sleep 5 || return 1; fi
  done
  return 1
}

clear_artifacts() {
  local name
  for name in "${managed[@]}"; do
    rm -rf -- "$APP/$name" || return 1
  done
}

rollback() {
  local name
  record_state ROLLING_BACK || return 1
  # Check the retained archive again before any rollback deletion. The restore
  # directory was extracted and checked before activation started.
  (cd "$run_dir" && sha256sum -c backup.sha256 >/dev/null) || return 1
  valid_bundle "$run_dir/restore" || return 1
  # Isolate capacity_fail's exit from finish(): failed recovery preflight must
  # preserve the lock/evidence and become ROLLBACK_FAILED before more APP writes.
  (trap - EXIT HUP INT TERM; capacity_before_rollback) || return 1
  clear_artifacts || return 1
  for name in "${previous[@]}"; do
    mv -- "$run_dir/restore/$name" "$APP/$name" || return 1
  done
  restart_app || return 1
  health_check || return 1
  record_state ROLLED_BACK || return 1
}

finish() {
  local status=$?
  trap - EXIT HUP INT TERM
  # A lost SSH reader or failed diagnostic write must not interrupt recovery.
  trap '' PIPE
  set +e
  # A zero shell status alone is not evidence that activation reached HEALTHY.
  if (( status == 0 && ! activation_completed )); then status=1; fi
  if (( status != 0 && activation_started )); then
    echo 'Activation failed; attempting artifact rollback from the restore point' >&2 || true
    if rollback; then
      echo 'Artifacts restored and rollback health check passed; deployment still failed' >&2 || true
    else
      record_state ROLLBACK_FAILED || true
      echo 'ROLLBACK_FAILED: APP state is unknown; retain lock and restore point for manual recovery' >&2 || true
      keep_lock=1
      status=70
    fi
  fi
  if (( lock_owned && ! keep_lock )); then
    if ! rmdir -- "$STATE_ROOT/activation.lock"; then
      echo 'Activation lock cleanup failed; manual inspection required' >&2 || true
      status=70
    fi
  fi
  # This is the final stdout record, after both health and lock cleanup. If the
  # SSH reader loses it, the caller must retain UNKNOWN and never retry.
  if (( status == 0 && activation_completed )); then
    printf '%s\n' 'LKC_RELEASE_HEALTHY_V1' || status=1
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in tar curl sha256sum readlink mktemp mkdir rmdir mv rm cp sleep date stat find df wc id; do
  command -v "$command" >/dev/null || fail "Required activation tool is missing: $command"
done
[[ -d "$APP" && ! -L "$APP" && "$(readlink -f -- "$APP")" == "$APP" ]] || fail 'APP is not a canonical directory'
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail 'Deploy archive is missing or is a symlink'
[[ ! -L "$APP/tmp" && ! -L "$APP/tmp/restart.txt" ]] || fail 'Unsafe restart path'
for name in "${managed[@]}"; do
  [[ ! -L "$APP/$name" ]] || fail 'A managed APP path is a symlink'
done
valid_bundle "$APP" || fail 'Existing APP cannot provide a complete restore point'
load_capacity_policy || capacity_fail 'Approved reserve and retention policy is not configured'
validate_capacity_policy

[[ ! -L "$STATE_ROOT" ]] || fail 'Activation state root is a symlink'
mkdir -p -- "$STATE_ROOT"
[[ "$(readlink -f -- "$STATE_ROOT")" == "$STATE_ROOT" && "$STATE_ROOT" != "$APP" && "$STATE_ROOT" != "$APP/"* ]] || fail 'Unsafe activation state root'
if ! mkdir -- "$STATE_ROOT/activation.lock"; then
  fail 'Activation is locked; never steal a lock from an interrupted or concurrent deployment'
fi
lock_owned=1
run_dir=$(mktemp -d "$STATE_ROOT/release.XXXXXXXX")
record_state PREPARING
mkdir -- "$run_dir/candidate" "$run_dir/restore"
capacity_preflight "$ARCHIVE" prepare
# Validate a private copy, not the shared upload name which a later upload could
# replace. Preserve the original upload and every restore point for review.
cp -- "$ARCHIVE" "$run_dir/candidate.tar.gz"
capacity_preflight "$run_dir/candidate.tar.gz" copied
tar -tzf "$run_dir/candidate.tar.gz" > "$run_dir/members"
tar -tvzf "$run_dir/candidate.tar.gz" > "$run_dir/member-types"
while IFS= read -r member; do
  while [[ "$member" == ./* ]]; do member="${member#./}"; done
  [[ "$member" == . || -z "$member" ]] && continue
  case "$member" in
    /*|*\\*|*//*|../*|*/../*|*/..|..|*/./*|*/.|*[[:cntrl:]]*) fail 'Unsafe archive member path' ;;
  esac
  case "${member%%/*}" in
    .next|public|node_modules|prisma|src|server.js|package.json|prisma.config.ts) ;;
    *) fail 'Archive contains an unmanaged path' ;;
  esac
done < "$run_dir/members"
while IFS= read -r member; do
  case "${member:0:1}" in
    -|d) ;;
    *) fail 'Archive links and special files are not allowed' ;;
  esac
done < "$run_dir/member-types"
# Private parent directories protect the staging area; preserve artifact modes
# when these files later move into APP rather than masking them with umask 077.
tar --no-same-owner --same-permissions -xzf "$run_dir/candidate.tar.gz" -C "$run_dir/candidate"
valid_bundle "$run_dir/candidate" || fail 'Candidate bundle is incomplete'

previous=()
for name in "${managed[@]}"; do
  if [[ -e "$APP/$name" ]]; then previous+=("$name"); fi
done
tar --format=gnu --blocking-factor=20 -czf "$run_dir/backup.tar.gz" -C "$APP" -- "${previous[@]}"
backup_bytes=$(LC_ALL=C stat -c %s -- "$run_dir/backup.tar.gz")
capacity_uint "$backup_bytes" && (( backup_bytes <= capacity_backup_bound )) || capacity_fail 'Backup exceeded its preflight size bound'
tar -tzf "$run_dir/backup.tar.gz" >/dev/null
(cd "$run_dir" && sha256sum backup.tar.gz > backup.sha256 && sha256sum -c backup.sha256 >/dev/null)
tar --no-same-owner --same-permissions -xzf "$run_dir/backup.tar.gz" -C "$run_dir/restore"
valid_bundle "$run_dir/restore" || fail 'Restore point verification failed'
record_state BACKUP_READY
printf 'Restore point ready: %s\n' "$run_dir"

capacity_before_activation
record_state ACTIVATING
activation_started=1
clear_artifacts
for name in "${managed[@]}"; do
  if [[ -e "$run_dir/candidate/$name" ]]; then
    mv -- "$run_dir/candidate/$name" "$APP/$name"
  fi
done
restart_app
health_check || fail 'Activation health check failed'
record_state HEALTHY
activation_started=0
activation_completed=1
echo 'Activation health check passed; restore point retained'
}
REMOTE_ACTIVATION
)
if remote_output=$(ssh \
  -p 22 \
  -i "$key_file" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$known_hosts" \
  -o ConnectTimeout=15 \
  -o ConnectionAttempts=1 \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=4 \
  "$SSH_USER@$SSH_HOST" 'bash -s' <<< "$remote_command"); then
  if [[ "${remote_output##*$'\n'}" != 'LKC_RELEASE_HEALTHY_V1' ]]; then
    echo 'UNKNOWN: SSH exited 0 without the final HEALTHY acknowledgement; APP state is unknown; no automatic retry' >&2
    exit 1
  fi
  printf '%s\n' "$remote_output"
  echo 'Remote activation HEALTHY acknowledged; restore point retained'
else
  remote_status=$?
  echo "UNKNOWN: Remote deployment failed or its response was lost (exit $remote_status); APP state is unknown; no automatic retry" >&2
  exit "$remote_status"
fi
