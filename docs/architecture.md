# Architecture

FactoryOS uses a strict command boundary: React route -> repository -> optimistic revision check -> role/state policy -> domain validation -> immutable snapshot and audit receipt. The eight workflow policies are independent domain modules and the shared capabilities cover scheduling, search, imports, comments, approvals, retry, outbox, synchronization, reporting, migration, feature flags, pagination, activity queries, and accessible interaction state.

## Storage capability boundary

The dependency-free `src/platform/storage-port.ts` owns three structural interfaces: `StorageReader` exposes only `getItem`, `StorageWriter` only `setItem`, and `StoragePort` combines both. Readers import the contract directly instead of depending on the concrete workspace repository. Its previous `StoragePort` type export remains available for compatibility.

For FactoryOS, the collection and legacy readers in `src/execution/order-machine` project orders and lot genealogy. They, validated reads, and snapshot export/comparison accept a getItem-only provider. Saving collections, executing commands, and binding editable records still require the writable port. Selected-record decoders no longer receive artificial throwing writer stubs. Storage keys, persisted shapes, validation, revision checks, and audit history are unchanged.

This is a compile-time capability boundary, not a runtime security sandbox. A browser Storage object remains structurally compatible. Role choices are still local workflow simulations. The earlier storage-port refactor did not add authenticated services or transactional backend persistence; the separate reservation ledger now has the SQLite boundary described below, still without authentication. Collection and older single-record workflows retain their existing synchronization limits.

## Automated dependency checks

Run `npm run architecture` to inspect the resolved production dependency graph. Run `npm run test:architecture` to exercise the checker itself. Both now run before lint, Vitest, TypeScript and build/budget checks in `npm run check`; Chromium remains `npm run test:e2e`.

The checker resolves imports, re-exports, import types, aliases, index modules and literal dynamic imports through TypeScript. It rejects runtime cycles, missing or excluded test dependencies, first-party paths outside src, and dependencies from shared workspace/platform/capabilities/components/interaction modules into product or application implementations. Explicit type-only cycles are allowed, but type dependencies still obey layer boundaries. The storage contract may not import any dependency.

Non-JSX source modules cannot depend on React or UI integration. Seven existing composition modules are explicit exceptions: application context, services and useAppServices; workspace useCollectionExplorer; features/decision-workbench useWorkbenchActions; state useWorkbench and workbenchContext. Adding an exception requires an intentional architecture decision and regression coverage.

Computed loaders, import.meta.glob, query/hash imports and source symlinks fail closed. This is a conservative first-party import-graph check, not general JavaScript execution analysis, security certification, or a scan of dependency internals.

## Material reservation boundary

The optional local reservation service owns a separate SQLite ledger for stock holds and retry receipts. `src/execution/materials/reservations.ts` defines pure commands, state validation and replay; `reservationClient.ts` validates HTTP responses; `ReservationsPage.tsx` owns draft and navigation state. `server/reservationDatabase.ts` owns the constrained schema and transactions; `sqliteReservationStore.ts` owns directory locking and explicit legacy migration; the HTTP service owns the loopback request boundary. The server and pure domain modules do not import UI modules. The previous JSON adapter remains for migration fixtures and regression verification, and refuses new writes after SQLite publication.

Order references cross this boundary only through explicit validated synchronization. The browser remains authoritative for the older execution workflow, and demo reservation stock is not the genealogy index. No automatic dual write or execution release is performed. See [material reservations](material-reservations.md) for startup, recovery and limits, and [SQLite migration](sqlite-reservation-migration.md) for the checksum-confirmed legacy transition.

`orderSyncPreview.ts` derives a read-only replacement review from a validated snapshot and the same source projection used by sync commands. The dedicated HTTP preview route reads but never executes a command. The client recomputes returned changes to reject mismatched summaries. `OrderSyncReview.tsx` presents the domain diff, while `ReservationsPage.tsx` owns source capture, review cancellation, first-confirmation freshness checks and immutable pending-command retries. The existing mutation transaction remains the final authority for revision and active-hold checks; preview does not grant authorization or lock a revision.

`ActiveHoldManager.tsx` owns hold-list filtering and pagination while the page owns explicit selection, captured review and pending batch intent. `applyReservationReleaseBatch` validates the ledger and complete input, derives ordered legacy release commands, rejects partial/mismatched receipt sets and computes the final state in memory. The SQLite adapter wraps one read/apply/capacity/write operation in an immediate transaction; it does not call the single-command persistence method in a loop. The JSON adapter publishes once. The HTTP client deeply captures the input and checks every expected event and released hold before accepting success. This preserves schema version 1 and existing receipt fingerprints without inventing durable batch provenance. See [the release contract](selected-hold-release.md).

## Verification and provenance

Type-checked contract tests retain the legacy export and distinguish read/write capabilities. Domain regressions exercise getItem-only collection exports and comparisons, preserved saved data, and safe read failures. Existing unit and Chromium workflows remain regression coverage; no test threshold is weakened. See the [batch release validation report](selected-hold-release-validation.md) for the latest FactoryOS results; the [order review report](order-sync-review-validation.md), [SQLite phase report](sqlite-reservations-validation.md) and portfolio architecture delivery report retain earlier evidence.

This refactor, checker and added tests were produced with AI assistance. They do not establish human authorship or licensing eligibility.
