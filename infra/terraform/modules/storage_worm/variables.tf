variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "replication_type" {
  type = string
}

variable "retention_days" {
  type    = number
  default = 2555
}

variable "immutability_locked" {
  type    = bool
  default = false
}

variable "private_endpoints_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "tags" {
  type = map(string)
}
