# Google Calendar

## Владелец сервера — один раз

1. Создайте проект Google Cloud; включите **Google Calendar API**.
2. Google Auth Platform → Branding: название, контакт, свой домен и ссылки:
   - Главная: `https://api.example.com/`
   - Конфиденциальность: `https://api.example.com/privacy`
   - Условия: `https://api.example.com/terms`
3. Audience → External. В режиме Testing добавьте Google-адреса участников в Test users; для посторонних нужна публикация — см. ниже.
4. Data Access → Add or remove scopes:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
5. Clients → Create client → **Web application**, не TV.
6. Redirect URI: `https://api.example.com/oauth/google/callback`.
7. В backend `.env` заполните `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; перезапустите сервер.

Замените example-домены своими. Callback должен точно совпадать с `PUBLIC_BASE_URL + /oauth/google/callback`. Секрет клиента не нужен ни телевизору, ни телефону.

## Каждый участник

В боте: /home → Ещё → Календари → свой участник → Подключить Google. После согласия вернитесь в консоль → Выбрать календари → Сохранить выбор.

Общий календарь выбирайте только у одного участника, иначе события повторятся. Все приглашённые в этот дом видят выбранные события.

## Если не работает

- `redirect_uri_mismatch`: проверьте callback.
- Отказ доступа: аккаунт должен быть в Test users.
- Доступ истёк: нажмите «Подключить заново».
- Нет событий: проверьте выбранные календари и даты.
- 503: проверьте настройки Google в `.env`.

OAuth-ссылка одноразовая, действует 15 минут. Старые ссылки с секретом в URL больше не используются.

«Отключить» удаляет локальный токен и кэш. Полный отзыв разрешения — в Google Account → сторонние подключения.

## Публикация и верификация

Пока приложение в статусе **Testing**, войти могут только адреса из Test users, а refresh token живёт **7 дней** — календарь придётся переподключать каждую неделю. Это и мешает пускать посторонних.

Порядок действий:

1. **Audience → Publish app.** Статус меняется на In production. Ограничение в 7 дней снимается сразу, список Test users больше не нужен.
2. Пока верификация не пройдена, на экране согласия показывается предупреждение «Google hasn't verified this app» и действует лимит около 100 пользователей. Работать это не мешает, выглядит пугающе.
3. **Подтвердите домен.** Google Search Console → добавьте `example.com` и подтвердите владение. Домен ссылок из Branding должен совпадать с подтверждённым.
4. **Branding.** Название, логотип, адрес поддержки и три ссылки, которые уже отдаёт сам сервер: `/`, `/privacy`, `/terms`.
5. **Prepare for verification → Submit.** Google попросит видео на YouTube: показать адресную строку с вашим доменом, вход, экран согласия со списком запрошенных доступов и то, ради чего они нужны — расписание на экране.

Оба используемых доступа (`calendar.events.readonly`, `calendar.calendarlist.readonly`) относятся к **sensitive**, а не restricted: независимый аудит безопасности (CASA) для них не требуется. Проверка обычно занимает от нескольких дней до нескольких недель, Google может задать уточняющие вопросы.

Публикация исходников верификацию не заменяет.

[Правила OAuth](https://developers.google.com/identity/protocols/oauth2) · [Web-подключение](https://developers.google.com/identity/protocols/oauth2/web-server)
