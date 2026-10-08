# Reversal accounting and physical material model

## Immutable history and derived balances

Every new accounting command has a UUID idempotency key, actor, workspace and reason. The command and its business records commit in the same transaction. Reusing a key returns a conflict, including concurrent retries; a rejected command rolls back completely. Existing workspace transaction locks remain, with PostgreSQL source/user locks and constraints as additional protection.

Original material movements, receipts, reward entries and consumption records cannot be updated or deleted. Reversals reference originals through foreign keys:

| Event | Original reference | Effect |
|---|---|---|
| `allocation_releases` | original drop allocation → material movement | Frees only the unreleased, unconsumed reservation |
| `preorder_events` | original preorder | Records previous/next lifecycle state |
| `reward_transactions` reverse | `original_transaction_id` | Exact signed opposite of original earn, redeem or expire |
| `production_cancellations` | original production run | Cancels a planned/approved commitment and releases its reservations |
| `return_corrections` | original inspected receipt | Voids the accepted source after reservation and reward reversals |

`source balance = opening verified kg − original allocated kg + released kg − corrected receipt kg`.

`effective drop allocation = original allocation − all releases`.

`credit balance = SUM(all signed reward transactions)`.

Pool entries document new residual creation, not an additional debit. Histories display original, released and net kilograms. A release is not new recovered material. Its counterpart source is the same original source. A completed production's recoverable residual is a **new** source linked to the run and original allocation.

Partial releases are allowed up to the original remaining reservation; the same command cannot be replayed. Multiple records within a cancellation cascade may refer to the same allocation, but their sum remains bounded. All state-changing API commands create audit events.

## Preorder lifecycle

Creation supports `pending` or `confirmed` (the short demo still creates confirmed simulated orders). Allowed subsequent transitions:

```text
pending → confirmed | failed | cancelled
confirmed → cancelled
cancelled → refunded
```

Only `confirmed` contributes to demand or current committed gross sales. Unit price, owner and original quantity remain immutable. `preorder_events` drives the current status projection. Duplicate transitions are rejected. One order identity per consumer/drop remains; a cancelled identity is not silently recreated.

Cancelling confirmed demand rechecks readiness immediately. If a **planned** run is no longer supportable (below threshold, above remaining demand, or missing capacity), it is cancelled by an audited system cascade and its recovered/auxiliary reservations released. Its original quantities and price remain in history. The drop returns to market testing and can unlock a new plan after new valid commitments and allocations.

After **approval**, cancellation creates a business exception and blocks starting if the remaining commitments cannot support the plan. A brand can explicitly cancel the approved run. After **in_production**, demand cancellation records the exception without restoring any material or cancelling manufacturing. Completion must reconcile physical material. Completed runs cannot be cancelled. Historical exceptions remain visible even after reconciliation.

## Explicit BOM

Recipes own immutable component records with unit (`kg` or `each`), requirement per produced unit, mass per component unit, recovered/non-recovered classification and accepted grades. Existing material requirements remain the recovered-component reservation interface. Auxiliary requirements use separate supplier stock sources, allocations, releases and consumption records.

The calibrated Utility Bag BOM is:

| Component | Per product | Source | Seed reservation |
|---|---:|---|---:|
| Cotton Denim | 1 kg | recovered fabric | 67.2 → 68 kg |
| Lining | 0.18 kg | simulated supplier | 12.24 kg |
| Zipper | 1 each, 0.01 kg each | simulated supplier | 68 each |
| Hardware | 2 each, 0.005 kg each | simulated supplier | 136 each |

The 1 kg recovered-denim allowance preserves the existing calibrated demo; it is not a validated cutting pattern. Auxiliary stock is not counted as recovered denim. Supplier and residual stock can be reserved separately through optional accounting controls. A source cannot supply multiple drops with the same units. Each-based inputs must be integers.

`capacity = MIN(FLOOR(available component / per-product requirement))` across recovered **and** auxiliary components. Every required component must reach its minimum before production. Confirmed demand must fit capacity. The recovered-denim minimum remains **68 kg**; auxiliary minima cover the **42-order** maker minimum. Supplier seed availability supports at most 68 products, retaining the headline capacity.

Existing historical/started runs are not retroactively given extra physical inputs. The migration adds auxiliary requirements and labelled simulated stock only to eligible existing demo drops. New seeded runs always include the full BOM. Newly generated non-Utility recipes retain their explicit registered recovered-material BOM; additional real manufacturer specifications remain future work.

## Inspected quality

Verified sources record controlled values:

- Grade: A, B, C, fibre_only.
- Composition: cotton_rich, cotton_blend, synthetic, unknown.
- Colour: blue, dark, light, mixed, unknown.
- Fabric weight class: light, medium, heavy, unknown.
- Panels: large, small, fibre_only.
- Contamination: clean, requires_cleaning, contaminated.

