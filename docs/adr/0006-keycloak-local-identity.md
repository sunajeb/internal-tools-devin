# ADR 0006: Keycloak for local identity

Status: accepted.

## Context

The session code must use the real OIDC protocol. The prototype must run without company accounts or secrets.

## Decision

Run a local Keycloak realm (`infra/keycloak/internal-tools-realm.json`) with seeded users and groups. The API is a confidential OIDC client and keeps tokens on the server. The API maps IdP groups to tool roles at sign-in. Sign out also ends the Keycloak session.

## Consequences

- The local session code is the same code that production uses with a different IdP.
- Sessions end after 30 minutes without activity or 8 hours in total.
- The API does not re-check the IdP during a session. A user removed from a group keeps access until the session ends.
- The production IdP (for example Entra ID), MFA and conditional access are client-owned.
