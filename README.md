# GymTracker

Минимальный Telegram Mini App для записи тренировок. Flask обслуживает мобильный веб-интерфейс и API, SQLite хранит пользователей, тренировки, упражнения и подходы. Все запросы к тренировкам требуют валидный Telegram `initData`; идентификатор владельца берётся только из проверенных данных.

## Локальный запуск

Нужен Python 3.10 или новее.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Для работы бота укажите в `.env` токен от [@BotFather](https://t.me/BotFather). Для Telegram Mini App задайте `WEBAPP_URL` на публичный HTTPS адрес приложения. Запустите веб-сервер:

```powershell
python app.py
```

Отдельно запустите бота в другом терминале:

```powershell
python bot.py
```

Бот отвечает на `/start` кнопкой открытия Mini App. Для локальной разработки страницу можно открыть по `http://127.0.0.1:8000`, но Telegram не предоставляет в обычном браузере подлинный `initData`, поэтому защищённый API будет возвращать ошибку авторизации. Не добавляйте тестовый обход авторизации в публичную конфигурацию.

## Публикация в Telegram

1. Разверните Flask-приложение на сервере с публичным HTTPS URL и задайте этот адрес в `WEBAPP_URL`.
2. Задайте `BOT_TOKEN` как переменную окружения на сервере и в среде бота. Не коммитьте `.env` и не вставляйте токен в исходный код.
3. Запустите веб-приложение через production WSGI-сервер (например, `gunicorn app:app`) и запустите `bot.py` как отдельный постоянно работающий процесс.
4. Настройте домен Mini App у @BotFather (Bot Settings → Configure Mini App / Menu Button) и проверьте кнопку `/start`.
5. Убедитесь, что reverse proxy передаёт запросы на Flask и HTTPS сертификат действителен.

Сервер проверяет HMAC подпись `initData` по алгоритму Telegram и отклоняет данные старше `MAX_INIT_DATA_AGE` (по умолчанию сутки). Клиент отправляет исходную строку `Telegram.WebApp.initData`; `initDataUnsafe` не используется для авторизации. Официальная схема: [Telegram Mini Apps: validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

## MVP

- Создание тренировки с датой, упражнениями и подходами (повторы и вес в кг).
- История тренировок, отсортированная по дате.
- Данные изолированы по проверенному Telegram ID; API выборки всегда ограничивает тренировки текущим пользователем.
