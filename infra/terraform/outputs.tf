output "server_ipv4" {
  value = hcloud_server.crm.ipv4_address
}

output "server_ipv6" {
  value = hcloud_server.crm.ipv6_address
}

output "ansible_inventory" {
  description = "Write to infra/ansible/inventory/production.yml after apply."
  value = yamlencode({
    all = {
      children = {
        crm = {
          hosts = {
            (var.server_name) = {
              ansible_host = hcloud_server.crm.ipv4_address
              ansible_user = "root"
            }
          }
        }
      }
    }
  })
}
