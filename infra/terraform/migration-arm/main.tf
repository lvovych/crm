terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.69" }
  }
}
provider "hcloud" {}
data "hcloud_ssh_key" "admin" { name = "lvovych" }
data "hcloud_firewall" "crm" { name = "crm-production-firewall" }
resource "hcloud_server" "replacement" {
  name         = "crm-arm-migration"
  server_type  = "cax21"
  image        = "debian-13"
  location     = "nbg1"
  ssh_keys     = [data.hcloud_ssh_key.admin.id]
  firewall_ids = [data.hcloud_firewall.crm.id]
  backups      = false
  keep_disk    = true
  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
  labels = { application = "crm", environment = "migration", managed_by = "terraform" }
  lifecycle { prevent_destroy = true }
}
output "server_id" { value = hcloud_server.replacement.id }
output "server_ipv4" { value = hcloud_server.replacement.ipv4_address }
output "server_ipv6" { value = hcloud_server.replacement.ipv6_address }
