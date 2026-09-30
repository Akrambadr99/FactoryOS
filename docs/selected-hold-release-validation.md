# Selected material hold release validation

The FactoryOS batch-release phase passed the complete local code gate and all 66 Chromium journeys on Windows using Node 24.16.0 and npm 11.13.0. Work started at `1d3f5881d6168ee1ad1cb7c544a4ecd44aa1e754` and was limited to FactoryOS. No operational ledger was initialized or migrated, and no code was pushed, uploaded or deployed.

## Delivered behavior

Planners can search, filter, page and explicitly select up to 25 active material holds independently of the selected order. Hidden selections remain visible in the count and are included in the captured confirmation. A shared reason, exact selected holds and base revision are reviewed before any write. Stale selections require explicit cleanup; there is no automatic release from an order-sync review.

The backend validates the entire batch and commits all releases in one SQLite immediate transaction, or one publication through the legacy JSON adapter. Existing per-release events and receipt fingerprints are preserved. Exact retries return current verified state; partial or mismatched receipt sets reject without completing remaining items. The client checks every released hold and acknowledgment before accepting success. SQLite schema version 1 and existing migration files are unchanged.

The UI preserves newer drafts and selections during pending requests. Completion clears only captured selections. A delayed success no longer steals focus from a newer draft. The shared dialog preserves document-order keyboard navigation, and its captured list is keyboard-focusable so users can inspect all 25 holds before confirming. Narrow layouts wrap actions and stack list content; checkbox descriptions include order, material and units.

## Final local gates

| Gate | Verified result |
| --- | --- |
| Architecture checker tests | 37 passed |
| Frontend dependency boundaries | 156 production modules and 277 resolved first-party dependencies; no runtime cycles or boundary violations |
| ESLint | Passed with zero allowed warnings |
| Application Vitest | 703 passed across 108 files |
| Backend Vitest | 157 passed across seven files |
| Frontend and server TypeScript | Passed |
| Browser production build | Passed; entry 335.85 KiB raw and 103.20 KiB gzip, below 450 and 130 KiB limits |
| Service and migration CLI build | Passed |
| Full Chromium suite | 66 passed with configured automatic retries disabled; all 60 earlier journeys retained and six added |
| Hosted CI | Not run; existing workflow remains configured |

The complete commands were `npm run check` and `npm run test:e2e`. Ignored logs are `factoryos-release-batch-check.log` and `factoryos-release-batch-e2e.log`. Tests use isolated temporary ledgers. The repository's operational `.factoryos-data` directory remained absent. No dependencies or runtime configuration changed. These counts are not coverage percentages or cross-browser certification.

## Integrity and interaction evidence

The new domain tests cover normalized unique UUIDs, complete input validation, safe revision arithmetic, 1–25 bounds, later-item failures, ordered fingerprints, complete replay, partial receipt rejection and compatibility with identical consecutive individual releases. Client tests deep-capture requests and reject incomplete or mismatched acknowledgments, including an incorrect final item.

Twenty-seven backend cases exercise real SQLite writes and restart, concurrent base-revision conflicts, stale/missing/released later holds, malformed requests and the existing HTTP boundary. An injected SQL trigger rejects the final receipt after earlier updates; the test verifies unchanged database bytes, holds, events and receipts. JSON compatibility tests verify one publication, unchanged bytes after a failed rename and restart-safe retry.

Seven new page cases and eight selection-component cases cover captured scope, reason recovery, hidden selections, no silent truncation, queued selection updates, unavailable-hold cleanup, cancellation of late previews, immutable retries and unmount cancellation. A deferred-success regression first reproduced focus stealing and passes after the fix. Real-service browser cases additionally cover competing tabs, a committed write with a lost acknowledgment, preserved newer typing, keyboard scrolling and responsive dialog bounds.

The first complete application run hit the existing five-second limit in a new component test. Long reason setup was changed from per-character typing to a direct input-change event; keyboard assertions and real browser typing coverage remain. No timeout, automatic retry or test threshold was increased. A later TypeScript check caught an unsupported test-query option, which was removed without changing its exact-name assertion.

The captured list has one documented, element-scoped exception to the non-interactive-tabindex lint rule: it is an independently scrollable list that must receive keyboard focus. Chromium tests exercise End, Home, ArrowDown and PageDown across its full 25 rows. During unit verification, the test DOM returned mixed-selector results out of document order; the shared dialog now traverses in document order before matching controls. This was not presented as a reproduced Chromium defect.

## Visual evidence

The browser suite generates viewport captures at:

- `test-results/release-batch-review-1440.png`
- `test-results/release-batch-review-820.png`
- `test-results/release-batch-review-390.png`

Desktop, tablet and mobile captures were inspected. Automated checks verify dialog/control containment, action separation and page overflow. After the full suite passed, the screenshot call was changed to disable animations during capture because one desktop image caught the dialog mid-transition. The same keyboard/layout journey was rerun to regenerate stable captures; the UI animation itself was not changed and no sleep was added. Its separate log is `factoryos-release-batch-visual.log`. Later Playwright runs may replace these ignored artifacts. This is focused visual and keyboard verification, not exhaustive assistive-technology certification.

## Remaining boundaries

This is still a local single-owner pilot with simulated stock, not an authoritative inventory service. Authentication, named-user audit identity, production inventory ownership, multi-process operation and operational backup guarantees remain outside this phase. Drafts, selection and pending requests are not durable across reload; abandoning a request never proves that its server write was rolled back.

No new durable batch record exists. Matching individual receipts prove recorded release outcomes, not historical batch provenance. The checkout has no configured remote, so remote HEAD equality and hosted CI cannot be verified. The [runbook](selected-hold-release.md) documents explicit recovery without deleting or rewriting history. Implementation, tests and documentation used AI assistance and do not establish human authorship, production use or external licensing eligibility.
