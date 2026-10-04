variable "project" {
  type    = string
  default = "itf"
}

variable "location" {
  type    = string
  default = "westeurope"
}

variable "unique_suffix" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9]{3,6}$", var.unique_suffix))
    error_message = "Unique suffix must contain 3 to 6 lowercase letters or numbers."
  }
}

variable "subscription_id" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "owner" {
  type = string
}

variable "data_class" {
  type    = string
  default = "confidential"
}

variable "cost_center" {
  type = string
}

variable "entra_admin_object_id" {
  type = string
}

variable "entra_admin_principal_name" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "alert_short_name" {
  type = string
  validation {
    condition     = length(var.alert_short_name) <= 12
    error_message = "Alert short name must be at most 12 characters."
  }
}

variable "image" {
  type    = string
  default = "internal-tools:latest"
}

variable "worker_command" {
  type    = string
  default = "node dist/worker.js"
}

variable "websites_port" {
  type    = number
  default = 3000
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}
