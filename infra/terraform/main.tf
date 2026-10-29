data "hcloud_ssh_key" "admin" {
  count = var.ssh_public_key_path == null ? 1 : 0
  name  = var.ssh_key_name
}

resource "hcloud_ssh_key" "admin" {
  count      = var.ssh_public_key_path == null ? 0 : 1
  name       = var.ssh_key_name
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "hcloud_firewall" "crm" {
  name = "${var.server_name}-firewall"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.allow_public_ssh_during_development ? ["0.0.0.0/0", "::/0"] : concat(var.admin_cidrs, var.deploy_runner_cidrs)
  }

  dynamic "rule" {
    for_each = toset(["80", "443"])
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.value
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "crm" {
  name         = var.server_name
  server_type  = var.server_type
  image        = "debian-13"
  location     = var.location
  ssh_keys     = [var.ssh_public_key_path == null ? data.hcloud_ssh_key.admin[0].id : hcloud_ssh_key.admin[0].id]
  firewall_ids = [hcloud_firewall.crm.id]
  keep_disk    = true
  backups      = false

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
    ipv4         = hcloud_primary_ip.crm_ipv4.id
    ipv6         = hcloud_primary_ip.crm_ipv6.id
  }

  labels = {
    application = "crm"
    environment = "production"
    managed_by  = "terraform"
  }

  lifecycle {
    prevent_destroy = true
    # Imported public_net changes can delete Primary IPs (provider issue #1381).
    # Reassign addresses explicitly; do not let the server resource manage them.
    ignore_changes = [ssh_keys, public_net]
  }
}
