variable "storage_box_password" {
  type      = string
  sensitive = true
}

resource "hcloud_storage_box" "backups" {
  name              = "crm-backups"
  storage_box_type  = "bx11"
  location          = "hel1"
  password          = var.storage_box_password
  ssh_keys          = [trimspace(file("${path.module}/../.secrets/backup_ed25519.pub"))]
  delete_protection = true

  access_settings = {
    reachable_externally = true
    ssh_enabled          = true
    samba_enabled        = false
    webdav_enabled       = false
    zfs_enabled          = false
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "backup_server" {
  value = hcloud_storage_box.backups.server
}

output "backup_username" {
  value = hcloud_storage_box.backups.username
}
