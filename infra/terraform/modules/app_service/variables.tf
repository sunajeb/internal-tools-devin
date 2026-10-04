variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "plan_sku" {
  type    = string
  default = "P1v3"
}

variable "zone_balancing_enabled" {
  type    = bool
  default = false
}

variable "worker_count" {
  type    = number
  default = 1
}

variable "app_integration_subnet_id" {
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

variable "front_door_profile_guid" {
  type = string
}

variable "websites_port" {
  type    = number
  default = 3000
}

variable "application_insights_connection_string" {
  type      = string
  sensitive = true
}

variable "log_analytics_workspace_id" {
  type = string
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

variable "oidc_client_id" {
  type = string
}

variable "oidc_issuer" {
  type = string
}

variable "oidc_redirect_uri" {
  type = string
}

variable "app_environment" {
  type = string
}

variable "tags" {
  type = map(string)
}
