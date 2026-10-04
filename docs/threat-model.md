# Threat model

## Scope

The prototype contains the Foundation, Refunds Console, Keycloak, a payment simulator, a worker, Postgres and a browser client. Production uses an external identity provider, a payment provider, private network paths and immutable storage.

## Assets and trust boundaries

- Refund amounts, charge references and customer contact data.
- Approval decisions, policy versions and session identities.
- Audit events, provider credentials and webhook signing keys.
- Browser to API, API to database, worker to provider, and provider to webhook boundaries.

The browser is untrusted. API input is untrusted. Only the IdP authenticates a user. The API and database enforce authorization and money rules. The payment simulator is a local stand-in, not a production provider.

## STRIDE

| Threat                 | Example                                                           | Control                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spoofing               | A forged webhook claims that a refund succeeded.                  | Check the HMAC signature and timestamp. Store each provider event once. Reconcile with provider records.                                                                                                                                                                                                                                               |
| Tampering              | A database operator changes an audit event.                       | Runtime role without `UPDATE` or `DELETE`, append-only trigger, SHA-256 chain and transaction advisory lock. **Verify chain** finds the first broken event. The hash is not keyed: an owner who rewrites the full chain is not detected. Production needs an external immutable copy of the chain head. The prototype has no head export and no alert. |
| Repudiation            | An approver denies an approval.                                   | Record actor, roles, request ID, source IP, user agent, result and event hash.                                                                                                                                                                                                                                                                         |
| Information disclosure | An agent exports customer email addresses.                        | Server-side export permission, masking, audited reveal and export. Do not store PAN or bank account numbers.                                                                                                                                                                                                                                           |
| Denial of service      | An attacker floods the approval or search endpoints.              | Rate limit (200 requests each minute), bounded request sizes and a 5-second statement timeout. A WAF and alerts are production work.                                                                                                                                                                                                                   |
| Elevation of privilege | A user with Agent and Supervisor roles approves their own refund. | Server-side permission checks, requester comparison, unique approval constraints and audit of denied attempts.                                                                                                                                                                                                                                         |

## Abuse cases

1. Reuse an idempotency key with another request body. The API must refuse the mismatch.
2. Submit simultaneous refunds against one charge. A charge row lock and balance constraint must allow only the available amount.
3. Replay an old or duplicate webhook. The timestamp and inbox primary key must refuse a second effect.
4. Pause execution during a provider incident. The worker must leave approved work queued.
5. Leak a session cookie. Use an HTTP-only, SameSite cookie, CSRF double-submit token, short idle timeout and TLS in production.

## Residual risk

The local simulator, development identity provider and local secrets do not prove production controls. Production requires managed secrets, TLS, network isolation, WORM storage, SIEM forwarding, penetration testing and a provider contract test.

Known limits:

- The audit hash chain is not keyed. It needs an external head anchor.
- Exactly-once applies to one refund ID, not to one customer intent.
- All tools share the database role `app_runtime`. A defect in one tool can reach the data of other tools.
- The API does not re-check the IdP during a session. Removed users keep access until the session ends (30 minutes idle, 8 hours total).
- The payment provider is simulated. There is no live Azure deployment. The Terraform is validated only.
