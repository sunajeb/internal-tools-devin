resource "azurerm_virtual_network" "main" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = var.address_space
  tags                = var.tags
}

locals {
  subnet_data = {
    app_integration = {
      name             = "${var.name}-app-integration"
      address_prefixes = [var.app_integration_prefix]
      delegation       = "Microsoft.Web/serverFarms"
    }
    worker = {
      name             = "${var.name}-worker"
      address_prefixes = [var.worker_prefix]
      # Each App Service plan can integrate with only one subnet.
      delegation = "Microsoft.Web/serverFarms"
    }
    private_endpoints = {
      name             = "${var.name}-private-endpoints"
      address_prefixes = [var.private_endpoints_prefix]
      delegation       = null
    }
    postgres = {
      name             = "${var.name}-postgres"
      address_prefixes = [var.postgres_prefix]
      delegation       = "Microsoft.DBforPostgreSQL/flexibleServers"
    }
  }
}

resource "azurerm_subnet" "main" {
  for_each = local.subnet_data

  name                              = each.value.name
  resource_group_name               = var.resource_group_name
  virtual_network_name              = azurerm_virtual_network.main.name
  address_prefixes                  = each.value.address_prefixes
  private_endpoint_network_policies = each.key == "private_endpoints" ? "NetworkSecurityGroupEnabled" : "Disabled"

  dynamic "delegation" {
    for_each = each.value.delegation == null ? [] : [each.value.delegation]
    content {
      name = "delegation"
      service_delegation {
        name    = delegation.value
        actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
      }
    }
  }
}

resource "azurerm_network_security_group" "main" {
  for_each = local.subnet_data

  name                = "${each.value.name}-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_network_security_rule" "postgres_from_app" {
  name                        = "AllowPostgresFromApp"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "5432"
  source_address_prefixes     = [var.app_integration_prefix, var.worker_prefix]
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.main["postgres"].name
}

resource "azurerm_network_security_rule" "postgres_deny_vnet" {
  name                        = "DenyOtherVNetInbound"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.main["postgres"].name
}

resource "azurerm_network_security_rule" "pe_https_from_app" {
  name                        = "AllowHttpsFromApp"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefixes     = [var.app_integration_prefix, var.worker_prefix]
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.main["private_endpoints"].name
}

resource "azurerm_network_security_rule" "pe_deny_vnet" {
  name                        = "DenyOtherVNetInbound"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.main["private_endpoints"].name
}

resource "azurerm_network_security_rule" "app_deny_vnet" {
  for_each = toset(["app_integration", "worker"])

  name                        = "DenyVNetInbound"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.main[each.value].name
}

resource "azurerm_subnet_network_security_group_association" "main" {
  for_each = azurerm_subnet.main

  subnet_id                 = each.value.id
  network_security_group_id = azurerm_network_security_group.main[each.key].id
}

resource "azurerm_private_dns_zone" "main" {
  for_each = toset([
    "privatelink.postgres.database.azure.com",
    "privatelink.vaultcore.azure.net",
    "privatelink.blob.core.windows.net",
  ])

  name                = each.value
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "main" {
  for_each = azurerm_private_dns_zone.main

  name                  = "${var.name}-${replace(each.key, ".", "-")}-link"
  resource_group_name   = var.resource_group_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false
  tags                  = var.tags
}
