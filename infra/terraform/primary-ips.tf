# Imported production addresses are independent of the VM lifecycle.
resource "hcloud_primary_ip" "crm_ipv4" {
  name              = "crm-production-ipv4"
  type              = "ipv4"
  location          = var.location
  auto_delete       = false
  delete_protection = true
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [assignee_id, assignee_type]
  }
}
resource "hcloud_primary_ip" "crm_ipv6" {
  name              = "crm-production-ipv6"
  type              = "ipv6"
  location          = var.location
  auto_delete       = false
  delete_protection = true
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [assignee_id, assignee_type]
  }
}
