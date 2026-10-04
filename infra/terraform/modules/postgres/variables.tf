variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "delegated_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "private_dns_zone_link_id" {
  type = string
}

variable "sku_name" {
  type = string
}

variable "storage_mb" {
  type = number
}

variable "high_availability_enabled" {
  type    = bool
  default = false
}

variable "password_auth_enabled" {
  type    = bool
  default = false
}

variable "tenant_id" {
  type = string
}

variable "entra_admin_object_id" {
  type = string
}

variable "entra_admin_principal_name" {
  type = string
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "tags" {
  type = map(string)
}
