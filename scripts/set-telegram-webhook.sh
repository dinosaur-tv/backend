#!/usr/bin/env bash
# Run on the VPS after .env has been completed. It never prints secrets.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
set -a
source ./.env
set +a
: "${TELEGRAM_WEB_APP_URL:=https://home.dym-dino.ru/console/}"

curl --fail-with-body --silent --show-error \
  --form "url=${PUBLIC_BASE_URL}/v1/telegram/webhook" \
  --form "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"

curl --fail-with-body --silent --show-error \
  --data-urlencode "menu_button={\"type\":\"web_app\",\"text\":\"Dino TV\",\"web_app\":{\"url\":\"${TELEGRAM_WEB_APP_URL}\"}}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton" >/dev/null

curl --fail-with-body --silent --show-error \
  --data-urlencode 'commands=[{"command":"home","description":"Открыть домашнюю консоль"},{"command":"today","description":"Экран «Сегодня»"},{"command":"tomorrow","description":"Экран «Завтра»"},{"command":"week","description":"Экран «Неделя»"},{"command":"theme","description":"Выбрать тему"},{"command":"privacy","description":"Гостевой режим"},{"command":"note","description":"Заметка на экране"},{"command":"status","description":"Проверить календари"}]' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" >/dev/null

curl --fail-with-body --silent --show-error \
  --data-urlencode 'description=Домашний экран Dino TV: погода Петербурга, общие календари и настроение гостиной. Управление — из Mini App или командами слева.' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyDescription" >/dev/null || true

curl --fail-with-body --silent --show-error \
  --data-urlencode 'short_description=Экран вашего дома' \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyShortDescription" >/dev/null || true

if [[ -f assets/bot-photo.png ]]; then
  curl --silent --show-error \
    --form "photo=@assets/bot-photo.png" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyProfilePhoto" >/dev/null || true
fi

printf '\nTelegram webhook, Mini App menu button and command list installed.\n'
printf 'Mini App URL: %s\n' "${TELEGRAM_WEB_APP_URL}"
printf 'If the chat still shows the old bottom keyboard, send /start once — the bot will hide it.\n'
