"use client";
import { useState } from "react";
import { Snapshot } from "@/lib/server/types";
import { money } from "@/lib/mock-data";

const sgd = (cents: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    currencyDisplay: "code",
  }).format(cents / 100);
type Props = {
  data: Snapshot;
  onItem?: (id: string) => void;
  onBatch?: (id: string) => void;
  onDrop?: (id: string) => void;
};
export function DomainHistory({ data, onBatch, onDrop, onItem }: Props) {
  const [view, setView] = useState("My Wardrobe Items");
  const tabs = [
    "My Wardrobe Items",
    "My Returns",
    "My Contributions",
    "My Preorders",
    "My Rewards",
  ];
  return (
    <section className="panel persisted-history">
      <span className="eyebrow">ACCOUNT HISTORY / {data.actor.name}</span>
      <h2>Your items and orders.</h2>
      <div
        className="history-tabs"
        role="tablist"
        aria-label="Consumer history"
      >
        {tabs.map((t) => (
          <button
            role="tab"
            aria-selected={view === t}
            key={t}
            onClick={() => setView(t)}
            className={view === t ? "primary" : "secondary"}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {view === tabs[0] && (
          <>
            {!data.items.length && <p>No saved wardrobe items yet.</p>}
            {data.items.map((i) => (
              <div className="history-row" key={i.id}>
                <strong>{i.item_type}</strong>
                <span>
                  {i.estimated_material_type} · {i.estimated_condition} ·
                  estimated {i.estimated_recoverable_kg} kg
                </span>
                <span>{i.recommendation}</span>
                {onItem && (
                  <button className="text-button" onClick={() => onItem(i.id)}>
                    Review saved item
                  </button>
                )}
              </div>
            ))}
          </>
        )}
        {view === tabs[1] && (
          <>
            {!data.returns.length && <p>No returns reserved yet.</p>}
            {data.returns.map((r) => (
              <div className="history-row" key={r.id}>
                <strong>
                  Return {r.id.slice(0, 8)} · {r.status}
                </strong>
                <span>
                  {r.point_name} · estimated {r.estimated_material_kg} kg /
                  verified {r.verified_material_kg ?? "not inspected"} kg
                </span>
                <span>
                  {r.allocated_kg} kg allocated · +{r.reward} credits
                </span>
                {onItem && (
                  <button
                    className="text-button"
                    onClick={() => onItem(r.consumer_item_id)}
                  >
                    Continue return
                  </button>
                )}
              </div>
            ))}
          </>
        )}
        {view === tabs[2] && (
          <>
            {!data.contributions.length && <p>No material movements yet.</p>}
            {data.contributions
              .filter((m) =>
                data.returns.some((r) => r.source_id === m.source_id),
              )
              .map((m) => (
                <div className="history-row" key={m.id}>
                  <strong>
                    {m.source_type.replaceAll("_", " ")} ·{" "}
                    {m.source_id.slice(0, 8)}
                  </strong>
                  <span>
                    {m.net_kg} kg net → {m.drop_code ?? m.destination_type} ·
                    original {m.quantity_kg} kg / released {m.released_kg} kg
                  </span>
                </div>
              ))}
          </>
        )}
        {view === tabs[3] && (
          <>
            {!data.preorders.length && <p>No preorders yet.</p>}
            {data.preorders.map((p) => {
              const checkout = data.commerce.checkouts.find(
                (record) => record.preorder_id === p.id,
              );
              return (
                <div className="history-row" key={p.id}>
                  <strong>
                    {p.code} · {p.status}
                  </strong>
                  {checkout ? (
                    <span>
                      Product value {sgd(checkout.price_cents)} − return
                      discount {sgd(checkout.discount_cents)} − credits{" "}
                      {sgd(checkout.credit_cents)} = {sgd(checkout.payable_cents)}{" "}
                      simulated payable · checkout: {checkout.status} · payment:{" "}
                      {p.payment_status}
                    </span>
                  ) : (
                    <span>
                      Product value {money(p.unit_price)} · payment:{" "}
                      {p.payment_status}
                    </span>
                  )}
                  <button
                    className="text-button"
                    onClick={() => onDrop?.(p.drop_id)}
                  >
                    View contributed drop
                  </button>
                </div>
              );
            })}
          </>
        )}
        {view === tabs[4] && (
          <>
            <h3>Balance: {data.balance} circular credits</h3>
            <p>
              Derived from ledger transactions. Simulated benefits; no
              redemption or payment.
            </p>
            {data.rewards.map((r) => (
              <div className="history-row" key={r.id}>
                <strong>
                  {r.amount > 0 ? "+" : ""}
                  {r.amount} · {r.type.replaceAll("_", " ")}
                </strong>
                <span>{r.reason}</span>
                <small>Receipt {r.receipt_id?.slice(0, 8) ?? "—"}</small>
              </div>
            ))}
          </>
        )}
      </div>
      {data.actor.role !== "consumer" && (
        <details>
          <summary>Brand inventory history</summary>
          {data.batches.map((b) => (
            <div className="history-row" key={b.id}>
              <strong>
                {b.code} · {b.inputs.quantity} {b.inputs.product} · {b.status}
              </strong>
              <span>
                {b.estimated_kg} kg estimated · {b.verified_kg ?? "unverified"}{" "}
                kg verified · {b.allocated_kg} kg allocated · {b.remaining_kg}{" "}
                kg remaining
              </span>
              <span>Route: {b.route ?? "not selected"}</span>
              {b.used_by.map((d) => (
                <small key={d.drop_code}>
                  Used by {d.drop_code} — {d.kg} kg
                </small>
              ))}
              <button className="text-button" onClick={() => onBatch?.(b.id)}>
                Inspect batch
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
export function StoredAnalytics({ data }: { data: Snapshot }) {
  const a = data.analytics;
  return (
    <details className="architecture">
      <summary>Brand demand summary · observed demo data</summary>
      <div className="architecture-flow">
        <div>
          <strong>{a.preorders} confirmed preorders</strong>
          <span>
            {(a.reservationConversion * 100).toFixed(1)}%
            reservation-to-preorder conversion (same consumer / drop)
          </span>
        </div>
        <div>
          <strong>
            {a.acceptedReturns} accepted / {a.returns} reserved returns
          </strong>
          <span>{(a.returnRate * 100).toFixed(1)}% accepted return rate</span>
        </div>
        <div>
          <strong>{a.popularConcept}</strong>
          <span>
            Most preorders · common returned material: {a.commonMaterial}
          </span>
        </div>
        <div>
          <strong>
            {(a.averageMatch * 100).toFixed(0)}% average allocated compatibility
          </strong>
          <span>Rule scores averaged over posted allocation events</span>
        </div>
      </div>
      <p>
        Route distribution:{" "}
        {a.routes.map((r) => `${r.route}: ${r.count}`).join(" · ")}.
      </p>
      <p>
        Observed demo data includes persisted seed events. Prototype predictions
        remain labelled in circular route estimates; no mock preference
        percentages are presented as observations.
      </p>
    </details>
  );
}
