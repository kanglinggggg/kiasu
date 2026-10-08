# terise

**Turn demand into recovery, and recovery into the next drop.**

Demand tells us what materials are needed. Recovered materials determine what can be produced. The loop is **WEAR → RETURN → MATCH → UNLOCK → REMIX**, with keeping, repairing and reusing wearable clothing ahead of recovery.

Retail surplus can become another generation of unwanted products if it is remade without demand. terise compares circular routes, verifies supported recipes and material, and requires confirmed buyers before production. Consumers contribute useful material to drops with actual material needs. This is **Demand-Driven Material Recovery**: observe demand → identify required material → reward matching returns → recover material → produce confirmed demand. Conventional collection often decides the material destination later.

## Why terise

terise is our own spelling of Teresa, inspired by the ideas of harvest and summer. We want brands and people to gain something from what already exists, and to do our part in giving the Earth its summers back.

让企业和每个人都有所收获，也还给地球正常的夏天。🌞

## Run locally

Prerequisites: Node.js 22+, npm and PostgreSQL 17. This Windows workspace uses a dedicated project database on `127.0.0.1:55432`, separate from any existing PostgreSQL service.

```powershell
npm install
npm run db:local
npm run db:migrate
npm run db:seed
npm run dev
```

Open [terise locally](http://127.0.0.1:3000). The app runs locally; pushing the source to GitHub does not deploy it. `db:local` starts or initializes `.local-data/postgres`, generates a local password and writes the server-only `DATABASE_URL` and `LOCAL_DEMO=true` into ignored `.env.local`. It expects PostgreSQL at `C:\Program Files\PostgreSQL\17\bin`. For another PostgreSQL installation, set a suitable `DATABASE_URL` in `.env.local`, set `LOCAL_DEMO=true`, and run migration/seed directly. Back up `.local-data` and `.env.local` together using normal PostgreSQL backup procedures; do not delete the cluster to reset the demo.

Migrations are versioned and seed is idempotent. **Reset demo creates a new persistent workspace**, preserving previous runs. Use the Demo run selector to revisit them. Restart the database with `npm run db:local` after a machine restart.

```sh
npm run typecheck
npm test                 # 23 existing unit tests + PostgreSQL integration tests
npm run test:api         # independent HTTP sessions; requires local server on port 3000
npm run build
npm start                # stop dev first if using the same port
```

Both web scripts bind to 127.0.0.1. Integration tests create isolated workspaces in the local database; tests never clear existing records. They require migrations and `DATABASE_URL`. API tests create an isolated saved demo run and use separate cookie sessions.

## Three-minute demo

1. Remain **Demo Operator** and select **Scan an item**. Optional Demo AI identifies a damaged pair of Cotton Denim jeans; review type, condition and usage. Confirm the item. Good wearable clothing instead recommends Keep & Restyle, repair or reuse.
2. Match the default 0.8 kg estimate to **Drop #024, Denim Utility Bag**. It has 41 confirmed simulated preorders and 67.2 kg allocated verified-in-demo material. Multiple active drops are evaluated with deterministic compatibility rules.
3. Reserve a mock collection point. **Reservation adds no material or reward.** Simulate receipt, explicitly simulate inspection, then allocate accepted material to the drop. These are separate persisted operations. Accepted verification issues 100 base + 80 demand-bonus credits once; allocation raises material to 68 kg while demand remains 41/42.
4. Confirm the 42nd simulated preorder. Both gates are ready. The Demo Operator requests the server unlock; **DROP UNLOCKED** and impact show 42 buyers, 68 kg allocated material, capacity 68 and **SGD 2,058 committed gross sales**.
5. Optionally approve, start and complete the planned 42-unit production. The recipe consumes 42 kg; **26 kg enters the future material pool** as traceable residual sources. Use Brand Studio's material ledger to allocate them to a later compatible drop.
6. Reload or change local identity. Wardrobe, returns, contributions, preorders, reward entries, production and inventory balances remain stored. A consumer can contribute and preorder; a brand user approves production. Only the combined Demo Operator role auto-requests unlock for the short presentation.

Reverse steps 3 and 4 to show that demand alone cannot unlock production. All inspection, payment and manufacturing actions remain clearly simulated; no physical collection, voucher or payment service is contacted.

## Preserved Brand Studio

B017 is a **separate** 180-jean / 142 kg brand-demo batch, fully assigned to the existing Denim Tote drop. Select Analyse circular routes → Explore Remix concepts → Generate Remix Opportunities → Denim Tote → open its drop. The default recommendation is Remix; other conditions can recommend resale, repair or recycling. The existing Tote has 41 seeded orders, capacity 68 and price SGD 49. One preorder gives 42 orders and SGD 2,058; the maximum potential gross sales are SGD 3,332. Unselected concepts are alternative historical material uses, not extra available production capacity.

Editing quantity, price, material, condition or weight updates deterministic estimates. Saving corrected inputs creates a **new batch**, preserving old orders and allocations. Generate proposals, confirm the separate inventory inspection and launch a supported concept. New drops start at **zero observed demand**, never fabricated 41-order history. The database refuses reuse of already allocated material. The interface separates estimated potential from available verified kilograms.

The consumer-loop batch D102 contains 180 jeans and 142 kg verified-in-demo material: 60 kg allocated to #024, 82 kg remaining. Nine earlier consumer receipts contribute 7.2 kg. The default new receipt contributes another 0.8 kg. B017 does not reuse D102's material.

## Architecture and data

```text
Frontend → Server/API layer → Domain engines → Transaction/service layer → PostgreSQL
```

- `src/lib/ai/`: optional interpretation, extraction, styling and product ideation.
- `circular-engine.ts`, `remix-engine.ts`, `economics.ts`: preserved deterministic route scoring, material capacities and financial arithmetic.
- `material-match-engine.ts`, `rewards-engine.ts`, `return-engine.ts`, `unlock-engine.ts`: composition compatibility, recovery reward rules, circular hierarchy and pure gate logic.
- `src/lib/server/validation.ts`: strict runtime schemas; no client-supplied verified values in extraction endpoints.
- `src/lib/server/service.ts`: role/ownership checks, transactions, lifecycle transitions, allocation, order creation, inspections and production reconciliation.
- `src/lib/server/snapshot.ts`: consistent reads, derived balances, histories and observed analytics.
- `db/migrations/`: relational entities, foreign keys, uniqueness, immutable ledgers and allocation/production guards.
- `src/lib/persistent-client.ts`: API-backed client snapshots. Local state contains editable drafts and navigation only.

**AI = interpretation. Domain engines = calculation. Database = authoritative state. Ledger = traceability. Consumers = demand validation.**

See [architecture, ERD, API and state transitions](docs/architecture.md) and [full calculation assumptions](docs/calculation-assumptions.md).

The material ledger tracks brand inventory, accepted returns and production residuals separately. Transactions, row locks, workspace serialization and unique references prevent double allocation, receipt, reward and preorder. Production capacity is derived from verified component allocations. Explicit recipe BOMs distinguish recovered fabric from required auxiliary components. Capacity is limited by the scarcest component; the short demo keeps auxiliary details collapsed.

Brand analytics count stored votes, reservations, preorders, returns, matches and chosen routes. They are labelled **Observed demo data**. Forecast ranges and scores are **Prototype predictions/estimates**. No fixed 68% preference is presented as observed evidence. Reward balance is the signed sum of earn/redeem/reverse/expire entries. Inventory remaining weight includes immutable releases and correction events.

## Accounting and physical materials

The optional **Accounting controls** panel supports preorder cancellation/refund, 50-credit simulated redemption, reward reversal/expiry, unused allocation release, accepted-return correction and planned/approved production cancellation. Every action retains the original history, references the original transaction and has an idempotency key. Only confirmed preorders count toward readiness. Cancellation of an unsupported planned run revokes readiness; demand changes after approval become visible business exceptions.

The Utility Bag BOM keeps its 1 kg recovered-denim allowance and adds separately tracked lining (0.18 kg), zipper (1 each) and hardware (2 each). Calibrated simulated supplier stock supports 68 units. Every required component must be ready. Inspections record controlled quality attributes; A/B fabric can match the Utility Bag, while the Pouch also accepts C. AI never sets verified quality.

Completion reconciles **allocated = consumed + recoverable residual + non-recoverable residual**, within 0.001 kg. Process scrap is included within residuals, never double-counted. Default recovered denim still gives 68 = 42 + 26 kg; including auxiliaries, total mass is 81.6 = 50.4 + 31.2 kg. No environmental benefit is inferred.

See [reversal accounting, lifecycle, BOM, quality, mass balance and invariants](docs/accounting.md). Original workflows and tests remain in place. The headline is unchanged: **67.2 + 0.8 kg, 41 + 1 orders, SGD 2,058**.

## AI and human review

**AI proposes; deterministic engines verify; consumers validate demand.** AI handles ambiguity. Deterministic rules handle commitments.

AI may suggest product type, material, condition, quantity, styling or concept names and qualitative reasons. Users can correct all extracted inputs. Confidence is indicative and uncalibrated; confirmation of a classification is not physical verification. Only explicit inspection records supply verified material. AI cannot set rewards, allocation, route-score arithmetic, final price, material capacity, thresholds or unlock eligibility.

**Demo AI** works without an external API. It uses curated suggestions and deterministic text/CSV-like extraction. Optional images are human review references, not analysed by this mode. Unsupported concepts, such as Denim Sneakers, fail the recipe check. The exact same review and feasibility workflow is used in connected mode.

**Connected AI** is optional: add `OPENAI_API_KEY` and `OPENAI_MODEL` to the existing `.env.local`, without overwriting its database settings, then restart Next.js. The server adapter uses structured JSON, validates outputs and exposes only allowed suggestions. Credentials never enter browser code. The configured model must support the adapter's structured output and optional image input. Provider errors do not silently change inventory or switch modes. Connected mode tests mock transport; a live paid model call is not part of local verification.

## Assumptions and current limits

- Material recovery estimates, circular scores, concept yields and maker minima are prototype assumptions, not validated commercial or environmental results. No CO2 savings or universal disposal-avoidance claim.
- Verified-in-demo fields result from explicit simulated inspection. They do not prove laboratory composition or physical receipt. Conservative verified weight cannot exceed the rule-based estimate; correct source inputs before inspection if the estimate is wrong.
- Prices/costs come from supported recipes. Gross sales mean quantity × price, not profit. Setup, logistics, refunds and other costs are not a complete profit model.
- Waste-Defined Scarcity comes from allocated recovered material, not a marketing cap. Each source can be spent once. Production must satisfy **both demand and material**, with orders within deterministic capacity.
- Local identity switching is a lightweight role simulation, **not production authentication**. APIs enforce local-origin access and server ownership, but the app is intentionally not ready for public deployment. No Supabase account or cloud service is needed.
- No real payments, vouchers, collection logistics or manufacturing. Simulated redemption, immutable reversals, bounded material releases and planned/approved production cancellation are supported. Started production requires explicit reconciliation; completed runs cannot be cancelled.
- Supported recipes and material classifications are limited. Images are not stored as authoritative inventory evidence. Database migrations support additional drop components without a complex multi-material UI.

## Verification

Existing 23 engine/AI/loop unit tests remain intact. PostgreSQL integration tests exercise actual transactions, duplicate calls, cross-drop over-allocation, rejected and partial returns, reward integrity, each independent unlock gate, production bounds, residual reuse, ownership, unsafe AI fields and persistent fresh reads. HTTP tests use two independent cookie sessions and concurrent mutations against the running application.

The local browser regression covers the brand route/concept/drop flow, consumer receipt/inspection/allocation/preorder flow, reload persistence, dynamic quantity and responsive desktop/mobile layouts. No authentication provider, payment provider or external publishing is used.

Next.js, React, TypeScript, Tailwind CSS, Zod and PostgreSQL (`pg`). Existing product imagery, editorial layout, accessible labels/progress, keyboard dialog focus, reduced motion, workflow navigation and reset are retained.
