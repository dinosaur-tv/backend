# Dino TV backend

Приватный сервис для одного дома: подключает Google Calendar Миши и Наташи, получает погоду Санкт-Петербурга, принимает команды Telegram и отдаёт телевизору защищённый снимок данных. Разворачивается на небольшом VPS в Docker.

## До первого запуска

- VPS с Ubuntu 24.04+ и публичным IPv4;
- домен или поддомен, например `api.dym-dino.ru`, с A-записью на IP VPS;
- открытые TCP-порты `80` и `443`;
- Docker Engine и Docker Compose plugin на VPS;
- Telegram bot token из @BotFather.

Caddy сам выпустит и обновит HTTPS-сертификат, когда DNS уже будет указывать на VPS.

## Ссылки для Google Auth Platform

После публикации с `API_DOMAIN=api.dym-dino.ru` пропишите в Google Auth Platform → Branding:

| Поле | Значение |
| --- | --- |
| Application home page | `https://api.dym-dino.ru/` |
| Application privacy policy link | `https://api.dym-dino.ru/privacy` |
| Application terms of service link | `https://api.dym-dino.ru/terms` |

Это три общедоступные страницы Dino TV: они не требуют авторизации и не показывают персональные данные.

## Развёртывание

Для VPS с уже работающим Traefik используйте `docker-compose.traefik.yml`: он не открывает порты сам, а подключает Dino TV к существующей reverse-proxy сети. Имя этой Docker-сети задаётся в `TRAEFIK_NETWORK` (на целевом сервере — `proxy`). В случае с самостоятельным сервером без Traefik оставьте исходный `docker-compose.yml` — он использует Caddy.

Загрузите на VPS **только эту папку `backend/`**, затем создайте отдельного пользователя для развёртывания. Установите Docker, подготовьте свой SSH-ключ и один раз под root выполните:

```bash
sudo bash scripts/provision-dino-user.sh 'ssh-ed25519 ВАШ_ПУБЛИЧНЫЙ_КЛЮЧ dino-tv'
```

В новом терминале проверьте, что вход под `dino-d` и `sudo` работают. Только после успешной проверки закройте root-вход и парольную авторизацию:

```bash
sudo bash scripts/lock-root-ssh.sh
```

Дальше уже под `dino-d`:

```bash
cd backend
cp .env.example .env
nano .env
docker compose -f docker-compose.traefik.yml up -d --build
docker compose -f docker-compose.traefik.yml logs -f dino-backend
```

Проверьте `https://ваш-домен/health`. Секреты лежат только в `.env`, который исключён из git. OAuth refresh tokens находятся в `data/state.enc` и зашифрованы AES-256-GCM ключом `TOKEN_ENCRYPTION_KEY`. Перед запуском создайте в Cloudflare DNS A-запись `api.dym-dino.ru` на VPS и включите proxied-режим.

Конфигурация Traefik использует стандартные labels `Host(API_DOMAIN)`, `websecure`, TLS и внутренний порт `3000`. До запуска убедитесь, что имя внешней Docker-сети в `.env` действительно совпадает с сетью работающего Traefik; это единственное значение, зависящее от уже настроенных проектов на VPS.

Для `TOKEN_ENCRYPTION_KEY`, `DEVICE_TOKEN`, `OAUTH_CONNECT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` используйте `openssl rand -base64 32` или менеджер паролей. Не отправляйте их в чат.

## Google Calendar

Calendar API в проекте уже включён. Дальше:

1. Google Auth Platform → **Data Access** → Add or remove scopes:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
2. Google Auth Platform → **Clients**: удалите старый `TV and Limited Input` client.
3. Create client → **Web application**.
4. В Authorized redirect URIs добавьте:

   ```text
   https://api.example.com/oauth/google/callback
   ```

   где `api.example.com` — `API_DOMAIN` из `.env`.
5. Впишите новый Client ID и Client Secret в `.env` на VPS. Не добавляйте их в Android-приложение.

После запуска откройте на личном устройстве:

```text
https://api.example.com/oauth/google/start?person=misha&key=OAUTH_CONNECT_TOKEN
https://api.example.com/oauth/google/start?person=natasha&key=OAUTH_CONNECT_TOKEN
```

Замените `OAUTH_CONNECT_TOKEN` значением из `.env`; не публикуйте эти ссылки. Каждый входит в свой Google-аккаунт. Если нужны не primary-календари, в `.env` укажите их ID через запятую в `MISHA_CALENDAR_IDS` или `NATASHA_CALENDAR_IDS`.

## Telegram

1. Создайте бота в @BotFather и внесите token в `TELEGRAM_BOT_TOKEN`.
2. В `TELEGRAM_ALLOWED_USER_IDS` внесите числовые Telegram user ID Миши и Наташи.
3. После запуска установите webhook:

```bash
curl -F "url=https://api.example.com/v1/telegram/webhook" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

Или, после заполнения `.env`, выполните без вывода токенов:

```bash
bash scripts/set-telegram-webhook.sh
```

Команды: `/now`, `/today`, `/week`, `/month`, `/theme gallery|home-day|home-evening|night|play|forest|mountains|sea|space|petersburg|rome|florence|venice|rus|byzantium|india|italy`, `/privacy on|off`, `/note текст`, `/status`.

## API для телевизора

`GET /v1/display/snapshot` требует `Authorization: Bearer <DEVICE_TOKEN>` и возвращает погоду Петербурга, события на 31 день, владельца/цвет каждого события, выбранную тему и команды Telegram. Подключение endpoint к Android-приложению — следующий шаг после первого успешного запуска VPS.
