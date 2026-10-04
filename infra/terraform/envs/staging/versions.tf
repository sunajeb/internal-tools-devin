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

  backend "azurerm" {
    resource_group_name  = "REPLACE_ME"
    storage_account_name = "REPLACE_ME"
    container_name       = "REPLACE_ME"
    key                  = "staging.tfstate"
    use_azuread_auth     = true
  }
}
