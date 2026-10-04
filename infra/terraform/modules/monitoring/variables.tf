variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "retention_days" {
  type    = number
  default = 90
}

variable "alert_email" {
  type = string
}

variable "alert_short_name" {
  type = string
  validation {
    condition     = length(var.alert_short_name) <= 12
    error_message = "The action group short name must be at most 12 characters."
  }
}

variable "tags" {
  type = map(string)
}
