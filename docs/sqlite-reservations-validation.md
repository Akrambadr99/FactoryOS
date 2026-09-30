# SQLite reservation validation

FactoryOS now uses a transactional SQLite reservation ledger with an explicit, checksum-confirmed upgrade path for existing JSON ledgers. This phase changes FactoryOS only, starting from commit `4766aed8ffc2f9b5092acaf515b214351ed67625`. All local gates passed on Windows with Node 24.16.0 and npm 11.13.0. No operational ledger was initialized or migrated, and no code was pushed or deployed.

## Delivered changes

- Separate constrained tables for orders, lots, reservations, events, receipts and migration metadata; atomic commands retain revision and retry semantics.
- Read-only legacy preview, explicit reviewed-checksum apply, exclusive ownership, non-overwriting publication and exact source preservation. Reapplying a completed migration does not restore stale state.
- Rejection of unsupported schemas, damaged state, interrupted artifacts and unexpected filenames without automatic reset or repair.
- A built migration CLI, sanitized startup errors and keyboard-accessible upgrade guidance that makes no request before explicit connection.
- Node 24 runtime configuration, pinned SQLite driver and Windows/Linux CI configuration. Other portfolio runtimes remain unchanged.

## Measured local results

| Gate | Result |
| --- | --- |
| Clean locked install | `npm ci --no-audit --no-fund` passed with the committed project configuration; native SQLite smoke test passed |
| Runtime | Node 24.16.0, npm 11.13.0, better-sqlite3 13.0.3, SQLite 3.53.4 |
| Architecture tests | 37 passed |
| Frontend dependency boundaries | 153 production modules and 268 resolved first-party dependencies; no runtime cycles or boundary violations |
| ESLint | Passed with zero allowed warnings |
| Application Vitest | 601 passed across 105 files |
| Server Vitest | 106 passed across five files |
| Frontend and server TypeScript | Passed |
| Frontend production build | Passed; entry budget 335.85 KiB raw / 103.21 KiB gzip, below 450 / 130 KiB limits |
| Server production build | Passed for both service and migration CLI entries |
| Chromium | 52 passed, retaining all 46 earlier product journeys and six reservation journeys |
| Production dependency audit | `npm audit --omit=dev --audit-level=high --json` reported zero vulnerabilities at the time of validation |
| Hosted CI | Configured and YAML structure checked; not executed |

Server tests comprise 22 retained JSON integration cases, 16 low-level SQLite cases, 35 filesystem and migration cases, 18 CLI and built-entry cases, and 15 SQLite HTTP cases. These are test counts, not code-coverage percentages. No new coverage percentage, Linux execution, non-Chromium browser support or complete security assurance is claimed.

The final complete commands were `npm run check` followed by `npm run test:e2e`, both successful. Local ignored output files are `factoryos-sqlite-check.log` and `factoryos-sqlite-e2e.log`. CLI tests invoke the built entrypoints in child processes and use isolated temporary directories, as do browser service fixtures. The repository's operational `.factoryos-data` directory was absent after validation.

## Integrity and interaction evidence

Independent review reproduced two integrity defects during development. Opening an existing WAL-format database could rewrite its header before rejecting migration; existing-file header checks now run before the native database is opened, with unchanged bytes and directory contents verified. Case-variant reserved filenames could bypass a legacy-writer guard on Windows; case-safe guards and regression tests now prevent that alternate ledger from being written. Neither fix deletes or normalizes rejected data.

Browser reservation fixtures now verify the actual SQLite file header and absence of a JSON ledger for new directories. The first journey opens the upgrade guidance with Enter and confirms no API request or ledger revision change occurs before explicit connection. Existing journeys still exercise competing views, draft preservation, exact-request retry after a lost response, focus recovery, filtering, selection and persistence.

Responsive screenshots are regenerated at `test-results/reservations-1440.png`, `test-results/reservations-820.png` and `test-results/reservations-390.png`. They are local ignored artifacts, not committed assets. The final tablet screenshot was inspected; automated journeys also passed narrow-width overflow and keyboard checks.

## Installation and operational limits

The project `.npmrc` enforces the supported runtime and disables dependency install hooks. A plain clean install initially attempted an unnecessary native rebuild with npm 11.13.0; the committed install policy uses the locked dependencies' prebuilt assets. A subsequent standard clean install and the entire validation suite passed. Explicit application scripts still run. This policy must be reviewed on dependency upgrades; no installed dependency source was patched to obtain a passing result.

The GitHub workflow pins action revisions, grants read-only repository permissions and defines Windows/Linux jobs. There is no configured Git remote in this checkout, so neither hosted results nor remote HEAD equality are available.

This remains a bounded local single-owner pilot with simulated inventory and explicit browser-order synchronization. It does not provide authentication, authoritative production inventory, multi-process operation, automatic backups or a cloud deployment. Network filesystems and power-loss recovery have not been validated. The next phase should establish authoritative order and inventory ownership with a reviewed migration contract before enabling multi-user workflows.

Use [the migration runbook](sqlite-reservation-migration.md) before upgrading a real ledger. Keep the exact original JSON source with a migrated database; never run an older JSON writer against that directory. This implementation and its tests used AI assistance. These changes do not establish historical human authorship, production use or eligibility for external codebase licensing.
