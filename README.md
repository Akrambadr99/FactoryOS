# FactoryOS

Manufacturing execution and factory operations. A local-first React 19 operations platform with typed records, versioned commands, role-separated workflow transitions, cross-record validation, retry-safe receipts, immutable audit evidence, analytics, and direct Chromium journeys.

## Runtime

- Node 24.16+ within the Node 24 LTS line; npm 11.13.0
- Install with `npm ci --no-audit --no-fund`. Project configuration disables dependency lifecycle hooks; explicit application scripts still run. See the migration runbook before changing native dependencies or runtimes.
- `npm run check`
- `npm run test:e2e`

No external service is required. All deterministic fixtures and persistence adapters are local.

## Material reservations

An optional local Node service stores material holds, revision conflict state and retry receipts in a transactional SQLite database. Open **Reservations** in the product navigation. Inventory is explicitly simulated, and this separate ledger does not automatically release existing browser execution gates. Existing JSON ledgers require a reviewed preview and explicit checksum-confirmed migration; they are never automatically replaced.

See [the material reservation runbook](docs/material-reservations.md) for startup commands, persistence and recovery limits, workflow behavior and the next backend phases. `npm run check` validates the browser and server; `npm run test:e2e` includes real-service Chromium journeys.

See [the explicit SQLite migration procedure](docs/sqlite-reservation-migration.md) before upgrading an existing ledger, and [the SQLite phase validation report](docs/sqlite-reservations-validation.md) for measured results and remaining limits.

Order synchronization now has a [read-only change review](docs/order-sync-review.md), removal acknowledgment and stale-source protection before explicit confirmation. This does not move browser order ownership to the service. See [the order review validation report](docs/order-sync-review-validation.md) for current checks and visual evidence.
