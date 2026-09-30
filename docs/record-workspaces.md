# Selected order workflows

The /execution/recovery-workspace workspace and its linked detail pages now edit the same persisted order record. Use **Open record details** or **Open decision workflow** for the selected row. The `record` URL query identifies the editing target; **Back to workspace** restores that selection.

Execution and recall details edit the selected order aggregate. Recovery claims use its actual production line and all active order recovery work. The order ID and lot link are retained on return navigation.

## Persistence and recovery

- The collection is the source of truth for these connected screens.
- When no collection exists, the existing legacy ledger is imported as the primary record. The first successful save persists that collection; the original legacy key is retained as migration backup.
- Each editor retains its opening record snapshot. If that record changes or is archived elsewhere, a save fails visibly and preserves local input. **Reload record and discard local edits** opens the current version and restores keyboard focus to the record context.
- A change to another record is preserved when the selected edit is saved. A stale collection-wide action is rejected; **Refresh workspace** retains the selected ID.
- Missing and archived IDs never fall back silently to another record.
- Storage failures do not advance the editor snapshot, so an unchanged draft can be retried.
- Domain history remains in the ledger; successful detail writes append a collection audit entry.

New detail screens should use `openSelectedRecord` and `SelectedRecordRoute`. Direct writes through legacy ledger storage functions are retained for import compatibility and isolated tests; those keys are not synchronized after migration. The other operational-workspace aggregates remain separate domain models.

## Verification

`selectedRecord.test.ts` covers legacy migration, durable edits, unrelated-record preservation, stale snapshots, unavailable records, and storage failure. `e2e/fifteenth-pass.spec.ts` covers connected browser navigation and recovery. Run `npm run check` and `npm run test:e2e`.

The storage adapter detects stale snapshots before its write. It is a local browser persistence mechanism, not a transactional multi-user server or cross-tab locking service.
