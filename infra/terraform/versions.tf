terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.0"
    }
  }
}

# Read the project-scoped API token from HCLOUD_TOKEN.
provider "hcloud" {}
