variable "name" {
  type = string
}

variable "endpoint_name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "web_default_hostname" {
  type = string
}

variable "rate_limit_threshold" {
  type    = number
  default = 300
}

variable "log_analytics_workspace_id" {
  type = string
}

variable "tags" {
  type = map(string)
}
