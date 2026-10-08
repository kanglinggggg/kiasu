import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool, transaction } from "../src/lib/server/db";
import { seedWorkspace } from "../src/lib/server/seed";
import { execute, getDrop } from "../src/lib/server/service";
import { snapshot } from "../src/lib/server/snapshot";
import { defaultItem } from "../src/lib/return-engine";
import { Actor } from "../src/lib/server/domain";
import { defaultBatch } from "../src/lib/mock-data";
after(() => pool.end());
async function fixture() {
  const f = await transaction((c) =>
    seedWorkspace(c, `Integration ${crypto.randomUUID()}`),
  );
  const s = await snapshot(f.admin);
  return {
    ...f,
    s,
    drop: s.drops.find((d) => d.code === "DROP024")!,
    batch: s.batches.find((b) => b.code === "D102")!,
  };
}
async function reserved(a: Actor, drop: string) {
  const s = await snapshot(a);
  const item = await execute(a, ["consumer-items"], defaultItem);
  return await execute(a, ["returns"], {
    itemId: item.id,
    dropId: drop,
    collectionPointId: s.points[0].id,
  });
}
const run = (a: Actor, path: string[], body: unknown = {}) =>
  execute(a, path, body);
async function received(a: Actor, drop: string) {
  const r = await reserved(a, drop);
  await run(a, ["returns", r.id, "receive"]);
  return r;
}
async function filled(a: Actor, drop: string) {
  const r = await received(a, drop);
  await run(a, ["returns", r.id, "simulate-inspection"]);
  const s = await snapshot(a),
    ret = s.returns.find((x) => x.id === r.id)!;
  const d = s.drops.find((x) => x.id === drop)!;
  await run(a, ["drops", drop, "allocate-material"], {
    sourceId: ret.source_id,
    requirementId: d.requirements[0].id,
    kg: 0.8,
    requestKey: crypto.randomUUID(),
  });
  return r;
}

