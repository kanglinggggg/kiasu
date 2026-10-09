"use client";
import {FashionHome,shopDrop,BrandMarginComparison,RewardWallet} from "./fashion-commerce";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Layers3,
  Package,
  RotateCcw,
  Scissors,
  Sparkles,
} from "lucide-react";
import {
  Batch,
  ConceptId,
  Condition,
  Material,
  Demand,
  materials,
  conditions,
  defaultBatch,
  money,
} from "@/lib/mock-data";
import { calculateConcepts, materialEstimate } from "@/lib/remix-engine";
import { calculateRoutes } from "@/lib/circular-engine";
import {
  verifyOpportunities,
  type VerifiedOpportunity,
} from "@/lib/ai/concept-generator";
import { AIMode } from "@/lib/ai/inventory-analysis";
import { usePersistentData } from "@/lib/persistent-client";
import { RouteAnalysis } from "./route-analysis";
import { ConceptsView } from "./concepts-view";
import { ConsumerDrop } from "./consumer-drop";
import { InventoryAssistant } from "./inventory-assistant";
import {
  OpportunityAssistant,
  OpportunityResult,
} from "./opportunity-assistant";
import { AccountingPanel } from "./accounting-panel";
import { QualityFields } from "./quality-fields";
import { defaultQuality } from "@/lib/material-quality";
import { DecisionArchitecture } from "./ai-mode";
import { ProductImage, SectionTitle } from "./ui";
import { PersistentLoop, StoredImpact } from "./persistent-loop";
import { DomainHistory, StoredAnalytics } from "./domain-history";
import { AccessibleModal } from "./accessible-modal";
import { MaterialManager } from "./material-manager";
type Stage =
  "home" | "inventory" | "routes" | "concepts" | "drop" | "impact" | "loop" | "history";
const steps: Stage[] = ["inventory", "routes", "concepts", "drop", "impact"],
  labels = [
    "Surplus inventory",
    "Route analysis",
    "Remix concepts",
    "Consumer drop",
    "Impact",
  ];
