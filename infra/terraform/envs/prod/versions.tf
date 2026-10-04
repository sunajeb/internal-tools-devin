terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.10"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.14"
    }
  }

  # Replace these placeholders with the bootstrapped state backend values.
  # Use -backend-config or edit this block before initializing a real backend.
  backend "azurerm" {
    resource_group_name  = "REPLACE_ME"
    storage_account_name = "REPLACE_ME"
    container_name       = "REPLACE_ME"
    key                  = "prod.tfstate"
    use_azuread_auth     = true
  }
}
