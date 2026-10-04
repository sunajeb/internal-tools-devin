# ADR 0001: TypeScript with Fastify and React

Status: accepted.

## Context

The prototype has an API, a worker, a payment simulator and a browser console. Money amounts and policy rules need strong types. One small team maintains all parts.

## Decision

Use TypeScript in all parts. Use Fastify for the HTTP services. Use React with Vite for the console. Use Zod schemas for route input.

## Consequences

- One language and one type checker (`npm run typecheck`) cover all code.
- Shared packages (`packages/foundation`, `packages/ui-kit`) work in the API, the worker and the browser.
- The team must keep Node.js at version 22 (`.nvmrc`). Engine errors occur on other versions.
