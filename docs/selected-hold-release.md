# Selected material hold release

FactoryOS can release 1–25 explicitly selected active material holds together. A planner reviews the exact holds, supplies one shared reason and confirms one atomic write. This reduces repetitive release decisions when production plans change, without silently resolving order-sync blockers or changing browser execution records. Inventory remains simulated and the service remains a local single-owner pilot.

## Review and confirmation

1. Connect the local service and expand **Manage active holds**.
2. Search by order, lot or note, or filter by production line. Each page shows up to eight active holds in creation order. Select individual holds or **Select visible holds**. That button adds the whole visible page only if it fits within the 25-hold limit; it never silently selects a partial page.
3. Check the selection count, including holds outside the current page or filter. Filtering does not remove selections, and hidden selections are included in the review. **Clear hold selection** is explicit.
4. Choose **Review selected releases**. The dialog captures the selected holds and loaded ledger revision. Opening it cancels any in-flight order-sync preview. Nothing is written yet.
5. Give an 8–240 character reason and inspect the captured order, material and units. The shared reason is stored on each released hold. Escape or **Keep selected holds** closes the dialog without writing; the selection and reason remain available in memory.
6. Confirm **Release selected holds**. The service releases every captured hold or none. It preserves each hold's original reservation and release history and makes the held units available again. It does not consume stock, remove records or synchronize orders.

Changing the loaded ledger while the dialog is open disables confirmation and requires a new review. A change by another tab that is not yet loaded is still checked by the service at write time. There is no automatic rebase. If a selected hold is no longer active after refresh, it remains flagged and blocks a new review until **Remove unavailable selections** explicitly removes it.

The list uses native checkboxes, descriptive order/material context, textual selection counts and a keyboard-operable disclosure. The confirmation uses the shared focus-trapping dialog. Its captured list is the first tab stop, so keyboard users can scroll through a long selection before reaching the reason and decision controls. Short layouts stack controls and wrap actions. Async results announce status without moving focus away from a newer draft.

## Pending requests and recovery

Submission captures a base revision, the reason and an ordered list of unique request and reservation identifiers. Retry sends this same intent, even if the current list filter, selection or draft has changed. Completing a request removes only its captured identifiers from selection. A hold selected while it was pending remains selected.

| Observed outcome | Safe next action |
| --- | --- |
| Connection failure or unreadable acknowledgment | Keep the pending request and use **Retry same request**. The original write may already have committed. |
| Revision conflict | Refresh, inspect the ledger, discard the old pending request locally, and explicitly review a new selection. A retry never substitutes the new revision. |
| Selected hold no longer active | Refresh and inspect its history; remove unavailable selections explicitly before starting another review. |
| Partial or mismatched receipts | Refresh and inspect recorded outcomes. Do not assume remaining items were released or manufacture new identifiers to bypass the conflict. Start a new reviewed decision only after reconciling the history. |
| Service storage failure | Preserve the data directory and follow the main runbook. Do not delete receipts, locks or database files to retry. |

Discarding a pending request is local only and never rolls back a server change. Selection, reason drafts, reviews and pending attempts survive an in-page service refresh but not navigation away, page reload or tab closure. After reopening, reconnect and inspect the saved ledger before creating another request. Aborting a browser request also does not prove the server rolled it back.

## API and atomic persistence

`POST /api/reservations/release-batch` accepts exactly this shape:

```ts
{
  expectedRevision: number,
  reason: string,
  releases: Array<{ requestId: string, reservationId: string }>
}
```

The list must contain 1–25 items. Identifiers must be valid UUIDs and are normalized to lowercase; both request identifiers and reservation identifiers must be unique after normalization. The reason uses the existing release validation and is trimmed at its boundaries. Revisions must be safe non-negative integers, including the final derived revision. Extra keys and malformed or sparse lists are rejected.

For item index `i`, the domain derives an existing `release` command at expected revision `base + i`. Each new item appends one ordinary event and receipt. Item order is part of the intent. The domain validates the source state and all input before computing changes, then the store persists the final result once.

| Existing receipt set | Result |
| --- | --- |
| None of the submitted request identifiers exist | Check the current revision and every hold; compute all changes, then persist atomically. |
| All identifiers exist with matching fingerprints | Return the current validated snapshot with `replayed: true`; append nothing. |
| Only some matching identifiers exist | Reject with `idempotency_conflict`; do not finish the remaining releases. |
| Any existing identifier has a different fingerprint | Reject with `idempotency_conflict`; save nothing from this attempt. |

The SQLite store uses one `IMMEDIATE` transaction, including final capacity checks, changed holds, all events and receipts, and the final revision. A late SQL failure rolls back earlier updates. The legacy JSON adapter serializes one read/apply/publish operation. The HTTP route retains the existing Host, Origin, method, client-header, UTF-8, JSON and body-size checks; these are not authentication. The client validates every expected event sequence, reservation identity, released status, reason and release revision before accepting the response.

## Compatibility and limits

No schema upgrade, new event kind or durable batch table is introduced. Existing JSON migration data and individual release fingerprints remain valid. Identical consecutive individual release receipts are indistinguishable from batch-created receipts and can safely satisfy a replay. Therefore the ledger proves individual recorded outcomes, not historical batch provenance or named-user approval.

The existing 1,000-retained-reservation, 5,000-command and 16 MiB logical-content bounds still apply. Each released hold counts as one command. Release headroom remains reserved, but disk exhaustion can still reject a write. This is not an unbounded bulk job or a multi-process production API.

See [material reservations](material-reservations.md) for startup and storage recovery, [order synchronization review](order-sync-review.md) for the separate sync decision, and [validation results](selected-hold-release-validation.md) for measured checks. Implementation and tests used AI assistance; they do not establish historical human authorship, production use or external licensing eligibility.
