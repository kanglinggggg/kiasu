# Local verification — 8 October 2026

- PostgreSQL migrations 001–010 applied; rerun completed safely.
- Seed rerun preserved existing records.
- TypeScript typecheck passed.
- 23 existing unit tests passed, unchanged.
- 39 PostgreSQL integration tests passed (16 existing and 23 accounting tests), including concurrency and direct database invariant checks.
- 1 HTTP integration test passed using two independent cookie sessions against the local server.
- Next.js production build passed.
- Total: 63 tests passed. Commands: `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:api`, `npm run build`.

## Observed browser workflows

Desktop: preserved brand route analysis, AI proposal generation, server feasibility checks, existing Tote drop 41 → 42 and SGD 2,058. Changed inventory to 360 jeans / 284 kg, observed doubled route values and Tote/Sleeve/Jacket capacities 136/184/62. Confirmed separate inspection, launched a new 136-capacity drop with zero seeded orders. Existing source allocations were preserved.

Consumer loop: reserved return added no material; receipt added no material; explicit simulated inspection accepted 0.8 kg and awarded 180 credits once; allocation changed 67.2 → 68 kg. Demand stayed locked at 41. The 42nd preorder unlocked a planned 42-unit run. Approval/start/completion consumed 42 kg and returned 26 kg to the future pool. Reload retained return, rewards, orders and completed production.

Mobile (390 × 844): scan form, wearable-item Keep & Restyle with three suggestions, consumer history/rewards, identity role restrictions and the existing consumer drop. Document width did not exceed viewport. Preorder dialog wrapped Shift+Tab to Cancel; Escape closed it without ordering. Fresh console inspection showed no warnings/errors. Viewport override restored afterward.

Independent HTTP sessions observed the same committed material and demand. Simultaneous duplicate receipt, inspection and preorder calls returned one success and one conflict. Cross-origin access, consumer production unlock and injected authoritative AI fields were rejected.

Integration coverage also includes competing allocations, rejected/partial inspection, residual reuse, multi-component material readiness, overcapacity lock, new brand batch lifecycle, and no second drop funded from spent material.

## Accounting and physical modelling iteration

Repeated the default consumer flow with the new BOM and quality inspection fields: 67.2 + 0.8 kg, then 41 → 42 confirmed orders, unlocked at SGD 2,058. Approved, started and completed the run through the browser. The physical statement displayed 81.6 kg allocated = 50.4 kg consumed + 31.2 kg recoverable residual + 0 kg non-recoverable residual, including auxiliaries. The recovered denim portion remains 68 = 42 + 26 kg. These are calibrated prototype recipe quantities, not measured manufacturing results.

Simulated reward redemption changed the balance from 180 to 130; an explicit reversal restored 180. Original transactions remained in history. Reload retained the completed production and confirmed preorder. Mobile accounting controls were inspected at 390 × 844 with no horizontal overflow. Fresh console inspection after reload returned no warnings or errors. Restored the normal viewport and created a fresh demo workspace without deleting completed history.

New automated cases cover pending/confirmed/cancelled/refunded/failed demand, duplicate cancellation and idempotency keys, allocation releases, immutable original records, reward debit/reversal/expiry, return correction rollback, inspected quality compatibility, missing/limiting auxiliary components, exact mass reconciliation, recorded non-recoverable loss, recoverable residual sources, planned/approved cancellation, started-run exceptions, cancellation/unlock races, allocation/release races and concurrent credit debits. Direct PostgreSQL checks reject fabricated consumption and mass statements.

## Boundaries

All physical inspections, demand seed records, payments and production are simulated. Connected AI transport is mocked in tests; no paid live model call was made. Local role simulation is not production authentication. Browser testing used the local app only; nothing was published externally.
