provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }

  storage_use_azuread = true
  subscription_id     = var.subscription_id
}

provider "azuread" {
  tenant_id = var.tenant_id
}
