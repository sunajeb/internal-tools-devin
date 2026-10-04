resource "azurerm_container_registry" "main" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  sku                           = "Premium"
  admin_enabled                 = false
  anonymous_pull_enabled        = false
  zone_redundancy_enabled       = var.zone_redundancy_enabled
  public_network_access_enabled = true
  retention_policy_in_days      = 7

  tags = var.tags
}

resource "azurerm_monitor_diagnostic_setting" "main" {
  name                       = "${var.name}-diagnostics"
  target_resource_id         = azurerm_container_registry.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
