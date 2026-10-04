output "vnet_id" {
  value = azurerm_virtual_network.main.id
}

output "app_integration_subnet_id" {
  value = azurerm_subnet.main["app_integration"].id
}

output "worker_subnet_id" {
  value = azurerm_subnet.main["worker"].id
}

output "private_endpoints_subnet_id" {
  value = azurerm_subnet.main["private_endpoints"].id
}

output "postgres_subnet_id" {
  value = azurerm_subnet.main["postgres"].id
}

output "postgres_dns_zone_id" {
  value = azurerm_private_dns_zone.main["privatelink.postgres.database.azure.com"].id
}

output "key_vault_dns_zone_id" {
  value = azurerm_private_dns_zone.main["privatelink.vaultcore.azure.net"].id
}

output "blob_dns_zone_id" {
  value = azurerm_private_dns_zone.main["privatelink.blob.core.windows.net"].id
}

output "postgres_dns_zone_link_id" {
  value = azurerm_private_dns_zone_virtual_network_link.main["privatelink.postgres.database.azure.com"].id
}
