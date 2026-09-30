# FactoryOS material reservations

The material reservation workspace is the first local backend workflow for FactoryOS. It gives saved production orders a separate, persistent stock-hold ledger with atomic allocation, revision conflicts, retry receipts and release history. It is a local single-user pilot with demo inventory, not a production inventory database or a replacement for the existing browser execution gates.

## Start the local workflow

Use the existing Node 20.19.x runtime and installed dependencies. From the FactoryOS repository, run:

```sh
npm run build:server
npm run start:server
```

In another terminal, start the frontend:

```sh
npm run dev -- --host 127.0.0.1 --port 4304
```

Open `http://127.0.0.1:4304/execution/reservations`. The API binds only to `127.0.0.1:4404`. Click **Connect reservation service**, then **Sync saved orders**. Nothing is sent automatically. Sync submits the full saved collection for validation but retains only order references in the reservation ledger. Unsaved edits are not included. Browser localStorage is never changed by this feature.

The service initializes three explicitly labelled demo stock lots and no orders. Genealogy-index availability is not inventory quantity. Choose an eligible order, a compatible stock lot, positive whole units and a note of 8–240 characters. A reservation holds units without consuming or shipping them. Each order may have one active hold per stock lot. Release requires a reason and preserves the original record and history.

The source order must be non-archived and in material-hold or ready phase. Sync rejects changes to an order with an active hold; release the hold before syncing changed or removed order references. Server references can become stale relative to browser records: this pilot has explicit synchronization, not a shared authoritative execution database. It does not certify material release, machine readiness or independent quality approval.

## Interface behavior

Order selection, search, state filtering, sorting and pagination are stored in the URL. Unknown query parameters are preserved. Selected order details remain open outside a filtered list. Each order has its own in-memory reservation draft.

A submitted command captures its request identifier, expected ledger revision and values. While a request is pending, newer draft edits remain separate. Refresh does not resubmit. Retry sends the same request; a lost response followed by a retry returns the existing receipt without allocating twice. For a revision conflict, refresh, discard the pending request locally, review the current quantities and submit a new request explicitly. Discarding does not undo any server change.

Drafts and pending attempts survive in-page refreshes, not navigation away, tab closure or browser reload. After reopening the page, reconnect and inspect recorded holds before submitting. A page refresh does not delete server data.

Release confirmation supports keyboard focus trapping, Escape to cancel and focus restoration. If a failed release leaves focus without an enabled control, focus moves to Retry same request; a late failure does not interrupt an already focused draft. Success is announced, statuses use text, the workbench reflows at narrow widths, and motion respects reduced-motion preferences.

## Persistence and request boundaries

The default data directory is `.factoryos-data` and is ignored by Git. `FACTORYOS_DATA_DIR` chooses another local directory. `FACTORYOS_PORT` changes the API port for diagnostics; the shipped browser client uses port 4404, so keep the default for normal use. Do not expose this service through a public tunnel or reverse proxy.

An exclusive process lock prevents two service processes from owning the same ledger. Operations are serialized. State and idempotency receipts are validated, written together to an exclusive temporary file, flushed, closed and atomically renamed. A failed publish does not acknowledge success. The file checksum detects accidental corruption; it is not protection against an attacker who can modify local files. No cross-platform power-loss durability, replication or backup guarantee is claimed.

Reads validate record relationships, stock balances, event references and the full receipt replay. Corrupt data is preserved and rejected rather than silently replaced with seed data. Successful idempotent replay returns the current ledger, not an obsolete snapshot.

The HTTP boundary validates Host, Origin, method, route, content type and the dedicated client header. Only configured localhost frontend origins are allowed. These checks are not authentication or user authorization. There is no cloud upload, tenant boundary, encryption at rest, login, named-user audit identity or production deployment in this phase.

Limits are 2 MiB per command, 16 MiB per stored ledger, 1,000 imported orders, 1,000 retained reservations and 5,000 ledger commands. Data and receipts are not silently evicted. Event capacity and conservative file-size headroom are reserved for releasing active holds. The file-backed replay model is intentionally bounded; it is not intended for high-throughput or multi-process production use.

## Recovery

If startup reports a lock, interrupted write or invalid ledger, stop and preserve the entire data directory. Check whether another service instance owns the lock. Do not delete a lock while its process is active, remove pending-write evidence, edit quantities manually, or replace the ledger with an empty file.

Review a copy of the files with a maintainer and compare against a known-good backup. A stale lock may be addressed only after verifying that its owning process has stopped. The application deliberately provides no automatic reset, cleanup, repair or destructive restore endpoint. Logs and shared bug reports must omit private order content and local filesystem details.

## Verification and next phases

`npm run check` covers architecture invariants, lint, browser Vitest, backend integration tests, TypeScript and browser/server production builds. `npm run test:e2e` adds real-service Chromium workflows; its fixture uses a private temporary data directory rather than the operational ledger. Existing workflow tests remain in place.

The next architectural phase is a database-backed authoritative order and inventory service, followed by authenticated roles, controlled browser-data migration, configurable stock receipts and adjustments, BOM demand, consumption, returns and quality disposition. Those changes require explicit migration and operational decisions; the current pilot must not be advertised as already providing them.

This implementation and its tests were developed with AI assistance. The Git history records actual changes and is not evidence of historical human authorship or external licensing eligibility.
