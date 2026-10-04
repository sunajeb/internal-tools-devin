variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "address_space" {
  type = list(string)
}

variable "app_integration_prefix" {
  type = string
}

variable "worker_prefix" {
  type = string
}

variable "private_endpoints_prefix" {
  type = string
}

variable "postgres_prefix" {
  type = string
}

variable "tags" {
  type = map(string)
}
