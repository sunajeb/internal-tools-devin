resource "azurerm_monitor_metric_alert" "web_http5xx" {
  name                = "${var.name}-web-http5xx"
  resource_group_name = var.resource_group_name
  scopes              = [var.web_app_id]
  description         = "Web application HTTP 5xx count exceeded the threshold."
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = var.http5xx_threshold
  }
  action {
    action_group_id = var.action_group_id
  }
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "web_response_time" {
  name                = "${var.name}-web-response-time"
  resource_group_name = var.resource_group_name
  scopes              = [var.web_app_id]
  description         = "Web application response time exceeded the threshold."
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "HttpResponseTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = var.http_response_time_threshold
  }
  action {
    action_group_id = var.action_group_id
  }
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  name                = "${var.name}-postgres-cpu"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL CPU usage exceeded 80 percent."
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = var.action_group_id
  }
  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "postgres_storage" {
  name                = "${var.name}-postgres-storage"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = "PostgreSQL storage usage exceeded 80 percent."
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = var.action_group_id
  }
  tags = var.tags
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "outbox_failed" {
  name                 = "${var.name}-outbox-failed"
  resource_group_name  = var.resource_group_name
  location             = "global"
  scopes               = [var.application_insights_id]
  description          = "Outbox delivery failures were reported."
  severity             = 2
  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  criteria {
    query                   = "customMetrics | where name == \"outbox_failed_total\" | summarize failed = max(value)"
    time_aggregation_method = "Maximum"
    metric_measure_column   = "failed"
    operator                = "GreaterThan"
    threshold               = 0
    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }
  action {
    action_groups = [var.action_group_id]
  }
  tags = var.tags
}
