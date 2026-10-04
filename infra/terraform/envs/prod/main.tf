locals {
  env_octet = {
    dev     = "10"
    staging = "20"
    prod    = "30"
  }[var.environment]

  base_name                = "${var.project}-${var.environment}-${var.unique_suffix}"
  resource_group           = "${local.base_name}-rg"
  key_vault_name           = "${local.base_name}-kv"
  registry_name            = "${var.project}${var.environment}${var.unique_suffix}"
  storage_name             = "${var.project}${var.environment}${var.unique_suffix}sa"
  web_app_name             = "${local.base_name}-web"
  worker_app_name          = "${local.base_name}-worker"
  postgres_name            = "${local.base_name}-pg"
  front_door_name          = "${local.base_name}-fd"
  front_door_endpoint_name = "${local.base_name}-fd"
  tags = {
    env         = var.environment
    owner       = var.owner
    data_class  = var.data_class
    cost_center = var.cost_center
  }
}

resource "azurerm_resource_group" "main" {
  name     = local.resource_group
  location = var.location
  tags     = local.tags
}

module "network" {
  source                   = "../../modules/network"
  name                     = "${local.base_name}-vnet"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = var.location
  address_space            = ["10.${local.env_octet}.0.0/16"]
  app_integration_prefix   = "10.${local.env_octet}.1.0/26"
  worker_prefix            = "10.${local.env_octet}.2.0/26"
  private_endpoints_prefix = "10.${local.env_octet}.3.0/27"
  postgres_prefix          = "10.${local.env_octet}.4.0/27"
  tags                     = local.tags
}

module "monitoring" {
  source              = "../../modules/monitoring"
  name                = local.base_name
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  retention_days      = 90
  alert_email         = var.alert_email
  alert_short_name    = var.alert_short_name
  tags                = local.tags
}

module "registry" {
  source                     = "../../modules/registry"
  name                       = local.registry_name
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  zone_redundancy_enabled    = var.environment == "prod"
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  tags                       = local.tags
}

module "front_door" {
  source                     = "../../modules/front_door"
  name                       = local.front_door_name
  endpoint_name              = local.front_door_endpoint_name
  resource_group_name        = azurerm_resource_group.main.name
  web_default_hostname       = module.app_service.default_hostname
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  tags                       = local.tags
}

module "app_service" {
  source                                 = "../../modules/app_service"
  name                                   = local.web_app_name
  resource_group_name                    = azurerm_resource_group.main.name
  location                               = var.location
  plan_sku                               = "P1v3"
  zone_balancing_enabled                 = var.environment == "prod"
  worker_count                           = var.environment == "prod" ? 3 : 1
  app_integration_subnet_id              = module.network.app_integration_subnet_id
  acr_id                                 = module.registry.id
  acr_login_server                       = module.registry.login_server
  image                                  = var.image
  front_door_profile_guid                = module.front_door.profile_guid
  websites_port                          = var.websites_port
  application_insights_connection_string = module.monitoring.application_insights_connection_string
  log_analytics_workspace_id             = module.monitoring.log_analytics_workspace_id
  postgres_fqdn                          = module.postgres.fqdn
  postgres_database_name                 = module.postgres.database_name
  key_vault_name                         = local.key_vault_name
  oidc_client_id                         = module.identity.client_id
  oidc_issuer                            = module.identity.issuer_url
  tags                                   = local.tags
}

module "worker" {
  source                                 = "../../modules/worker"
  name                                   = local.worker_app_name
  resource_group_name                    = azurerm_resource_group.main.name
  location                               = var.location
  worker_subnet_id                       = module.network.worker_subnet_id
  acr_id                                 = module.registry.id
  acr_login_server                       = module.registry.login_server
  image                                  = var.image
  worker_command                         = var.worker_command
  websites_port                          = var.websites_port
  postgres_fqdn                          = module.postgres.fqdn
  postgres_database_name                 = module.postgres.database_name
  key_vault_name                         = local.key_vault_name
  oidc_client_id                         = module.identity.client_id
  oidc_issuer                            = module.identity.issuer_url
  application_insights_connection_string = module.monitoring.application_insights_connection_string
  log_analytics_workspace_id             = module.monitoring.log_analytics_workspace_id
  zone_balancing_enabled                 = var.environment == "prod"
  tags                                   = local.tags
}

module "postgres" {
  source                     = "../../modules/postgres"
  name                       = local.postgres_name
  resource_group_name        = azurerm_resource_group.main.name
  location                   = var.location
  delegated_subnet_id        = module.network.postgres_subnet_id
  private_dns_zone_id        = module.network.postgres_dns_zone_id
  private_dns_zone_link_id   = module.network.postgres_dns_zone_link_id
  sku_name                   = var.environment == "dev" ? "B_Standard_B2s" : "GP_Standard_D2ds_v5"
  storage_mb                 = var.postgres_storage_mb
  high_availability_enabled  = var.environment == "prod"
  password_auth_enabled      = false
  tenant_id                  = var.tenant_id
  entra_admin_object_id      = var.entra_admin_object_id
  entra_admin_principal_name = var.entra_admin_principal_name
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  tags                       = local.tags
}

module "key_vault" {
  source                      = "../../modules/key_vault"
  name                        = local.key_vault_name
  resource_group_name         = azurerm_resource_group.main.name
  location                    = var.location
  private_endpoints_subnet_id = module.network.private_endpoints_subnet_id
  private_dns_zone_id         = module.network.key_vault_dns_zone_id
  secret_reader_principal_ids = {
    web         = module.app_service.principal_id
    web_staging = module.app_service.staging_principal_id
    worker      = module.worker.principal_id
  }
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  tags                       = local.tags
}

module "storage_worm" {
  source                      = "../../modules/storage_worm"
  name                        = local.storage_name
  resource_group_name         = azurerm_resource_group.main.name
  location                    = var.location
  replication_type            = var.environment == "prod" ? "GZRS" : "ZRS"
  retention_days              = var.environment == "prod" ? 2555 : var.environment == "staging" ? 7 : 1
  immutability_locked         = var.environment == "prod"
  private_endpoints_subnet_id = module.network.private_endpoints_subnet_id
  private_dns_zone_id         = module.network.blob_dns_zone_id
  log_analytics_workspace_id  = module.monitoring.log_analytics_workspace_id
  tags                        = local.tags
}

module "identity" {
  source                           = "../../modules/identity"
  display_name                     = "${local.base_name}-oidc"
  tenant_id                        = var.tenant_id
  redirect_uri                     = "https://${module.front_door.endpoint_hostname}/auth/callback"
  key_vault_id                     = module.key_vault.id
  secret_writer_role_assignment_id = module.key_vault.deployer_role_assignment_id
  tags                             = local.tags
}

module "alerts" {
  source                  = "../../modules/alerts"
  name                    = local.base_name
  resource_group_name     = azurerm_resource_group.main.name
  web_app_id              = module.app_service.id
  postgres_server_id      = module.postgres.id
  application_insights_id = module.monitoring.application_insights_id
  action_group_id         = module.monitoring.action_group_id
  tags                    = local.tags
}
