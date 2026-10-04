resource "azurerm_service_plan" "main" {
  name                   = "${var.name}-plan"
  resource_group_name    = var.resource_group_name
  location               = var.location
  os_type                = "Linux"
  sku_name               = var.plan_sku
  worker_count           = var.worker_count
  zone_balancing_enabled = var.zone_balancing_enabled
  tags                   = var.tags
}

locals {
  app_settings = {
    WEBSITES_PORT                         = tostring(var.websites_port)
    APPLICATIONINSIGHTS_CONNECTION_STRING = var.application_insights_connection_string
    NODE_ENV                              = "production"
    PGHOST                                = var.postgres_fqdn
    PGDATABASE                            = var.postgres_database_name
    PGSSLMODE                             = "require"
    PGUSER                                = var.name # The PostgreSQL Entra principal uses the web app name.
    SESSION_SECRET                        = "@Microsoft.KeyVault(VaultName=${var.key_vault_name};SecretName=session-secret)"
    OIDC_CLIENT_SECRET                    = "@Microsoft.KeyVault(VaultName=${var.key_vault_name};SecretName=oidc-client-secret)"
    OIDC_CLIENT_ID                        = var.oidc_client_id
    OIDC_ISSUER                           = var.oidc_issuer
  }
}

# Front Door cannot present client certificates, and the Node service implements Entra OIDC itself.
#trivy:ignore:AZU-0001
#trivy:ignore:AZU-0003
# tflint-ignore: azurerm_app_service_missing_auto_heal_setting
resource "azurerm_linux_web_app" "main" {
  name                          = var.name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  service_plan_id               = azurerm_service_plan.main.id
  https_only                    = true
  public_network_access_enabled = true
  virtual_network_subnet_id     = var.app_integration_subnet_id
  client_affinity_enabled       = false
  app_settings                  = local.app_settings

  sticky_settings {
    app_setting_names = ["PGUSER"]
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
    health_check_path                       = "/healthz"
    health_check_eviction_time_in_min       = 5
    container_registry_use_managed_identity = true
    application_stack {
      docker_image_name   = var.image
      docker_registry_url = "https://${var.acr_login_server}"
    }
    ip_restriction_default_action = "Deny"
    ip_restriction {
      name        = "AllowFrontDoor"
      service_tag = "AzureFrontDoor.Backend"
      priority    = 100
      action      = "Allow"
      headers = [{
        x_azure_fdid      = [var.front_door_profile_guid]
        x_fd_health_probe = []
        x_forwarded_for   = []
        x_forwarded_host  = []
      }]
    }
    scm_ip_restriction_default_action = "Deny"
  }

  logs {
    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 35
      }
    }
  }

  tags = var.tags
}

# The staging slot uses the same Front Door and application-managed OIDC controls as production.
#trivy:ignore:AZU-0001
#trivy:ignore:AZU-0003
# tflint-ignore: azurerm_app_service_missing_auto_heal_setting
resource "azurerm_linux_web_app_slot" "staging" {
  name                          = "staging"
  app_service_id                = azurerm_linux_web_app.main.id
  https_only                    = true
  public_network_access_enabled = true
  virtual_network_subnet_id     = var.app_integration_subnet_id
  client_affinity_enabled       = false
  # Each slot has its own managed identity. Verify the principal name in Entra ID before you create the PostgreSQL role.
  app_settings = merge(local.app_settings, {
    PGUSER = "${var.name}/slots/staging"
  })

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
    health_check_path                       = "/healthz"
    health_check_eviction_time_in_min       = 5
    container_registry_use_managed_identity = true
    application_stack {
      docker_image_name   = var.image
      docker_registry_url = "https://${var.acr_login_server}"
    }
    ip_restriction_default_action = "Deny"
    ip_restriction {
      name        = "AllowFrontDoor"
      service_tag = "AzureFrontDoor.Backend"
      priority    = 100
      action      = "Allow"
      headers = [{
        x_azure_fdid      = [var.front_door_profile_guid]
        x_fd_health_probe = []
        x_forwarded_for   = []
        x_forwarded_host  = []
      }]
    }
    ip_restriction {
      name                      = "AllowDeploymentRunner"
      priority                  = 200
      action                    = "Allow"
      virtual_network_subnet_id = var.deployment_runner_subnet_id
    }
    scm_ip_restriction_default_action = "Deny"
  }

  logs {
    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 35
      }
    }
  }

  tags = var.tags
  # Run /healthz from the deployment runner before swapping slots.
}

resource "azurerm_role_assignment" "acr_pull_web" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

resource "azurerm_role_assignment" "acr_pull_staging" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app_slot.staging.identity[0].principal_id
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
