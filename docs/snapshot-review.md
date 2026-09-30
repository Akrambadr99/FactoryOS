# FactoryOS collection snapshots

The Snapshots navigation item opens /data-snapshots for production operations. It exports a private copy of the current primary collection and compares compatible files with current local data. Comparison never imports, restores, deletes or overwrites records.

## Included data

The record groups are orders and lot indexes. Recall jobs, production histories and related lot indexes remain intact. Failed and blocked records are legitimate evidence and are not silently normalized.

The complete validated collection is exported, including JSON metadata and collection history outside the displayed record groups. Other workflow stores, the separate Operations workspace, application settings and unsaved form edits are not included. A seeded or legacy-derived collection can be exported without materializing it in browser storage.

## Review workflow

Download collection snapshot reads current saved data and creates a version 1 envelope identifying this product and collection. Keep the unencrypted file private; it can contain sensitive data. The screen uploads nothing.

Choose a file or paste its JSON, then select Compare snapshot. The comparison shows added, changed, removed and unchanged records relative to the current collection. These labels describe differences, not planned write operations. Search, status filtering and ten-record pagination retain the selected detail, including when it leaves the visible page. Current and snapshot details expand separately.

Object-key order is ignored, while array order, nested history and metadata remain significant. A whole-collection difference can exist even when every displayed record is unchanged. The comparison states that distinction.

Editing JSON invalidates the previous results. Later typing or a newer file selection wins over a late file read. Read failures preserve existing text and support retry. Current storage changes observed through another-tab events, window focus or visibility checks mark affected results out of date; Refresh comparison re-reads current data without replacing the snapshot text. This is a point-in-time review, not an atomic multi-user guarantee.

## Validation and limits

Product, collection scope, format version, creation timestamp, domain structure and comparison identities are validated. Wrong-product files, unknown future versions, raw recovery downloads and Operations backups are refused. Existing domain validators preserve legitimate stale, archived, blocked and failed workflow states.

Files and serialized snapshots have a 20,000,000-byte UTF-8 limit, with an additional character guard and a maximum JSON nesting depth of 60. These are defensive bounds, not tested production workload targets. Generic exception messages and file paths are not shown as recovery instructions. Existing saved data is never reset by this feature.

Visible labels, native controls, focus on comparison completion, textual difference states, live status messages and responsive detail layout support keyboard and narrow-screen use. No new motion or runtime dependency is introduced.

## Architecture and verification

Generic validation and comparison live in src/workspace/collectionSnapshot.ts. SnapshotReviewPage.tsx owns file-read races, state, selection and review controls. The domain adapter and wrapper use existing collection readers and rules; domain behavior is not moved into the generic component.

Shared unit and React tests cover envelope validation, all difference categories, metadata, UTF-8 limits, selection, pagination, late reads and retry. Domain adapter tests cover relevant source changes and zero writes. e2e/collection-snapshots.spec.ts covers real downloads, file review, malformed inputs, narrow layouts and cross-tab refresh. The portfolio delivery report records actual full-suite outcomes.

This implementation is AI-assisted development. Its code size and Git history do not establish human authorship, ownership or eligibility for paid codebase licensing.
