# Локальна перевірка Docker та автентифікації

Staging ізольовано у Compose-проєкті `crm-auth-staging`. Він використовує тільки синтетичні облікові записи `@example.test`, окремі PostgreSQL і uploads; порти опубліковано лише на loopback. Фонові задачі вимкнені, production rate limit автентифікації залишається увімкненим. На сервер нічого не розгортається.

## Результат 27.10.2026

Цей Docker/browser-прогін виконано на повній робочій копії, що також містила незакомічені розширення ledger. Наведені digest образу та 115 міграцій стосуються саме тієї копії, а не окремого коміту безпеки. Нові функції й міграції ledger до коміту безпеки не включено.

- Production Docker build: **PASS**, Linux amd64, Node **22.23.4**, Next.js **16.4.3**. Образ `crm-local-staging:security-final` (також тег `security`), SHA-256 `c71f3aa4d0e2db53a9dac49b3e610922c7d3bb3365b9423212b479e32d1ed74b`.
- Запуск як `nextjs`, UID **1001**. Prisma CLI/client **7.10.1**, schema engine і sharp працюють у контейнері з `--network none`.
- На порожній базі успішно застосовано **115 міграцій**. Повторний старт перевірено окремо.
- Chromium: **2 повні сценарії пройшли**, пароль/TOTP/recovery — 60 секунд, passkey — 7 секунд. Перевірено також відмову старій cookie після logout і credential після видалення.
- Регресійні unit-тести passkey: **24 пройшли**. Lint: **1973 файли, 0 помилок**; TypeScript пройшов у Docker build.
- Після повторного старту: sign-in HTTP **200**, перший WebSocket upgrade **PASS**, неавторизований socket закрито з **4001**. Повторний локальний `tsc --noEmit`: код **0**.
- npm audit усередині встановлення production-залежностей образу: **0 вразливостей**.

Виправлено heap OOM збірки Node 22: build-only `BUILD_NODE_OPTIONS=--max-old-space-size=4096`. Runtime heap не змінено. Додано Prisma engine із dependency-stage тієї самої платформи/lockfile: `--ignore-scripts` у runtime npm ci інакше залишав його без native engine.

Виправлено UI passkey: серверний `result.error` більше не показується як успішне видалення/перейменування; після скасування реєстрації кнопка знову доступна; актуальний код `ERROR_CEREMONY_ABORTED` обробляється як скасування і під час реєстрації, і під час входу. Стан браузера й результати реальних WebAuthn endpoint перевірено. `.dockerignore` додатково виключає з контексту браузерні сесії та звіти.

Початковий браузерний прогін підтвердив HTTP 429 на занадто часті входи. Тест тепер чекає завершення вікна обмеження; production limiter не відключався. Staging без reverse proxy використовує спільний IP fallback Better Auth; налаштування reverse proxy на сервері цей прогін не перевіряє.

Після перевірки локальні контейнери зупинено, їхні синтетичні volumes видалено. Перевірений Docker-образ залишено локально.

## Повторення

Потрібні Docker, Python 3, Node 22+ та Chromium Playwright. Згенерувати одноразовий env-файл поза репозиторієм із правами 0600:

```sh
python3 - <<'PY'
import os, secrets
with os.fdopen(os.open('/tmp/crm-auth-staging.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as out:
    out.write('STAGING_DB_PASSWORD=' + secrets.token_hex(24) + '\n')
    out.write('STAGING_AUTH_SECRET=' + secrets.token_hex(32) + '\n')
PY

docker compose -p crm-auth-staging --env-file /tmp/crm-auth-staging.env \
  -f docker-compose.staging.yml up -d --build

npx playwright install chromium
set -a
. /tmp/crm-auth-staging.env
set +a
export STAGING_DATABASE_URL="postgresql://crm_staging:${STAGING_DB_PASSWORD}@127.0.0.1:55441/crm_auth_staging"
npx playwright test --config=playwright.staging.config.ts
```

Застосунок: `http://localhost:55440`. Тести відмовляються працювати з іншим хостом/портом і будь-якою БД, крім локальної `crm_auth_staging`. Вони створюють нових користувачів без очищення інших баз. Звіт і артефакти — `test-results/auth-staging/`; це тимчасові тестові дані, не призначені для образу чи Git.

Тести перевіряють неправильний і правильний пароль, налаштування TOTP через UI, захист сторінок до другого фактора, неправильний код, резервний код та його повторне використання, вимкнення MFA, logout і відмову старій cookie. Passkey перевіряється через Chromium CDP virtual authenticator: справжня WebAuthn-реєстрація/підпис, перейменування, вхід і відкликання. Окремо симулюється відмова сервера при видаленні та AbortSignal при реєстрації.

Віртуальний authenticator перевіряє браузерний WebAuthn і серверну криптографію, але не є перевіркою фізичних Touch ID/Face ID/YubiKey, синхронізації iCloud/Google чи Safari. Зовнішній OAuth до цього локального прогону не входить.

Після перевірки зупинити staging. `--volumes` нижче видаляє тільки синтетичні дані цього окремого Compose-проєкту:

```sh
docker compose -p crm-auth-staging --env-file /tmp/crm-auth-staging.env \
  -f docker-compose.staging.yml down --volumes
```

## Перевірка окремого коміту безпеки

Індекс Git експортовано в окрему тимчасову директорію без незакомічених розширень ledger; Prisma Client згенеровано саме з її схеми. Перевірки виконано на Node 24.19:

- Vitest: початковий повний прогін — 352 файли / 4699 тестів пройшли, 3 файли / 48 тестів пропущено; одна помилка переліку AI-колонок виправлена, повторно всі 9 тестів цього файлу пройшли.
- Після перенесення `socketStats` із Next route-модуля: 7 файлів / 72 realtime-тести пройшли.
- Python backup/restore: 4 тести пройшли.
- `tsc --noEmit` та Biome lint пройшли; production `next build --webpack` завершився з кодом 0, включно з перевіркою типів і генерацією сторінок.
- Збірка потребувала мережі для Google Fonts. Production-секрети в тимчасову копію не переносилися; Better Auth повідомляв про відсутній secret/base URL під час build. Секрети обов’язково задаються під час запуску, як у staging Compose.

Docker-образ саме цього ізольованого дерева й браузерні сценарії після відбору коміту повторно не запускалися; попередні результати образу наведено вище з окремо зазначеною областю перевірки. Розгортання та push не виконувалися.
