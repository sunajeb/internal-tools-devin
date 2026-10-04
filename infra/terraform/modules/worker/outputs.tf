output "id" {
  value = azurerm_linux_web_app.main.id
}

output "principal_id" {
  value = azurerm_linux_web_app.main.identity[0].principal_id
}
