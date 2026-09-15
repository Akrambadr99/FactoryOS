# Minerva Interaction Surface Map

## Sixth-pass command workbench

The **Production recovery command** route adds a deterministic, domain-specific interaction surface around line constraint, lot genealogy, and quality authority. It is production behavior, not an injected defect or verifier-only fixture.

### Observable interaction seams

1. Deep-linked record selection and invalid-ID fallback.
2. Search across identifier, title, context, and owner.
3. Status filtering with intentional empty-state recovery.
4. Arrow-key queue navigation with URL synchronization.
5. Selection retained independently of current filters.
6. Observer, operator, and approver permission boundaries.
7. Required decision rationale with recoverable inline feedback.
8. Async pending state and duplicate-submit prevention.
9. Deterministic stale-version conflict detection.
10. Server-version refresh that preserves the user's note.
11. Partial bulk success with record-scoped failures.
12. Targeted retry that keeps failed records selected.
13. Undo of the last completed mutation.
14. Screen-reader status announcements.
15. Responsive master-detail collapse without losing active context.
16. Progressive disclosure of decision history.

### Candidate quality guidance

Future Minerva tasks should isolate one observable behavior and preserve the surrounding invariants. A candidate should demonstrate a deterministic failure on an exact historical base and success after a focused production patch. Local tests do not establish platform acceptance.
