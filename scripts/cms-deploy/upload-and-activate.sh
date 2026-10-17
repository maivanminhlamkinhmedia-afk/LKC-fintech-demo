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

for command in tar curl sha256sum readlink mktemp mkdir rmdir mv rm cp sleep date; do
  command -v "$command" >/dev/null || fail "Required activation tool is missing: $command"
done
[[ -d "$APP" && ! -L "$APP" && "$(readlink -f -- "$APP")" == "$APP" ]] || fail 'APP is not a canonical directory'
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail 'Deploy archive is missing or is a symlink'
[[ ! -L "$APP/tmp" && ! -L "$APP/tmp/restart.txt" ]] || fail 'Unsafe restart path'
for name in "${managed[@]}"; do
  [[ ! -L "$APP/$name" ]] || fail 'A managed APP path is a symlink'
done
valid_bundle "$APP" || fail 'Existing APP cannot provide a complete restore point'

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
# Validate a private copy, not the shared upload name which a later upload could
# replace. Preserve the original upload and every restore point for review.
cp -- "$ARCHIVE" "$run_dir/candidate.tar.gz"
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
tar -czf "$run_dir/backup.tar.gz" -C "$APP" -- "${previous[@]}"
tar -tzf "$run_dir/backup.tar.gz" >/dev/null
(cd "$run_dir" && sha256sum backup.tar.gz > backup.sha256 && sha256sum -c backup.sha256 >/dev/null)
tar --no-same-owner --same-permissions -xzf "$run_dir/backup.tar.gz" -C "$run_dir/restore"
valid_bundle "$run_dir/restore" || fail 'Restore point verification failed'
record_state BACKUP_READY
printf 'Restore point ready: %s\n' "$run_dir"

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
