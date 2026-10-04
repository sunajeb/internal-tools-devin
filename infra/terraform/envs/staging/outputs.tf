output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "web_url" {
  value = "https://${module.front_door.endpoint_hostname}"
}

output "worker_id" {
  value = module.worker.id
}

output "postgres_fqdn" {
  value = module.postgres.fqdn
}

output "key_vault_uri" {
  value = module.key_vault.vault_uri
}
