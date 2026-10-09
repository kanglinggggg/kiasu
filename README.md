# terise

**Turn demand into recovery, and recovery into the next drop.**

Demand tells us what materials are needed. Recovered materials determine what can be produced. The loop is **WEAR → RETURN → MATCH → UNLOCK → REMIX**, with keeping, repairing and reusing wearable clothing ahead of recovery.

Retail surplus can become another generation of unwanted products if it is remade without demand. terise compares circular routes, verifies supported recipes and material, and requires confirmed buyers before production. Consumers contribute useful material to drops with actual material needs. This is **Demand-Driven Material Recovery**: observe demand → identify required material → reward matching returns → recover material → produce confirmed demand. Conventional collection often decides the material destination later.

## Why terise

terise is our own spelling of Teresa, inspired by the ideas of harvest and summer. We want brands and people to gain something from what already exists, and to do our part in giving the Earth its summers back.

## Try the website

[Open terise](https://kanglinggggg.github.io/terise/) — a public, static demo on GitHub Pages. It uses sample data, browser-side Local CLIP and Demo AI. Try the brand analysis or scan a pair of jeans, confirm the simulated return, then place the 42nd preorder. Refreshing resets the demo. No real collections, payments or accounts are created.

The local app below is the full PostgreSQL version, including inspection, immutable ledgers, reversals and production accounting. The website does not connect to that database.

`npm run build:pages` builds the public demo into `.pages-build/out` using a separate build directory. Only the generated static files are deployed. Pushes to `main` publish through `.github/workflows/pages.yml`.

## Run locally

Prerequisites: Node.js 22+, npm and PostgreSQL 17. This Windows workspace uses a dedicated project database on `127.0.0.1:55432`, separate from any existing PostgreSQL service.

```powershell
npm install
npm run db:local
npm run db:migrate
npm run db:seed
npm run dev
```

Open [terise locally](http://127.0.0.1:3000). Local changes are not published by these commands. The repository's existing Pages workflow publishes when changes are pushed to `main`; do not push during local review. `db:local` starts or initializes `.local-data/postgres`, generates a local password and writes the server-only `DATABASE_URL` and `LOCAL_DEMO=true` into ignored `.env.local`. It expects PostgreSQL at `C:\Program Files\PostgreSQL\17\bin`. For another PostgreSQL installation, set a suitable `DATABASE_URL` in `.env.local`, set `LOCAL_DEMO=true`, and run migration/seed directly. Back up `.local-data` and `.env.local` together using normal PostgreSQL backup procedures; do not delete the cluster to reset the demo.

Migrations are versioned and seed is idempotent. **Reset demo creates a new persistent workspace**, preserving previous runs. Use the Demo run selector to revisit them. Restart the database with `npm run db:local` after a machine restart.

```sh
npm run typecheck
npm test                 # all pure-engine/provider and PostgreSQL integration tests
npm run test:api         # independent HTTP sessions; requires local server on port 3000
npm run build
npm start                # stop dev first if using the same port
```

Both web scripts bind to 127.0.0.1. Integration tests create isolated workspaces in the local database; tests never clear existing records. They require migrations and `DATABASE_URL`. API tests create an isolated saved demo run and use separate cookie sessions.

## Three-minute demo

1. Remain **Demo Operator** and select **Scan an item**. Optional Demo AI identifies a damaged pair of Cotton Denim jeans; review type, condition and usage. Confirm the item. Good wearable clothing instead recommends Keep & Restyle, repair or reuse.
2. Match the default 0.8 kg estimate to **Drop #024, Denim Utility Bag**. It has 41 confirmed simulated preorders and 41.2 kg allocated verified-in-demo material. Multiple active drops are evaluated with deterministic compatibility rules.
3. Reserve a mock collection point. **Reservation adds no material or reward.** Simulate receipt, explicitly simulate inspection, then allocate accepted material to the drop. These are separate persisted operations. The well-supplied default issues 100 base credits and no shortage bonus; allocation raises material to 42 kg while demand remains 41/42.
4. Confirm the 42nd simulated preorder. Both gates are ready. The Demo Operator requests the server unlock; **DROP UNLOCKED** and impact show 42 buyers, 42 kg allocated material, a 42-unit plan and a waste-defined maximum of 68 and **SGD 2,058 committed gross sales**.
5. Optionally approve, start and complete the planned 42-unit production. The recipe consumes all 42 kg of allocated denim. Any explicitly over-allocated fabric and unused auxiliaries become traceable residual sources for later compatible drops.
6. Reload or change local identity. Wardrobe, returns, contributions, preorders, reward entries, production and inventory balances remain stored. A consumer can contribute and preorder; a brand user approves production. Only the combined Demo Operator role auto-requests unlock for the short presentation.

Reverse steps 3 and 4 to show that demand alone cannot unlock production. All inspection, payment and manufacturing actions remain clearly simulated; no physical collection, voucher or payment service is contacted.

For the dedicated acceptance case, use **New genuine-shortage scenario**. It creates its own labelled workspace with 41 confirmed buyers, 41.2 kg allocated Cotton Denim, zero compatible unallocated stock and a genuine 0.8 kg planned-batch shortage. The homepage advertises that need. Reserving a return still grants nothing; accepting the inspected 0.8 kg return issues a deterministic capped shortage bonus, removes the bounty from the homepage, and allocation makes every seeded BOM component ready. The 42nd simulated checkout then satisfies demand and unlocks the 42-unit plan. This scenario does not alter the well-supplied default.

## Preserved Brand Studio

B017 is a **separate** 180-jean / 142 kg brand-demo batch, fully assigned to the existing Denim Tote drop. Select Analyse circular routes → Explore Remix concepts → Generate Remix Opportunities → Denim Tote → open its drop. The default recommendation is Remix; other conditions can recommend resale, repair or recycling. The existing Tote has 41 seeded orders, capacity 68 and price SGD 49. One preorder gives 42 orders and SGD 2,058; the maximum potential gross sales are SGD 3,332. Unselected concepts are alternative historical material uses, not extra available production capacity.

Editing quantity, price, material, condition or weight updates deterministic estimates. Saving corrected inputs creates a **new batch**, preserving old orders and allocations. Generate proposals, confirm the separate inventory inspection and launch a supported concept. New drops start at **zero observed demand**, never fabricated 41-order history. The database refuses reuse of already allocated material. The interface separates estimated potential from available verified kilograms.

The consumer-loop batch D102 contains 180 jeans and 142 kg verified-in-demo material: 34 kg allocated to #024, 108 kg remaining. Nine earlier consumer receipts contribute 7.2 kg. The default new receipt contributes another 0.8 kg. B017 does not reuse D102's material.

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

### Single-brand pilot boundary

The local marketplace can hold more than one brand for authorization regression tests, while each Brand Studio remains private. A brand snapshot includes only its own inventory batches, verified source balances, concepts, drops, allocations, production records, location analytics and sales totals. Consumer snapshots expose published product projections but omit batch IDs, unit costs, concepts, private sources, allocations and financial totals. PostgreSQL records immutable brand ownership on batches, concepts and drops, derives every recovered source owner from its lineage, and rejects cross-brand material allocation even for an admin/demo command.

Material Wanted uses `planned BOM requirement - verified allocation - authorized compatible available stock`. “Authorized” means inventory, accepted returns and residuals belonging to the Drop’s brand. Another brand’s private surplus cannot suppress a bounty or fund the Drop. Cross-brand material trading, loyalty settlement and designer marketplaces remain **proposed roadmap items**; they are not implemented or claimed by this MVP.

The Utility Bag BOM keeps its 1 kg recovered-denim allowance and adds separately tracked lining (0.18 kg), zipper (1 each) and hardware (2 each). Calibrated simulated supplier stock supports 68 units. Every required component must be ready. Inspections record controlled quality attributes; A/B fabric can match the Utility Bag, while the Pouch also accepts C. AI never sets verified quality.

Completion reconciles **allocated = consumed + recoverable residual + non-recoverable residual**, within 0.001 kg. Process scrap is included within residuals, never double-counted. Default recovered denim gives 42 = 42 + 0 kg; the seeded auxiliaries still support 68 units, so total mass is 55.6 = 50.4 + 5.2 kg. Allocating an extra 26 kg for a residual-accounting scenario gives 81.6 = 50.4 + 31.2 kg. No environmental benefit is inferred.

See [reversal accounting, lifecycle, BOM, quality, mass balance and invariants](docs/accounting.md). Original workflows and tests remain in place. The fresh demo is **41.2 + 0.8 = 42 kg, 41 + 1 orders, SGD 2,058**, with **68** retained as the maximum, not the unlock target.

## AI and human review

**AI proposes; deterministic engines verify; consumers validate demand.** AI handles ambiguity. Deterministic rules handle commitments.

AI may suggest product type, material, condition, quantity, styling or concept names and qualitative reasons. Users can correct all extracted inputs. Confidence is indicative and uncalibrated; confirmation of a classification is not physical verification. Only explicit inspection records supply verified material. AI cannot set rewards, allocation, route-score arithmetic, final price, material capacity, thresholds or unlock eligibility.

**Demo AI** works without an external API. It uses curated suggestions and deterministic text/CSV-like extraction. Optional images are human review references, not analysed by this mode. Unsupported concepts, such as Denim Sneakers, fail the recipe check. The exact same review and feasibility workflow is used in connected mode.

**Brand Connected AI (OpenAI)** remains optional for brand inventory and concept suggestions: add `OPENAI_API_KEY` and `OPENAI_MODEL` to the existing `.env.local`, without overwriting its database settings, then restart Next.js. The server adapter uses structured JSON, validates outputs and exposes only allowed suggestions. Credentials never enter browser code. The configured model must support the adapter's structured output and optional image input. Provider errors do not silently change inventory or switch modes. Connected mode tests mock transport; a live paid model call is not part of local verification.

## Assumptions and current limits

- Material recovery estimates, circular scores, concept yields and maker minima are prototype assumptions, not validated commercial or environmental results. No CO2 savings or universal disposal-avoidance claim.
- Verified-in-demo fields result from explicit simulated inspection. They do not prove laboratory composition or physical receipt. Conservative verified weight cannot exceed the rule-based estimate; correct source inputs before inspection if the estimate is wrong.
- Recipe-card prices and unit costs come from supported prototype recipes. Gross sales mean quantity × price, not profit. The separate Brand Studio forecast adds editable setup, manufacturing, inspection, preparation, logistics, auxiliary, fee, incentive, cancellation-risk allowance and other-cost assumptions; it remains a scenario rather than realized profit. A zero assumption means that cost is excluded and still requires validation.
- Waste-Defined Scarcity comes from allocated recovered material, not a marketing cap. Each source can be spent once. Production must satisfy **both demand and material**, with orders within deterministic capacity.
- Local identity switching is a lightweight role simulation, **not production authentication**. APIs enforce local-origin access and server ownership, but the app is intentionally not ready for public deployment. No Supabase account or cloud service is needed.
- No real payments, vouchers, collection logistics or manufacturing. Simulated redemption, immutable reversals, bounded material releases and planned/approved production cancellation are supported. Started production requires explicit reconciliation; completed runs cannot be cancelled.
- Supported recipes and material classifications are limited. Images are not stored as authoritative inventory evidence. Database migrations support additional drop components without a complex multi-material UI.

## Verification

The pure engine, AI, commerce and loop suites remain intact. PostgreSQL integration tests exercise actual transactions, duplicate calls, cross-drop over-allocation, rejected and partial returns, reward integrity, each independent unlock gate, production bounds, residual reuse, ownership, unsafe AI fields and persistent fresh reads. HTTP tests use two independent cookie sessions and concurrent mutations against the running application.

The local browser regression covers the brand route/concept/drop flow, consumer receipt/inspection/allocation/preorder flow, reload persistence, dynamic quantity and responsive desktop/mobile layouts. No authentication provider, payment provider or external publishing is used.

Next.js, React, TypeScript, Tailwind CSS, Zod and PostgreSQL (`pg`). Existing product imagery, editorial layout, accessible labels/progress, keyboard dialog focus, reduced motion, workflow navigation and reset are retained.

## Planned quantity and material readiness

Before commitment, planned units are `max(minimum viable batch, confirmed preorders)`. For the Utility Bag this means at least 42 units; 50 confirmed orders require inputs for 50 units. Every recovered and auxiliary component must cover `planned units × recipe allowance`, rounded up to the ledger precision. The plan is never reduced to fit missing material. All confirmed demand must fit verified component capacity before unlock.

After unlock, the production run fixes the planned units. Approval and start recheck that quantity against current confirmed demand and every BOM component. Cancellation/release can invalidate an unapproved run through the existing reversal workflow; started runs require explicit reconciliation.

The UI separates required input for the plan, current verified production capacity, and the waste-defined maximum (68 for the Utility Bag). Matching and demand bonuses use the planned shortage, not the gap to 68. Old workspaces with 67.2 kg are already material-ready for 42 units; migration 011 changes calculations without editing their ledger history. Use Reset demo to create the new 41.2 kg scenario.


## Wardrobe photos: Demo AI and Gemini Vision

The wardrobe scan has its own provider boundary. The local Next.js app supports **Gemini Vision**, **Local CLIP** and **Demo AI**; the GitHub Pages export supports **Local CLIP and Demo AI**.

- **Demo AI** is free, deterministic/mock, and makes no external image-analysis request. Uploaded images are local references. Image-only input returns unknown fields for manual review; it does not pretend to see the photo.
- **Gemini Vision** calls Google's official Gemini `generateContent` REST API from the server. It accepts a garment photo, a care-label photo, a description, or a combination. It is subject to the configured provider's quota, pricing and rate limits.

Add both settings to the existing ignored `.env.local`, preserving database settings, and restart Next.js:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=
```

Use an image-capable model available to your Google project that supports structured JSON output. See the [official Gemini API reference](https://ai.google.dev/api/generate-content). Never use a `NEXT_PUBLIC_` key or add credentials to the Pages build. Missing configuration disables Gemini Vision. There is no silent fallback to mocked results.

### Review and material evidence

Upload garment photo -> Scan clothing -> review item and visible condition -> optionally scan care label -> edit suggestions -> Apply reviewed suggestions -> Confirm item -> existing deterministic circular engine.

Garment appearance cannot establish fibre composition. `wardrobe-schema.ts` requires a supplied care-label photo, label-sourced fibre evidence and material confidence of at least 0.75 before retaining a material suggestion. Otherwise material is Unknown, fibre percentages are discarded, and the UI invites a care-label scan. Unsupported types become unknown instead of being coerced into jeans. Readable-label results can still be wrong: confidence is uncalibrated, confirmation saves estimates, and only the inspection workflow creates verified material. Composition text is an editable review reference, not a verified database field.

### Server and trust boundary

`WardrobeScanner` -> `POST /api/wardrobe` -> server-only `gemini-provider.ts` -> strict Zod schema and evidence policy -> editable review. The API does not import database services or write wardrobe records. Only explicit confirmation saves allowlisted item fields. AI cannot inject kg, rewards, capacity, quality verification, allocation, prices or unlock state; unexpected fields are rejected. Circular and accounting engines are unchanged.

JPEG, PNG and WebP uploads accept up to 10 MB, resize locally to a maximum dimension of 1600 px and compress to under 2 MB per analysis input, with request-size bounds and server-side file-signature checks. Images are temporary inputs, are not written to PostgreSQL, and are sent externally only in Gemini mode. Avoid sensitive images. This is not a promise about Google's retention or training policies. The adapter uses a 30-second timeout and returns actionable configuration, quota, refusal, malformed-output and connection errors without changing saved items.

Tests mock Google responses to cover image-only inputs, conservative material evidence, manual corrections, rejected business fields, provider errors and missing-key Demo AI. HTTP regression checks that failed scans leave persisted records unchanged. Live model assessment requires local credentials and real test photos; mocked tests do not establish recognition accuracy.


## V7 fashion commerce

The consumer landing page now leads with an original editorial campaign, product discovery, real material needs, observed community milestones, the five-step circular loop and a wardrobe entry. Brand Studio and the original production controls remain available. Product illustrations are existing project-authorized assets; `public/terise-editorial.webp` is an original AI-generated campaign illustration created for this project, not a copied fashion campaign or a claim about actual garments. Provenance and delivery variants are recorded in [the image asset record](docs/assets.md).

### Checkout and return benefits

Migrations 012–014 add `discount_entitlements`, immutable `entitlement_events`, `checkout_records`, `waitlist_entries`, per-workspace `commerce_policies` and database guards for checkout arithmetic and ledger lineage. An eligible accepted inspection grants one 10% entitlement per receipt, valid for 90 days for the listed supported recipes. Reservation alone grants nothing. Historical non-corrected eligible receipts receive the same entitlement. Inspection, grants and reward earnings commit together.

Shop checkout quotes use integer cents. The default policy is 100 credits = SGD 1, with a combined incentive cap of 25% of product value. Policies can be configured in `commerce_policies`; every checkout snapshots its exchange rate and cap. Creating a checkout reserves one pending preorder and writes an immutable credit debit. It reserves the selected entitlement atomically under the workspace transaction lock. Confirming counts that preorder toward demand and marks the entitlement redeemed. No payment provider is involved.

Cancellation/failure restores credits through a linked opposite ledger entry and returns a non-expired entitlement to available. Refund after cancellation does not restore benefits twice. Correcting a return with an active reserved/redeemed entitlement is rejected until its checkout is cancelled/refunded. Reissued eligibility retains the original expiry and receipt; it is not a new grant. A 30-minute checkout expiry blocks confirmation; the wallet exposes explicit cancellation to release abandoned reservations. There is no background expiry job. The existing one-preorder-per-user-per-drop rule still applies after cancellation.

Product value (GMV), return discounts, redeemed-credit value and net simulated commitments are separate. Legacy undiscounted preorders retain their original full-price economics. Gross sales on production views are commitments, not realized revenue or profit. Brand forecasts include editable fixed and per-unit operating assumptions, incentives and capacity limits; they can show a loss or negative margin uplift.

The conventional baseline uses its independently entered unit count; only the terise scenario is capped by the selected Drop’s verified material capacity. A break-even quantity above that capacity is marked unreachable under current constraints, and contribution margin is shown as N/A when net sales are zero. Redeemed credits reduce forecast net sales once. Outstanding, unredeemed wallet credits are not automatically recognized as a forecast liability; expected redemption belongs in the dedicated credit assumption and must not also be entered as another operating cost.

### AI proposals, recipe approval and product images

AI-generated concepts are proposals. Deterministic feasibility does not make a product production-ready. A new concept must reference a registered recipe BOM, pass the rules, receive an explicit brand review and record a simulated maker review before it can open a market test. PostgreSQL enforces the same gate. Existing seeded Drops carry a visible `Prototype maker review · simulated` record; this is not evidence of a manufacturing partner. Product imagery is illustrative and does not prove that the pictured design is manufacturable.

### Materials Wanted and demand intelligence

V7 shortages use the current planned batch, verified allocated input, grade-compatible authorized unallocated stock and BOM requirements. Available stock is virtually assigned once within each brand, in confirmed-demand order, when displaying multi-drop needs. Unpaid waitlist/reservation signals are labeled separately and never unlock production. No demand is manufactured to fill the 68-unit maximum.

Base credits derive from eligible verified recoverable material. Bonuses require a real uncovered need, are bounded by demand signals, capped at 120 credits per receipt and by a default 10,000-credit workspace budget. Existing ledger entries are never rewritten. In the default D102 workspace, 108 kg remains compatible and unallocated, so the new 0.8 kg return earns 100 base credits with **no false shortage bonus**, plus its qualifying 10% entitlement. Regression tests retain the accounting scenarios with corrected V7 reward expectations. Allocation and the 41-to-42 production story are unchanged.

Community figures aggregate accepted, non-corrected receipts, contributors, confirmed orders, completed production and residual stock. They are labeled simulated. Collection-location totals come from actual receipt references. Preferences and regional growth figures are not invented.

### Browser-side Local CLIP

Gemini Vision remains the primary connected wardrobe option when configured. **Local CLIP** uses `@huggingface/transformers` and `Xenova/clip-vit-base-patch32`, loaded only when Scan clothing is pressed in that mode. Inference runs in a reusable Web Worker using quantized single-thread WASM, including on the static Pages export without cross-origin isolation headers. Download progress is per model file. Successful scans reuse the pipeline; failure/cancellation discards the worker so retry can start cleanly. A three-minute watchdog and explicit Cancel scan keep unsupported or memory-constrained devices recoverable.

The first use requires internet for model files (roughly 150 MB) and runtime assets. Browser caching is best-effort; this is not a guaranteed offline application. Images stay in the browser in Local CLIP; network requests download model/runtime assets, not upload garment photos. The public model and runtime hosts may see normal connection metadata.

Controlled clothing and visual-attribute labels are ranked by relative similarity. Scores are **not calibrated confidence**. Unclear/unsupported types remain unknown, condition requires manual inspection, T-shirt appearance does not prove cotton, and material composition remains Unknown. CLIP does not read care labels. Use Gemini or manual label review for composition suggestions. Demo AI remains the final explicit local/mock fallback; no provider silently substitutes another mode.

The static shop uses clearly labeled in-memory simulated data and resets on reload. It shares quote arithmetic and review components, but PostgreSQL transactions, ledger history and real multi-user invariants apply only to the full local app. Run `npm run test:unit`, `npm run test:integration`, `npm run test:api`, `npm run typecheck`, `npm run build` and `npm run build:pages`. Building the export does not deploy it; the configured Pages workflow deploys a later push to `main`.

### V7 verification notes

The earlier V7 acceptance baseline passed 111 tests. The pilot-hardening review adds same-workspace two-brand privacy, authorized-stock bounty and explicit concept-approval regressions; final committed-revision results are recorded in [the pilot readiness report](docs/pilot-readiness.md). Browser checks exercise a verified return, its one-use discount, credit reservation, refund reconciliation and the SGD 49 - 4.90 - 1.00 = 43.10 checkout. Local CLIP completed actual image-only inference in both Next.js and the static export. Cold download remains too slow for a three-minute pitch, so the runbook uses explicit Demo AI and never waits for CLIP. See [the complete acceptance record](docs/verification.md).