export default function PersistentApp() {
  const { data, error, busy, refresh, perform, setError } = usePersistentData();
  const [inventoryQuality, setInventoryQuality] = useState(defaultQuality);
  const [stage, setStage] = useState<Stage>("home"),
    [batch, setBatch] = useState<Batch>(defaultBatch),
    [batchId, setBatchId] = useState(""),
    [selectedConcept, setSelectedConcept] = useState<ConceptId>("tote"),
    [dropId, setDropId] = useState(""),
    [loopDropId, setLoopDropId] = useState(""),
    [wardrobeItemId, setWardrobeItemId] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("Remix"),
    [opportunities, setOpportunities] = useState<OpportunityResult | null>(
      null,
    ),
    [aiMode, setAIMode] = useState<AIMode>("demo"),
    [connected, setConnected] = useState(false),
    [notice, setNotice] = useState(""),
    [checkout, setCheckout] = useState<ConceptId | null>(null);
  const heading = useRef<HTMLDivElement>(null),
    formDensity = useRef(142 / 180);
  const selectedBatch =
    data?.batches.find((b) => b.id === batchId) ??
    data?.batches.find((b) => b.code === "B017") ??
    data?.batches[0];
  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((r) => setConnected(r.connected === true))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (selectedBatch) {
      setBatch(selectedBatch.inputs);
      setSelectedRoute(selectedBatch.route ?? "Remix");
      setOpportunities(null);
      setSelectedConcept("tote");
      formDensity.current =
        (selectedBatch.inputs.weight ?? selectedBatch.estimated_kg) /
        selectedBatch.inputs.quantity;
    }
  }, [selectedBatch?.id]);
  useEffect(() => {
    if (data?.actor.role === "consumer" && stage === "inventory")
      setStage("loop");
  }, [data?.actor.id]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [stage]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const go = (s: Stage) => {
    setStage(s);
  };
  const notifyError = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : "The operation failed.");
  const draftChanged =
    !selectedBatch ||
    JSON.stringify(batch) !== JSON.stringify(selectedBatch.inputs);
  const calculated = calculateConcepts(batch),
    analysis =
      !draftChanged && selectedBatch?.analysis
        ? selectedBatch.analysis
        : calculateRoutes(batch),
    stock = materialEstimate(batch);
  const brandDrop =
    data?.drops.find((d) => d.id === dropId) ??
    data?.drops.find(
      (d) =>
        d.batch_id === selectedBatch?.id && d.recipe_key === selectedConcept,
    );
  const concepts = calculated.map((c) => {
    const d = data?.drops.find(
      (d) => d.batch_id === selectedBatch?.id && d.recipe_key === c.id,
    );
    return d && !draftChanged
      ? {
          ...c,
          max: d.capacity,
          price: d.selling_price,
          cost: d.unit_cost,
          feasible: d.capacity >= d.preorder_threshold,
        }
      : c;
  });
  const demand = Object.fromEntries(
    concepts.map((c) => {
      const d = data?.drops.find(
        (d) => d.batch_id === selectedBatch?.id && d.recipe_key === c.id,
      );
      return [
        c.id,
        {
          votes: d?.votes ?? 0,
          reservations: d?.reservations ?? 0,
          preorders: d?.orders ?? 0,
          voted: d?.my_vote ?? false,
          reserved: d?.my_reservation ?? false,
          ordered: Boolean(d?.my_preorder_status),
        },
      ];
    }),
  ) as Demand;
  const verified = opportunities
    ? (opportunities.checks ??
      verifyOpportunities(batch, opportunities.suggestions))
    : [];
  async function saveAndAnalyse(next: Batch = batch) {
    try {
      if (!data || data.actor.role === "consumer") return;
      if (
        selectedBatch &&
        JSON.stringify(next) === JSON.stringify(selectedBatch.inputs) &&
        selectedBatch.status !== "draft"
      ) {
        setBatch(next);
        go("routes");
        return;
      }
      const r = await perform<{ id: string }>("inventory", next);
      await perform(`inventory/${r.id}/analyse`);
      setBatchId(r.id);
      setBatch(next);
      go("routes");
      setNotice(
        "New inventory batch saved. Existing allocations were preserved.",
      );
    } catch (e) {
      notifyError(e);
    }
  }
  async function explore() {
    try {
      if (!selectedBatch) return;
      if (["analysed", "route_selected"].includes(selectedBatch.status))
        await perform(`inventory/${selectedBatch.id}/select-route`, {
          route: selectedRoute,
        });
      else if (selectedRoute !== selectedBatch.route)
        throw new Error(
          "An allocated batch cannot change route. Save corrected inputs as a new batch.",
        );
      go("concepts");
    } catch (e) {
      notifyError(e);
    }
  }
  async function saveConcepts(result: OpportunityResult | null) {
    if (!result || !selectedBatch) return;
    try {
      const response = await perform<{ checks: VerifiedOpportunity[] }>(
        `inventory/${selectedBatch.id}/concepts`,
        { suggestions: result.suggestions },
      );
      setOpportunities({ ...result, checks: response.checks });
    } catch (e) {
      notifyError(e);
    }
  }
  async function launch() {
    try {
      if (!data || !selectedBatch) return;
      const existing = data.drops.find(
        (d) =>
          d.batch_id === selectedBatch.id && d.recipe_key === selectedConcept,
      );
      if (existing) {
        setDropId(existing.id);
        go("drop");
        return;
      }
      const concept = data.concepts.find(
        (c) =>
          c.batch_id === selectedBatch.id && c.recipe_key === selectedConcept,
      );
      if (!concept?.approved)
        throw new Error("Generate and verify a feasible concept first.");
      if (
        !concept.recipe_registered ||
        !concept.brand_approved_at ||
        !concept.maker_approved_at
      )
        throw new Error(
          "Register the recipe and record brand / maker approval before launch.",
        );
      if (selectedBatch.verified_kg === null)
        throw new Error(
          "Confirm the inventory material inspection below before launch.",
        );
      const d = await perform<{ id: string }>("drops", {
        conceptId: concept.id,
      });
      setDropId(d.id);
      go("drop");
    } catch (e) {
      notifyError(e);
    }
  }
  async function approveConcept() {
    try {
      if (!data || !selectedBatch) return;
      const concept = data.concepts.find(
        (c) =>
          c.batch_id === selectedBatch.id && c.recipe_key === selectedConcept,
      );
      if (!concept?.approved)
        throw new Error("Only a feasible proposal can enter recipe review.");
      if (selectedBatch.verified_kg === null)
        throw new Error("Confirm the inventory inspection before approval.");
      await perform(`concepts/${concept.id}/approve`, {
        makerName: "Prototype maker review",
        note: "Brand and maker feasibility review recorded for the simulated pilot.",
      });
      setNotice("Recipe registered. Brand and simulated maker approval recorded.");
    } catch (e) {
      notifyError(e);
    }
  }
  async function engage(
    id: ConceptId,
    kind: "votes" | "reservations" | "preorders",
  ) {
    const d = data?.drops.find(
      (d) => d.batch_id === selectedBatch?.id && d.recipe_key === id,
    );
    if (!d) {
      setNotice(
        "Launch this concept as its own material-backed drop before collecting commitments.",
      );
      return;
    }
    try {
      await perform(
        `drops/${d.id}/${kind === "votes" ? "vote" : kind === "reservations" ? "reserve" : "preorder"}`,
      );
      setCheckout(null);
      setDropId(d.id);
      if (kind === "preorders") go("impact");
      else setNotice("Saved to the persistent demand record.");
    } catch (e) {
      notifyError(e);
    }
  }
  async function reset(
    scenario: "standard" | "genuine_shortage" = "standard",
  ) {
    try {
      await perform("demo-reset", { scenario });
      setBatchId("");
      setDropId("");
      setLoopDropId("");
      setOpportunities(null);
      setCheckout(null);
      setAIMode("demo");
      go(scenario === "genuine_shortage" ? "home" : "inventory");
      setNotice(
        scenario === "genuine_shortage"
          ? "Genuine-shortage audit scenario created: 41 buyers, 41.2 kg allocated, 0.8 kg verified material still needed."
          : "New persisted demo run created. Previous runs remain in the database.",
      );
    } catch (e) {
      notifyError(e);
    }
  }
  if (!data)
    return (
      <main className="main">
        <div role={error ? "alert" : "status"} aria-live="polite">
          <SectionTitle
            eyebrow="TERISE / PREPARING THE EDIT"
            title="The next chapter is loading."
            description={error || "Connecting to your local collection and circular wallet…"}
          />
        </div>
        {error && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              void refresh().catch((e) =>
                setError(e instanceof Error ? e.message : "Database unavailable"),
              );
            }}
          >
            Retry connection
          </button>
        )}
      </main>
    );
  const canBrand = data.actor.role !== "consumer";
  return (
    <>
      <header className="header">
        <button
          className="logo"
          onClick={() => go("home")}
          aria-label="terise home"
        >
          <span className="logo-mark">t.</span>terise
        </button>
        <nav aria-label="Main navigation">
          <button
            className={["inventory", "routes", "concepts"].includes(stage) ? "active" : ""}
            aria-current={["inventory", "routes", "concepts"].includes(stage) ? "page" : undefined}
            onClick={() => go("inventory")}
            disabled={!canBrand}
          >
            Brand studio
          </button>
          <button
            className={["home", "drop", "impact"].includes(stage) ? "active" : ""}
            aria-current={["home", "drop", "impact"].includes(stage) ? "page" : undefined}
            onClick={() => go("home")}
          >
            Explore drops
          </button>
          <button
            className={stage === "loop" ? "active" : ""}
            aria-current={stage === "loop" ? "page" : undefined}
            onClick={() => go("loop")}
          >
            Scan an item
          </button>
          <button
            className={stage === "history" ? "active" : ""}
            aria-current={stage === "history" ? "page" : undefined}
            onClick={() => go("history")}
          >
            My history
          </button>
        </nav>
        <div className="header-right">
          <button
            className="icon-button"
            aria-label="Reset demo"
            title="Start new demo run; preserve previous records"
            onClick={() => void reset()}
            disabled={busy || data.actor.role !== "admin/demo"}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </header>
      <div className="identity-strip">
        <span>LOCAL DATABASE · {data.workspaceName}</span>
        <label>
          Demo identity
          <select
            aria-label="Demo identity"
            value={data.actor.id}
            disabled={busy}
            onChange={(e) => {
              void perform("session", { userId: e.target.value })
                .then(() => {
                  setCheckout(null);
                  setError("");
                })
                .catch(notifyError);
            }}
          >
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Demo run
          <select
            aria-label="Demo run"
            value={data.actor.workspace_id}
            disabled={busy}
            onChange={(e) => {
              void perform("workspace", { workspaceId: e.target.value })
                .then(() => {
                  setBatchId("");
                  setDropId("");
                  setLoopDropId("");
                  setWardrobeItemId("");
                  setStage("inventory");
                })
                .catch(notifyError);
            }}
          >
            {data.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name === "Remix Demo"
                  ? w.name
                  : "Demo run " +
                    new Date(
                      w.name.slice(9).split(" · ")[0],
                    ).toLocaleString("en-SG", {
                      timeZone: "Asia/Singapore",
                    }) +
                    (w.name.includes("GENUINE SHORTAGE")
                      ? " · Genuine shortage"
                      : "")}
              </option>
            ))}
          </select>
        </label>
        <small>Local role simulation</small>
        <button
          className="scenario-button"
          disabled={busy || data.actor.role !== "admin/demo"}
          onClick={() => void reset("genuine_shortage")}
        >
          New genuine-shortage scenario
        </button>
      </div>
      {!["home", "loop", "history"].includes(stage) && (
        <div className="workflow">
          <div className="workflow-inner">
            {steps.map((s, i) => (
              <button
                key={s}
                onClick={() => go(s)}
                aria-current={stage === s ? "step" : undefined}
                className={
                  stage === s
                    ? "current"
                    : steps.indexOf(stage) > i
                      ? "complete"
                      : ""
                }
              >
                <span>
                  {steps.indexOf(stage) > i ? (
                    <Check size={13} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                {labels[i]}
                {i < 4 && <ChevronRight size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
      <main className="main" ref={heading} tabIndex={-1}>
        {stage === "home" && <FashionHome drops={data.drops.map(shopDrop)} commerce={data.commerce} balance={data.balance} perform={perform} onWardrobe={()=>go("loop")}/>}
        {stage === "inventory" && <BrandMarginComparison key={brandDrop?.id??"none"} drop={brandDrop??data.drops.find(d=>d.code==="DROP024")} commerce={data.commerce}/>}
        {stage === "history" && <RewardWallet commerce={data.commerce} balance={data.balance} perform={perform}/>}
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="save-status" role="status">
            Saving and validating against the material ledger…
          </p>
        )}
        {stage === "inventory" && canBrand && (
          <>
            <div className="page-heading">
              <SectionTitle
                eyebrow={`THE BRAND STUDIO / ${selectedBatch?.code ?? "NEW BATCH"}`}
                title="Good materials. New possibilities."
                description="Give surplus a considered second life. Start with what you already have."
              />
              <span className="outline-tag">
                <Layers3 size={15} /> Circular retail, reimagined
              </span>
            </div>
            <div className="loop-entry">
              <div>
                <span className="eyebrow">REMIX LOOP</span>
                <h3>
                  Turn demand into recovery, and recovery into the next drop.
                </h3>
                <p>
                  Keep wearable items in use. Match useful returns to material
                  that is actually needed.
                </p>
              </div>
              <button className="secondary" onClick={() => go("loop")}>
                Scan an item <ChevronRight size={16} />
              </button>
            </div>
            <label className="batch-picker">
              Saved inventory batch
              <select
                value={selectedBatch?.id ?? ""}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setDropId("");
                }}
              >
                {data.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.inputs.product} · {b.remaining_kg} kg
                    unallocated
                  </option>
                ))}
              </select>
            </label>
            <p className="fine-print">
              D102 funds the consumer loop. B017 is a separate brand-demo batch,
              so its material is never counted twice.
            </p>
            <InventoryAssistant
              key={`${data.actor.id}-${selectedBatch?.id}`}
              price={batch.price}
              mode={aiMode}
              connected={connected}
              onMode={setAIMode}
              onConfirm={(next) => void saveAndAnalyse(next)}
            />
            <div className="inventory-layout">
              <section className="panel inventory-panel">
                <div className="panel-heading">
                  <div className="square-icon">
                    <Package size={21} />
                  </div>
                  <div>
                    <h2>Your surplus, in focus</h2>
                    <p>Source inputs · estimates before inspection</p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveAndAnalyse();
                  }}
                >
                  <fieldset className="loop-fields" disabled={busy}>
                    <div className="form-grid">
                      <label className="full">
                        Product
                        <input
                          required
                          maxLength={80}
                          value={batch.product}
                          onChange={(e) =>
                            setBatch({ ...batch, product: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          required
                          value={batch.quantity}
                          onChange={(e) => {
                            const quantity = Number(e.target.value);
                            setBatch({
                              ...batch,
                              quantity,
                              weight:
                                batch.weight === null
                                  ? null
                                  : Math.round(
                                      quantity * formDensity.current * 10,
                                    ) / 10,
                            });
                          }}
                        />
                      </label>
                      <label>
                        Reusable material (optional) kg
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          step="0.001"
                          value={batch.weight ?? ""}
                          onChange={(e) => {
                            const weight =
                              e.target.value === ""
                                ? null
                                : Number(e.target.value);
                            if (weight !== null && batch.quantity > 0)
                              formDensity.current = weight / batch.quantity;
                            setBatch({ ...batch, weight });
                          }}
                        />
                      </label>
                      <label>
                        Material
                        <select
                          value={batch.material}
                          onChange={(e) =>
                            setBatch({
                              ...batch,
                              material: e.target.value as Material,
                            })
                          }
                        >
                          {materials.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Original retail price SGD
                        <input
                          required
                          type="number"
                          min="1"
                          max="100000"
                          value={batch.price}
                          onChange={(e) =>
                            setBatch({
                              ...batch,
                              price: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="full">
                        Condition
                        <select
                          value={batch.condition}
                          onChange={(e) =>
                            setBatch({
                              ...batch,
                              condition: e.target.value as Condition,
                            })
                          }
                        >
                          {conditions.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button className="primary full-button">
                      <Sparkles size={17} />
                      {draftChanged
                        ? "Save new batch & analyse"
                        : "Analyse circular routes"}
                    </button>
                    <p className="fine-print">
                      Edits are local drafts until saved as a new batch.
                      Existing material allocations and orders are never reset
                      by editing a form.
                    </p>
                  </fieldset>
                </form>
              </section>
              <aside className="inventory-story">
                <div className="story-top">
                  <span className="eyebrow">THE NEXT CHAPTER</span>
                  <span>{selectedBatch?.code}</span>
                </div>
                <h2>
                  A second life.
                  <br />
                  <em>A first choice.</em>
                </h2>
                <div className="story-product">
                  <ProductImage concept={calculated[0]} />
                  <span className="floating-label">
                    <Scissors size={14} /> Recovered denim. Reimagined.
                  </span>
                </div>
                <div className="story-bottom">
                  <div>
                    <strong>{batch.quantity}</strong>
                    <span>surplus items assessed</span>
                  </div>
                  <div>
                    <strong>
                      {stock.availableKg.toFixed(1)}
                      <small> kg</small>
                    </strong>
                    <span>estimated material potential</span>
                  </div>
                </div>
              </aside>
            </div>
            <StoredAnalytics data={data} />
            <MaterialManager data={data} perform={perform} busy={busy} />
            <DomainHistory
              data={data}
              onBatch={(id) => setBatchId(id)}
              onDrop={(id) => {
                setLoopDropId(id);
                go("loop");
              }}
            />
          </>
        )}
        {stage === "routes" && (
          <RouteAnalysis
            batch={batch}
            analysis={analysis}
            selected={selectedRoute}
            onSelect={setSelectedRoute}
            onEdit={() => go("inventory")}
            onExplore={() => void explore()}
          />
        )}
        {stage === "concepts" && (
          <>
            <OpportunityAssistant
              key={selectedBatch?.id}
              batch={batch}
              mode={aiMode}
              connected={connected}
              onMode={setAIMode}
              result={opportunities}
              onResult={(r) => void saveConcepts(r)}
              locked={busy || !canBrand}
            />
            {opportunities && (
              <ConceptsView
                concepts={concepts.map(
                  (c) =>
                    verified.find((v) => v.concept?.id === c.id)?.concept ?? c,
                )}
                verification={verified}
                selected={selectedConcept}
                onSelect={(id) => {
                  setSelectedConcept(id);
                  setDropId("");
                }}
                approvalReady={Boolean(
                  data.concepts.find(
                    (c) =>
                      c.batch_id === selectedBatch?.id &&
                      c.recipe_key === selectedConcept,
                  )?.recipe_registered &&
                    data.concepts.find(
                      (c) =>
                        c.batch_id === selectedBatch?.id &&
                        c.recipe_key === selectedConcept,
                    )?.brand_approved_at &&
                    data.concepts.find(
                      (c) =>
                        c.batch_id === selectedBatch?.id &&
                        c.recipe_key === selectedConcept,
                    )?.maker_approved_at,
                )}
                onApprove={() => void approveConcept()}
                onLaunch={() => void launch()}
                locked={busy || !canBrand}
              />
            )}
            <p className="fine-print">
              Concepts are alternatives. Server-side launch validates remaining
              verified material; an existing allocation cannot fund another
              concept.
            </p>
            {selectedBatch?.verified_kg === null &&
              selectedBatch.route === "Remix" && (
                <div className="callout">
                  <div>
                    <strong>Human inventory inspection required</strong>
                    <QualityFields
                      value={inventoryQuality}
                      onChange={setInventoryQuality}
                    />
                    <p>
                      Confirm {selectedBatch.estimated_kg} kg of{" "}
                      {selectedBatch.inputs.material} as a simulated inspected
                      quantity. AI estimates alone cannot enter the material
                      ledger.
                    </p>
                    <button
                      className="primary"
                      disabled={busy || !canBrand}
                      onClick={() =>
                        void perform(`inventory/${selectedBatch.id}/verify`, {
                          quality: inventoryQuality,
                          kg: selectedBatch.estimated_kg,
                          material: selectedBatch.inputs.material,
                          note: "Human-confirmed simulated inventory inspection.",
                        }).catch(notifyError)
                      }
                    >
                      Confirm simulated inventory verification
                    </button>
                  </div>
                </div>
              )}
          </>
        )}
        {stage === "drop" &&
          (brandDrop ? (
            <ConsumerDrop
              preorderStatus={brandDrop.my_preorder_status}
              dropCode={brandDrop.code}
              canEngage={
                data.actor.role !== "brand_user" &&
                brandDrop.phase === "market_test"
              }
              availableConcepts={data.drops
                .filter(
                  (d) =>
                    d.batch_id === selectedBatch?.id &&
                    d.phase === "market_test",
                )
                .map((d) => d.recipe_key as ConceptId)}
              batch={batch}
              concepts={concepts}
              selected={selectedConcept}
              demand={demand}
              onEngage={(id, k) => void engage(id, k)}
              onCheckout={setCheckout}
              onImpact={() => go("impact")}
              onSelect={() => go("concepts")}
              productionUnlocked={[
                "unlocked",
                "production",
                "completed",
              ].includes(brandDrop.phase)}
            />
          ) : (
            <div className="callout">
              Launch an approved concept to open its persisted drop.
              <button className="secondary" onClick={() => go("concepts")}>
                Review concepts
              </button>
            </div>
          ))}
        {stage === "impact" &&
          (brandDrop ? (
            <>
              <SectionTitle
                eyebrow="THE IMPACT OF A BETTER DECISION"
                title="A new chapter. Already chosen."
                description="All commitments and verified allocations are read from the database."
              />
              <div className="impact-grid">
                <div className="metric">
                  <strong>{batch.quantity}</strong>
                  <h3>surplus items assessed</h3>
                </div>
                <div className="metric">
                  <strong>
                    {
                      calculated.find((c) => c.id === selectedConcept)
                        ?.utilisation
                    }
                    %
                  </strong>
                  <h3>estimated material utilisation</h3>
                </div>
              </div>
              <StoredImpact
                data={data}
                drop={brandDrop}
                perform={perform}
                busy={busy}
              />
              {!brandDrop.eligible && brandDrop.phase === "market_test" && (
                <p>Waiting for both verified material and confirmed demand.</p>
              )}
            </>
          ) : (
            <p>Select a saved drop first.</p>
          ))}
        {stage === "loop" && (
          <PersistentLoop
            key={`${data.actor.id}-${wardrobeItemId}`}
            initialItemId={wardrobeItemId}
            data={data}
            perform={perform}
            busy={busy}
            dropId={loopDropId}
            onDrop={setLoopDropId}
            mode={aiMode}
            connected={connected}
            onMode={setAIMode}
          />
        )}
        {stage === "history" && (
          <>
            <SectionTitle
              eyebrow="YOUR CIRCULAR RECORD"
              title="Every item. Every contribution."
              description="Saved wardrobe items, returns, preorders and ledger-derived rewards."
            />
            <DomainHistory
              data={data}
              onItem={(id) => {
                setWardrobeItemId(id);
                go("loop");
              }}
              onBatch={(id) => {
                setBatchId(id);
                setDropId("");
                go("inventory");
              }}
              onDrop={(id) => {
                setLoopDropId(id);
                go("loop");
              }}
            />
            {canBrand && (
              <>
                <MaterialManager data={data} perform={perform} busy={busy} />
                <details className="architecture">
                  <summary>Audit events</summary>
                  {data.audit.map((e) => (
                    <p key={e.id}>
                      {new Date(e.created_at).toLocaleString("en-SG", {
                        timeZone: "Asia/Singapore",
                      })}{" "}
                      · {e.type}
                    </p>
                  ))}
                </details>
              </>
            )}
          </>
        )}
        <AccountingPanel data={data} perform={perform} busy={busy} />
        <DecisionArchitecture />
      </main>
      <footer>
        <span className="footer-brand">terise</span>
        <span>Made from what exists. Chosen for what’s next.</span>
        <span>SDG 12 · RESPONSIBLE PRODUCTION</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
      {checkout && (
        <AccessibleModal
          label="Demo preorder"
          onClose={() => {
            if (!busy) setCheckout(null);
          }}
        >
          <h2>Make the next chapter happen.</h2>
          <p>
            {concepts.find((c) => c.id === checkout)?.name} ·{" "}
            {money(concepts.find((c) => c.id === checkout)?.price ?? 0)}
          </p>
          <p className="fine-print">
            Simulated payment. This commitment is saved to your consumer
            history.
          </p>
          <button
            autoFocus
            className="primary"
            disabled={busy}
            onClick={() => void engage(checkout, "preorders")}
          >
            Confirm demo pre-order
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setCheckout(null)}
          >
            Cancel
          </button>
        </AccessibleModal>
      )}
    </>
  );
}
