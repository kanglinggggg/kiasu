import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool, transaction } from "../src/lib/server/db";
import { seedWorkspace } from "../src/lib/server/seed";
import { execute } from "../src/lib/server/service";
import { snapshot } from "../src/lib/server/snapshot";
import { defaultItem } from "../src/lib/return-engine";
import { Actor } from "../src/lib/server/domain";
after(() => pool.end());
const cmd = () => ({
  requestKey: crypto.randomUUID(),
  reason: "Explicit accounting integration test",
});
const call = (a: Actor, path: string[], body: unknown = {}) =>
  execute(a, path, body);
async function fixture() {
  const f = await transaction((c) =>
    seedWorkspace(c, `Accounting ${crypto.randomUUID()}`),
  );
  const s = await snapshot(f.admin);
  return {
    ...f,
    drop: s.drops.find((d) => d.code === "DROP024")!,
    batch: s.batches.find((b) => b.code === "D102")!,
  };
}
async function accept(f: Awaited<ReturnType<typeof fixture>>, grade = "B") {
  const s = await snapshot(f.admin),
    item = await call(f.admin, ["consumer-items"], defaultItem),
    r = await call(f.admin, ["returns"], {
      itemId: item.id,
      dropId: f.drop.id,
      collectionPointId: s.points[0].id,
    });
  await call(f.admin, ["returns", r.id, "receive"]);
  await call(f.admin, ["returns", r.id, "inspect"], {
    kg: 0.8,
    result: "accepted",
    material: "Cotton Denim",
    condition: defaultItem.condition,
    note: "Explicit simulated inspection",
    quality: { quality_grade: grade },
  });
  const ret = (await snapshot(f.admin)).returns.find((x) => x.id === r.id)!;
  return ret;
}
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await accept(f);
  await call(f.admin, ["drops", f.drop.id, "allocate-material"], {
    sourceId: r.source_id,
    requirementId: f.drop.requirements[0].id,
    kg: 0.8,
    requestKey: crypto.randomUUID(),
  });
  const order = await call(f.admin, ["drops", f.drop.id, "preorder"]);
  return { r, order };
}
async function unlock(f: Awaited<ReturnType<typeof fixture>>, extraKg=0) {
  const r = await ready(f);
  if(extraKg) await call(f.admin,["drops",f.drop.id,"allocate-material"],{sourceId:f.batch.source_id,requirementId:f.drop.requirements[0].id,kg:extraKg,requestKey:crypto.randomUUID()});
  await call(f.admin, ["drops", f.drop.id, "unlock"]);
  return { ...r, run: (await snapshot(f.admin)).production[0] };
}

