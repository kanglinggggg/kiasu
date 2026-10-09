"use client";
import {ProductDetail,shopDrop,RewardWallet} from "./fashion-commerce";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Scissors } from "lucide-react";
import { Snapshot, Match, StoredDrop } from "@/lib/server/types";
import {
  ConsumerItem,
  defaultItem,
  itemTypes,
  itemMaterials,
  itemConditions,
  itemUsages,
  recommendAction,
} from "@/lib/return-engine";
import { AIMode } from "@/lib/ai/inventory-analysis";
import { stylingSuggestions } from "@/lib/ai/styling-suggestions";
import { api } from "@/lib/persistent-client";
import { money } from "@/lib/mock-data";
import { SectionTitle, Progress } from "./ui";
import { WardrobeScanner } from "./wardrobe-scanner";
import { QualityFields } from "./quality-fields";
import { defaultQuality } from "@/lib/material-quality";
import { DomainHistory, StoredAnalytics } from "./domain-history";
type Perform = <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
) => Promise<T>;
type Props = {
  initialItemId?: string;
  data: Snapshot;
  perform: Perform;
  busy: boolean;
  dropId: string;
  onDrop: (id: string) => void;
  mode: AIMode;
  connected: boolean;
  onMode: (mode: AIMode) => void;
};
export function PersistentLoop({
  data,
  perform,
  busy,
  dropId,
  onDrop,
  mode,
  connected,
  onMode,
  initialItemId,
}: Props) {
  const first = data.items.find((i) => i.id === initialItemId) ?? data.items[0];
  const [item, setItem] = useState<ConsumerItem>(
    first
      ? {
          type: first.item_type,
          material: first.estimated_material_type,
          condition: first.estimated_condition,
          usage: first.usage,
          ageMonths: first.age_months,
        }
      : defaultItem,
  );
  const [itemId, setItemId] = useState(first?.id ?? ""),
    [matches, setMatches] = useState<Match[]>([]),
    [point, setPoint] = useState(
      data.points.find((p) => p.name === "NUS UTown")?.id ??
        data.points[0]?.id ??
        "",
    ),
    [localError, setLocalError] = useState("");
  const [shopOpen,setShopOpen]=useState(false);
  const [quality, setQuality] = useState(defaultQuality);
  const [inspectionKg, setInspectionKg] = useState("0.8"),
    [inspectionResult, setInspectionResult] = useState<
      "accepted" | "partially_accepted" | "rejected"
    >("accepted");
  const d =
    data.drops.find((d) => d.id === dropId) ??
    data.drops.find((d) => d.code === "DROP024")!;
  const ret = data.returns.find((r) => r.consumer_item_id === itemId),
    action = recommendAction(item),
    myMatch = matches.find(
      (m) => m.dropId === d.id && m.compatible && m.neededKg > 0,
    ),
    saved = !!itemId,
    canConsume = data.actor.role !== "brand_user";
  const reviewKey = JSON.stringify(item),
    materialVersion = data.drops
      .map((d) => d.allocated_kg + ":" + d.orders + ":" + d.phase)
      .join("|");
  useEffect(() => {
    let active = true;
    if (!canConsume) return;
    api<{ best_match: Match | null; other_matches: Match[] }>(
      ret?.source_id ? `returns/${ret.id}/matches` : "matches",
      ret?.source_id ? {} : JSON.parse(reviewKey),
    )
      .then((r) => {
        if (active) setMatches(r.other_matches);
      })
      .catch((e) => {
        if (active) setLocalError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reviewKey, materialVersion, canConsume, itemId, ret?.status, ret?.id]);
  const mutate = (patch: Partial<ConsumerItem>) => {
    setItem((i) => ({ ...i, ...patch }));
    setItemId("");
  };
  const run = async (path: string, body: unknown = {}) => {
    try {
      setLocalError("");
      return await perform(path, body);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Request failed");
      return null;
    }
  };
  const confirm = async () => {
    const r = await run("consumer-items", item);
    if (r) {
      setItemId(String(r.id));
      if (Array.isArray(r.matches)) setMatches(r.matches as Match[]);
      setInspectionKg(String(r.estimated_recoverable_kg));
    }
  };
  return (
    <>
      <SectionTitle
        eyebrow="REMIX LOOP / DEMAND-DRIVEN MATERIAL RECOVERY"
        title="Clothes you no longer wear?"
        description="Check whether to keep, repair, pass on or return your item."
      />
      <div className="loop-steps">
        {["Wear", "Return", "Match", "Unlock", "Remix"].map((s, i) => (
          <span key={s}>
            <small>0{i + 1}</small>
            {s}
            {i < 4 && <ArrowRight size={16} />}
          </span>
        ))}
      </div>
      <div className="loop-layout">
        <section className="panel loop-panel">
          <span className="eyebrow">01 / YOUR WARDROBE</span>
          <h2>Scan an item</h2>
          <p>Check the condition before deciding what to do with it.</p>
          {!canConsume && (
            <p className="callout">
              Switch to Consumer Alex or Demo Operator to save personal wardrobe
              items.
            </p>
          )}
          <WardrobeScanner disabled={busy || !!ret || !canConsume} onApply={mutate} />
          {saved && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setItem(defaultItem);
                setItemId("");
              }}
            >
              Scan another item
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <fieldset
              disabled={busy || !!ret || !canConsume}
              className="loop-fields"
            >
              <div className="form-grid">
                <label>
                  Clothing type
                  <select
                    value={item.type}
                    onChange={(e) =>
                      mutate({ type: e.target.value as ConsumerItem["type"] })
                    }
                  >
                    {itemTypes.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Item material
                  <select
                    value={item.material}
                    onChange={(e) =>
                      mutate({
                        material: e.target.value as ConsumerItem["material"],
                      })
                    }
                  >
                    {itemMaterials.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Item condition
                  <select
                    value={item.condition}
                    onChange={(e) =>
                      mutate({
                        condition: e.target.value as ConsumerItem["condition"],
                      })
                    }
                  >
                    {itemConditions.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Current usage
                  <select
                    value={item.usage}
                    onChange={(e) =>
                      mutate({ usage: e.target.value as ConsumerItem["usage"] })
                    }
                  >
                    {itemUsages.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Age in months
                  <input
                    type="number"
                    min="0"
                    max="1200"
                    value={item.ageMonths}
                    onChange={(e) =>
                      mutate({
                        ageMonths: Math.max(
                          0,
                          Math.min(
                            1200,
                            Math.floor(Number(e.target.value) || 0),
                          ),
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <p className="fine-print">
                Return eligible clothing and receive 10% off your next terise product after verified acceptance. Human review saves estimates. Only the separate inspection
                workflow creates verified material.
              </p>
              <button className="primary" disabled={saved} type="submit">
                {saved
                  ? "Item saved to wardrobe"
                  : "Confirm item"}
              </button>
            </fieldset>
          </form>
          {localError && (
            <p className="ai-error" role="alert">
              {localError}
            </p>
          )}
          {saved && (
            <div className="loop-recommendation">
              <span className="eyebrow">CIRCULAR ACTION RECOMMENDATION</span>
              <h3>{action.action}</h3>
              <p>{action.reason}</p>
              {action.action === "KEEP & RESTYLE" && (
                <>
                  <h3>3 ways to wear this again</h3>
                  <ol>
                    {stylingSuggestions(item).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p>
                    <em>
                      If it still works for you, keep wearing it.
                    </em>
                  </p>
                </>
              )}
              {action.action === "RETURN FOR REMIX" && (
                <>
                  <h3>
                    {myMatch
                      ? "Strong material match"
                      : "No current match for this drop"}
                  </h3>
                  {myMatch && (
                    <>
                      <p>
                        {Math.round(myMatch.compatibilityScore * 100)}% rule
                        compatibility · {myMatch.reason}
                      </p>
                      <p>
                        Estimated recoverable: {myMatch.recoverableKg} kg ·
                        still needed: {myMatch.neededKg} kg
                      </p>
                    </>
                  )}
                  <details>
                    <summary>Matches across active drops</summary>
                    {matches
                      .filter((m) => m.compatible && m.neededKg > 0)
                      .map((m, i) => (
                        <div className="history-row" key={m.requirementId}>
                          <strong>
                            {i === 0 ? "Best match" : "Other match"} ·{" "}
                            {m.dropCode}
                          </strong>
                          <span>
                            {m.name} · {m.neededKg} kg needed ·{" "}
                            {Math.round(m.compatibilityScore * 100)}%
                            compatibility
                          </span>
                          <button
                            className="text-button"
                            onClick={() => onDrop(m.dropId)}
                          >
                            View this drop
                          </button>
                        </div>
                      ))}
                  </details>
                  {myMatch && !ret && (
                    <>
                      <div className="reward-lines">
                        <span>
                          Standard return reward{" "}
                          <b>{myMatch.reward.base} credits</b>
                        </span>
                        <span>
                          Current material bonus{" "}
                          <b>+{myMatch.reward.bonus} credits</b>
                        </span>
                        <strong>
                          Estimated total: {myMatch.reward.total} credits
                        </strong>
                        <small>
                          Quoted because this material is needed for {d.code}.
                          Recalculated after inspection; reservations award
                          nothing.
                        </small>
                      </div>
                      <label>
                        Collection point
                        <select
                          value={point}
                          onChange={(e) => setPoint(e.target.value)}
                        >
                          {data.points.map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>
                        11:00–19:00 · hypothetical prototype collection point,
                        within seven days
                      </p>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run("returns", {
                            itemId,
                            dropId: d.id,
                            collectionPointId: point,
                          })
                        }
                      >
                        Return for Remix · reserve collection
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {ret && (
            <div className="loop-receipt">
              <span className="eyebrow">
                RETURN {ret.id.slice(0, 8)} · {ret.status.toUpperCase()}
              </span>
              <h3>
                {ret.status === "reserved"
                  ? "Your return is reserved."
                  : "Your return record."}
              </h3>
              <p>
                {ret.point_name} · 11:00–19:00 · by{" "}
                {new Date(ret.return_by).toLocaleDateString("en-SG", {
                  timeZone: "Asia/Singapore",
                })}
              </p>
              <p className="fine-print">
                Hypothetical prototype location and simulated collection record;
                no collection partnership is claimed.
              </p>
              <p>
                Estimated: {ret.estimated_material_kg} kg · verified:{" "}
                {ret.verified_material_kg ?? "awaiting inspection"} kg ·
                allocated: {ret.allocated_kg} kg
              </p>
              {ret.status === "reserved" && (
                <>
                  <p>
                    A reservation contributes 0 kg. Receipt alone also
                    contributes 0 kg.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(`returns/${ret.id}/receive`)}
                  >
                    Simulate collection receipt
                  </button>
                </>
              )}
              {ret.status === "received" && (
                <QualityFields value={quality} onChange={setQuality} />
              )}
              {ret.status === "received" && (
                <>
                  <p>
                    Review: {item.material}, {item.condition},{" "}
                    {ret.estimated_material_kg} kg. This is a simulated human
                    inspection, not a measured real-world result.
                  </p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(`returns/${ret.id}/simulate-inspection`, {
                        quality,
                      })
                    }
                  >
                    Confirm simulated inspection · {ret.estimated_material_kg}{" "}
                    kg
                  </button>
                  {data.actor.role === "admin/demo" && (
                    <details>
                      <summary>Inspect a partial or rejected return</summary>
                      <label>
                        Inspection result
                        <select
                          value={inspectionResult}
                          onChange={(e) =>
                            setInspectionResult(
                              e.target.value as typeof inspectionResult,
                            )
                          }
                        >
                          <option value="accepted">Accepted</option>
                          <option value="partially_accepted">
                            Partially accepted
                          </option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </label>
                      <label>
                        Accepted verified kg
                        <input
                          type="number"
                          min="0"
                          max={ret.estimated_material_kg}
                          step="0.001"
                          value={inspectionKg}
                          onChange={(e) => setInspectionKg(e.target.value)}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(`returns/${ret.id}/inspect`, {
                            quality,
                            result: inspectionResult,
                            kg:
                              inspectionResult === "rejected"
                                ? 0
                                : Number(inspectionKg),
                            material: item.material,
                            condition: item.condition,
                            note: "Human reviewed simulated inspection in local demo.",
                          })
                        }
                      >
                        Save inspection result
                      </button>
                    </details>
                  )}
                </>
              )}
              {ret.source_id && ret.remaining_kg > 0 && myMatch && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(`drops/${d.id}/allocate-material`, {
                      sourceId: ret.source_id,
                      requirementId: myMatch.requirementId,
                      kg: Math.min(ret.remaining_kg, myMatch.neededKg),
                      requestKey: crypto.randomUUID(),
                    })
                  }
                >
                  Allocate verified{" "}
                  {Math.min(ret.remaining_kg, myMatch.neededKg)} kg to {d.code}
                </button>
              )}
              {ret.reward > 0 && (
                <>
                  <strong>
                    +{ret.reward} circular credits · balance {data.balance}
                  </strong>
                  {Number(ret.verified_material_kg) > 0 && (
                    <p>
                      A verified eligible return earns a one-use 10% discount. Check your wallet for its status, expiry and eligible products.
                    </p>
                  )}
                </>
              )}
              {ret.allocated_kg > 0 && (
                <p>
                  Your returned material contributed to this Remix batch. We do
                  not trace your exact garment into an individual product.
                </p>
              )}
            </div>
          )}
        </section>
        <aside className="panel loop-panel loop-drop">
          <label>
            Active Remix Drop
            <select value={d.id} onChange={(e) => onDrop(e.target.value)}>
              {data.drops.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} · {x.name}
                </option>
              ))}
            </select>
          </label>
          <div className="loop-product">
            <div
              role="img"
              aria-label={`${d.name} · illustrative product concept`}
              className={`product-image ${["tote","utility"].includes(d.recipe_key)?"terise-tote-image":["sleeve","blend-sleeve"].includes(d.recipe_key)?"terise-sleeve-image":""}`}
              style={{ backgroundPosition: "0% center" }}
            />
            <span>Illustrative concept · registered prototype recipe</span>
          </div>
          <h2>{d.name}</h2>
          <p>
            {money(d.selling_price)} · {d.code}
          </p>
          <StoredReadiness drop={d} />
          <p>
            {money(d.gross_sales)} committed gross sales · simulated payment
          </p>
          <div className="card-actions">
            <button
              className="secondary"
              disabled={
                busy || d.my_vote || d.phase !== "market_test" || !canConsume
              }
              onClick={() => void run(`drops/${d.id}/vote`)}
            >
              {d.my_vote ? "Voted" : `Vote · ${d.votes}`}
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                d.my_reservation ||
                d.phase !== "market_test" ||
                !canConsume
              }
              onClick={() => void run(`drops/${d.id}/reserve`)}
            >
              {d.my_reservation ? "Reserved" : `Reserve · ${d.reservations}`}
            </button>
          </div>
          <button
            className="primary full-button"
            disabled={
              busy ||
              Boolean(d.my_preorder_status) ||
              d.phase !== "market_test" ||
              !canConsume
            }
            onClick={() => setShopOpen(true)}
          >
            {d.my_preorder_status
              ? `Your pre-order: ${d.my_preorder_status}`
              : `Demo: add ${d.orders === 41 ? "the 42nd" : "one"} pre-order · ${money(d.selling_price)}`}
          </button>
          <p className="fine-print">
            No payment. One preorder per consumer per drop. Requests are
            validated and saved on the server.
          </p>
          <div className="scarcity loop-scarcity">
            <Scissors size={20} />
            <div>
              <span className="eyebrow">Waste-Defined Scarcity</span>
              <h3>Maximum production: {d.maximum_capacity} units</h3>
              <p>
                The material-bounded batch cap is {d.maximum_capacity} units. Current verified inputs support {d.capacity} units. The planned batch is {d.planned_units} units.
              </p>
            </div>
          </div>
          <details>
            <summary>Material requirements & sources</summary>
            {d.auxiliary.map((r) => (
              <p key={r.id}>
                {r.component}: {r.per_unit} {r.unit}/unit · {r.available}{" "}
                {r.unit} reserved / {r.required_quantity} required for this plan ·{" "}
                {r.ready ? "READY" : "REQUIRED COMPONENT MISSING"} ·
                non-recovered supplier material
              </p>
            ))}
            {d.requirements.map((r) => (
              <p key={r.id}>
                {r.component}: {r.material_type} · {r.required_kg} required / {r.maximum_kg} maximum{" "}
                kg · {r.kg_per_unit} kg/unit · blends{" "}
                {r.allowed_blend ? "allowed" : "not allowed"} · grades{" "}
                {r.accepted_grades.join(", ")}
              </p>
            ))}
            {data.contributions
              .filter((m) => m.destination_drop_id === d.id)
              .map((m) => (
                <p key={m.id}>
                  {m.source_type}: {m.net_kg} kg net (original {m.quantity_kg};
                  released {m.released_kg})
                </p>
              ))}
          </details>
        </aside>
      </div>
      <RewardWallet commerce={data.commerce} balance={data.balance} perform={perform}/>
      {shopOpen&&<ProductDetail drop={shopDrop(d)} commerce={data.commerce} balance={data.balance} perform={perform} onClose={()=>setShopOpen(false)} onScan={()=>setShopOpen(false)}/>}
      <StoredImpact data={data} drop={d} perform={perform} busy={busy} />
      <DomainHistory
        data={data}
        onDrop={onDrop}
        onItem={(id) => {
          const i = data.items.find((i) => i.id === id);
          if (i) {
            setItem({
              type: i.item_type,
              material: i.estimated_material_type,
              condition: i.estimated_condition,
              usage: i.usage,
              ageMonths: i.age_months,
            });
            setItemId(i.id);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      />
      {data.actor.role !== "consumer" && <StoredAnalytics data={data} />}
      <div className="manifesto">
        <span className="eyebrow">REMIX LOOP</span>
        <h2>
          Recover materials needed
          <br />
          <span>for confirmed orders.</span>
        </h2>
        <p>AI suggests options. Human review and fixed rules determine what can proceed.</p>
      </div>
    </>
  );
}
export function StoredReadiness({ drop: d }: { drop: StoredDrop }) {
  return (
    <>
      <div className="loop-readiness" aria-live="polite">
        <div>
          <strong>
            Demand{" "}
            <span>
              {d.orders} / {d.preorder_threshold}
            </span>
          </strong>
          <Progress
            value={d.orders}
            max={d.preorder_threshold}
            label="Confirmed buyers"
          />
          <small>
            {d.demand_ready
              ? "DEMAND READY ✓"
              : `${Math.max(0, d.preorder_threshold - d.orders)} buyers still needed`}
          </small>
        </div>
        {d.requirements.map((r) => (
          <div key={r.id}>
            <strong>
              {r.component}{" "}
              <span>
                {r.allocated_kg.toFixed(1)} / {r.required_kg} kg
              </span>
            </strong>
            <Progress
              value={r.allocated_kg}
              max={r.required_kg}
              label={`Verified ${r.component}`}
            />
            <small>
              {r.allocated_kg + 1e-8 >= r.required_kg
                ? "MATERIAL READY ✓"
                : `${(r.required_kg - r.allocated_kg).toFixed(1)} kg still needed`}
            </small>
          </div>
        ))}
      </div>
      {d.auxiliary.some((r) => !r.ready) && (
        <p role="status">
          Required auxiliary material is missing. All BOM components must be
          ready.
        </p>
      )}
      <h3>
        {["unlocked", "production", "completed"].includes(d.state)
          ? "DROP UNLOCKED"
          : d.eligible
            ? "READY TO UNLOCK"
            : d.demand_ready
              ? "DEMAND READY · MATERIAL STILL NEEDED"
              : d.material_ready
                ? "MATERIAL READY · DEMAND STILL NEEDED"
                : "Demand + material, both required."}
      </h3>
      <p className="fine-print">
        State: {d.state.replaceAll("_", " ")} · capacity {d.capacity} · verified
        ledger inputs. Planned batch: {d.planned_units} units
      </p>
    </>
  );
}
export function StoredImpact({
  data,
  drop: d,
  perform,
  busy,
}: {
  data: Snapshot;
  drop: StoredDrop;
  perform: Perform;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    attempt = useRef(""),
    run = data.production.find(
      (p) => p.drop_id === d.id && p.status !== "cancelled",
    ),
    unlocked = ["unlocked", "production", "completed"].includes(d.phase),
    wasUnlocked = useRef(unlocked),
    [error, setError] = useState("");
  // Local demo operator convenience: request the same server-validated unlock API.
  // Consumers themselves cannot approve or start production.
  useEffect(() => {
    if (
      data.actor.role === "admin/demo" &&
      d.phase === "market_test" &&
      d.eligible &&
      attempt.current !== d.id
    ) {
      attempt.current = d.id;
      void perform(`drops/${d.id}/unlock`).catch((e) => setError(e.message));
    }
  }, [d.id, d.phase, d.eligible, data.actor.role, perform]);
  useEffect(() => {
    if (unlocked && !wasUnlocked.current) {
      ref.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      ref.current?.focus({ preventScroll: true });
    }
    wasUnlocked.current = unlocked;
  }, [unlocked]);
  const [scrap, setScrap] = useState("0"),
    [loss, setLoss] = useState("0");
  const mass = data.massBalances.find((m) => m.production_run_id === run?.id);
  const exceptions = data.exceptions.filter(
    (e) => e.production_run_id === run?.id,
  );
  const canApprove = data.actor.role !== "consumer";
  const act = async (path: string, body: Record<string, unknown> = {}) => {
    try {
      setError("");
      await perform(path, body);
    } catch (e) {
      setError(String(e));
    }
  };
  if (!unlocked && !d.eligible) return null;
  return (
    <div ref={ref} tabIndex={-1} className="loop-impact">
      <div className="impact-hero" role="status">
        <CheckCircle2 size={42} />
        <div>
          <span className="eyebrow">
            {d.eligible
              ? "DEMAND READY ✓ / VERIFIED MATERIAL READY ✓"
              : "COMMITMENT CHANGED · REVIEW REQUIRED"}
          </span>
          <h2>
            {!d.eligible
              ? "PRODUCTION EXCEPTION"
              : unlocked
                ? "DROP UNLOCKED"
                : "READY TO UNLOCK"}
          </h2>
          <p>
            {d.code} ·{" "}
            {unlocked
              ? "Both constraints passed. Only confirmed demand can enter production."
              : "Waiting for the brand to authorise the production plan."}
          </p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {exceptions.map((e) => (
        <p role="status" key={e.id}>
          {e.reason}
        </p>
      ))}
      {!unlocked && canApprove && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act(`drops/${d.id}/unlock`)}
        >
          Unlock verified drop
        </button>
      )}
      <div className="impact-grid">
        {[
          [d.orders, "confirmed buyers"],
          [`${d.allocated_kg} kg`, "verified in demo · allocated material"],
          [d.maximum_capacity, "waste-defined maximum production"],
          [money(d.gross_sales), "committed gross sales"],
          [
            money(d.maximum_capacity * d.selling_price),
            "maximum potential gross sales",
          ],
          [0, "speculative units produced"],
        ].map(([value, label]) => (
          <div className="metric" key={label}>
            <strong>{value}</strong>
            <h3>{label}</h3>
          </div>
        ))}
      </div>
      {run && (
        <div className="callout">
          <div>
            <strong>
              Production run {run.id.slice(0, 8)} · {run.status}
            </strong>
            <p>
              {run.confirmed_units} confirmed units · estimated production cost{" "}
              {money(run.estimated_total_cost)} · committed gross sales{" "}
              {money(run.gross_committed_sales)}. Costs exclude setup, shipping,
              fees and returns; no profit claim.
            </p>
            {canApprove && run.status === "planned" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act(`production-runs/${run.id}/approve`)}
              >
                Approve production plan
              </button>
            )}
            {canApprove && run.status === "approved" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act(`production-runs/${run.id}/start`)}
              >
                Start simulated production
              </button>
            )}
            {canApprove && run.status === "in_production" && (
              <details>
                <summary>
                  Physical reconciliation · process scrap & loss
                </summary>
                <p className="fine-print">
                  Scrap is included within residuals, not added twice. No loss
                  is assumed unless explicitly recorded. Invalid mass balances
                  are rejected.
                </p>
                <label>
                  Process scrap kg
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={scrap}
                    onChange={(e) => setScrap(e.target.value)}
                  />
                </label>
                <label>
                  Non-recoverable portion kg
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={loss}
                    onChange={(e) => setLoss(e.target.value)}
                  />
                </label>
              </details>
            )}
            {canApprove && run.status === "in_production" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(`production-runs/${run.id}/complete`, {
                    requestKey: crypto.randomUUID(),
                    reason:
                      "Explicit simulated physical production reconciliation",
                    processScrapKg: Number(scrap),
                    nonRecoverableKg: Number(loss),
                  })
                }
              >
                Complete simulated production
              </button>
            )}
            {mass && (
              <details>
                <summary>
                  Reconciled physical mass · recovered + auxiliary inputs
                </summary>
                <p>
                  {mass.allocated_kg} kg allocated = {mass.consumed_kg} kg
                  consumed + {mass.recoverable_residual_kg} kg recoverable
                  residual + {mass.non_recoverable_residual_kg} kg
                  non-recoverable residual.
                </p>
                <p>
                  Process scrap: {mass.process_scrap_kg} kg (subset of
                  residual). Tolerance: 0.001 kg. No environmental benefit is
                  inferred.
                </p>
              </details>
            )}
            {run.status === "completed" && (
              <>
                <h3>{d.code} COMPLETED · SIMULATED</h3>
                <p>
                  {run.confirmed_units} units produced · {run.consumed_kg} kg
                  input consumed · {run.residual_kg} kg returned to Future
                  Material Pool.
                </p>
                <p>
                  Residuals are new traceable sources, available to compatible
                  future drops. No verified CO₂ or disposal-avoidance claim.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
