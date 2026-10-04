resource "azurerm_service_plan" "main" {
  name                   = "${var.name}-plan"
  resource_group_name    = var.resource_group_name
  location               = var.location
  os_type                = "Linux"
  sku_name               = "P1v3"
  worker_count           = var.worker_count
  zone_balancing_enabled = var.zone_balancing_enabled
  tags                   = var.tags
}

#trivy:ignore:AZU-0001
#trivy:ignore:AZU-0003
resource "azurerm_linux_web_app" "main" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  service_plan_id               = azurerm_service_plan.main.id
  https_only                    = true
  public_network_access_enabled = false
  virtual_network_subnet_id     = var.worker_subnet_id
  app_settings = {
    WEBSITES_PORT                         = tostring(var.websites_port)
    APPLICATIONINSIGHTS_CONNECTION_STRING = var.application_insights_connection_string
    NODE_ENV                              = "production"
    PGHOST                                = var.postgres_fqdn
    PGDATABASE                            = var.postgres_database_name
    PGSSLMODE                             = "require"
    PGUSER                                = var.name # The PostgreSQL Entra principal uses the worker app name.
  }

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                               = true
    minimum_tls_version                     = "1.2"
    scm_minimum_tls_version                 = "1.2"
    ftps_state                              = "Disabled"
    http2_enabled                           = true
    vnet_route_all_enabled                  = true
    app_command_line                        = var.worker_command
    health_check_path                       = "/healthz" # The worker must listen on WEBSITES_PORT and answer /healthz for App Service probes.
    health_check_eviction_time_in_min       = 5
    ip_restriction_default_action           = "Deny"
    scm_ip_restriction_default_action       = "Deny"
    container_registry_use_managed_identity = true
    auto_heal_setting {
      trigger {
        requests {
          count    = 10
          interval = "00:05:00"
        }
      }
      action {
        action_type = "Recycle"
      }
    }
    application_stack {
      docker_image_name   = var.image
      docker_registry_url = "https://${var.acr_login_server}"
    }
  }

  tags = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

resource "azurerm_monitor_diagnostic_setting" "main" {
  name                       = "${var.name}-diagnostics"
  target_resource_id         = azurerm_linux_web_app.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_log {
    category = "AppServiceAppLogs"
  }
  enabled_metric {
    category = "AllMetrics"
  }
}
