variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "worker_subnet_id" {
  type = string
}

variable "acr_id" {
  type = string
}

variable "acr_login_server" {
  type = string
}

variable "image" {
  type    = string
  default = "internal-tools:latest"
}

variable "worker_command" {
  type    = string
  default = "npm run start -w @internal-tools/worker"
}

variable "websites_port" {
  type    = number
  default = 3000
}

variable "postgres_fqdn" {
  type = string
}

variable "postgres_database_name" {
  type = string
}

variable "key_vault_name" {
  type = string
}

variable "application_insights_connection_string" {
  type      = string
  sensitive = true
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "zone_balancing_enabled" {
  type    = bool
  default = false
}

variable "worker_count" {
  type = number
}

variable "tags" {
  type = map(string)
}
