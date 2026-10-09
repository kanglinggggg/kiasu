import { reconcileCheckout } from './commerce';
import { z } from "zod";
import { PoolClient } from "pg";
import { Actor, assertDomain, brandOwns, owns, role, roundKg } from "./domain";
import { one, audit, getDrop } from "./service";
import { id, kg } from "./validation";
const reason = z.string().trim().min(3).max(500);
export const commandInput = z.object({ requestKey: id, reason }).strict();
export const releaseInput = commandInput
  .extend({ kg: kg.refine((n) => n > 0) })
  .strict();
export const finishInput = z
  .object({
    requestKey: id.optional(),
    reason: reason.optional(),
    processScrapKg: kg.default(0),
    nonRecoverableKg: kg.default(0),
  })
  .strict()
  .refine(
    (x) => x.nonRecoverableKg <= x.processScrapKg,
    "Non-recoverable material is a subset of process scrap.",
  );
export async function command(
  c: PoolClient,
  a: Actor,
  input: z.infer<typeof commandInput>,
) {
  await c.query(
    "INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,$4)",
    [input.requestKey, a.workspace_id, a.id, input.reason],
  );
  return input.requestKey;
}
export async function releaseAllocation(
  c: PoolClient,
  a: Actor,
  allocationId: string,
  amount: number,
  key: string,
) {
  const x = await one(
    c,
    "SELECT e.*,d.brand_id,d.workspace_id FROM effective_allocations e JOIN drops d ON d.id=e.drop_id WHERE e.id=$1 AND d.workspace_id=$2",
    [allocationId, a.workspace_id],
  );
  brandOwns(a, x.brand_id);
  assertDomain(
    amount > 0 && amount <= x.quantity_kg,
    "Release exceeds remaining original allocation.",
  );
  const r = await one(
    c,
    "INSERT INTO allocation_releases(allocation_id,quantity_kg,command_id) VALUES($1,$2,$3) RETURNING id",
    [allocationId, amount, key],
  );
  await c.query(
    "UPDATE inventory_batches b SET status=CASE WHEN s.remaining_kg=s.verified_kg THEN 'route_selected' ELSE 'partially_allocated' END FROM source_balances s WHERE s.batch_id=b.id AND s.id=$1",
    [x.source_id],
  );
  await audit(c, a, "allocation_released", "allocation_release", r.id, {
    originalAllocation: allocationId,
    kg: amount,
  });
  return r;
}
export async function cancelProduction(
  c: PoolClient,
  a: Actor,
  runId: string,
  key: string,
) {
  const p = await one(
    c,
    "SELECT p.*,d.brand_id FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE p.id=$1 AND d.workspace_id=$2",
    [runId, a.workspace_id],
  );
  brandOwns(a, p.brand_id);
  assertDomain(
    ["planned", "approved"].includes(p.status),
    "Started production requires explicit mass reconciliation; completed runs cannot be cancelled.",
  );
  const r = await one(
    c,
    "INSERT INTO production_cancellations(production_run_id,command_id) VALUES($1,$2) RETURNING id",
    [runId, key],
  );
  await c.query("UPDATE production_runs SET status='cancelled' WHERE id=$1", [
    runId,
  ]);
  await c.query(
    "UPDATE drops SET phase='market_test',unlocked_at=NULL WHERE id=$1",
    [p.drop_id],
  );
  for (const x of (
    await c.query(
      "SELECT * FROM effective_allocations WHERE drop_id=$1 AND quantity_kg>0",
      [p.drop_id],
    )
  ).rows)
    await releaseAllocation(c, a, x.id, x.quantity_kg, key);
  for (const x of (
    await c.query(
      "SELECT e.* FROM effective_auxiliary_allocations e JOIN auxiliary_requirements r ON r.id=e.requirement_id WHERE r.drop_id=$1 AND e.remaining_quantity>0",
      [p.drop_id],
    )
  ).rows) {
    await c.query(
      "INSERT INTO auxiliary_releases(allocation_id,quantity,command_id) VALUES($1,$2,$3)",
      [x.id, x.remaining_quantity, key],
    );
    await audit(c, a, "auxiliary_released", "auxiliary_allocation", x.id, {
      quantity: x.remaining_quantity,
    });
  }
  await audit(c, a, "production_cancelled", "production_cancellation", r.id, {
    originalRun: runId,
    previousStatus: p.status,
  });
  return r;
}
async function invalidatePlanned(
  c: PoolClient,
  a: Actor,
  dropId: string,
  key: string,
) {
  const p = (
    await c.query(
      "SELECT * FROM production_runs WHERE drop_id=$1 AND status='planned'",
      [dropId],
    )
  ).rows[0];
  if (!p) return;
  const d = await getDrop(c, a.workspace_id, dropId);
  if (!d.eligible || p.confirmed_units > d.orders) {
    // A consumer's cancellation causes a system reversal, without granting them production approval privileges.
    const system = { ...a, role: "admin/demo" as const };
    await cancelProduction(c, system, p.id, key);
    await audit(c, a, "drop_readiness_revoked", "drop", dropId, {
      reason:
        "Confirmed demand or component capacity no longer supports planned production.",
    });
  }
}
export async function reverseReward(
  c: PoolClient,
  a: Actor,
  transactionId: string,
  key: string,
) {
  const original = await one(
    c,
    "SELECT * FROM reward_transactions WHERE id=$1 AND workspace_id=$2",
    [transactionId, a.workspace_id],
  );
  const r = await one(
    c,
    "INSERT INTO reward_transactions(workspace_id,user_id,receipt_id,type,amount,reason,original_transaction_id,command_id) VALUES($1,$2,$3,'reverse',$4,'Explicit reversal of original reward transaction',$5,$6) RETURNING id",
    [
      a.workspace_id,
      original.user_id,
      original.receipt_id,
      -original.amount,
      original.id,
      key,
    ],
  );
  await audit(c, a, "reward_reversed", "reward_transaction", r.id, {
    originalTransaction: original.id,
    amount: -original.amount,
  });
  return r;
}
export async function executeAccounting(
  c: PoolClient,
  a: Actor,
  path: string[],
  raw: unknown,
): Promise<Record<string, any> | undefined> {
  const [resource, recordId, action] = path;
  if (resource === "preorders" && recordId) {
    const input = commandInput.parse(raw);
    const p = await one(
      c,
      "SELECT p.*,d.workspace_id FROM preorders p JOIN drops d ON d.id=p.drop_id WHERE p.id=$1 AND d.workspace_id=$2",
      [recordId, a.workspace_id],
    );
    owns(a, p.user_id);
    const next = (
      {
        confirm: "confirmed",
        cancel: "cancelled",
        refund: "refunded",
        fail: "failed",
      } as Record<string, string>
    )[action];
    assertDomain(next, "Unknown preorder transition.", 404);
    const d = await getDrop(c, a.workspace_id, p.drop_id);
    if (next === "confirmed") {
      assertDomain(d.phase === "market_test", "Market test is closed.");
      const max = Math.min(
        ...d.requirements.map((r) =>
          Math.floor((r.maximum_kg + 1e-7) / r.kg_per_unit),
        ),
        ...d.auxiliary.map((r) => r.capacity),
      );
      assertDomain(
        d.orders < max,
        "Confirmed demand would exceed BOM capacity.",
      );
    }
    const key = await command(c, a, input);
    const event = await one(
      c,
      "INSERT INTO preorder_events(preorder_id,from_state,to_state,command_id) VALUES($1,$2,$3,$4) RETURNING id",
      [p.id, p.status, next, key],
    );
    await reconcileCheckout(c,a,p.id,next,key);
    if (next === "cancelled" && p.status === "confirmed") {
      await invalidatePlanned(c, a, p.drop_id, key);
      const committed = (
        await c.query(
          "SELECT id FROM production_runs WHERE drop_id=$1 AND status IN ('approved','in_production','completed')",
          [p.drop_id],
        )
      ).rows[0];
      if (committed) {
        await c.query(
          "INSERT INTO business_exceptions(production_run_id,preorder_event_id,reason) VALUES($1,$2,$3)",
          [
            committed.id,
            event.id,
            "Demand cancelled after approval; do not restore material automatically. Review the commitment and reconcile physical production.",
          ],
        );
        await audit(
          c,
          a,
          "production_demand_exception",
          "production_run",
          committed.id,
          { preorderId: p.id },
        );
      }
    }
    await audit(c, a, `preorder_${next}`, "preorder_event", event.id, {
      originalPreorder: p.id,
      from: p.status,
      to: next,
    });
    return event;
  }
  if (resource === "allocations" && recordId && action === "release") {
    role(a, "brand_user");
    const input = releaseInput.parse(raw),
      key = await command(c, a, input);
    const r = await releaseAllocation(c, a, recordId, input.kg, key);
    const x = await one(
      c,
      "SELECT drop_id FROM drop_material_allocations WHERE id=$1",
      [recordId],
    );
    await invalidatePlanned(c, a, x.drop_id, key);
    return r;
  }
  if (resource === "production-runs" && recordId && action === "cancel") {
    role(a, "brand_user");
    const input = commandInput.parse(raw),
      key = await command(c, a, input);
    return cancelProduction(c, a, recordId, key);
  }
  if (resource === "rewards" && recordId === "redeem") {
    role(a, "consumer");
    const input = commandInput
        .extend({ amount: z.number().int().positive().max(1000000) })
        .strict()
        .parse(raw),
      key = await command(c, a, input);
    const r = await one(
      c,
      "INSERT INTO reward_transactions(workspace_id,user_id,type,amount,reason,command_id) VALUES($1,$2,'redeem',$3,$4,$5) RETURNING id",
      [a.workspace_id, a.id, -input.amount, input.reason, key],
    );
    await audit(c, a, "reward_redeemed", "reward_transaction", r.id, {
      amount: input.amount,
      simulated: true,
    });
    return r;
  }
  if (
    resource === "rewards" &&
    recordId &&
    ["reverse", "expire"].includes(action)
  ) {
    role(a);
    const input = commandInput
        .extend({ amount: z.number().int().positive().max(1000000).optional() })
        .strict()
        .parse(raw),
      key = await command(c, a, input);
    if (action === "reverse") {
      const checkout = await c.query('SELECT id FROM checkout_records WHERE credit_transaction_id=$1', [recordId]);
      assertDomain(checkout.rowCount === 0, 'Checkout credits must be restored by cancelling or refunding the linked preorder.');
      return reverseReward(c, a, recordId, key);
    }
    assertDomain(input.amount, "Expiration requires an amount.");
    const original = await one(
      c,
      "SELECT * FROM reward_transactions WHERE id=$1 AND workspace_id=$2",
      [recordId, a.workspace_id],
    );
    const r = await one(
      c,
      "INSERT INTO reward_transactions(workspace_id,user_id,receipt_id,type,amount,reason,original_transaction_id,command_id) VALUES($1,$2,$3,'expire',$4,$5,$6,$7) RETURNING id",
      [
        a.workspace_id,
        original.user_id,
        original.receipt_id,
        -input.amount,
        input.reason,
        original.id,
        key,
      ],
    );
    await audit(c, a, "reward_expired", "reward_transaction", r.id, {
      originalTransaction: original.id,
    });
    return r;
  }
  if (resource === "returns" && recordId && action === "correct") {
    role(a);
    const input = commandInput.parse(raw),
      key = await command(c, a, input);
    const r = await one(
      c,
      "SELECT rr.* FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE r.id=$1 AND r.workspace_id=$2",
      [recordId, a.workspace_id],
    );
    assertDomain(
      r.inspection_result !== "rejected",
      "A rejected receipt has no credited material to reverse.",
    );
    const source = await one(
      c,
      "SELECT * FROM material_sources WHERE receipt_id=$1",
      [r.id],
    );
    for (const allocation of (
      await c.query(
        "SELECT * FROM effective_allocations WHERE source_id=$1 AND quantity_kg>0",
        [source.id],
      )
    ).rows) {
      await releaseAllocation(c, a, allocation.id, allocation.quantity_kg, key);
      await invalidatePlanned(c, a, allocation.drop_id, key);
    }
    for (const reward of (
      await c.query(
        "SELECT t.id FROM reward_transactions t WHERE receipt_id=$1 AND type IN ('return_base','material_bonus') AND NOT EXISTS(SELECT 1 FROM reward_transactions r WHERE r.original_transaction_id=t.id AND r.type='reverse')",
        [r.id],
      )
    ).rows) {
      for (const expiry of (
        await c.query(
          "SELECT t.id FROM reward_transactions t WHERE original_transaction_id=$1 AND type='expire' AND NOT EXISTS(SELECT 1 FROM reward_transactions r WHERE r.original_transaction_id=t.id AND r.type='reverse')",
          [reward.id],
        )
      ).rows)
        await reverseReward(c, a, expiry.id, key);
      await reverseReward(c, a, reward.id, key);
    }
    const correction = await one(
      c,
      "INSERT INTO return_corrections(receipt_id,command_id,reason) VALUES($1,$2,$3) RETURNING id",
      [r.id, key, input.reason],
    );
    await c.query("UPDATE return_requests SET status='corrected' WHERE id=$1", [
      recordId,
    ]);
    await audit(c, a, "return_corrected", "return_correction", correction.id, {
      originalReceipt: r.id,
      voidedKg: source.verified_kg,
    });
    return correction;
  }
  if (
    resource === "drops" &&
    recordId &&
    ["receive-auxiliary", "allocate-auxiliary"].includes(action)
  ) {
    role(a, "brand_user");
    const input = commandInput
        .extend({
          requirementId: id,
          quantity: kg.refine((n) => n > 0),
          sourceId: id.optional(),
        })
        .strict()
        .parse(raw),
      key = await command(c, a, input);
    const d = await getDrop(c, a.workspace_id, recordId);
    brandOwns(a, d.brand_id);
    const req = await one(
      c,
      "SELECT r.id,c.* FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id WHERE r.id=$1 AND r.drop_id=$2",
      [input.requirementId, recordId],
    );
    let sourceId = input.sourceId;
    if (action === "receive-auxiliary") {
      const source = await one(
        c,
        "INSERT INTO auxiliary_sources(workspace_id,component,unit,quantity,mass_per_unit_kg,origin,command_id) VALUES($1,$2,$3,$4,$5,'simulated_supplier',$6) RETURNING id",
        [
          a.workspace_id,
          req.component,
          req.unit,
          input.quantity,
          req.mass_per_unit_kg,
          key,
        ],
      );
      sourceId = source.id;
    }
    assertDomain(sourceId, "Select an available auxiliary source.");
    const allocation = await one(
      c,
      "INSERT INTO auxiliary_allocations(requirement_id,source_id,quantity,command_id) VALUES($1,$2,$3,$4) RETURNING id",
      [input.requirementId, sourceId, input.quantity, key],
    );
    await audit(
      c,
      a,
      "auxiliary_allocated",
      "auxiliary_allocation",
      allocation.id,
      { component: req.component, quantity: input.quantity, simulated: true },
    );
    return allocation;
  }
  return undefined;
}
export async function seedAuxiliaries(c: PoolClient, dropId: string) {
  const d = await one(c, "SELECT * FROM drops WHERE id=$1", [dropId]);
  const reqs = (
    await c.query(
      "SELECT r.id,c.component,c.unit,c.per_unit,c.mass_per_unit_kg FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id WHERE r.drop_id=$1",
      [dropId],
    )
  ).rows;
  for (const r of reqs) {
    if (
      (
        await c.query(
          "SELECT 1 FROM auxiliary_allocations WHERE requirement_id=$1",
          [r.id],
        )
      ).rowCount
    )
      continue;
    const source = await one(
      c,
      "INSERT INTO auxiliary_sources(workspace_id,component,unit,quantity,mass_per_unit_kg,origin) VALUES($1,$2,$3,$4,$5,'simulated_supplier') RETURNING id",
      [
        d.workspace_id,
        r.component,
        r.unit,
        roundKg(r.per_unit * 68),
        r.mass_per_unit_kg,
      ],
    );
    await c.query(
      "INSERT INTO auxiliary_allocations(requirement_id,source_id,quantity) VALUES($1,$2,$3)",
      [r.id, source.id, roundKg(r.per_unit * 68)],
    );
  }
}