Utility Bag and Jacket accept A/B; the Small Pouch accepts A/B/C. Material compatibility **and** accepted grade, clean status, suitable panels and cotton composition must pass. Unknown/contaminated/fibre-only sources cannot enter current product recipes. Colour and fabric weight are recorded descriptors, not invented compatibility restrictions.

Before inspection, the existing wardrobe match explicitly states its provisional grade B assumption. After inspection, matching reads stored verified attributes through `/api/returns/:id/matches`. AI/item confirmation endpoints reject injected quality fields. The separate human inspection form allows corrections; quality on receipts/sources then becomes immutable. Residuals retain their source quality and lineage. Defaults and legacy attributes are labelled prototype assumptions; they do not prove physical testing.

## Production mass balance

Completion appends per-allocation recovered and auxiliary consumption, then one `production_mass_balances` record. It requires:

```text
allocated input = consumed input + recoverable residual + non-recoverable residual
```

Tolerance is **0.001 kg**. PostgreSQL compares the statement with the actual component ledger; a balanced but fabricated summary is rejected. Consumption cannot exceed its allocation. Non-recoverable material remains a recorded debit/loss and never becomes stock.

**Process scrap is a subset of residual**, not an extra additive term. Explicit non-recoverable scrap must be no greater than process scrap; scrap cannot exceed unused recovered input. The prototype currently attributes entered scrap/loss to recovered fabric, while auxiliaries use exact recipe consumption and reusable leftovers. Default completion assumes zero declared scrap/loss. Real-world measured reconciliation would require maker measurements and a richer per-component process model.

Default complete run:

- Recovered fabric: 68 kg input = 42 kg consumed + 26 kg recoverable residual.
- Auxiliaries: 13.6 kg input = 8.4 kg consumed + 5.2 kg reusable stock.
- Total: **81.6 = 50.4 + 31.2 + 0 kg**.

With 3 kg explicitly declared scrap, including 2 kg non-recoverable:

- Total: **81.6 = 50.4 + 29.2 + 2 kg**.
- Scrap 3 kg is included inside the two residual categories.

Recoverable fabric creates new `material_sources`; reusable auxiliary leftovers create new `auxiliary_sources`. Both can fund future production. No environmental benefit or CO2 saving is inferred from either category.

## Rewards and corrections

Existing base/bonus entries retain their original types and expose lifecycle **earn**. New signed entries support **redeem**, **reverse**, **expire**. The small UI redemption deducts 50 simulated credits; it creates no actual voucher or payment. Admins can reverse a transaction or record a bounded expiry. PostgreSQL locks the consumer balance and rejects overdrafts and duplicate reversals, even without the service's workspace lock.

A reversal offsets the full original amount. Expiry may partially debit an earn, bounded by its remaining unexpired amount; reversing an expiry restores that amount's availability. Earn/bonus uniqueness per receipt remains. No negative balance policy is enabled.

Return correction is a **full void of an accepted inspection**, not an edit of old measured kilograms. It atomically releases legally releasable material, reverses active expirations and earnings, and records a receipt correction. It rejects material committed to approved/started/completed production or spent credits that cannot be reversed. An approved run must be explicitly cancelled first. A new inspection requires a new reviewed item/return. Rejected receipts have nothing to credit or reverse. This conservative state-machine rule does not imply jurisdiction-specific legal advice.

## Additional APIs

All are POST, locally scoped, runtime validated, role/ownership checked and audited:

- `/api/preorders/:id/confirm|cancel|refund|fail`
- `/api/allocations/:id/release` with kg
- `/api/production-runs/:id/cancel`
- `/api/production-runs/:id/complete` with optional `processScrapKg`, `nonRecoverableKg`, command key/reason
- `/api/returns/:id/correct`
- `/api/returns/:id/matches` (read-only matching via existing POST boundary)
- `/api/rewards/redeem` with amount
- `/api/rewards/:id/reverse|expire`
- `/api/drops/:id/receive-auxiliary|allocate-auxiliary`

New reversal/redemption/supply operations require `{ requestKey: UUID, reason: string }`. Legacy completion with `{}` remains supported; its unique final mass statement prevents replay. No external payment, collection or reward API is called.

## Database invariants

- Immutable ledger rows and typed original references.
- Material release ≤ remaining original allocation; source balance cannot become negative.
- All component capacities and required minima enforced before planning, approval and start.
- Grade/composition/cleanliness checks on recovered allocations.
- Unique preorder target transitions; status changes require immutable events.
- One active production run per drop; cancelled history retained.
- No cancellation of started/completed production; no release of committed input.
- Unique receipt earnings; unique reversal per original; nonnegative signed reward balance.
- Per-allocation consumption reconciliation and total mass statement checked in PostgreSQL.
- Idempotent command keys, transactional rollback and audit history.

The app remains a localhost demo with simulated identity selection. These accounting controls improve internal integrity; they do not supply production authentication, legal return policies, actual supplier verification or a validated manufacturing model.
