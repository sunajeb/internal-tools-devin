variable "display_name" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "redirect_uri" {
  type = string
}

variable "key_vault_id" {
  type = string
}

variable "secret_writer_role_assignment_id" {
  type = string
}

variable "tags" {
  type = map(string)
}
