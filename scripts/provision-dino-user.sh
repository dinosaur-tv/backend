#!/usr/bin/env bash
# Run once as root on the VPS. The argument must be one complete public SSH key.
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if [[ "${#}" -ne 1 || ! "${1}" =~ ^ssh-(ed25519|rsa|ecdsa)\  ]]; then
  echo "Usage: sudo bash scripts/provision-dino-user.sh 'ssh-ed25519 AAAA... label'" >&2
  exit 1
fi

readonly user_name="dino-d"
readonly public_key="$1"

if ! id "${user_name}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Dino TV deployment" "${user_name}"
fi

if ! getent group docker >/dev/null; then
  echo "Docker group does not exist. Install Docker first, then rerun this script." >&2
  exit 1
fi

usermod --append --groups sudo,docker "${user_name}"
passwd --lock "${user_name}"
install --directory --owner "${user_name}" --group "${user_name}" --mode 700 "/home/${user_name}/.ssh"
touch "/home/${user_name}/.ssh/authorized_keys"
chown "${user_name}:${user_name}" "/home/${user_name}/.ssh/authorized_keys"
chmod 600 "/home/${user_name}/.ssh/authorized_keys"
if ! grep --fixed-strings --quiet --line-regexp "${public_key}" "/home/${user_name}/.ssh/authorized_keys"; then
  printf '%s\n' "${public_key}" >> "/home/${user_name}/.ssh/authorized_keys"
fi
printf '%s ALL=(ALL) ALL\n' "${user_name}" > "/etc/sudoers.d/${user_name}"
chmod 440 "/etc/sudoers.d/${user_name}"
visudo --check --file "/etc/sudoers.d/${user_name}"

echo "User ${user_name} is ready. Open a separate SSH session with this key and verify sudo before running scripts/lock-root-ssh.sh."
