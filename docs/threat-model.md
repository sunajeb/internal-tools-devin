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

| Threat                 | Example                                                           | Control                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | A forged webhook claims that a refund succeeded.                  | Check the HMAC signature and timestamp. Store each provider event once. Reconcile with provider records.                    |
| Tampering              | A database operator changes an audit event.                       | Append-only trigger, SHA-256 chain, transaction advisory lock and hourly anchor export. Verify and alert on a broken chain. |
| Repudiation            | An approver denies an approval.                                   | Record actor, roles, request ID, source IP, user agent, result and event hash.                                              |
| Information disclosure | An agent exports customer email addresses.                        | Server-side export permission, masking, audited reveal and export. Do not store PAN or bank account numbers.                |
| Denial of service      | An attacker floods the approval or search endpoints.              | Rate limits, bounded request sizes, query timeout, WAF in production and operational alerts.                                |
| Elevation of privilege | A user with Agent and Supervisor roles approves their own refund. | Server-side permission checks, requester comparison, unique approval constraints and audit of denied attempts.              |

## Abuse cases

1. Reuse an idempotency key with another request body. The API must refuse the mismatch.
2. Submit simultaneous refunds against one charge. A charge row lock and balance constraint must allow only the available amount.
3. Replay an old or duplicate webhook. The timestamp and inbox primary key must refuse a second effect.
4. Pause execution during a provider incident. The worker must leave approved work queued.
5. Leak a session cookie. Use an HTTP-only, SameSite cookie, CSRF double-submit token, short idle timeout and TLS in production.

## Residual risk

The local simulator, development identity provider and local secrets do not prove production controls. Production requires managed secrets, TLS, network isolation, WORM storage, SIEM forwarding, penetration testing and a provider contract test.
