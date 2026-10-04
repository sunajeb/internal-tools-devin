# Front Door

Creates Azure Front Door Premium, a web origin, HTTPS routing, WAF rules, and diagnostics.

## Key inputs

- `endpoint_name` must be globally unique.
- `web_default_hostname` selects the App Service origin.
- `rate_limit_threshold` sets requests allowed per minute.

## Outputs

The profile GUID, endpoint hostname, and endpoint ID.

## Important notes

The WAF blocks managed Default Rule Set and Bot Manager matches. It also applies a request rate limit.
The App Service allows traffic only from Front Door with the matching profile header.
