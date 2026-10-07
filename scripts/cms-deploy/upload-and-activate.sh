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
remote_command='
  set -e

  APP="/home/edpmjmha/lkcfintech.com.vn/deploy"
  ARCHIVE="/home/edpmjmha/lkc-deploy.tar.gz"

  tar -tzf "$ARCHIVE" >/dev/null

  rm -rf \
    "$APP/.next" \
    "$APP/public" \
    "$APP/node_modules" \
    "$APP/prisma"

  rm -f \
    "$APP/server.js" \
    "$APP/package.json" \
    "$APP/prisma.config.ts"

  tar -xzf "$ARCHIVE" -C "$APP"
  rm -f "$ARCHIVE"

  mkdir -p "$APP/tmp"
  printf "deployed at %s\n" "$(date -u +%FT%TZ)" > "$APP/tmp/restart.txt"
'
if ssh \
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
  "$SSH_USER@$SSH_HOST" "$remote_command"; then
  echo 'Remote deployment command completed'
else
  remote_status=$?
  echo "Remote deployment failed or its response was lost (exit $remote_status); APP state is unknown; no automatic retry" >&2
  exit "$remote_status"
fi
