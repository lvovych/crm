terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.0"
    }
  }
}
provider "hcloud" {}

variable "ssh_key_name" {
  description = "Existing administrator SSH key in this Hetzner project."
  type        = string
}
variable "admin_cidrs" {
  type = list(string)
  validation {
    condition = length(var.admin_cidrs) > 0 && alltrue([
      for cidr in var.admin_cidrs : can(cidrhost(cidr, 0)) && !endswith(cidr, "/0")
    ])
    error_message = "Supply trusted administrator CIDRs; /0 is forbidden."
  }
}
variable "location" {
  type    = string
  default = "nbg1"
}
variable "server_type" {
  description = "An x86_64 server type; this runner does not build Docker images."
  type        = string
  default     = "cx23"
}

data "hcloud_ssh_key" "admin" { name = var.ssh_key_name }
resource "hcloud_firewall" "runner" {
  name = "crm-deploy-runner"
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_cidrs
  }
}
resource "hcloud_primary_ip" "runner" {
  name        = "crm-deploy-runner"
  type        = "ipv4"
  auto_delete = false
  location    = var.location
  lifecycle { prevent_destroy = true }
}
resource "hcloud_server" "runner" {
  name         = "crm-deploy-runner"
  image        = "ubuntu-24.04"
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = [data.hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.runner.id]
  public_net {
    ipv4         = hcloud_primary_ip.runner.id
    ipv4_enabled = true
    ipv6_enabled = false
  }
}
output "runner_ipv4" { value = hcloud_primary_ip.runner.ip_address }
output "production_ssh_cidr" { value = "${hcloud_primary_ip.runner.ip_address}/32" }
