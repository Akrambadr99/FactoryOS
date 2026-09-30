# FactoryOS

Manufacturing execution and factory operations. A local-first React 19 operations platform with typed records, versioned commands, role-separated workflow transitions, cross-record validation, retry-safe receipts, immutable audit evidence, analytics, and direct Chromium journeys.

## Runtime

- Node 20.19.x
- npm 10.8.2
- npm ci
- npm run check
- npm run test:e2e

No external service is required. All deterministic fixtures and persistence adapters are local.

## Material reservations

An optional local Node service supports persistent material holds, shared-stock validation, revision conflict recovery and retry-safe receipts. Open **Reservations** in the product navigation. Inventory is explicitly simulated, and this separate ledger does not automatically release existing browser execution gates.

See [the material reservation runbook](docs/material-reservations.md) for startup commands, persistence and recovery limits, workflow behavior and the next backend phases. `npm run check` validates the browser and server; `npm run test:e2e` includes real-service Chromium journeys.
