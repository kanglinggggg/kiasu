"use client";
import { useState } from "react";
import { Snapshot } from "@/lib/server/types";
type Perform = <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
) => Promise<T>;
export function AccountingPanel({
  data,
  perform,
  busy,
}: {
  data: Snapshot;
  perform: Perform;
  busy: boolean;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("Reviewed simulated accounting correction"),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState("0.8");
  const admin = data.actor.role === "admin/demo",
    brand = data.actor.role !== "consumer";
  const act = async (path: string, extra: Record<string, unknown> = {}) => {
    setError("");
    setNotice("");
    try {
      await perform(path, {
        requestKey: crypto.randomUUID(),
        reason,
        ...extra,
      });
      setNotice(
        "Accounting entry saved. Balances updated; the original record is unchanged.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    }
  };
  const allocation =
    data.allocations.find((x) => x.id === selected) ?? data.allocations[0];
  return (
    <details className="architecture accounting-panel">
      <summary>
        Accounting controls · cancellations, credits & material reservations
      </summary>
      <p>
        Original ledger history is preserved. Every correction references its
        original record. Started production requires reconciliation.
      </p>
      <label>
        Reason for this accounting action
        <input
          value={reason}
          minLength={3}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <h3>My preorders</h3>
      {data.preorders.length === 0 && <p>You have no preorders yet.</p>}
      {data.preorders.map((p) => (
        <div className="history-row" key={p.id}>
          <strong>
            {p.code} · {p.status}
          </strong>
          <small>Original order {p.id.slice(0, 8)} · simulated payment</small>
          {["pending", "confirmed"].includes(p.status) && (
            <button
              disabled={busy}
              className="text-button"
              onClick={() => void act(`preorders/${p.id}/cancel`)}
            >
              Cancel preorder
            </button>
          )}
          {p.status === "pending" && (
            <button
              disabled={busy}
              className="text-button"
              onClick={() => void act(`preorders/${p.id}/confirm`)}
            >
              Confirm pending preorder
            </button>
          )}
          {p.status === "cancelled" && (
            <button
              disabled={busy}
              className="text-button"
              onClick={() => void act(`preorders/${p.id}/refund`)}
            >
              Record simulated refund
            </button>
          )}
        </div>
      ))}
      <h3>Reward ledger · {data.balance} credits</h3>
      {data.actor.role !== "brand_user" && (
        <button
          className="secondary"
          disabled={busy || data.balance < 50}
          onClick={() => void act("rewards/redeem", { amount: 50 })}
        >
          Simulate redemption · 50 credits
        </button>
      )}
      <p className="fine-print">
        No voucher is issued. A redemption adds a debit; only an explicit
        reversal restores credits.
      </p>
      {admin &&
        data.rewards
          .filter(
            (r) =>
              r.type !== "reverse" &&
              !data.rewards.some(
                (x) =>
                  x.original_transaction_id === r.id && x.type === "reverse",
              ),
          )
          .map((r) => (
            <div className="history-row" key={r.id}>
              <span>
                {r.amount > 0 ? "+" : ""}
                {r.amount} · {r.type} · {r.id.slice(0, 8)}
              </span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void act(`rewards/${r.id}/reverse`)}
              >
                Reverse transaction
              </button>
              {r.amount > 0 && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act(`rewards/${r.id}/expire`, {
                      amount: Math.min(10, r.amount),
                    })
                  }
                >
                  Expire up to 10 credits
                </button>
              )}
            </div>
          ))}
      {brand && (
        <>
          <h3>Release unused recovered material</h3>
          {allocation ? (
            <>
              <label>
                Original allocation
                <select
                  value={allocation.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {data.allocations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} · {x.id.slice(0, 8)} · {x.quantity_kg} kg
                      reserved
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Release kg
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  max={allocation.quantity_kg}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(`allocations/${allocation.id}/release`, {
                    kg: Number(amount),
                  })
                }
              >
                Record allocation release
              </button>
            </>
          ) : (
            <p>No outstanding recovered-material allocations.</p>
          )}
          <p className="fine-print">
            Approved runs must be cancelled first. Started/completed material
            cannot simply return to stock.
          </p>
          <h3>Production reservations</h3>
          {data.production
            .filter((p) => ["planned", "approved"].includes(p.status))
            .map((p) => (
              <div className="history-row" key={p.id}>
                <span>
                  {data.drops.find((d) => d.id === p.drop_id)?.code} ·{" "}
                  {p.status} · {p.confirmed_units} units
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act(`production-runs/${p.id}/cancel`)}
                >
                  Cancel run & release reservations
                </button>
              </div>
            ))}
          <h3>Required auxiliary components</h3>
          {data.drops
            .filter(
              (d) =>
                ["market_test", "unlocked"].includes(d.phase) &&
                d.auxiliary.length,
            )
            .map((d) => (
              <details key={d.id}>
                <summary>{d.code} · supplier stock and BOM</summary>
                {d.auxiliary.map((r) => {
                  const missing = Math.max(
                      0,
                      Math.round((r.required_quantity - r.available) * 1000) / 1000,
                    ),
                    stock = data.auxiliarySources.find(
                      (s) =>
                        s.component === r.component &&
                        s.unit === r.unit &&
                        s.remaining_quantity > 0,
                    );
                  return (
                    <div className="history-row" key={r.id}>
                      <strong>
                        {r.component}: {r.available} {r.unit} reserved ·{" "}
                        {r.per_unit} / unit
                      </strong>
                      <span>Component capacity: {r.capacity}</span>
                      <button
                        className="text-button"
                        disabled={busy || missing === 0}
                        onClick={() =>
                          void act(`drops/${d.id}/receive-auxiliary`, {
                            requirementId: r.id,
                            quantity: missing,
                          })
                        }
                      >
                        Simulate supplier receipt for the planned batch
                      </button>
                      {stock && (
                        <button
                          className="text-button"
                          disabled={busy || missing === 0}
                          onClick={() =>
                            void act(`drops/${d.id}/allocate-auxiliary`, {
                              requirementId: r.id,
                              sourceId: stock.id,
                              quantity: Math.min(
                                stock.remaining_quantity,
                                missing,
                              ),
                            })
                          }
                        >
                          Reserve available {stock.component} stock
                        </button>
                      )}
                    </div>
                  );
                })}
              </details>
            ))}
          {data.releases.length > 0 && (
            <details>
              <summary>Immutable material releases</summary>
              {data.releases.map((r) => (
                <p key={r.id}>
                  {r.code} · released {r.quantity_kg} kg · original allocation{" "}
                  {r.allocation_id.slice(0, 8)}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {admin && (
        <>
          <h3>Return corrections</h3>
          <p>
            Void an accepted inspection only while material is unconsumed and
            credits can be reversed. Original receipt remains; reassessment
            requires a new reviewed item.
          </p>
          {data.returns
            .filter((r) =>
              ["accepted", "partially_accepted", "allocated"].includes(
                r.status,
              ),
            )
            .map((r) => (
              <div className="history-row" key={r.id}>
                <span>
                  Return {r.id.slice(0, 8)} · {r.verified_material_kg} kg ·{" "}
                  {r.status}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act(`returns/${r.id}/correct`)}
                >
                  Void inspection & reverse credits
                </button>
              </div>
            ))}
        </>
      )}
      {data.exceptions.length > 0 && (
        <div role="status">
          <h3>Production exceptions</h3>
          {data.exceptions.map((e) => (
            <p key={e.id}>
              {e.code} · {e.reason}
            </p>
          ))}
        </div>
      )}
    </details>
  );
}
