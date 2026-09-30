# Collection triage

Order recovery workspace now separates collection exploration from domain decisions.

## View contract

- Search, archive scope, work state, sorting, page and page size use URL parameters: `q`, `show`, `state`, `sort`, `page`, `size`. Invalid values fall back safely.
- Search replaces the current history entry; discrete filter and page changes can be navigated with browser Back/Forward. Changing a filter or sort resets paging.
- Sorts use stable record IDs to break revision ties. The default page size is 10; 5 and 25 are available under View options.
- Selected detail remains open when filtering or paging hides its row. Reset view restores the default active collection; it does not change the selected record or force archived records into the active view.
- Detail and decision links carry the collection view back to the workspace. Unrelated URL context is retained; view context is bounded to 4,000 characters.

## Selection and workflow safety

Page selection adds only visible row IDs. Clearing the current page preserves selections elsewhere. Hidden selection counts and bulk-scope guidance are visible before the existing bulk action. Clear selection removes all checked IDs. Selection is transient and does not survive a full reload or route unmount.

Global work queues and metrics remain portfolio-of-records summaries, not filtered collection summaries. Their labels state this scope. Existing permission, capacity, archival, fan-out and stale-write policies remain authoritative. Triage changes alone do not write domain records.

## Domain state

Stale recovery evidence takes priority over a recall job status, then production completion. This distinguishes finished production from failed recall reconciliation. Search includes order ID, line, linked lot and current named recovery owner.

When multiple conditions exist, the work-state facet represents the highest-priority condition above. The selected detail and global work queue preserve other evidence.

The collection's genealogy decision link now supplies a trace depth of 1. Previously it omitted this required positive input, so following the link reached the route's invalid zero default and failed during render. The new link regression checks the actual scenario evaluator, and Chromium opens both linked workflows.

## Verification

`collectionTriage.test.ts` covers seeded states, precedence and searchable domain identity. `e2e/sixteenth-pass.spec.ts` covers deep links, reload/history, empty-view recovery, hidden page selection, and detail/decision round trips at tablet width. Existing collection and record-workspace suites remain regression coverage.
