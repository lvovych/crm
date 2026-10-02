# Інфраструктура CRM

Домен: `crm.srv.lauto.com.ua`. Старт: одна Hetzner CPX22, Debian 13,
системний диск 80 GB, Docker Compose. Без Kubernetes і додаткових дисків.

Terraform описує VM та firewall; Ansible готує Docker і каталоги.
`playbooks/deploy.yml` та шаблони Compose готують запуск TorqVoice, PostgreSQL
і Caddy. Вони ще не перевірені на VM. CI/CD, резервне копіювання, моніторинг
та процедуру відновлення потрібно завершити перед production-запуском.

Домен — `crm.srv.lauto.com.ua`. `crm_public_https: false` залишає застосунок
доступним лише на loopback сервера; HTTPS вмикається після налаштування DNS
та початкового адміністратора. Для deploy потрібні `crm_image` з digest
і три випадкові 64-символьні hex-секрети: `vault_postgres_password`,
`vault_auth_secret`, `vault_integrations_key`. Передавати їх через зашифрований
Ansible Vault (`--ask-vault-pass`), не через відкритий Git чи аргументи CLI.
Приватний GHCR-образ потребує окремого налаштування registry authentication.
Повторний deploy зі змінами схеми потребує перевіреного бекапа.

## Межі відповідальності

- `terraform/`: VM, firewall, використання вже завантаженого SSH-ключа.
- `ansible/`: конфігурація ОС, Docker, надалі Compose, бекапи та відновлення.
- Вихідний код застосунку та Dockerfile залишаються в корені репозиторію.
- Terraform не запускає Ansible через provisioner; це два окремі контрольовані кроки.
- DNS поки не керується кодом: спочатку потрібно визначити DNS-провайдера.

## Підготовка Terraform

Потрібні Terraform >= 1.9, Ansible та API token саме створеного Hetzner-проєкту
з правами Read & Write. Токен зберігається локально в `infra/.env` як
`HCLOUD_TOKEN`, файл має права `0600` та виключений із Git. Не записувати
токен у код або tfvars. Terraform не читає `.env` автоматично — перед запуском
завантажити змінні командами нижче. Додавання SSH-ключа не надає API-доступ.

```sh
cd infra
set -a
. ./.env
set +a
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Заповнити ssh_key_name та admin_cidrs; перевірити location.
terraform init
terraform fmt -check
terraform validate
terraform plan -out=production.tfplan
# Після перевірки плану, коли готові створити платну VM:
terraform apply production.tfplan
```

`ssh_key_name` — точне ім'я вже наявного ключа в цьому Hetzner-проєкті.
`admin_cidrs` — ваші зовнішні IP із маскою /32 для IPv4 або /128 для IPv6.
Не використовуйте 0.0.0.0/0 чи ::/0. При зміні IP оновіть firewall через Terraform.
Локація за замовчуванням `nbg1` — пропозиція, доступність перевіряється до apply.
VM має `prevent_destroy`: випадкова заміна/видалення буде заблокована.

Перший етап використовує локальний Terraform state. Він, збережені плани та
tfvars ігноруються Git. State потрібно зберігати в захищеному резервному
сховищі; для спільної роботи налаштувати remote backend із блокуванням.
`.terraform.lock.hcl` потрібно комітити для відтворюваних версій провайдерів.

## Підготовка Ansible

Після створення VM:

```sh
terraform output -raw ansible_inventory > ../ansible/inventory/production.yml
cd ../ansible
# Звірити SSH host fingerprint через довірений канал Hetzner Console,
# потім виконати перше SSH-підключення й додати перевірений ключ у known_hosts.
ansible-playbook playbooks/bootstrap.yml --check --diff
ansible-playbook playbooks/bootstrap.yml
```

Ansible використовує SSH agent або ваш стандартний SSH config. Якщо потрібен
інший ключ, передайте `--private-key /absolute/path/to/key`. Приватний ключ
не копіюється в репозиторій чи на VM. Початковий користувач — `root` зі своїм
SSH-ключем; окремого користувача для деплою додамо разом із CI/CD.

Перевірка синтаксису без VM:

```sh
ansible-playbook -i inventory/production.example.yml playbooks/bootstrap.yml --syntax-check
```

## Наступні кроки

1. Compose: Caddy, власний зафіксований образ TorqVoice, PostgreSQL без public port.
2. GitHub Actions: збірка в GHCR, контрольований деплой із перевіркою здоров'я.
3. Секрети через Ansible Vault; пароль Vault зберігається поза Git.
4. Зовнішнє сховище: узгоджені бекапи БД і uploads, retention, повідомлення про помилки.
5. Restore playbook і перевірка відновлення на чистій VM до production-запуску.
6. DNS, HTTPS, моніторинг диска/RAM/доступності та давності бекапів.

Збільшення CPU/RAM починається зі зміни `server_type` і перевірки plan.
Параметр `keep_disk = true` залишає системний диск попереднього розміру.
Перед змінами розміру потрібні перевірений бекап та вікно обслуговування.
