# V7 pre-release acceptance audit — 9 October 2026

The V7 release candidate was audited locally without committing, pushing or deploying it. The fresh public export was served from its `/terise/` base path; the deployed GitHub Pages site was left unchanged.

## Automated release gates

- Migrations 012, 013 and 014 are applied. All ten commerce triggers, the recursive material-bonus view and the five query indexes are present.
- Pure engine, AI and provider tests: **55 / 55 passed**.
- PostgreSQL transaction, accounting and concurrency tests: **54 / 54 passed**.
- Independent HTTP persistence tests: **2 / 2 passed**.
- Total: **111 / 111 passed**.
- TypeScript typecheck, Next.js production build and GitHub Pages static export passed.
- `npm audit --omit=dev` reported no vulnerabilities.
- The rebuilt static output contains the optimized WebP campaign and product assets, no stale PNG references and no server-secret patterns.

The database tests include duplicate and competing allocations, duplicate receipt and inspection calls, confirmed-only demand, cancellation and refund reconciliation, double-spend prevention, entitlement uniqueness, exact checkout arithmetic, genuine shortage rewards, BOM component gates, residual material, mass balance, ownership and direct PostgreSQL forgery attempts.

## Browser verification

The persistent local application was exercised through the consumer shop: homepage, product details, benefit reservation, 10% return entitlement, 100-credit redemption, confirmation and order history. The displayed checkout reconciled `SGD 49.00 - SGD 4.90 - SGD 1.00 = SGD 43.10`. Cancellation restored the credit balance and eligible entitlement once. The cancelled-to-refunded transition advances the preorder and checkout records without issuing a second reversal.

The wardrobe flow was exercised through human review, return reservation, collection receipt, accepted inspection, entitlement issuance, material allocation and dual unlock. Reservation and receipt added no verified material, credits or usable discount. Accepted inspection issued one entitlement and reward. Allocation then changed production readiness.

A separate genuine-shortage workspace starts with 41 confirmed buyers, 41.2 kg of verified allocated denim, no compatible authorized free stock and a 0.8 kg shortage. It advertises a deterministic bonus, issues it only after accepted inspection and removes the campaign when the accepted source covers the shortage. Allocation satisfies the BOM material gate; the 42nd simulated checkout satisfies demand and unlocks a 42-unit plan at SGD 2,058 gross merchandise value. The waste-defined maximum remains 68 units.

Brand Studio was checked with full-price orders, return discounts, redeemed credits, inspection, collection, manufacturing, auxiliaries, fixed setup and baseline costs. It keeps gross merchandise value, net simulated commitments, payable amount, relevant costs, contribution profit and forecast margin distinct. A deliberately unprofitable scenario showed negative contribution, negative uplift and a break-even above verified capacity.

Desktop and 390 × 844 browser-emulated mobile layouts were inspected. The final mobile product-details and checkout dialogs have visible 44 px close controls without overlapping headings. No horizontal overflow was observed. This was viewport emulation, not a physical-device test.

## Local CLIP observations

Image-only Local CLIP scans were run for denim jeans, a denim jacket, a T-shirt and unsupported footwear. Unsupported or weak clothing results remained unconfirmed, and material composition stayed Unknown without label evidence. Cancellation returned the scanner to an editable state and retry completed.

The rebuilt static export loaded `Xenova/clip-vit-base-patch32` without an application API key. A first model-loading scan in the final local Pages build reported **34.9 seconds**; browser-observed end-to-end time, including image preparation and audit polling, was about **54.2 seconds**. A separate fully cold audit run took about **103 seconds**. Repeated warm inference reported **1.1 seconds** in the UI (about **3.2 seconds** including the fixed audit wait). Timing depends on network, browser cache and hardware and is not a performance guarantee.

## Fixes made during acceptance

- Added migration 014 guards for checkout transitions, entitlement linkage, exact credit/discount arithmetic and deferred ledger consistency.
- Corrected recursive material-bonus accounting.
- Added a genuine-shortage seed that does not ignore compatible stock and stopped zero-demand drops from advertising bounties.
- Corrected baseline capacity, undefined zero-sales margin, unreachable break-even messaging and workspace-total labels.
- Reconciled checkout refund state, separated discount and credits in order history and prevented an invalid second preorder after cancellation.
- Fixed stage focus, unlocked-page auto-scroll, modal labels and close targets, image mapping, text contrast, loading/error recovery and responsive scan presentation.
- Replaced large public PNG delivery assets with documented WebP variants.

## Remaining limitations and release hold

- Gemini transport is covered with mocked provider tests, but no live Gemini accuracy or quota test was performed.
- Physical mobile memory, battery use, camera capture and inference performance were not tested.
- Community reporting shows currently confirmed preorders; it does not yet store a historical “confirmed before production” milestone.
- Campaign and product visuals are generated/authorized project assets documented in `docs/assets.md`; that record is internal provenance, not an external licence certificate.
- The static public build is simulated local state. PostgreSQL persistence, ledgers and multi-session guarantees apply only to the local full application.
- A non-empty Gemini key was found temporarily in the uncommitted `.env.example` during this audit. It was removed, was not staged and was not found in Git history or the rebuilt static output. The credential must still be revoked or rotated before release.

**Acceptance verdict: NOT READY until the exposed Gemini credential is revoked or rotated.** After rotation, the tested release candidate meets the audited local and static release gates. The currently deployed GitHub Pages site is an older build because this audit intentionally did not publish anything.
