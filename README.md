# Remix Drop

**Turn surplus into products people have already chosen.**

A Next.js hackathon MVP for demand-before-production circular retail. It compares keeping products in use, repairing them, remaking material and recycling. It then tests demand for one selected Remix concept before unlocking production.

## Run

Node.js 22+ and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Next.js (normally http://localhost:3000).

```sh
npm run typecheck
node --test tests/engines.test.cjs
npm run build
```

The production build statically exports to `out/`. Host that directory on a static web server; `next start` is not the preview command for a static export.

## Problem and solution

Surplus inventory loses value. Remaking it without checking demand can produce another generation of unwanted products. Remix Drop first compares circular routes, then uses material-constrained concepts and simulated pre-orders to demonstrate how brands can avoid speculative remanufacturing.

This iteration is a deterministic prototype, **not a scientifically validated decision system**, real demand prediction or production marketplace. No authentication, payments, Supabase or external API is required.

## Three-minute demo

1. Start with 180 Denim Jeans, Cotton Denim, Unsold / Minor Defects, SGD 69 original price and 142 kg reusable material.
2. Analyse routes. Remix wins the calculated comparison; expand **Why this route?** to inspect inputs and weighted score contributions.
3. Inspect three alternative designs: Tote capacity 68, Sleeve 92, Jacket 31. Select Denim Tote and launch its consumer drop.
4. Tote begins with 41 / 42 simulated confirmed pre-orders. Vote, reserve, or confirm a demo pre-order. The explicit 42nd-order demo button uses the same order action.
5. The 42nd order goes directly to the impact view with an animated **PRODUCTION UNLOCKED** banner, 42 orders and SGD 2,058 committed gross sales.
6. The same view shows 180 jeans **assessed**, 84% estimated design utilisation, 68 maximum units, SGD 3,332 maximum potential gross sales, and zero speculative units produced before validation.

Reset restores all defaults. Editing inventory resets demand so previous commitments cannot silently survive changes to material, cost or capacity. Switching the selected concept also starts its own seeded demand scenario; after the user places an order, reset or edit inventory before switching. Non-selected concepts remain interest tests with votes and reservations, not competing material commitments.

## Calculation architecture

```text
lib/mock-data.ts       Typed inputs, material/condition assumptions,
                      product recipes and simulated demand seeds
        ↓
lib/remix-engine.ts    Available material → capacities, design yields,
                      suggested prices, unit costs and feasibility
        ↓
lib/circular-engine.ts Four routes → gross value estimates,
                      factor contributions, explanations and recommendation

lib/economics.ts       Selected concept + confirmed orders → gross sales,
                      estimated production cost and unlock eligibility
        ↓
React workflow state → route-analysis / concepts-view / consumer-drop / impact-view
```

The UI consumes engine results; it does not store fixed route scores, capacities or impact revenue. Product recipes and behavioural assumptions live outside the UI. React state is session-local and resets on reload.

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

## Verification

The automated engine tests cover default capacities and recommendation, exact unlock arithmetic, half/double quantities, insufficient stock, changing condition/material/price, missing/zero/excessive material, score reconstruction and a single selected material allocation.

Manual browser checks cover the complete default workflow, expandable explanations, inventory edits and resulting figures, desktop/mobile layouts, checkout confirmation and reset.

## Stack and accessibility

Next.js App Router, React, TypeScript, Tailwind CSS 4, custom shared design tokens and Lucide icons. Existing generated product concept photography and premium retail design are retained. Responsive layouts, semantic forms and native details controls, keyboard focus styling, dialog focus trapping, labelled progress bars, live status messages, reduced-motion support and reset remain available.

An optional feature-detected WebMCP tool navigates the same workflow stages. It performs no payments or external writes. This MVP has no authentication, persistent multi-user state, payment collection or actual manufacturing.
