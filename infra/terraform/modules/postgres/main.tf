resource "terraform_data" "dns_link" {
  input = var.private_dns_zone_link_id
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  version                       = "16"
  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false
  sku_name                      = var.sku_name
  storage_mb                    = var.storage_mb
  auto_grow_enabled             = true
  zone                          = "1"
  backup_retention_days         = 35
  geo_redundant_backup_enabled  = true
  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = var.password_auth_enabled
    tenant_id                     = var.tenant_id
  }

  dynamic "high_availability" {
    for_each = var.high_availability_enabled ? [true] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = "2"
    }
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      zone,
      high_availability[0].standby_availability_zone,
    ]
    precondition {
      condition     = !var.high_availability_enabled || !startswith(var.sku_name, "B_")
      error_message = "High availability requires a non-Burstable PostgreSQL SKU."
    }
  }

  depends_on = [terraform_data.dns_link]
  tags       = var.tags
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "main" {
  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  object_id           = var.entra_admin_object_id
  principal_name      = var.entra_admin_principal_name
  principal_type      = "Group"
}

resource "azurerm_postgresql_flexible_server_configuration" "main" {
  for_each = {
    require_secure_transport     = "on"
    log_connections              = "on"
    log_disconnections           = "on"
    log_checkpoints              = "on"
    "connection_throttle.enable" = "on"
  }

  name      = each.key
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = each.value
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "internal_tools"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_monitor_diagnostic_setting" "main" {
  name                       = "${var.name}-diagnostics"
  target_resource_id         = azurerm_postgresql_flexible_server.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
