# Monitoring

Creates Log Analytics, workspace-based Application Insights, and an email action group.

## Key inputs

- `retention_days` controls Log Analytics retention.
- `alert_email` receives alert notifications.
- `alert_short_name` must contain no more than 12 characters.

## Outputs

Workspace ID, Application Insights ID and connection string, and action group ID.

## Important notes

Metric and query alerts are in the separate `alerts` module. This separation avoids a dependency cycle with the web app.
