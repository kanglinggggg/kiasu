# Remix Drop

**Turn surplus into products people have already chosen.**

A hackathon MVP exploring demand-backed circular retail. The waste already exists. The demand is validated. Only then do we produce.

## Problem statement

Surplus retail inventory loses value through markdowns, storage and disposal. Remaking inventory without testing demand can create another generation of unwanted products. Brands need to compare recovery routes, identify feasible remakes, and validate willingness to buy before manufacturing.

## Solution

Remix Drop connects circular route comparison with product concepts, consumer votes, reservations and simulated pre-orders. The demo recommends Remix for one reference denim batch while preserving clearance, repair and recycling as alternatives. It does not automatically upcycle everything.

## Run locally

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000. If Next.js selects another port, use the URL in the terminal.

```bash
npm run typecheck
npm run build
```

The build produces a static Next.js export in `out/`, suitable for static hosting. `next start` is not used for this export; serve `out/` with a static server for a production preview.

## Three-minute user workflow

1. **Surplus inventory:** review or edit the prefilled 180-jean batch, then submit. Required numeric fields validate positive quantities.
2. **Circular route analysis:** compare clearance, repair + resale, remix and recycling. Select alternatives to inspect the decision. The supplied demo recommends Remix.
3. **Remix concepts:** inspect Denim Tote, Laptop Sleeve and Patchwork Jacket with costs, prices, capacities, utilisation, difficulty and reasons.
4. **Consumer drop:** vote, reserve, or open the simulated pre-order confirmation. Each action is counted once per concept in the current session. All three product cards show responsive demand statistics.
5. **Production threshold:** use “Demo: add the 42nd pre-order” or pre-order the tote. The 41 → 42 transition opens the production-unlocked celebration.
6. **Impact:** select “See the impact”. The live demo count starts at 42. “Simulate 48 buyers” advances the follow-on scenario to 48, alongside the supplied impact projections.

The header reset button restores all initial values. Stage navigation and both Brand Studio and Consumer Drop are accessible throughout the demo. State is local React state and resets on reload; there are no accounts, payments, backend calls or persistent shared orders.

## Architecture

```text
Next.js App Router (static export)
  └─ RemixApp: workflow + batch + demand state
      ├─ Brand inventory form
      ├─ Circular route comparison
      ├─ Material-led product concepts
      ├─ Consumer cards + simulated checkout
      ├─ Unlock modal
      └─ Impact scenario

lib/mock-data.ts → typed batch, routes, concepts, demand seeds
components/ui.tsx → product imagery, progress, section headings
app/globals.css → responsive visual system, animation, reduced motion
```

## Core concepts

- **Circular value ladder:** assess resale and repair before remaking or recycling. The mock route recommendation is explicit and inspectable.
- **Demand before production:** votes and reservations express intent; only demo pre-orders count toward the threshold.
- **Waste-defined scarcity:** the tote is capped at a stated material capacity of 68. Concept capacities describe alternative uses of the same batch and cannot be summed.
- **Zero speculative Remix units:** the prototype demonstrates the rule; it does not create real manufacturing orders or measure real waste reduction.

## Demo assumptions and limitations

All route scores and figures are supplied illustrative fixtures, not a validated AI analysis, maker quote or environmental assessment. Editing the batch stores and displays your inputs but does not recalculate the reference route/concept/impact estimates; the interface states this explicitly.

The requested tote threshold is fixed at **42**. It is not computed from costs. If setup cost is SGD 800 and contribution is SGD 19/unit, the mathematical break-even is 43, not 42. No setup-cost claim is made in this demo.

The requested SGD 4,380 projected inventory recovery value is a full-batch illustrative scenario, not tote revenue: 68 × SGD 49 = SGD 3,332 gross tote revenue. Gross recovery must not be treated as profit. The 180-jean and 84% impact figures do not establish actual material consumption or avoided disposal. The interface labels these projections and distinguishes them from the interactive order count.

Before production, a real service would need maker-approved patterns, material allocation across concepts, payments/refunds, deadline and cancellation handling, verified stock and cost accounting. No real payments are collected. Votes, reservations and orders are deliberately simulated independently per concept for demonstration.

Product photography is AI-generated concept imagery, not a photograph of a verified manufactured sample.

## Technical stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4 and shared custom design tokens
- Lucide React icons
- Local typed mock data (no Supabase credentials required)
- Static export for portable deployment

An optional feature-detected WebMCP navigation tool exposes the same workflow stages in supported browsers. It is not required for ordinary use.

## Accessibility

Semantic forms, required fields and numeric constraints, keyboard focus styles, labelled progress bars, product image descriptions, dialog focus trapping, Escape dismissal, live status notifications and reduced-motion support. Layout adapts from desktop to mobile.

## Future production architecture

A future Supabase backend can store brands, batches, concepts, drops, interactions, pre-orders and material allocations. Trusted server-side transactions would enforce allocation and order limits; authenticated brand access, payment webhooks and maker approvals must be implemented before operating a marketplace.