test("pending does not count; confirmation counts; cancellation and refund append events once", async () => {
  const f = await fixture();
  const p = await call(f.admin, ["drops", f.drop.id, "preorder"], {
    status: "pending",
  });
  assert.equal(
    (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!.orders,
    41,
  );
  await call(f.admin, ["preorders", p.id, "confirm"], cmd());
  assert.equal(
    (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!
      .gross_sales,
    2058,
  );
  const key = cmd();
  await call(f.admin, ["preorders", p.id, "cancel"], key);
  await assert.rejects(call(f.admin, ["preorders", p.id, "cancel"], key));
  await assert.rejects(call(f.admin, ["preorders", p.id, "cancel"], cmd()));
  await call(f.admin, ["preorders", p.id, "refund"], cmd());
  const s = await snapshot(f.admin);
  assert.equal(s.preorders[0].status, "refunded");
  assert.equal(s.drops.find((d) => d.id === f.drop.id)!.orders, 41);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM preorder_events WHERE preorder_id=$1",
        [p.id],
      )
    ).rows[0].count,
    3,
  );
});
test("failed pending preorder remains outside demand", async () => {
  const f = await fixture();
  const p = await call(f.admin, ["drops", f.drop.id, "preorder"], {
    status: "pending",
  });
  await call(f.admin, ["preorders", p.id, "fail"], cmd());
  await assert.rejects(call(f.admin, ["preorders", p.id, "confirm"], cmd()));
  assert.equal(
    (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!.orders,
    41,
  );
});
test("cancellation invalidates an unapproved plan and releases materials, leaving original history", async () => {
  const f = await fixture(),
    x = await unlock(f);
  await call(f.admin, ["preorders", x.order.id, "cancel"], cmd());
  const s = await snapshot(f.admin),
    d = s.drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.orders, 41);
  assert.equal(d.eligible, false);
  assert.equal(d.phase, "market_test");
  assert.equal(d.allocated_kg, 0);
  assert.equal(s.production[0].status, "cancelled");
  assert.equal(s.batches.find((b) => b.id === f.batch.id)!.remaining_kg, 142);
  assert.equal(
    (
      await pool.query(
        "SELECT quantity_kg FROM material_movements WHERE source_id=$1 AND destination_drop_id=$2",
        [f.batch.source_id, d.id],
      )
    ).rows[0].quantity_kg,
    34,
  );
});
test("release restores balance without mutating original; amount and idempotency are bounded", async () => {
  const f = await fixture(),
    s = await snapshot(f.admin),
    a = s.allocations.find((x) => x.source_id === f.batch.source_id)!;
  const key = { ...cmd(), kg: 20 };
  await call(f.admin, ["allocations", a.id, "release"], key);
  await assert.rejects(call(f.admin, ["allocations", a.id, "release"], key));
  await assert.rejects(
    call(f.admin, ["allocations", a.id, "release"], { ...cmd(), kg: 41 }),
  );
  const after = await snapshot(f.admin);
  assert.equal(
    after.batches.find((b) => b.id === f.batch.id)!.remaining_kg,
    128,
  );
  assert.equal(after.allocations.find((x) => x.id === a.id)!.quantity_kg, 14);
  assert.equal(after.allocations.find((x) => x.id === a.id)!.original_kg, 34);
  await assert.rejects(
    pool.query(
      "UPDATE material_movements SET quantity_kg=1 WHERE id=(SELECT movement_id FROM drop_material_allocations WHERE id=$1)",
      [a.id],
    ),
  );
});
test("earn, redeem, reverse, expire are immutable and never permit a negative balance", async () => {
  const f = await fixture();
  await accept(f);
  let s = await snapshot(f.admin);
  assert.equal(s.balance, 180);
  const redemption = await call(f.admin, ["rewards", "redeem"], {
    ...cmd(),
    amount: 50,
  });
  assert.equal((await snapshot(f.admin)).balance, 130);
  await assert.rejects(
    call(f.admin, ["rewards", "redeem"], { ...cmd(), amount: 131 }),
  );
  await call(f.admin, ["rewards", redemption.id, "reverse"], cmd());
  await assert.rejects(
    call(f.admin, ["rewards", redemption.id, "reverse"], cmd()),
  );
  assert.equal((await snapshot(f.admin)).balance, 180);
  const earn = s.rewards.find((x) => x.amount === 100)!;
  await call(f.admin, ["rewards", earn.id, "expire"], { ...cmd(), amount: 30 });
  assert.equal((await snapshot(f.admin)).balance, 150);
  await assert.rejects(
    call(f.admin, ["rewards", earn.id, "expire"], { ...cmd(), amount: 71 }),
  );
});
test("return correction voids verified source and reverses both earnings exactly once", async () => {
  const f = await fixture(),
    r = await accept(f);
  await call(f.admin, ["returns", r.id, "correct"], cmd());
  const s = await snapshot(f.admin);
  assert.equal(s.balance, 0);
  assert.equal(s.rewards.length, 4);
  assert.equal(s.sources.find((x) => x.id === r.source_id)!.remaining_kg, 0);
  assert.equal(s.returns.find((x) => x.id === r.id)!.status, "corrected");
  await assert.rejects(call(f.admin, ["returns", r.id, "correct"], cmd()));
  assert.equal(
    (
      await pool.query(
        "SELECT verified_material_kg FROM return_receipts WHERE return_request_id=$1",
        [r.id],
      )
    ).rows[0].verified_material_kg,
    0.8,
  );
});
test("correction with spent reward fails atomically; reversing redemption permits correction", async () => {
  const f = await fixture(),
    r = await accept(f);
  const debit = await call(f.admin, ["rewards", "redeem"], {
    ...cmd(),
    amount: 50,
  });
  await assert.rejects(call(f.admin, ["returns", r.id, "correct"], cmd()));
  assert.equal((await snapshot(f.admin)).balance, 130);
  assert.equal(
    (await snapshot(f.admin)).sources.find((x) => x.id === r.source_id)!
      .remaining_kg,
    0.8,
  );
  await call(f.admin, ["rewards", debit.id, "reverse"], cmd());
  await call(f.admin, ["returns", r.id, "correct"], cmd());
  assert.equal((await snapshot(f.admin)).balance, 0);
});
test("BOM includes recovered fabric and auxiliary physical units; limiting component sets capacity", async () => {
  const f = await fixture();
  let d = f.drop;
  assert.equal(d.capacity, 41);
  assert.equal(d.auxiliary.length, 3);
  const zipper = d.auxiliary.find((x) => x.component === "zipper")!;
  const allocation = (
    await pool.query(
      "SELECT * FROM auxiliary_allocations WHERE requirement_id=$1",
      [zipper.id],
    )
  ).rows[0];
  await transaction(async (c) => {
    const key = cmd();
    await c.query(
      "INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,$4)",
      [key.requestKey, f.admin.workspace_id, f.admin.id, key.reason],
    );
    await c.query(
      "INSERT INTO auxiliary_releases(allocation_id,quantity,command_id) VALUES($1,68,$2)",
      [allocation.id, key.requestKey],
    );
  });
  d = (await snapshot(f.admin)).drops.find((x) => x.id === d.id)!;
  assert.equal(d.capacity, 0);
  assert.equal(d.material_ready, false);
  await call(f.admin, ["drops", d.id, "receive-auxiliary"], {
    ...cmd(),
    requirementId: zipper.id,
    quantity: 20,
  });
  d = (await snapshot(f.admin)).drops.find((x) => x.id === d.id)!;
  assert.equal(d.capacity, 20);
  assert.equal(d.material_ready, false);
  await assert.rejects(call(f.admin, ["drops", d.id, "unlock"]));
});
test("inspected grade C cannot enter A/B recipe but can enter C-compatible pouch", async () => {
  const f = await fixture(),
    r = await accept(f, "C");
  await assert.rejects(
    call(f.admin, ["drops", f.drop.id, "allocate-material"], {
      sourceId: r.source_id,
      requirementId: f.drop.requirements[0].id,
      kg: 0.8,
      requestKey: crypto.randomUUID(),
    }),
  );
  const pouch = (await snapshot(f.admin)).drops.find(
    (d) => d.code === "DROP026",
  )!;
  await call(f.admin, ["drops", pouch.id, "allocate-material"], {
    sourceId: r.source_id,
    requirementId: pouch.requirements[0].id,
    kg: 0.8,
    requestKey: crypto.randomUUID(),
  });
  assert.equal(
    (await snapshot(f.admin)).sources.find((x) => x.id === r.source_id)!
      .quality_grade,
    "C",
  );
});
test("AI cannot inject authoritative quality into consumer item confirmation", async () => {
  const f = await fixture();
  await assert.rejects(
    call(f.admin, ["consumer-items"], { ...defaultItem, quality_grade: "A" }),
  );
  await assert.rejects(
    call(f.admin, ["consumer-items"], {
      ...defaultItem,
      quality: { quality_grade: "A" },
    }),
  );
});
test("mass conservation includes auxiliaries, scrap and non-recoverable loss without claiming benefit", async () => {
  const f = await fixture(),
    x = await unlock(f,26);
  await call(f.admin, ["production-runs", x.run.id, "approve"]);
  await call(f.admin, ["production-runs", x.run.id, "start"]);
  await call(f.admin, ["production-runs", x.run.id, "complete"], {
    ...cmd(),
    processScrapKg: 3,
    nonRecoverableKg: 2,
  });
  const s = await snapshot(f.admin),
    m = s.massBalances[0];
  assert.equal(m.allocated_kg, 81.6);
  assert.equal(m.consumed_kg, 50.4);
  assert.equal(m.process_scrap_kg, 3);
  assert.equal(m.recoverable_residual_kg, 29.2);
  assert.equal(m.non_recoverable_residual_kg, 2);
  assert.equal(
    Math.round(
      (m.consumed_kg +
        m.recoverable_residual_kg +
        m.non_recoverable_residual_kg) *
        1000,
    ),
    81600,
  );
  assert.equal(
    Math.round(
      s.sources
        .filter((x) => x.source_type === "residual_material")
        .reduce((n, x) => n + x.verified_kg, 0) * 1000,
    ),
    24000,
  );
  assert.equal(s.production[0].residual_kg, 24);
  await assert.rejects(
    call(f.admin, ["production-runs", x.run.id, "cancel"], cmd()),
  );
});
test("out-of-range scrap rolls back completion, then default completion retains 26kg recovered residual", async () => {
  const f = await fixture(),
    x = await unlock(f,26);
  await call(f.admin, ["production-runs", x.run.id, "approve"]);
  await call(f.admin, ["production-runs", x.run.id, "start"]);
  await assert.rejects(
    call(f.admin, ["production-runs", x.run.id, "complete"], {
      ...cmd(),
      processScrapKg: 27,
      nonRecoverableKg: 27,
    }),
  );
  assert.equal((await snapshot(f.admin)).massBalances.length, 0);
  await call(f.admin, ["production-runs", x.run.id, "complete"]);
  const s = await snapshot(f.admin);
  assert.equal(s.production[0].residual_kg, 26);
  assert.equal(s.massBalances[0].recoverable_residual_kg, 31.2);
});
test("planned and approved cancellation release reservations; historical plans remain", async () => {
  for (const approved of [false, true]) {
    const f = await fixture(),
      x = await unlock(f);
    if (approved) await call(f.admin, ["production-runs", x.run.id, "approve"]);
    const key = cmd();
    await call(f.admin, ["production-runs", x.run.id, "cancel"], key);
    await assert.rejects(
      call(f.admin, ["production-runs", x.run.id, "cancel"], key),
    );
    const s = await snapshot(f.admin);
    assert.equal(s.production[0].status, "cancelled");
    assert.equal(s.drops.find((d) => d.id === f.drop.id)!.allocated_kg, 0);
    assert.equal(s.batches.find((b) => b.id === f.batch.id)!.remaining_kg, 142);
    assert.ok(
      s.auxiliarySources.some(
        (s) => s.component === "zipper" && s.remaining_quantity === 68,
      ),
    );
  }
});
test("started production never restores material on cancellation and demand changes become exceptions", async () => {
  const f = await fixture(),
    x = await unlock(f);
  await call(f.admin, ["production-runs", x.run.id, "approve"]);
  await call(f.admin, ["production-runs", x.run.id, "start"]);
  await assert.rejects(
    call(f.admin, ["production-runs", x.run.id, "cancel"], cmd()),
  );
  await assert.rejects(call(f.admin, ["returns", x.r.id, "correct"], cmd()));
  await call(f.admin, ["preorders", x.order.id, "cancel"], cmd());
  const s = await snapshot(f.admin);
  assert.equal(s.production[0].status, "in_production");
  assert.equal(s.drops.find((d) => d.id === f.drop.id)!.allocated_kg, 42);
  assert.equal(s.exceptions.length, 1);
  assert.equal(s.exceptions[0].production_run_id, x.run.id);
});
test("concurrent allocation and release cannot overspend; replay of a command is rejected", async () => {
  const f = await fixture();
  const s = await snapshot(f.admin),
    allocation = s.allocations.find((a) => a.source_id === f.batch.source_id)!,
    pouch = s.drops.find((d) => d.code === "DROP026")!;
  const results = await Promise.allSettled([
    call(f.admin, ["allocations", allocation.id, "release"], {
      ...cmd(),
      kg: 20,
    }),
    call(f.admin, ["drops", pouch.id, "allocate-material"], {
      sourceId: f.batch.source_id,
      requirementId: pouch.requirements[0].id,
      kg: 100,
      requestKey: crypto.randomUUID(),
    }),
  ]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  const current = (await snapshot(f.admin)).batches.find(
    (b) => b.id === f.batch.id,
  )!;
  assert.ok(current.remaining_kg >= 0);
  assert.equal(current.allocated_kg + current.remaining_kg, 142);
});
test("concurrent cancellation versus unlock cannot leave an invalid active plan", async () => {
  const f = await fixture(),
    x = await ready(f);
  await Promise.allSettled([
    call(f.admin, ["preorders", x.order.id, "cancel"], cmd()),
    call(f.admin, ["drops", f.drop.id, "unlock"]),
  ]);
  const s = await snapshot(f.admin),
    d = s.drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.orders, 41);
  assert.equal(d.eligible, false);
  assert.ok(!s.production.some((p) => p.status !== "cancelled"));
});
test("concurrent redemptions cannot make balance negative", async () => {
  const f = await fixture();
  await accept(f);
  const key = { ...cmd(), amount: 100 };
  const outcomes = await Promise.allSettled([
    call(f.admin, ["rewards", "redeem"], key),
    call(f.admin, ["rewards", "redeem"], key),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await snapshot(f.admin)).balance, 80);
});

