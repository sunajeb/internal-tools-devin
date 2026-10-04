resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.name}-law"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_days
  tags                = var.tags
}

resource "azurerm_application_insights" "main" {
  name                = "${var.name}-appi"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = var.tags
}

resource "azurerm_monitor_action_group" "main" {
  name                = "${var.name}-alerts"
  resource_group_name = var.resource_group_name
  short_name          = var.alert_short_name

  email_receiver {
    name                    = "primary"
    email_address           = var.alert_email
    use_common_alert_schema = true
  }

  tags = var.tags
}
