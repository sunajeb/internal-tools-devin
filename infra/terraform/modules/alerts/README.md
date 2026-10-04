# Alerts

Creates web and PostgreSQL metric alerts, plus an Application Insights outbox query alert.

## Key inputs

- `web_app_id`, `postgres_server_id`, and `application_insights_id` set alert scopes.
- `action_group_id` receives all alert notifications.
- Web alert thresholds can be adjusted with input values.

## Outputs

All alert resource IDs.

## Important notes

The application must emit the `outbox_failed_total` custom metric for the query alert to fire.
This module stays separate from monitoring resources to avoid a web app dependency cycle.
