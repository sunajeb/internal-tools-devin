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

variable "key_vault_network_dependency_ids" {
  type = list(string)
}

variable "allowed_group_object_ids" {
  description = "Entra security groups that may sign in"
  type        = list(string)

  validation {
    condition     = length(var.allowed_group_object_ids) > 0
    error_message = "Specify at least one Entra security group."
  }
}

variable "tags" {
  type = map(string)
}
