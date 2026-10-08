# Prototype calculation assumptions

These assumptions describe the preserved brand estimation engines. Persisted drops freeze an approved recipe; production uses verified ledger allocations, never a recalculation from unreviewed AI fields.

## Material and capacity assumptions

- Estimated reference reusable weight per source item: `142 / 180` kg.
- Entered reusable kg is optional. If blank, use quantity × estimated weight/item. Entering zero intentionally means no reusable material.
- Quantity edits proportionally scale entered kg using the last kg/item ratio. The user can then override kg. The engine caps available kg at quantity × reference kg/item; this is an explicit conservative prototype rule, not a verified physical measurement.
- Effective material = available kg × material yield × condition panel suitability.
- Cotton Denim yield = 1; Cotton Blend Denim = 0.85.
- Condition panel factors: minor defects 1; good condition 1; broken fastenings 0.95; damaged reusable panels 0.7; fibre-only 0.
- Prototype input allowances per finished product: Tote `142 / 68` kg, Sleeve `142 / 92` kg, Jacket `142 / 31` kg. These are calibration assumptions covering grading, matching and panel constraints; they are not claims about finished product weight or validated cutting patterns.
- Maximum capacity = floor(effective material / input allowance). A small numeric tolerance avoids floating-point rounding one exact whole unit down.
- Design utilisation: base 84%, 77%, 90% respectively × material yield, rounded; zero if no effective material. This is a design estimate for material allocated to that concept, not the percentage of all assessed garments diverted.
- Concepts are **alternative uses of the same material**. Their capacities cannot be added together. Only one selected concept accepts pre-orders.

## Prices, costs and production minimum

Suggested selling price = round(base concept price × sqrt(original retail price / 69) × material price factor), minimum SGD 1. Base prices are SGD 49 / 35 / 95. Cotton factor is 1; blend factor is 0.95.

Estimated unit production cost = base cost (SGD 18 / 14 / 42) × material cost factor × condition cost factor × small-batch loading. Blend cost factor is 1.1; cotton is 1. Condition factors are 1 / 1 / 1.1 / 1.2 / 1.5 in the condition order above. Small-batch loading is 1.2 when capacity is below the maker minimum, otherwise 1.

Maker minima are assumed constants: Tote 42, Sleeve 32, Jacket 20. **These are production minimums, not break-even calculations.** A concept below its minimum cannot launch or accept reservations/pre-orders and receives no seeded orders. A confirmed order cannot exceed capacity.

Gross sales = confirmed order count × suggested price. Maximum potential gross sales = material capacity × suggested price, conditional on selling all units. At the default unlock, `42 × 49 = SGD 2,058`; maximum `68 × 49 = SGD 3,332`.

Production cost shown is only an estimate for the displayed number of units. Setup, logistics, platform fees, returns and other costs are excluded. **No profit is calculated or claimed.**

## Explainable route scoring

Each route returns a `score`, `factors`, `explanation`, financial estimate and viability flag. Six ratings on a 0–100 scale are weighted, each contribution rounded to two decimals, summed and rounded to an integer:

| Factor | Weight | Rating basis |
|---|---:|---|
| Expected value recovery | 30% | Route gross value / highest route gross value × 100 |
| Estimated waste avoidance | 20% | Assumed sell-through × retained material fraction |
| Material utilisation | 15% | Resale 100, repair 95, calculated Remix design yield, recycling 90 |
| Processing ease | 10% | Resale 100, repair 65, Remix 45, recycling 85 |
| Lower production / sales risk | 10% | Assumed route demand percentage; recycling 95 |
| Estimated demand | 15% | Condition-specific assumed demand; recycling 95 |

Gross value formulas:

- Resale: quantity × original price × clearance price retention × resale demand.
- Repair: quantity × original price × repaired price retention × repaired demand.
- Remix: calculated Tote capacity × suggested Tote price × assumed Remix demand.
- Recycling: available kg × material fibre value/kg (cotton SGD 1.4; blend SGD 0.7).

| Condition | Resale demand | Repair demand | Remix demand | Clearance price retention | Repair price retention |
|---|---:|---:|---:|---:|---:|
| Minor defects | 12% | 20% | 88% | 25% | 45% |
| Good condition | 90% | 80% | 65% | 65% | 65% |
| Broken fastenings | 8% | 88% | 65% | 15% | 70% |
| Damaged panels | 2% | 4% | 82% | 10% | 30% |
| Fibre only | 0% | 0% | 0% | 0% | 0% |

Waste avoidance ratings: resale = demand × 100; repair = demand × 95; Remix = demand × calculated utilisation; recycle = 90. These illustrative ratings do not prove disposal avoidance, lifecycle benefit or mass balance. They intentionally favour preserving existing products where feasible. Demand and risk are correlated assumptions, not independent evidence.

Viability gates: resale demand ≥10%; repair demand ≥15%; Remix positive assumed demand and capacity ≥42; recycling positive available kg. Resale and repair also require a positive item count. The highest-scoring viable resale/repair/Remix route wins. Recycling is only recommended when those routes fail; a high recycling score cannot override a viable higher-value pathway. Zero-stock input returns no recommendation.

The default recommends Remix. Good condition recommends resale, broken fastenings recommends repair, and fibre-only stock recommends recycling. Route comparison is based on a Tote scenario before concept selection; that is identified in the explanation and is not recomputed as a different product's route value.


The seeded Utility Bag uses a separate 1 kg/unit recipe and a 68 kg material gate. Its 42-unit production consumes 42 kg and returns 26 kg to the future pool. Compatibility scores are classification rules, not a second material-yield multiplier.
