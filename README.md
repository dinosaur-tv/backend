# Dino TV · backend

API, Telegram-бот, Google Calendar и настройки экрана. Node.js 22, TypeScript, Docker.

**Один экземпляр обслуживает много независимых домов.** У каждого дома свои участники, календари, устройства и настройки; данные соседей недоступны. Открытая регистрация включается флагом — см. [общий сервер](docs/HOSTED_SERVICE.md).

## Установка на VPS

Нужны Docker Compose, домен, DNS на VPS и свободные порты 80/443. Репозитории `backend` и `app` разместите рядом.

```bash
cp .env.example .env
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET
# Заполните .env своими доменами и секретами.
mkdir -p data
sudo chown 1000:1000 data
chmod 700 data
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.fullstack.yml up -d --build
```

Проверка: `https://api.example.com/health` и `https://home.example.com/console/`. HTTPS выдаёт Caddy.

Существующий Traefik: используйте `docker-compose.traefik.yml` в обоих репозиториях, одну сеть и свои настройки TLS. Nginx направляет `/api/` к `dino-backend:3000`.

## Подключение

1. Создайте бота через @BotFather.
2. В `.env` заполните токен бота, URL консоли и `REGISTRATION_OPEN`.
3. Выполните `bash scripts/set-telegram-webhook.sh`.
4. В личном чате с ботом: `/start` → приложение → «Создать дом» → введите код с телевизора.
5. Второй человек: владелец даёт код приглашения («Ещё → Пригласить участника»), гость вводит его в «Ещё → Войти по приглашению».
6. Телефон без Telegram: на авторизованном телефоне «Ещё → Код для моего телефона».

Google: [пошаговая настройка](docs/GOOGLE_CALENDAR.md). В приложении доступны подключение, выбор календарей и отключение.

Подписи двух календарей дом задаёт сам в «Ещё → Дом и участники». Внутренние ID `misha` / `natasha` сохранены для совместимости. Сейчас поддерживаются два календаря на дом и погода Петербурга.

## Настройки и данные

- `TV_REMOTE_ENABLED=false`: экспериментальные кнопки пульта и запуск приложений выключены. Для включения — `true` и перезапуск.
- Настройки экрана и базовые медиакнопки работают отдельно от пульта.
- Музыку воспроизводит Кинопоиск/другое приложение; Dino использует Android MediaSession.
- Данные: `data/households.sqlite` и `data/backgrounds/<ID дома>/`. Сохраняйте резервную копию вместе с ключом шифрования.
- Старый `data/state.enc` переносится в первый дом при первом запуске и дальше не используется. Не удаляйте его до проверки переноса.
- Не заменяйте ключ шифрования без миграции: база перестанет читаться.
- Перед обновлением сделайте резервную копию. Откат к старому небезопасному подключению по коду недопустим.

## Разработка

```bash
npm ci
node --env-file=.env --import tsx src/server.ts
npm run quality
npm audit
pre-commit install
pre-commit run --all-files
```

Тесты проверяют изоляцию домов, авторизацию, приглашения, отзыв доступа, OAuth-state, пульт и состояние экрана.

[Безопасность](SECURITY.md) · [Участие](CONTRIBUTING.md) · [MIT](LICENSE)