test("quality-aware matching uses inspected grade rather than provisional AI assumption", async () => {
  const f = await fixture(),
    r = await accept(f, "C");
  const matches = await call(f.admin, ["returns", r.id, "matches"]);
  assert.equal(
    matches.other_matches.find((m: any) => m.dropCode === "DROP024").compatible,
    false,
  );
  assert.equal(matches.best_match.dropCode, "DROP026");
});
test("approved demand cancellation creates exception and blocks start until explicit cancellation", async () => {
  const f = await fixture(),
    x = await unlock(f);
  await call(f.admin, ["production-runs", x.run.id, "approve"]);
  await call(f.admin, ["preorders", x.order.id, "cancel"], cmd());
  let s = await snapshot(f.admin);
  assert.equal(s.production[0].status, "approved");
  assert.equal(s.exceptions.length, 1);
  await assert.rejects(call(f.admin, ["production-runs", x.run.id, "start"]));
  await call(f.admin, ["production-runs", x.run.id, "cancel"], cmd());
  s = await snapshot(f.admin);
  assert.equal(s.production[0].status, "cancelled");
});
test("cancelled plan can be replaced after fresh reservations without rewriting its quantities", async () => {
  const f = await fixture(),
    x = await unlock(f);
  await call(f.admin, ["production-runs", x.run.id, "cancel"], cmd());
  let s = await snapshot(f.admin);
  await call(f.admin, ["drops", f.drop.id, "allocate-material"], {
    sourceId: f.batch.source_id,
    requirementId: f.drop.requirements[0].id,
    kg: 68,
    requestKey: crypto.randomUUID(),
  });
  for (const r of f.drop.auxiliary) {
    const source = s.auxiliarySources.find((x) => x.component === r.component)!;
    await call(f.admin, ["drops", f.drop.id, "allocate-auxiliary"], {
      ...cmd(),
      requirementId: r.id,
      sourceId: source.id,
      quantity: r.per_unit * 68,
    });
  }
  await call(f.admin, ["drops", f.drop.id, "unlock"]);
  s = await snapshot(f.admin);
  assert.equal(s.production.length, 2);
  assert.equal(s.production.filter((p) => p.status === "planned").length, 1);
  assert.equal(
    s.production.find((p) => p.id === x.run.id)!.confirmed_units,
    42,
  );
  assert.equal(
    s.production.find((p) => p.status === "planned")!.gross_committed_sales,
    2058,
  );
});
test("expiration reversal restores available earn budget and correction preserves all adjustments", async () => {
  const f = await fixture(),
    r = await accept(f);
  const earn = (await snapshot(f.admin)).rewards.find((x) => x.amount === 100)!;
  const expiry = await call(f.admin, ["rewards", earn.id, "expire"], {
    ...cmd(),
    amount: 30,
  });
  await call(f.admin, ["rewards", expiry.id, "reverse"], cmd());
  await call(f.admin, ["rewards", earn.id, "expire"], {
    ...cmd(),
    amount: 100,
  });
  await call(f.admin, ["returns", r.id, "correct"], cmd());
  assert.equal((await snapshot(f.admin)).balance, 0);
});
test("PostgreSQL directly protects concurrent reward debits without the service lock", async () => {
  const f = await fixture();
  await accept(f);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      transaction(async (c) => {
        const key = cmd();
        await c.query(
          "INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,$4)",
          [key.requestKey, f.admin.workspace_id, f.admin.id, key.reason],
        );
        await c.query(
          "INSERT INTO reward_transactions(workspace_id,user_id,type,amount,reason,command_id) VALUES($1,$2,'redeem',-100,'Direct integrity test',$3)",
          [f.admin.workspace_id, f.admin.id, key.requestKey],
        );
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await snapshot(f.admin)).balance, 80);
});
test("database rejects invented consumption or a mass statement without reconciled component records", async () => {
  const f = await fixture(),
    x = await unlock(f);
  await call(f.admin, ["production-runs", x.run.id, "approve"]);
  await call(f.admin, ["production-runs", x.run.id, "start"]);
  const allocation = (await snapshot(f.admin)).allocations.find(
    (a) => a.drop_id === f.drop.id,
  )!;
  await assert.rejects(
    pool.query(
      "INSERT INTO production_consumptions(production_run_id,allocation_id,consumed_kg) VALUES($1,$2,$3)",
      [x.run.id, allocation.id, allocation.quantity_kg + 1],
    ),
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO production_mass_balances(production_run_id,allocated_kg,consumed_kg,process_scrap_kg,recoverable_residual_kg,non_recoverable_residual_kg) VALUES($1,68,42,0,26,0)",
      [x.run.id],
    ),
  );
});


