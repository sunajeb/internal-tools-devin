variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "web_app_id" {
  type = string
}

variable "postgres_server_id" {
  type = string
}

variable "application_insights_id" {
  type = string
}

variable "action_group_id" {
  type = string
}

variable "http5xx_threshold" {
  type    = number
  default = 10
}

variable "http_response_time_threshold" {
  type    = number
  default = 2
}

variable "tags" {
  type = map(string)
}
