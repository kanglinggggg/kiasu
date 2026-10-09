# V7 pilot hardening acceptance matrix

Audit date: 9 October 2026

Scope: local, single-brand B2B2C competition pilot with same-workspace two-brand regression fixtures

Release rule: no merge, push, Pages publication or public deployment before the Gemini credential is rotated and the owner gives explicit approval

Status terms used below:

- **Implemented** — present in the application and covered by executed automated or browser evidence.
- **Simulated** — functional pilot workflow using labelled demo identities, records or transactions rather than a live operating partner.
- **Proposed** — intentionally documented as roadmap only.
- **Unverified** — not established by the evidence in this review.

| Critical requirement | Result | Classification | Executed evidence | Boundary or remaining limitation |
| --- | --- | --- | --- | --- |
| Brand-private inventory, material sources, costs, concepts, unpublished Drops, allocations and forecasts stay within the owning brand | Pass for the pilot boundary | Implemented | `tests/tenant.integration.test.ts` exercises two brands in one workspace; brand snapshots contain only owned records, consumer snapshots omit batch IDs and unit costs, and PostgreSQL rejects cross-brand allocation. | Local identities are a demo role switcher. This is not a claim of production authentication, RLS or arbitrary multi-tenant readiness. |
| Public marketplace projections are separated from private Brand Studio data | Pass | Implemented | Consumer HTTP/snapshot tests assert no private batches, concepts, allocations, production records or financial totals; browser review shows only public Drop projections. | Public community values remain clearly labelled simulated local records. |
| Material shortage and bonus use planned BOM need minus verified allocation and authorized compatible available stock | Pass | Implemented | Commerce and tenant integration tests verify the formula, compatible grade rules, per-brand stock consumption and that 100 kg owned by Brand B does not suppress Brand A's 0.8 kg shortage. | Cross-brand stock is never assumed to be authorized. |
| Credits, one-use discounts, checkout commitments, cancellations and forecasts reconcile without double redemption | Pass | Implemented / simulated transaction | Accounting and commerce integration suites cover earn, reserve, redeem, reverse, cancellation, refund, idempotency and concurrent double-spend attempts. Browser checkout reconciled SGD 49.00 - SGD 4.90 - SGD 1.00 = SGD 43.10. | Payments and voucher redemption remain simulated. |
| GMV, net simulated sales and contribution profit are distinct | Pass | Implemented | Economics tests assert GMV, incentives, relevant costs and contribution separately. Brand Studio displays brand-scoped confirmed GMV, net simulated commitments, forecast costs, contribution and margin. | All profitability outputs are forecasts, not realized revenue or profit. |
| AI concepts remain proposals until deterministic feasibility, a registered recipe, brand approval and maker approval exist | Pass | Implemented / simulated approval | Dynamic batch integration rejects Drop launch before approval; concept-approval service registers the recipe and both approvals; database guards reject ownership and approved-economics mutation. | Maker review is explicitly labelled a simulated prototype approval, not a manufacturing partnership. Concept images are illustrative. |
| Circular hierarchy keeps wearable goods in use before Remix or recycling | Pass | Implemented | Pure and integration tests retain Keep & Restyle, Repair and Resell/Donate decisions ahead of material recovery; reward rules reject wearable, unknown, rejected and incompatible items. | Styling and condition inputs are prototype recommendations until human review. |
| Seeded people, votes, orders, collection points, environmental statements and financials are labelled honestly | Pass | Implemented / simulated data | Browser review shows `LOCAL DATABASE`, demo identities, simulated payment, hypothetical collection point, illustrative imagery, observed demo records and forecast labels. Copy explicitly avoids carbon, landfill, customer, partner and measured-impact claims. | No operational collection, maker or customer results have been verified. |
| Cross-brand loyalty settlement, material trading and designer marketplace remain out of scope | Pass | Proposed | README names all three as roadmap items and the allocation guard prevents implicit cross-brand material use. | No settlement or trading workflow is implemented. |
| Profitability includes collection, inspection, preparation, auxiliaries, manufacturing, logistics, incentives, setup and cancellation exposure | Pass as a model | Implemented / unverified assumptions | Unit tests include preparation and cancellation risk exactly once; Brand Studio exposes every requested input and says zero means excluded and still requires validation. | Inputs are editable prototype assumptions, not supplier quotes or measured operating costs. |
| Competition journey reaches a verified production decision | Pass | Simulated end-to-end | Browser run created a genuine-shortage scenario at 41 buyers and 41.2/42 kg; human review saved the item; reservation and receipt granted nothing; accepted inspection issued 194 credits and one 10% entitlement; 0.8 kg allocation removed the bounty; 100-credit checkout produced SGD 43.10; the 42nd confirmed preorder produced SGD 2,058 GMV; explicit brand approval displayed `DROP UNLOCKED`. | The workflow uses deterministic seed records, Demo AI and simulated inspection/payment. |
| Three-minute pitch avoids a cold Local CLIP download | Pass by demo design | Simulated | `docs/demo-runbook.md` uses explicit Demo AI and contains no model download step. The public scanner exposes Demo AI as the selected fallback and Local CLIP as an optional alternative. | Exact presenter timing varies; the full operational audit path is longer than the staged three-minute pitch. |
| Public static demo works without a database or secrets | Pass | Simulated | Static export was served at its real `/terise/` base path; navigation and scanner hydrated, Local CLIP and Demo AI were available, 390 x 844 viewport had no horizontal overflow, and browser console showed no warnings or errors. | PostgreSQL persistence, server transactions and Gemini are local-full-app capabilities and are not represented as persistent on Pages. |
| Gemini connected mode is safe to publish | Hold | Unverified | Keys are server-only in code and `.env.example` contains empty placeholders. Mock provider tests cover the boundary. | The previously exposed key must be rotated by the owner. No live Gemini quota or accuracy run was performed. |

## Executed release gates

- Database migrations through `016_tenant_identity_guards.sql` applied successfully.
- Pure unit/provider suite: **56 passed**.
- PostgreSQL integration/accounting/concurrency/tenant suite: **56 passed**.
- Independent HTTP suite: **2 passed**.
- Total automated tests: **114 passed**.
- TypeScript typecheck: passed.
- Next.js production build: passed.
- GitHub Pages static export: passed.
- Local desktop browser: persistent competition journey completed with no console errors.
- Local 390 × 844 and static 390 × 844 viewport checks: no horizontal overflow and no console errors.
- Tracked files, Git history and generated static/Next.js output: no credential-shaped Gemini, OpenAI or GitHub tokens found. `.env.local` remains ignored.

## Recommendation

The committed review candidate is ready for a local competition rehearsal and code review. It is **not ready for public deployment** until the Gemini key is rotated and the owner explicitly approves publication. Production multi-tenant readiness, live manufacturing economics, physical mobile performance and live Gemini behavior remain outside the evidence of this pilot audit.
