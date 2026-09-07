#!/usr/bin/env bash
# Run on the VPS after .env has been completed. It never prints secrets.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
set -a
source ./.env
set +a
: "${TELEGRAM_WEB_APP_URL:=https://home.dym-dino.ru}"

curl --fail-with-body --silent --show-error \
  --form "url=${PUBLIC_BASE_URL}/v1/telegram/webhook" \
  --form "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
curl --fail-with-body --silent --show-error \
  --data-urlencode 'menu_button={"type":"default"}' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton" >/dev/null
curl --fail-with-body --silent --show-error \
  --data-urlencode 'commands=[{"command":"home","description":"Открыть домашнюю консоль"},{"command":"now","description":"Показать главный экран"},{"command":"today","description":"Показать дела на сегодня"},{"command":"week","description":"Показать неделю"},{"command":"month","description":"Показать месяц"},{"command":"theme","description":"Выбрать тему экрана"},{"command":"privacy","description":"Включить гостевой режим"},{"command":"note","description":"Показать заметку"},{"command":"status","description":"Проверить подключения"}]' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" >/dev/null
printf '\nTelegram webhook, command menu and chat keyboard settings installed.\n'
