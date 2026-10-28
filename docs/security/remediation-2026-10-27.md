# Виправлення за аудитом — 27.10.2026

Цей результат доповнює й замінює поточні статуси початкового audit-2026-10-27.md. Робота локальна, без розгортання на сервер. Наявні зміни ledger та інші зміни користувача збережено.

## Безпека

- Better Auth і passkey узгоджено оновлено до 1.7.14; адаптовано MFA enable до нового TOTP API. Next.js 16.4.3, DOMPurify 3.4.17, Nodemailer 10.2.1. Lockfile перебудовано без force/legacy-peer-deps.
- Повний npm audit: 0 critical, high, moderate, low (машинний звіт npm-audit-2026-10-27.json). Це стан advisory на момент перевірки, не гарантія відсутності всіх вразливостей.
- Збережено виправлення ізоляції публічних вкладень, строку дії токенів, прихованих вкладень, кешування, anonymous rate limit та непублічного PostgreSQL у Compose.
- SQL ledger-запити явно використовують схему public. AI-allowlist не відкриває внутрішні фінансові snapshots і службові ідентифікатори.
- Cleanup враховує JSON-посилання ledger audit/command; rollback завантаження зберігає файл, якщо відповідний запис уже закомітився.

## Повне аварійне відновлення

Відповідно до вибору користувача реалізовано **повну базу + файли**, а не перенесення однієї організації через JSON. Інструкція: [full-backup-restore-uk.md](full-backup-restore-uk.md).

`scripts/full-backup.py` використовує pg_dump/pg_restore, знаходить усі public-таблиці, зберігає uploads і окремі ledger storage, перевіряє рядки й SHA-256 файлів. Підтримує старий fallback uploads із правильним пріоритетом. Вимагає зупинених writers; сам їх не зупиняє. Restore дозволений лише в нову БД і нову папку; архіви перевіряються до створення БД, SQL відновлюється транзакційно. Тригери незмінності не вимикаються у застосунку. Backup має зберігатися у захищеному сховищі; вбудованого шифрування/доставки немає.

JSON export/import повертає 409 за наявності ledger-моделей, ledger-замовлень або cutover; перевірка імпорту відбувається до очищення. Legacy restore також відновлює stockOwnership, customerPartInstalled, organizationId.

Локальний PostgreSQL 16, штучні дані: проведена складська накладна, платіж, audit/command записи, PDF-вкладення, CSV-файл імпорту, звичайний upload. Backup і restore: **PASS, 140 таблиць, 3 файли**, збіг усіх row fingerprints і файлів. На відновленій базі UPDATE ledger відхилено з `Posted ledger records are immutable`. Повторний restore в наявну БД відхилено. Це не відновлення копії production-даних.

## Тести й production-збірка

- Загальний Vitest: **356 файлів пройшли, 4712 тестів пройшли, 86 пропущено у 11 файлах, 0 помилок**. Окремі DB-suite мають власний запуск нижче.
- Ledger на ізольованому PostgreSQL з усіма міграціями: **22 файли, 207 тестів, 0 помилок**.
- Фінальне доповнення backup policy: **46 тестів пройшли**, включно з ledger-замовленням до першого проведення.
- Python backup: **4 тести пройшли** — roundtrip/пошкодження, небезпечні архіви, відсутні файли/symlink, fallback uploads.
- Lint: **1971 файл, 0 помилок**. TypeScript пройшов у production build.
- `npm run build` тепер явно використовує Webpack; **production build завершився з кодом 0**. Turbopack тут не працює через `binding to a port: Operation not permitted` у CSS worker. Виправлено реальний client/server blocker: ліцензійний UI імпортує browser-safe константи, а не node:crypto.
- Smoke зібраного застосунку на localhost, тестова БД, фонові задачі вимкнені: sign-in HTTP 200; перший WebSocket upgrade успішний; сокет без сесії закрито з 4001. next-ws patch розпізнає штатне upstream-виправлення ensureUserland.
- Чисте `npm ci --omit=dev --ignore-scripts` у тимчасовому каталозі: успіх, 999 production packages, 0 advisory; native sharp завантажується.
- Dockerfile більше не перевстановлює Prisma 7.6 поверх нового згенерованого клієнта: production-залежності беруться точно з lockfile через npm ci, після чого застосовуються WebSocket patches.

Тести перевірено доступним Node 24.19.0; .nvmrc, CI і Docker використовують Node 22. Повний Docker image та зовнішні OAuth/MFA/passkey сценарії в живому браузері окремо не перевірялися. Build без runtime-секретів друкує попередження Better Auth; production запуск потребує власних BETTER_AUTH_SECRET і URL, як і раніше. Реальні секрети не додавалися.

Наступний етап перед окремо погодженим релізом: staging на Node 22, браузерна перевірка входу/MFA/passkey та відновлення актуальної захищеної production-копії в ізоляції. Сервер не змінено.


## Подальша локальна staging-перевірка

Docker-образ на Node 22 та браузерні password/MFA/passkey сценарії перевірено й виправлено в наступному етапі. Актуальний результат: [local-auth-staging.md](local-auth-staging.md). Сервер не змінювався.
