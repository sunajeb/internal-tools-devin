output "metric_alert_ids" {
  value = [
    azurerm_monitor_metric_alert.web_http5xx.id,
    azurerm_monitor_metric_alert.web_response_time.id,
    azurerm_monitor_metric_alert.postgres_cpu.id,
    azurerm_monitor_metric_alert.postgres_storage.id,
    azurerm_monitor_scheduled_query_rules_alert_v2.outbox_failed.id,
  ]
}
