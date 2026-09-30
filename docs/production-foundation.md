# FactoryOS collection integrity and recovery

The order recovery workspace now validates production execution, recall jobs, recovery assignments, lot indexes and collection events at the persistence boundary. This is a local data-safety improvement, not a backend, authentication system or claim of production deployment.

## Runtime boundary

Domain rules live in `src/execution/order-machine/collectionValidation.ts`. They cover nested types, supported states, finite numeric values, safe revisions and record identities. Validation rejects duplicate identities where those identities are used to target updates. Valid stale, pending, blocked, archived and historical records remain usable; structural validation does not approve their business evidence.

`src/workspace/storageValidation.ts` supplies typed object, array, dictionary, optional, nullable and refinement rules plus `readStored` and `writeStored`. The mapped object schema requires a rule for every declared TypeScript field. Rules return the original accepted objects and preserve JSON-compatible unknown metadata rather than stripping it. They do not add missing fields or silently fix corrupt values.

Only an absent primary key starts an initial workspace. Empty saved text, malformed JSON and invalid nested values are failures, not reasons to reseed. Existing legacy readers retain their supported normalization; the resulting imported collection is validated. Empty or unreadable legacy data is classified using its legacy key. This does not retroactively validate every raw historical store or add a new schema migration system.

Before persistence, the candidate and its serialized representation are validated. A failed validation performs no write. A rejected browser save remains a failure and does not advance the bound record snapshot; existing conflict and retry behavior remains in place. Browser local storage is not a transactional, cross-device or server-authoritative database.

## Recovery interaction

Collection startup errors and typed selected-record opening errors reach the route recovery screen. Ordinary missing or archived record errors retain their existing contextual handling. A boundary outside the providers also catches initialization failures, including unavailable browser storage. Generic exception details are not rendered in the recovery screen; development consoles may still log framework diagnostics.

The recovery heading receives focus. Native buttons and a link provide retry, explicit download of the affected entry and return to the overview. Retry reloads the current address, including selected-record and collection query context. It does not automatically reset or delete data. Unsaved form edits may not be recoverable after a render failure or reload.

The recovery download contains the current raw text of only the failed storage entry. It is not validated, does not include unrelated entries and is not a complete backup. Keep it private. No upload, analytics transmission, automatic repair, deletion or bulk restore is added. If that entry has disappeared, the screen reports that nothing was downloaded; a blocked download remains retryable.

## Verification

`collectionValidation.test.ts` covers corrupt nested records, identities, write safety, legacy import output, optional fields and accepted domain states. Existing selected-record tests continue to check stale writes, peer preservation and storage-failure retry. Shared tests exercise the generic validation and recovery boundaries.

`e2e/production-foundation.spec.ts` covers exact recovery-download content, unrelated-storage preservation, malformed text surviving reload, a synthetic external repair followed by retry, direct detail-entry recovery, provider initialization failure and the recovery layout at 820px and 390px. The layout checks cover full title bounds and content ordering, not only page width. They do not constitute exhaustive mobile, cross-browser or accessibility certification.

Run the existing complete gates before release:

```
npm ci --offline --no-audit --no-fund
npm run check
npm run test:e2e
```

`npm run check` includes lint, full Vitest, TypeScript, the production build and entry-budget validation. Use the repository's pinned supported runtime. The portfolio delivery report records actual outcomes; this runbook does not imply an unexecuted gate passed.

## Next production work

The next architectural milestone requires an agreed backend, hosting environment, identity provider, tenancy model and data policy. Put authority, revisions, idempotency receipts and audit persistence on the server before exposing real multi-user workflows. Then add versioned migrations, validated backup/restore, controlled releases and redacted observability. Existing actor controls model domain behavior but are not authentication.

Preserve real commit history and honest authorship records. This development is AI-assisted; no licensing eligibility, regulatory suitability or benchmark-platform acceptance is established by these tests.