test("42 planned units unlock with exactly 42 kg; 68 remains only the maximum", async () => {
 const f=await fixture(); await ready(f);
 let d=(await snapshot(f.admin)).drops.find(d=>d.id===f.drop.id)!;
 assert.equal(d.planned_units,42); assert.equal(d.requirements[0].required_kg,42);
 assert.equal(d.maximum_capacity,68); assert.equal(d.capacity,42); assert.equal(d.eligible,true);
 await call(f.admin,["drops",d.id,"unlock"]);
 const s=await snapshot(f.admin); assert.equal(s.production[0].confirmed_units,42);
 assert.equal(s.production[0].allocated_material_kg,42); assert.equal(s.production[0].gross_committed_sales,2058);
 await call(f.admin,["production-runs",s.production[0].id,"approve"]);
 await call(f.admin,["production-runs",s.production[0].id,"start"]);
 await call(f.admin,["production-runs",s.production[0].id,"complete"]);
 assert.equal((await snapshot(f.admin)).production[0].residual_kg,0);
});

test("larger demand raises every component target and cancellation recalculates an uncommitted plan", async () => {
 const f=await fixture(); await ready(f);
 const extra=await transaction(async c=>{
  const users=(await c.query("SELECT id FROM users WHERE workspace_id=$1 AND role='consumer' AND id NOT IN (SELECT user_id FROM preorders WHERE drop_id=$2) LIMIT 8",[f.admin.workspace_id,f.drop.id])).rows;
  return (await c.query("INSERT INTO preorders(drop_id,user_id,unit_price) SELECT $1,x,49 FROM unnest($2::uuid[]) x RETURNING id",[f.drop.id,users.map(u=>u.id)])).rows;
 });
 let d=(await snapshot(f.admin)).drops.find(d=>d.id===f.drop.id)!;
 assert.equal(d.planned_units,50); assert.equal(d.requirements[0].required_kg,50);
 assert.equal(d.material_ready,false); assert.equal(d.eligible,false);
 assert.equal(d.auxiliary.find(r=>r.component==='lining')!.required_quantity,9);
 await assert.rejects(call(f.admin,["drops",d.id,"unlock"]));
 await call(f.admin,["preorders",extra[0].id,"cancel"],cmd());
 d=(await snapshot(f.admin)).drops.find(d=>d.id===f.drop.id)!;
 assert.equal(d.planned_units,49); assert.equal(d.requirements[0].required_kg,49);
 await call(f.admin,["drops",d.id,"allocate-material"],{sourceId:f.batch.source_id,requirementId:d.requirements[0].id,kg:7,requestKey:crypto.randomUUID()});
 const zipper=d.auxiliary.find(r=>r.component==='zipper')!;
 await transaction(async c=>{
  const key=cmd();await c.query("INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,$4)",[key.requestKey,f.admin.workspace_id,f.admin.id,key.reason]);
  await c.query("INSERT INTO auxiliary_releases(allocation_id,quantity,command_id) SELECT id,26,$2 FROM auxiliary_allocations WHERE requirement_id=$1",[zipper.id,key.requestKey]);
 });
 d=(await snapshot(f.admin)).drops.find(d=>d.id===f.drop.id)!;
 assert.equal(d.auxiliary.find(r=>r.component==='zipper')!.ready,false);
 assert.equal(d.material_ready,false);
 const view=(await pool.query("SELECT minimum_quantity FROM component_readiness WHERE id=$1",[zipper.id])).rows[0];assert.equal(view.minimum_quantity,49);
 await assert.rejects(call(f.admin,["drops",d.id,"unlock"]));
 await call(f.admin,["drops",d.id,"receive-auxiliary"],{...cmd(),requirementId:zipper.id,quantity:7});
 // A smaller run must not hide the shortage of an all-confirmed-order plan.
 await assert.rejects(transaction(async c=>{
  await c.query("UPDATE drops SET phase='unlocked' WHERE id=$1",[d.id]);
  await c.query("INSERT INTO production_runs(drop_id,confirmed_units,allocated_material_kg,estimated_unit_cost,selling_price) VALUES($1,42,49,18,49)",[d.id]);
 }));
 await call(f.admin,["drops",d.id,"unlock"]);
 assert.equal((await snapshot(f.admin)).production[0].confirmed_units,49);
});

test("legacy 67.2 kg allocation is already material-ready for 42; no fabricated shortage", async()=>{
 const f=await fixture();
 await call(f.admin,["drops",f.drop.id,"allocate-material"],{sourceId:f.batch.source_id,requirementId:f.drop.requirements[0].id,kg:26,requestKey:crypto.randomUUID()});
 let d=(await snapshot(f.admin)).drops.find(d=>d.id===f.drop.id)!;
 assert.equal(d.allocated_kg,67.2);assert.equal(d.material_ready,true);assert.equal(d.demand_ready,false);
 await call(f.admin,["drops",d.id,"preorder"]);
 await call(f.admin,["drops",d.id,"unlock"]);
 assert.equal((await snapshot(f.admin)).production[0].confirmed_units,42);
});
