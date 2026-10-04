output "profile_guid" {
  value = azurerm_cdn_frontdoor_profile.main.resource_guid
}

output "endpoint_hostname" {
  value = azurerm_cdn_frontdoor_endpoint.main.host_name
}

output "endpoint_id" {
  value = azurerm_cdn_frontdoor_endpoint.main.id
}
