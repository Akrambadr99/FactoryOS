# Minerva Interaction Surface Map

## Architecture change

Before this pass, the command workbench owned reducer state, mutation timing, permission checks, and rendering locally. Domain calculations in neighboring workflows could not consume that state without importing private feature code.

After this pass, shared behavior is divided across explicit production layers:

- `src/domain/workbench/domain.ts`: versioned records, invariants, reducer, audit transitions.
- `src/state/`: application provider and guarded context hook.
- `src/services/workbenchService.ts`: async decision and scenario boundary.
- `src/features/decision-workbench/useWorkbenchActions.ts`: permission-aware mutation orchestration.
- `src/features/domain-intelligence/operationalModel.ts`: FactoryOS-specific effective records and relationships.
- `operationalRules.ts` and `operationalSelectors.ts`: pure dependency findings and derived metrics.
- Three routed surfaces for work-order dependency, line recovery, and quality-hold reconciliation.

## Strong future candidate seams

Each candidate below can be scoped to one observable behavior while requiring comprehension across a small set of related layers. No defect is intentionally present.

1. On an effective date before a record starts, exclude it from derived operational metrics.
2. Treat the effective-to date as inclusive while excluding the following day.
3. Show every incomplete prerequisite in dependency findings without duplicating shared ancestors.
4. Report a missing dependency definition separately from an incomplete workbench record.
5. Preserve deterministic traversal order for a multi-level dependency path.
6. Prevent a dependency cycle from hanging or duplicating nodes.
7. Clear the stale-version finding for FO-519 immediately after shared reconciliation.
8. Recompute work-order dependency metrics after a command decision completes.
9. Restore the selected dependency record and effective date from a deep link.
10. Fall back predictably when a deep-linked record no longer exists.
11. Carry the selected record into the command workbench without losing its identifier.
12. Reject scenario factors outside the supported range while retaining the user's selected mode.
13. Ensure only the latest overlapping async scenario result is displayed.
14. Keep scenario execution read-only with respect to authoritative workbench records.
15. Recalculate derived metrics when the capacity factor changes through URL state.
16. Remove a reconciled stale record from the attention list while retaining its audit entry.
17. Keep blocked records visible when a different stale record is refreshed.
18. Preserve shared activity history while navigating between command and reconciliation pages.
19. Enforce observer/operator/approver boundaries inside the action hook, not only through disabled UI.
20. Preserve decision rationale across a stale save, refresh, and second submit.
21. Ignore an async decision response for a record that is no longer authoritative.
22. Restore focus and active record semantics after keyboard navigation updates the URL.
23. Announce dependency, scenario, and reconciliation state changes without relying on color.
24. Collapse the master-detail layout at narrow widths without dropping selected context.

## Candidate quality gate

A future task should choose one observable outcome, freeze an exact historical base, demonstrate deterministic failure, and use a focused production patch. Local tests are evidence only; they do not establish Minerva submission, screening, or acceptance.