test("real seed is consistent; reservation never adds material or rewards", async () => {
  const f = await fixture();
  assert.equal(f.drop.orders, 41);
  assert.equal(f.drop.allocated_kg, 67.2);
  assert.equal(f.batch.remaining_kg, 82);
  await reserved(f.admin, f.drop.id);
  const s = await snapshot(f.admin);
  assert.equal(s.drops.find((d) => d.id === f.drop.id)!.allocated_kg, 67.2);
  assert.equal(s.balance, 0);
  assert.equal(s.returns[0].status, "reserved");
});
test("duplicate receipt and inspection races produce one receipt and one pair of reward entries", async () => {
  const f = await fixture(),
    r = await reserved(f.admin, f.drop.id);
  const receives = await Promise.allSettled([
    run(f.admin, ["returns", r.id, "receive"]),
    run(f.admin, ["returns", r.id, "receive"]),
  ]);
  assert.equal(receives.filter((r) => r.status === "fulfilled").length, 1);
  const inspections = await Promise.allSettled([
    run(f.admin, ["returns", r.id, "simulate-inspection"]),
    run(f.admin, ["returns", r.id, "simulate-inspection"]),
  ]);
  assert.equal(inspections.filter((r) => r.status === "fulfilled").length, 1);
  const s = await snapshot(f.admin);
  assert.equal(s.balance, 180);
  assert.equal(s.rewards.length, 2);
  assert.equal(
    s.sources
      .filter((x) => x.source_type === "consumer_return")
      .reduce((n, x) => n + Math.round(x.verified_kg * 1000), 0),
    8000,
  );
});
test("rejected return and out-of-order inspection add neither source nor reward", async () => {
  const f = await fixture(),
    r = await reserved(f.admin, f.drop.id);
  await assert.rejects(run(f.admin, ["returns", r.id, "simulate-inspection"]));
  await run(f.admin, ["returns", r.id, "receive"]);
  await run(f.admin, ["returns", r.id, "inspect"], {
    result: "rejected",
    kg: 0,
    material: "Unknown",
    condition: "Fibre only",
    note: "Unusable mixed fibre detected.",
  });
  const s = await snapshot(f.admin);
  assert.equal(s.balance, 0);
  assert.equal(s.returns[0].source_id, null);
  assert.equal(s.returns[0].status, "rejected");
});
test("partial acceptance caps source and reward at inspected quantity", async () => {
  const f = await fixture(),
    r = await received(f.admin, f.drop.id);
  await run(f.admin, ["returns", r.id, "inspect"], {
    result: "partially_accepted",
    kg: 0.4,
    material: "Cotton Denim",
    condition: "Damaged / reusable panels",
    note: "Only half the panels accepted.",
  });
  const s = await snapshot(f.admin);
  assert.equal(s.returns[0].verified_material_kg, 0.4);
  assert.equal(s.balance, 90);
  await assert.rejects(
    run(f.admin, ["drops", f.drop.id, "allocate-material"], {
      sourceId: s.returns[0].source_id,
      requirementId: f.drop.requirements[0].id,
      kg: 0.8,
      requestKey: crypto.randomUUID(),
    }),
  );
});
test("competing allocations to different drops cannot spend the same source twice", async () => {
  const f = await fixture(),
    others = f.s.drops.filter((d) => ["DROP025", "DROP026"].includes(d.code));
  const calls = await Promise.allSettled(
    others.map((d) =>
      run(f.admin, ["drops", d.id, "allocate-material"], {
        sourceId: f.batch.source_id,
        requirementId: d.requirements[0].id,
        kg: 50,
        requestKey: crypto.randomUUID(),
      }),
    ),
  );
  assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
  const s = await snapshot(f.admin);
  assert.equal(s.batches.find((b) => b.id === f.batch.id)!.remaining_kg, 32);
});
test("same idempotency key cannot double-allocate an accepted return", async () => {
  const f = await fixture(),
    r = await received(f.admin, f.drop.id);
  await run(f.admin, ["returns", r.id, "simulate-inspection"]);
  const s = await snapshot(f.admin),
    ret = s.returns[0],
    input = {
      sourceId: ret.source_id,
      requirementId: f.drop.requirements[0].id,
      kg: 0.8,
      requestKey: crypto.randomUUID(),
    };
  const calls = await Promise.allSettled([
    run(f.admin, ["drops", f.drop.id, "allocate-material"], input),
    run(f.admin, ["drops", f.drop.id, "allocate-material"], input),
  ]);
  assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!
      .allocated_kg,
    68,
  );
});
test("demand-only stays locked and duplicate preorders do not inflate sales", async () => {
  const f = await fixture();
  const calls = await Promise.allSettled([
    run(f.admin, ["drops", f.drop.id, "preorder"]),
    run(f.admin, ["drops", f.drop.id, "preorder"]),
  ]);
  assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
  const d = (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.state, "demand_ready");
  assert.equal(d.gross_sales, 2058);
  await assert.rejects(run(f.admin, ["drops", f.drop.id, "unlock"]));
});
test("material-only stays locked; both ready unlock once and plan exactly 42 units", async () => {
  const f = await fixture();
  await filled(f.admin, f.drop.id);
  await assert.rejects(run(f.admin, ["drops", f.drop.id, "unlock"]));
  assert.equal(
    (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!.state,
    "material_ready",
  );
  await run(f.admin, ["drops", f.drop.id, "preorder"]);
  await run(f.admin, ["drops", f.drop.id, "unlock"]);
  await assert.rejects(run(f.admin, ["drops", f.drop.id, "unlock"]));
  const s = await snapshot(f.admin);
  assert.equal(s.production.length, 1);
  assert.equal(s.production[0].confirmed_units, 42);
  assert.equal(s.production[0].gross_committed_sales, 2058);
});
test("production rejects exceeding demand/capacity, requires approvals, and preserves 26kg residual", async () => {
  const f = await fixture();
  await filled(f.admin, f.drop.id);
  await run(f.admin, ["drops", f.drop.id, "preorder"]);
  await run(f.admin, ["drops", f.drop.id, "unlock"]);
  await assert.rejects(
    run(f.admin, ["production-runs"], { dropId: f.drop.id, units: 43 }),
  );
  await assert.rejects(
    run(f.admin, ["production-runs"], { dropId: f.drop.id, units: 69 }),
  );
  let s = await snapshot(f.admin);
  const p = s.production[0];
  await assert.rejects(run(f.admin, ["production-runs", p.id, "complete"]));
  await run(f.admin, ["production-runs", p.id, "approve"]);
  await run(f.admin, ["production-runs", p.id, "start"]);
  await run(f.admin, ["production-runs", p.id, "complete"]);
  await assert.rejects(run(f.admin, ["production-runs", p.id, "complete"]));
  s = await snapshot(f.admin);
  assert.equal(s.production[0].consumed_kg, 42);
  assert.equal(s.production[0].residual_kg, 26);
  assert.equal(
    s.sources
      .filter((x) => x.source_type === "residual_material")
      .reduce((n, x) => n + Math.round(x.remaining_kg * 1000), 0),
    26000,
  );
  const residual = s.sources.find(
      (x) => x.source_type === "residual_material",
    )!,
    next = s.drops.find((d) => d.code === "DROP026")!;
  await run(f.admin, ["drops", next.id, "allocate-material"], {
    sourceId: residual.id,
    requirementId: next.requirements[0].id,
    kg: residual.remaining_kg,
    requestKey: crypto.randomUUID(),
  });
  await assert.rejects(
    run(f.admin, ["drops", next.id, "allocate-material"], {
      sourceId: residual.id,
      requirementId: next.requirements[0].id,
      kg: residual.remaining_kg,
      requestKey: crypto.randomUUID(),
    }),
  );
});
test("AI fields cannot inject verification, price, capacity, rewards or unlock", async () => {
  const f = await fixture();
  for (const fields of [
    { verified_material_kg: 900 },
    { reward: 999 },
    { unlocked: true },
    { capacity: 1000 },
    { selling_price: 1 },
  ])
    await assert.rejects(
      run(f.admin, ["consumer-items"], { ...defaultItem, ...fields }),
    );
  await assert.rejects(
    run(f.admin, ["drops", f.drop.id, "preorder"], { price: 1 }),
  );
  await assert.rejects(
    run(f.admin, ["drops", f.drop.id, "unlock"], { unlocked: true }),
  );
  for (const value of [-1, NaN, Infinity])
    await assert.rejects(
      run(f.admin, ["inventory"], { ...f.batch.inputs, quantity: value }),
    );
  assert.equal((await snapshot(f.admin)).balance, 0);
});
test("server enforces consumer/brand ownership across roles and workspaces", async () => {
  const f = await fixture(),
    consumer = f.users.find((u) => u.role === "consumer") as Actor,
    brand = f.users.find((u) => u.role === "brand_user") as Actor;
  await assert.rejects(run(consumer, ["inventory"], f.batch.inputs));
  await assert.rejects(run(consumer, ["drops", f.drop.id, "unlock"]));
  await assert.rejects(run(brand, ["consumer-items"], defaultItem));
  const r = await reserved(f.admin, f.drop.id);
  await assert.rejects(run(consumer, ["returns", r.id, "receive"]));
  const stranger = await fixture();
  await assert.rejects(run(stranger.admin, ["drops", f.drop.id, "preorder"]));
});
test("wardrobe hierarchy and multi-drop compatibility are deterministic", async () => {
  const f = await fixture();
  const keep = await run(f.admin, ["consumer-items"], {
    ...defaultItem,
    condition: "Good",
    usage: "Rarely worn",
  });
  assert.equal(keep.recommendation, "KEEP & RESTYLE");
  await assert.rejects(
    run(f.admin, ["returns"], {
      itemId: keep.id,
      dropId: f.drop.id,
      collectionPointId: f.s.points[0].id,
    }),
  );
  const matches = await run(f.admin, ["matches"], {
    ...defaultItem,
    material: "Cotton Blend Denim",
  });
  assert.equal(
    matches.other_matches.find((m: any) => m.dropCode === "DROP024").compatible,
    false,
  );
  assert.equal(matches.best_match.compatibilityScore, 0.85);
  assert.equal(
    matches.other_matches.filter((m: any) => m.compatible && m.neededKg > 0)
      .length,
    2,
  );
});
test("database balance guard rejects direct concurrent overdraw as well as service calls", async () => {
  const f = await fixture();
  const calls = await Promise.allSettled(
    [1, 2].map(() =>
      transaction(async (c) => {
        await c.query(
          "INSERT INTO material_movements(workspace_id,source_id,destination_type,quantity_kg,idempotency_key) VALUES($1,$2,'recycling',60,$3)",
          [f.admin.workspace_id, f.batch.source_id, crypto.randomUUID()],
        );
      }),
    ),
  );
  assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
  const s = await snapshot(f.admin);
  assert.equal(s.batches.find((b) => b.id === f.batch.id)!.remaining_kg, 22);
});
test("fresh readers retain persisted orders and material, independent of React state", async () => {
  const f = await fixture();
  await filled(f.admin, f.drop.id);
  await run(f.admin, ["drops", f.drop.id, "preorder"]);
  const [a, b] = await Promise.all([snapshot(f.admin), snapshot(f.admin)]);
  assert.equal(a.drops.find((d) => d.id === f.drop.id)!.allocated_kg, 68);
  assert.equal(b.drops.find((d) => d.id === f.drop.id)!.orders, 42);
  assert.equal(a.balance, b.balance);
});

test("new brand batch scales deterministic capacity, requires verification, and cannot fund a second drop", async () => {
  const f = await fixture();
  const batch = await run(f.admin, ["inventory"], {
    ...defaultBatch,
    quantity: 360,
    weight: 284,
  });
  const analysis = await run(f.admin, ["inventory", batch.id, "analyse"]);
  assert.ok(
    analysis.analysis.routes.some((r: any) => r.name === "Remix" && r.viable),
  );
  await run(f.admin, ["inventory", batch.id, "select-route"], {
    route: "Remix",
  });
  const suggestions = [
    { name: "Denim Tote", reason: "Reusable panels" },
    { name: "Laptop Sleeve", reason: "Small panels" },
    { name: "Denim Sneakers", reason: "Unsupported" },
  ];
  const ideas = await run(f.admin, ["inventory", batch.id, "concepts"], {
    suggestions,
  });
  assert.equal(ideas.checks[0].concept.max, 136);
  assert.equal(ideas.checks[2].approved, false);
  let s = await snapshot(f.admin);
  const concept = s.concepts.find(
    (c) => c.batch_id === batch.id && c.recipe_key === "tote",
  )!;
  await assert.rejects(run(f.admin, ["drops"], { conceptId: concept.id }));
  await run(f.admin, ["inventory", batch.id, "verify"], {
    kg: 284,
    material: "Cotton Denim",
    note: "Simulated inspection for integration test",
  });
  const drop = await run(f.admin, ["drops"], { conceptId: concept.id });
  s = await snapshot(f.admin);
  const d = s.drops.find((d) => d.id === drop.id)!;
  assert.equal(d.capacity, 136);
  assert.equal(d.orders, 0);
  assert.equal(d.gross_sales, 0);
  assert.equal(s.batches.find((b) => b.id === batch.id)!.remaining_kg, 0);
  const recheck = await run(f.admin, ["inventory", batch.id, "concepts"], {
    suggestions,
  });
  assert.equal(recheck.checks[0].approved, true);
  assert.equal(recheck.checks[1].approved, false);
  const sleeve = s.concepts.find(
    (c) => c.batch_id === batch.id && c.recipe_key === "sleeve",
  )!;
  await assert.rejects(run(f.admin, ["drops"], { conceptId: sleeve.id }));
  assert.equal(
    (await snapshot(f.admin)).batches.find((b) => b.id === f.batch.id)!
      .remaining_kg,
    82,
  );
});

test("every component is required and an overcapacity demand state cannot unlock", async () => {
  const f = await fixture();
  await filled(f.admin, f.drop.id);
  await run(f.admin, ["drops", f.drop.id, "preorder"]);
  await transaction((c) =>
    c.query(
      "INSERT INTO drop_material_requirements(drop_id,component,material_type,minimum_kg,maximum_kg,kg_per_unit) VALUES($1,'lining','Cotton Denim',1,1,.01)",
      [f.drop.id],
    ),
  );
  let d = (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.material_ready, false);
  await assert.rejects(run(f.admin, ["drops", d.id, "unlock"]));
  const lining = d.requirements.find((r) => r.component === "lining")!;
  await run(f.admin, ["drops", d.id, "allocate-material"], {
    sourceId: f.batch.source_id,
    requirementId: lining.id,
    kg: 1,
    requestKey: crypto.randomUUID(),
  });
  d = (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.eligible, true);
  await transaction((c) =>
    c.query("UPDATE drop_material_requirements SET kg_per_unit=2 WHERE id=$1", [
      d.requirements.find((r) => r.component !== "lining")!.id,
    ]),
  );
  d = (await snapshot(f.admin)).drops.find((d) => d.id === f.drop.id)!;
  assert.equal(d.capacity, 34);
  assert.equal(d.eligible, false);
  await assert.rejects(run(f.admin, ["drops", d.id, "unlock"]));
});
