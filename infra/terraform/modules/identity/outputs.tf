output "client_id" {
  value = azuread_application.main.client_id
}

output "issuer_url" {
  value = "https://login.microsoftonline.com/${var.tenant_id}/v2.0"
}
