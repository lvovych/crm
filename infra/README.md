# Інфраструктура CRM

Домен: `crm.srv.lauto.com.ua`. Старт: одна Hetzner CPX22, Debian 13,
системний диск 80 GB, Docker Compose. Без Kubernetes і додаткових дисків.

Сервіс розгорнуто через Terraform та Ansible. Поточні адреси, доступ,
деплой, бекапи та відновлення описані в [RUNBOOK.md](RUNBOOK.md).

Обліковий запис власника: `ceo@lauto.com.ua`. Пароль зберігається лише локально
в `infra/.secrets/ceo-login.json`. Секрети та state не потрапляють у Git.

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
не копіюється в репозиторій чи на VM. Адміністративний доступ — `root` лише через SSH-ключ; доступ обмежений firewall.

Перевірка синтаксису без VM:

```sh
ansible-playbook -i inventory/production.example.yml playbooks/bootstrap.yml --syntax-check
```

## Подальші налаштування

- Підключити SMTP/провайдер email для листів і відновлення пароля через пошту.
- Налаштувати зовнішній канал сповіщень про помилки бекапів.
- Зберегти аварійну копію секретів та Terraform state у захищеному місці.
- Для командної роботи перенести state у remote backend з блокуванням.

Збільшення CPU/RAM: змінити `server_type`, перевірити plan, зробити бекап
і запланувати вікно обслуговування. `keep_disk = true` зберігає розмір диска.
