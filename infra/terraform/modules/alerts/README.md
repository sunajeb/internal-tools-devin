# Alerts

Creates web and PostgreSQL metric alerts, plus an Application Insights outbox query alert.

## Key inputs

- `web_app_id`, `postgres_server_id`, and `application_insights_id` set alert scopes.
- `action_group_id` receives all alert notifications.
- Web alert thresholds can be adjusted with input values.

## Outputs

All alert resource IDs.

## Important notes

The app must emit `outbox_failed_total` as an OpenTelemetry counter through the Azure Monitor exporter. The exporter sends the increment for each interval (delta temporality). The alert adds the values in a 10-minute window and fires when the total is more than 0.
This module stays separate from monitoring resources to avoid a web app dependency cycle.
