#!/usr/bin/env bash
# Run on the VPS after .env has been completed. It never prints secrets.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
set -a
source ./.env
set +a

curl --fail-with-body --silent --show-error \
  --form "url=${PUBLIC_BASE_URL}/v1/telegram/webhook" \
  --form "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
printf '\nTelegram webhook installed.\n'
