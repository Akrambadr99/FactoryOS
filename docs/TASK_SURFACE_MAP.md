# FactoryOS task-surface map

The repository has eight independent domain workflows and shared platform surfaces. Each candidate below is grounded in an existing route, policy, state machine, persistence boundary, and test suite; none requires planting a defect.

1. **Production order release** — extend the capacity decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
2. **BOM effective revisions** — extend the dependency decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
3. **Routing execution** — extend the sequence decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
4. **Machine downtime recovery** — extend the freshness decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
5. **Material availability** — extend the reserve decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
6. **Scrap disposition** — extend the threshold decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
7. **Rework release** — extend the qualification decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
8. **Shift handoff timing** — extend the window decision with cross-workflow consequences, stale-revision recovery, partial execution, and an auditable rollback boundary.
9. **Concurrent command recovery** — preserve newer operator work when a stale dialog refreshes against another tab's committed revision.
10. **Bulk partial-failure reconciliation** — reconcile mixed successful and rejected domain commands without replaying completed receipts.
11. **Effective-date reporting** — add point-in-time analytics that excludes future-effective records and explains each exclusion.
12. **Permission delegation** — introduce bounded temporary authority with expiry, revocation, and audit visibility across workflow routes.
13. **Import conflict review** — preview referential and revision conflicts before applying an external snapshot.
14. **Accessible recovery focus** — move focus to the precise failed constraint and restore initiating context after recovery.
15. **Cross-page activity filters** — derive a shareable audit query spanning entity, actor, status transition, and effective date.

These are task-generation surfaces, not claims of Minerva acceptance. Each future task still needs exact-base reproduction and independent platform review.
