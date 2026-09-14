# FactoryOS deep task directions

Architecture: Reducer/state-machine MES with material and machine invariants.

1. Resume an order without losing consumed material after downtime
2. Recompute OEE when a downtime category changes
3. Prevent routing advancement before mandatory inspection
4. Recover a material reservation after a partial issue failure
5. Trace a finished lot through rework and component substitutions
6. Enforce operator qualification at shift boundaries
7. Deep-link the selected order and routing step
8. Recalculate bottlenecks after a machine goes offline
9. Apply a BOM revision only to unstarted quantities
10. Preserve WIP during a changeover rollback
11. Explain yield loss across scrap and rework paths
12. Bulk-release orders with independent capacity failures
13. Reconcile maintenance completion with machine readiness
14. Restore focus to the failed material constraint
15. Compare planned and actual cycle time by work center
