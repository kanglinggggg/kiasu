import {
  Check,
  CheckCircle2,
  Heart,
  Layers3,
  Scissors,
  Zap,
  TrendingUp,
} from "lucide-react";
import { Batch, ConceptId, Demand, money } from "@/lib/mock-data";
import { Concept } from "@/lib/remix-engine";
import { calculateEconomics } from "@/lib/economics";
import { ProductImage, Progress } from "./ui";
export function ConsumerDrop({
  batch,
  concepts,
  selected,
  demand,
  onEngage,
  onCheckout,
  onImpact,
  onSelect,
  productionUnlocked,
  preorderStatus,
  dropCode = "DROP017",
  canEngage = true,
  availableConcepts,
}: {
  batch: Batch;
  concepts: Concept[];
  selected: ConceptId;
  demand: Demand;
  onEngage: (
    id: ConceptId,
    kind: "votes" | "reservations" | "preorders",
  ) => void;
  onCheckout: (id: ConceptId) => void;
  onImpact: () => void;
  onSelect: () => void;
  productionUnlocked?: boolean;
  preorderStatus?: string | null;
  dropCode?: string;
  canEngage?: boolean;
  availableConcepts?: ConceptId[];
}) {
  const active = concepts.find((c) => c.id === selected)!,
    orders = demand[selected].preorders,
    base = calculateEconomics(active, orders),
    e = { ...base, unlocked: productionUnlocked ?? base.unlocked };
  return (
    <>
      <div className="drop-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> REMIX {dropCode} · SINGAPORE
          </div>
          <h1>
            {batch.quantity} surplus jeans.
            <br />
            <span>What should they become?</span>
          </h1>
          <p>
            Choose a design. Production needs enough confirmed orders and the
            required materials.
          </p>
        </div>
        <div className="drop-stamp">
          <Scissors size={25} />
          <strong>
            MADE FROM
            <br />
            WHAT EXISTS.
          </strong>
          <span>Recovered denim concept</span>
        </div>
      </div>
      <p className="fine-print">
        Material gate:{" "}
        {e.materialReady
          ? "READY · existing assessed batch supports the maker minimum."
          : "NOT READY · insufficient assessed material."}{" "}
        Demand gate: {e.demandReady ? "READY" : "awaiting confirmed orders"}.
        Both gates must pass.
      </p>
      <div className="drop-intro">
        <span>
          <Layers3 size={16} /> ONE BATCH. THREE POSSIBILITIES.
        </span>
        <button className="text-button" onClick={onSelect}>
          Selected: {active.name} · Review concepts
        </button>
      </div>
      <div className="concept-grid">
        {concepts.map((c) => {
          const d = demand[c.id],
            isSelected = c.id === selected,
            available =
              canEngage &&
              (!availableConcepts || availableConcepts.includes(c.id));
          return (
            <article
              className={`concept-card consumer-card ${isSelected ? "selected-concept" : ""}`}
              key={c.id}
            >
              <div className="image-wrap">
                <ProductImage concept={c} />
                <span className="image-badge">
                  {isSelected
                    ? "SELECTED FOR THIS DROP"
                    : "ALTERNATIVE CONCEPT"}
                </span>
                <button
                  className={`heart ${d.voted ? "hearted" : ""}`}
                  aria-label={`Vote for ${c.name}`}
                  onClick={() => onEngage(c.id, "votes")}
                  disabled={d.voted || !available}
                >
                  <Heart size={18} fill={d.voted ? "currentColor" : "none"} />
                </button>
                <span className="unit-badge">Capacity {c.max}</span>
              </div>
              <div className="concept-content">
                <div className="product-title">
                  <h2>{c.name}</h2>
                  <strong>S${c.price}</strong>
                </div>
                <p>{c.subtitle}</p>
                <div className="demand-stats">
                  <div>
                    <strong>{d.votes}</strong>
                    <span>votes</span>
                  </div>
                  <div>
                    <strong>{d.reservations}</strong>
                    <span>reservations</span>
                  </div>
                  <div>
                    <strong>{d.preorders}</strong>
                    <span>pre-orders</span>
                  </div>
                </div>
                <div className="threshold-label">
                  <span>
                    {!c.feasible ? (
                      "Below production minimum"
                    ) : isSelected && e.unlocked ? (
                      <>
                        <CheckCircle2 size={14} /> Production unlocked
                      </>
                    ) : isSelected ? (
                      "Confirmed pre-orders"
                    ) : (
                      "Interest test only"
                    )}
                  </span>
                  <strong>
                    {d.preorders} / {c.threshold}
                  </strong>
                </div>
                <Progress
                  value={d.preorders}
                  max={c.threshold}
                  label={`${c.name} production threshold`}
                />
                <div className="card-actions">
                  <button
                    className="secondary"
                    onClick={() => onEngage(c.id, "reservations")}
                    disabled={d.reserved || !c.feasible || !available}
                  >
                    {d.reserved ? (
                      <>
                        <Check size={14} /> Reserved
                      </>
                    ) : (
                      "Reserve"
                    )}
                  </button>
                  <button
                    className="primary"
                    onClick={() => onCheckout(c.id)}
                    disabled={
                      !available ||
                      !isSelected ||
                      !c.feasible ||
                      d.ordered ||
                      d.preorders >= c.max
                    }
                  >
                    {!isSelected
                      ? "Alternative concept"
                      : !c.feasible
                        ? "Insufficient material"
                        : d.ordered
                          ? `Preorder: ${preorderStatus ?? "confirmed"}`
                          : `Pre-order · S${c.price}`}
                  </button>
                </div>
                <button
                  className="vote-text"
                  onClick={() => onEngage(c.id, "votes")}
                  disabled={d.voted || !available}
                >
                  {d.voted
                    ? "Your vote is counted"
                    : "Just browsing? Vote for this design"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="scarcity">
        <div className="scarcity-symbol">
          <Scissors size={28} />
        </div>
        <div>
          <span className="eyebrow">Waste-Defined Scarcity</span>
          <h3>Limited by material. Backed by demand.</h3>
          <p>
            Only {active.max} can exist because this recovered material batch
            can only support {active.max} units.
          </p>
          <p>A material limit, rather than an artificial limited edition.</p>
        </div>
        <div className="scarcity-number">
          <strong>{active.max}</strong>
          <span>Maximum possible production: {active.max}</span>
        </div>
      </div>
      <div className={`unlock-panel ${e.unlocked ? "unlocked" : ""}`}>
        <div>
          <span className="eyebrow">
            {e.unlocked
              ? "BATCH CONFIRMED"
              : "DEMAND BEFORE PRODUCTION"}
          </span>
          <h2>
            {e.unlocked
              ? "PRODUCTION UNLOCKED"
              : `${orders} / ${active.threshold} confirmed pre-orders`}
          </h2>
          <p>
            {!e.feasible
              ? `Material capacity ${active.max} is below the ${active.threshold}-order minimum. Revisit this batch.`
              : `${orders} × ${money(active.price)} = ${money(e.committedGrossSales)} committed gross sales`}
          </p>
        </div>
        <button
          className={e.unlocked ? "dark-button" : "white-button"}
          disabled={
            !e.feasible ||
            (!e.unlocked && (!canEngage || demand[selected].ordered))
          }
          onClick={() =>
            e.unlocked ? onImpact() : onEngage(selected, "preorders")
          }
        >
          {e.unlocked ? (
            <>
              <TrendingUp size={18} /> View impact
            </>
          ) : (
            <>
              <Zap size={18} />
              {selected === "tote" && orders === 41
                ? "Demo: add the 42nd pre-order"
                : "Demo: add one pre-order"}
            </>
          )}
        </button>
      </div>
      <p className="fine-print">
        Simulated orders; no payments. Only {active.name} uses this batch’s
        pre-order allocation. Votes and reservations are interest signals, not
        production commitments. Prototype maker minima and material estimates
        require real-world validation.
      </p>
    </>
  );
}
