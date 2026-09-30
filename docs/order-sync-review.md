# Order synchronization review

FactoryOS now reviews browser order references before synchronizing them to the local reservation service. The review shows the complete replacement impact without changing the ledger. It is a preparation step toward authoritative orders, not a transfer of order ownership, a production inventory feature or a migration of browser data.

## Review and confirm

Connect the reservation service, then choose **Sync saved orders**. The application captures the full validated browser collection and requests a service snapshot and change preview. Nothing is imported during this request. The inline review lists additions, updates and removals with before/after fields, plus the number of unchanged references. Search, change filters and pagination help inspect large collections without changing the full replacement set.

Changed or removed orders with active holds block confirmation. Cancel the review, resolve the affected holds deliberately, then review again; synchronization never releases holds on its own. Removed references require acknowledgment even if a filter hides them. Existing reservation and event history stays in the ledger. If projected references already match, the UI does not submit a redundant command. Older source revisions are shown explicitly rather than silently hidden or given a new compatibility rule.

**Confirm order sync** first verifies that the browser source still matches the captured collection and that the loaded ledger revision still matches the review. If either changed or the source cannot be read safely, confirmation stops and requires a new review. This is a freshness check, not a lock on browser storage: an edit in another tab after the check can still coexist with the explicitly captured command. The saved server projection always comes from the captured collection, never an automatic reread during submission.

The existing sync command then checks its expected revision and active-hold constraints inside the service transaction. Another service change after preview can cause a conflict. Refresh, discard the unconfirmed request locally, and review again before creating a new command. No partial import or automatic rebase occurs.

## Failures and cancellation

A failed preview has not submitted a sync command. Use **Review latest saved orders** to capture and review again, or cancel. Invalid responses are rejected; the client recomputes the preview against the captured source and validated returned snapshot rather than trusting summary counts alone.

A failed submission is different: the command may already have committed if its acknowledgment was lost. **Retry same request** resends the exact captured collection, request identifier and expected revision. New browser edits do not replace those values. The existing idempotency receipt confirms the original result without duplicating the write. Discarding a pending request changes only local UI state and does not undo a server commit.

Cancel restores focus to the sync trigger and leaves reservation drafts and URL selection intact. A delayed review does not steal focus from a newer draft. Refresh, another command or opening a release dialog invalidates pending preview responses. A new review resets the removal acknowledgment. Reviews and pending attempts are not durable across page closure or reload; reconnect and inspect the service before submitting a replacement.

## API and persistence boundary

`POST /api/reservations/order-sync-preview` accepts exactly `{ "collection": ... }` using the existing validated full order-collection shape. It returns `{ "snapshot": ..., "preview": ... }`. The preview includes its snapshot revision, source count, added/updated/removed/unchanged counts, blocked-order count and deterministic changed rows. Each row includes identity, change kind, before/after projections, changed fields and affected active-hold identifiers.

The route uses the existing loopback Host/Origin checks, client header, JSON and UTF-8 validation, encoding restrictions, 2 MiB request limit and no-store response headers. Only POST and its permitted preflight are supported at the exact route; GET, alternate paths and query variants do not expose another read interface. The handler reads a validated snapshot and computes the preview without executing a command, allocating a receipt or reserving a future revision.

The existing mutation route remains backward-compatible. Preview is an interaction safeguard, not authentication or a required authorization token; a direct local API caller can still submit a valid sync command without preview. SQLite schema version, JSON migration format and historical receipt fingerprints are unchanged. No database upgrade, operational ledger initialization, cloud service or external submission is part of this phase.

The implementation and tests used AI assistance. This feature does not establish production use, historical human authorship or external licensing eligibility.
