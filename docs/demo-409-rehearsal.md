# Demo concept regeneration fix and rehearsal evidence

Date: 9 October 2026. Local PostgreSQL, Demo Operator, Demo AI. No deployment or commit.

## Exact failure

`POST /api/inventory/:batchId/concepts` returned HTTP 409 with:

> Duplicate submission, invalid transition or conflicting material allocation. Refresh to see the committed state.

Executing the same service command against the affected B017 batch exposed PostgreSQL `P0001`: **Approved concept economics and feasibility are frozen**, raised in `guard_concept_identity`, line 11 (migration 016).

B017 contains approved, registered Tote, Sleeve and Jacket concepts. Tote is associated with DROP017 and the batch has no remaining unallocated material. The service correctly reused the funded Tote, but its upsert attempted to change approved Sleeve/Jacket feasibility to false and clear their approvals because they had no Drop. The database correctly rejected the frozen feasibility change. This was not a duplicate-ID violation or an ownership denial. The whole command rolled back.

## Small correction

Concept regeneration may update only records with neither brand nor maker approval and no Drop. Previously approved concepts are reused unchanged. Current available-stock checks remain separate, so an unfunded alternative can still be unavailable even though its historical recipe was approved. Existing Tote launch navigates to its existing Drop. The original database trigger, tenant checks, material ledger and approval gate remain intact. Duplicate Drop creation and duplicate approval still fail.

A small Financial outlook Drop selector makes the final forecast explicitly selectable as DROP024 instead of accidentally showing the seeded Tote. No economics formulas changed.

## Repeatable initialization

Use the updated demo-runbook.md. Reset creates an isolated new simulated workspace and preserves prior history. Save a new batch named Denim Jeans - simulated pilot to demonstrate fresh proposals and explicit human inspection/brand-maker approval. Do not pretend seeded B017 needs a second approval. The genuine-shortage button creates a separate workspace; the new brand batch cannot subsidize its material shortage. Default and shortage seed definitions are unchanged.

## Regression execution

- Unit tests: 56 passed.
- PostgreSQL integration tests: 58 passed, including two new concept-regeneration tests.
- New coverage: exact B017 failure, simultaneous repeated generation, unchanged approved records, existing funded Tote, infeasible unfunded alternatives, rejected duplicate approval, two independent fresh brand runs, approval required before Drop creation, approval preserved on regeneration, duplicate launch rejected.
- Typecheck: passed.
- Next.js production build: passed.
- GitHub Pages static build: passed.
- No migration or historical ledger rewrite was needed.

## Completed browser rehearsals

Times are wall-clock browser walkthroughs including server/UI waiting and tool overhead, not recorded spoken presentations. Initialization/reset is performed before the timer; each timer starts at inventory entry and ends at the selected Drop's financial outlook. Both use Demo AI and require no Gemini or CLIP inference/download.

| Stage | A seconds | B seconds |
| --- | ---: | ---: |
| New inventory and route comparison | 1.110 | 0.872 |
| AI proposals, inspection and explicit approval | 46.910 | 10.085 |
| Launch fashion Drop | 0.498 | 0.503 |
| Separate shortage scenario, scan/review, reservation, receipt, inspection, rewards and allocation | 21.451 | 58.739 |
| Credit/discount checkout, 42nd order and dual unlock | 11.111 | 12.175 |
| Selected Drop financial outlook | 8.565 | 7.588 |
| **Complete total** | **89.645** | **89.962** |

A: the first Generate click immediately after navigation did not issue a request. After inspecting the settled screen, clicking again completed generation. Timing includes that recovery. No HTTP 409 recurred. B: no errors or recovery actions. Earlier untimed setup and exploratory checks are not counted as these two completed rehearsals.

Read-only database reconciliation confirms both shortage workspaces, named Demo run 2026-10-09T10:51:50.554Z and Demo run 2026-10-09T10:53:01.302Z (each labelled GENUINE SHORTAGE), ended with:

- DROP024 phase unlocked; 42 confirmed buyers.
- 41.2 + 0.8 = 42 kg verified allocation for the planned batch; 68 remains the maximum, not the material readiness target.
- SGD 2,058 committed GMV; SGD 4.90 return discount; SGD 1.94 redeemed credits; SGD 2,051.16 net simulated commitments.
- Single checkout payable SGD 42.16; 194 earned credits redeemed; one 10% entitlement used.
- Forecast uses explicit rounded per-unit incentive assumptions (SGD 0.12 and SGD 0.05), yielding SGD 2,050.86 forecast net sales and SGD 95.86 forecast contribution. These are not the exact stored commitments or realized profit. The displayed admin totals cover the whole workspace, including the other seeded Drop.

## Decision

**READY FOR HACKATHON DEMO using the documented local Demo AI flow.** This is not a public-release approval or a Gemini validation. All collection, orders and maker approvals are simulated; manufacturing and financial assumptions remain unverified. Rehearse narration separately within the remaining presentation time. Images and historical ledgers are preserved. No commit, push, merge or deployment was performed.
