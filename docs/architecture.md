# Architecture

FactoryOS uses a strict command boundary: React route -> repository -> optimistic revision check -> role/state policy -> domain validation -> immutable snapshot and audit receipt. The eight workflow policies are independent domain modules and the shared capabilities cover scheduling, search, imports, comments, approvals, retry, outbox, synchronization, reporting, migration, feature flags, pagination, activity queries, and accessible interaction state.

## Storage capability boundary

The dependency-free `src/platform/storage-port.ts` owns three structural interfaces: `StorageReader` exposes only `getItem`, `StorageWriter` only `setItem`, and `StoragePort` combines both. Readers import the contract directly instead of depending on the concrete workspace repository. Its previous `StoragePort` type export remains available for compatibility.

For FactoryOS, the collection and legacy readers in `src/execution/order-machine` project orders and lot genealogy. They, validated reads, and snapshot export/comparison accept a getItem-only provider. Saving collections, executing commands, and binding editable records still require the writable port. Selected-record decoders no longer receive artificial throwing writer stubs. Storage keys, persisted shapes, validation, revision checks, and audit history are unchanged.

This is a compile-time capability boundary, not a runtime security sandbox. A browser Storage object remains structurally compatible. Role choices are still local workflow simulations; this pass adds neither authenticated services nor transactional backend persistence. Collection and older single-record workflows retain their existing synchronization limits.

## Automated dependency checks

Run `npm run architecture` to inspect the resolved production dependency graph. Run `npm run test:architecture` to exercise the checker itself. Both now run before lint, Vitest, TypeScript and build/budget checks in `npm run check`; Chromium remains `npm run test:e2e`.

The checker resolves imports, re-exports, import types, aliases, index modules and literal dynamic imports through TypeScript. It rejects runtime cycles, missing or excluded test dependencies, first-party paths outside src, and dependencies from shared workspace/platform/capabilities/components/interaction modules into product or application implementations. Explicit type-only cycles are allowed, but type dependencies still obey layer boundaries. The storage contract may not import any dependency.

Non-JSX source modules cannot depend on React or UI integration. Seven existing composition modules are explicit exceptions: application context, services and useAppServices; workspace useCollectionExplorer; features/decision-workbench useWorkbenchActions; state useWorkbench and workbenchContext. Adding an exception requires an intentional architecture decision and regression coverage.

Computed loaders, import.meta.glob, query/hash imports and source symlinks fail closed. This is a conservative first-party import-graph check, not general JavaScript execution analysis, security certification, or a scan of dependency internals.

## Material reservation boundary

The optional local reservation service owns a separate serialized ledger for stock holds and retry receipts. `src/execution/materials/reservations.ts` defines pure commands, state validation and replay; `reservationClient.ts` validates HTTP responses; `ReservationsPage.tsx` owns draft and navigation state. The Node implementation under `server` owns the filesystem lock, atomic publish and local HTTP boundary. It does not import UI modules.

Order references cross this boundary only through explicit validated synchronization. The browser remains authoritative for the older execution workflow, and demo reservation stock is not the genealogy index. No automatic dual write or execution release is performed. See [material reservations](material-reservations.md) for startup, recovery, limits and the planned database migration.

## Verification and provenance

Type-checked contract tests retain the legacy export and distinguish read/write capabilities. Domain regressions exercise getItem-only collection exports and comparisons, preserved saved data, and safe read failures. Existing unit and Chromium workflows remain regression coverage; no test threshold is weakened. See the portfolio architecture delivery report for current results and commit hashes.

This refactor, checker and added tests were produced with AI assistance. They do not establish human authorship or licensing eligibility.
