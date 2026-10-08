"use client";
import { useState } from "react";
import { Snapshot } from "@/lib/server/types";
type Props = {
  data: Snapshot;
  busy: boolean;
  perform: <T = Record<string, unknown>>(
    path: string,
    body?: unknown,
  ) => Promise<T>;
};
export function MaterialManager({ data, busy, perform }: Props) {
  const [sourceId, setSource] = useState(""),
    [dropId, setDrop] = useState(""),
    [requirementId, setReq] = useState(""),
    [kg, setKg] = useState(""),
    [error, setError] = useState("");
  const sources = data.sources.filter((s) => s.remaining_kg > 0),
    drops = data.drops.filter((d) => d.phase === "market_test"),
    drop = drops.find((d) => d.id === dropId) ?? drops[0],
    source = sources.find((s) => s.id === sourceId) ?? sources[0],
    requirement =
      drop?.requirements.find((r) => r.id === requirementId) ??
      drop?.requirements[0];
  if (data.actor.role === "consumer") return null;
  return (
    <details className="architecture">
      <summary>
        Verified material ledger · allocate remaining or residual material
      </summary>
      <p>
        Balances come from PostgreSQL ledger entries. Allocations are atomic and
        cannot exceed verified sources or requirement limits.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!source || !drop || !requirement) return;
          try {
            setError("");
            await perform(`drops/${drop.id}/allocate-material`, {
              sourceId: source.id,
              requirementId: requirement.id,
              kg: Number(kg),
              requestKey: crypto.randomUUID(),
            });
            setKg("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          Verified source
          <select
            value={source?.id ?? ""}
            onChange={(e) => setSource(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.material_type} · {s.remaining_kg} kg remaining
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination drop
          <select
            value={drop?.id ?? ""}
            onChange={(e) => {
              setDrop(e.target.value);
              setReq("");
            }}
          >
            {drops.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Component
          <select
            value={requirement?.id ?? ""}
            onChange={(e) => setReq(e.target.value)}
          >
            {drop?.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.component} · needs up to{" "}
                {(r.maximum_kg - r.allocated_kg).toFixed(3)} kg
              </option>
            ))}
          </select>
        </label>
        <label>
          Allocate kg
          <input
            type="number"
            required
            min="0.001"
            max={source?.remaining_kg ?? 0}
            step="0.001"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !source || !requirement}>
          Post material allocation
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className="history-list">
        {data.sources.map((s) => (
          <div className="history-row" key={s.id}>
            <strong>
              {s.label} · {s.source_type.replaceAll("_", " ")}
            </strong>
            <span>
              {s.verified_kg} kg verified · {s.remaining_kg} kg remaining
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
