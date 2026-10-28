variable "server_name" {
  type    = string
  default = "crm-production"
}

variable "server_type" {
  type    = string
  default = "cax21"
}

variable "location" {
  type    = string
  default = "nbg1"
}

variable "ssh_key_name" {
  description = "Name of the existing SSH key in the target Hetzner project."
  type        = string
}

variable "ssh_public_key_path" {
  description = "Optional local PUBLIC key path to upload; null uses an existing project key."
  type        = string
  default     = null
}

variable "admin_cidrs" {
  description = "Trusted public administrator IP ranges permitted to use SSH."
  type        = list(string)

  validation {
    condition = length(var.admin_cidrs) > 0 && alltrue([
      for cidr in var.admin_cidrs : can(cidrhost(cidr, 0)) && !endswith(cidr, "/0")
    ])
    error_message = "Provide at least one valid trusted CIDR; unrestricted /0 ranges are forbidden."
  }
}

variable "deploy_runner_cidrs" {
  description = "Dedicated deployment runner egress IPv4 /32 or IPv6 /128; never GitHub-wide ranges."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.deploy_runner_cidrs : can(cidrhost(cidr, 0)) && (
        endswith(cidr, "/32") && !strcontains(cidr, ":") || endswith(cidr, "/128") && strcontains(cidr, ":")
      )
    ])
    error_message = "Each deployment runner must be a single host (/32 IPv4 or /128 IPv6)."
  }
}
