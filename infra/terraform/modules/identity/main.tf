data "azurerm_client_config" "current" {}

resource "azuread_application" "main" {
  display_name            = var.display_name
  sign_in_audience        = "AzureADMyOrg"
  group_membership_claims = ["SecurityGroup"]
  owners                  = [data.azurerm_client_config.current.object_id]
  tags                    = [for key, value in var.tags : "${key}=${value}"]

  web {
    redirect_uris = [var.redirect_uri]
    implicit_grant {
      access_token_issuance_enabled = false
      id_token_issuance_enabled     = false
    }
  }

  optional_claims {
    id_token {
      name = "groups"
    }
  }

  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000"
    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"
      type = "Scope"
    }
  }
}

resource "azuread_service_principal" "main" {
  # Only assigned groups can sign in.
  client_id                    = azuread_application.main.client_id
  app_role_assignment_required = true
  tags                         = [for key, value in var.tags : "${key}=${value}"]
}

resource "azuread_app_role_assignment" "allowed_groups" {
  for_each            = toset(var.allowed_group_object_ids)
  app_role_id         = "00000000-0000-0000-0000-000000000000"
  principal_object_id = each.value
  resource_object_id  = azuread_service_principal.main.object_id
}

resource "time_rotating" "oidc" {
  rotation_days = 180
}

resource "azuread_application_password" "oidc" {
  application_id = azuread_application.main.id
  display_name   = "terraform-rotating-client-secret"
  end_date       = timeadd(time_rotating.oidc.rotation_rfc3339, "4320h")

  rotate_when_changed = {
    rotation = time_rotating.oidc.id
  }
}

resource "terraform_data" "secret_writer_role" {
  input = {
    role_assignment = var.secret_writer_role_assignment_id
    network         = var.key_vault_network_dependency_ids
  }
}

resource "time_sleep" "rbac_propagation" {
  create_duration = "120s"
  depends_on      = [terraform_data.secret_writer_role]
}

# The secret expires with its rotating Entra application password.
#trivy:ignore:AZU-0017
resource "azurerm_key_vault_secret" "oidc_client_secret" {
  name            = "oidc-client-secret"
  key_vault_id    = var.key_vault_id
  value           = azuread_application_password.oidc.value
  content_type    = "OIDC client secret"
  expiration_date = azuread_application_password.oidc.end_date
  tags            = var.tags
  depends_on      = [time_sleep.rbac_propagation]

  lifecycle {
    prevent_destroy = true
  }
}
