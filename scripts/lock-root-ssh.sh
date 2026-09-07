#!/usr/bin/env bash
# Run only after a separate, working dino-d SSH key session has been verified.
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo as root." >&2
  exit 1
fi

id dino-d >/dev/null
getent group docker | grep --quiet '\bdino-d\b'

readonly config_path="/etc/ssh/sshd_config.d/99-dino-tv-hardening.conf"
printf '%s\n' \
  'PermitRootLogin no' \
  'PasswordAuthentication no' \
  'KbdInteractiveAuthentication no' \
  > "${config_path}"

if ! sshd -t; then
  rm --force "${config_path}"
  echo "The SSH configuration is invalid; no changes were applied." >&2
  exit 1
fi

systemctl reload ssh || systemctl reload sshd
echo "Root and password SSH logins are disabled. Keep the current session open until you verify a new dino-d login."
