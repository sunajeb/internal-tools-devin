output "id" {
  value = azurerm_key_vault.main.id
}

output "name" {
  value = azurerm_key_vault.main.name
}

output "vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "private_endpoint_id" {
  value = azurerm_private_endpoint.main.id
}

output "deployer_role_assignment_id" {
  value = azurerm_role_assignment.deployer.id
}
