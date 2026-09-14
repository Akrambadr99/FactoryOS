# Architecture

FactoryOS uses a strict command boundary: React route -> repository -> optimistic revision check -> role/state policy -> domain validation -> immutable snapshot and audit receipt. The eight workflow policies are independent domain modules and the shared capabilities cover scheduling, search, imports, comments, approvals, retry, outbox, synchronization, reporting, migration, feature flags, pagination, activity queries, and accessible interaction state.
