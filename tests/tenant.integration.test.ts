import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool, transaction } from "../src/lib/server/db";
import { seedWorkspace } from "../src/lib/server/seed";
import { snapshot } from "../src/lib/server/snapshot";
import { execute, one, allocate } from "../src/lib/server/service";
import type { Actor } from "../src/lib/server/domain";

after(() => pool.end());

async function twoBrandFixture() {
  return transaction(async (c) => {
    const seeded = await seedWorkspace(
      c,
      `Tenant audit ${crypto.randomUUID()} · GENUINE SHORTAGE`,
      "genuine_shortage",
    );
    const brandA = seeded.users.find((u) => u.role === "brand_user") as Actor;
    const consumer = seeded.users.find((u) => u.role === "consumer") as Actor;
    const brand = await one(
      c,
      "INSERT INTO brands(workspace_id,name) VALUES($1,'Second Brand') RETURNING id",
      [seeded.workspaceId],
    );
    const brandB = (await one(
      c,
      "INSERT INTO users(workspace_id,brand_id,name,role) VALUES($1,$2,'Second Brand Team','brand_user') RETURNING *",
      [seeded.workspaceId, brand.id],
    )) as Actor;
    const shopper = await one(
      c,
      "INSERT INTO users(workspace_id,name,role) VALUES($1,'Second Brand shopper','consumer') RETURNING id",
      [seeded.workspaceId],
    );
    const batch = await one(
      c,
      `INSERT INTO inventory_batches(workspace_id,brand_id,code,product,original_quantity,original_weight,
       estimated_material_type,verified_material_type,condition,original_price,estimated_reusable_kg,
       verified_reusable_kg,status,route,verified_at)
       VALUES($1,$2,'PRIVATE-B','Private denim',120,100,'Cotton Denim','Cotton Denim',
       'Unsold / Minor Defects',999,100,100,'route_selected','Remix',now()) RETURNING id`,
      [seeded.workspaceId, brand.id],
    );
    const source = await one(
      c,
      "INSERT INTO material_sources(workspace_id,source_type,batch_id,material_type,verified_kg) VALUES($1,'brand_inventory',$2,'Cotton Denim',100) RETURNING id",
      [seeded.workspaceId, batch.id],
    );
    const concept = await one(
      c,
      `INSERT INTO remix_concepts(workspace_id,brand_id,batch_id,recipe_key,name,selling_price,unit_cost,
       input_kg,preorder_threshold,utilisation,reasoning,approved,proposal_source)
       VALUES($1,$2,$3,'pouch','Private Cost Pouch',999,777,.5,10,80,'Private forecast',true,'human') RETURNING id`,
      [seeded.workspaceId, brand.id, batch.id],
    );
    await c.query(
      "UPDATE remix_concepts SET recipe_registered=true,brand_approved_at=now(),maker_approved_at=now(),maker_name='Second Brand maker · simulated' WHERE id=$1",
      [concept.id],
    );
    const drop = await one(
      c,
      "INSERT INTO drops(workspace_id,brand_id,concept_id,code,phase) VALUES($1,$2,$3,'DROP-PRIVATE','market_test') RETURNING id",
      [seeded.workspaceId, brand.id, concept.id],
    );
    const requirement = await one(
      c,
      "INSERT INTO drop_material_requirements(drop_id,component,material_type,minimum_kg,maximum_kg,kg_per_unit,allowed_blend,accepted_grades) VALUES($1,'main fabric','Cotton Denim',5,50,.5,false,ARRAY['A','B']) RETURNING id",
      [drop.id],
    );
    await allocate(c, brandB, drop.id, {
      sourceId: source.id,
      requirementId: requirement.id,
      kg: 10,
      requestKey: crypto.randomUUID(),
    });
    await c.query(
      "INSERT INTO preorders(drop_id,user_id,unit_price,status) VALUES($1,$2,999,'confirmed')",
      [drop.id, shopper.id],
    );
    return {
      ...seeded,
      brandA,
      brandB,
      consumer,
      brandBId: brand.id,
      batchB: batch.id,
      sourceB: source.id,
      conceptB: concept.id,
      dropB: drop.id,
    };
  });
}

test("two brands in one marketplace cannot read each other's private domain", async () => {
  const f = await twoBrandFixture();
  const [a, b, consumer] = await Promise.all([
    snapshot(f.brandA),
    snapshot(f.brandB),
    snapshot(f.consumer),
  ]);
  assert.ok(a.batches.every((x) => x.brand_id === f.brandA.brand_id));
  assert.ok(a.concepts.every((x) => x.brand_id === f.brandA.brand_id));
  assert.ok(a.drops.every((x) => x.brand_id === f.brandA.brand_id));
  assert.ok(a.sources.every((x) => x.id !== f.sourceB));
  assert.ok(a.allocations.every((x) => x.drop_id !== f.dropB));
  assert.equal(a.commerce.sales.scope, "brand");
  assert.equal(a.commerce.sales.gmv_cents, 82 * 4900);

  assert.deepEqual(b.batches.map((x) => x.id), [f.batchB]);
  assert.deepEqual(b.concepts.map((x) => x.id), [f.conceptB]);
  assert.deepEqual(b.drops.map((x) => x.id), [f.dropB]);
  assert.equal(b.commerce.sales.gmv_cents, 99900);

  const publicDrop = consumer.drops.find((x) => x.id === f.dropB) as Record<string, unknown>;
  assert.ok(publicDrop);
  assert.equal("batch_id" in publicDrop, false);
  assert.equal("unit_cost" in publicDrop, false);
  assert.equal(consumer.batches.length, 0);
  assert.equal(consumer.concepts.length, 0);
  assert.equal(consumer.commerce.sales.scope, "not_exposed");
  assert.equal(consumer.commerce.sales.gmv_cents, 0);
});
test("other-brand stock neither suppresses a bounty nor crosses the allocation boundary", async () => {
  const f = await twoBrandFixture();
  const admin = await snapshot(f.admin);
  const constrained = admin.drops.find((x) => x.code === "DROP024")!;
  const bounty = admin.commerce.bounties.find((x) => x.dropId === constrained.id)!;
  assert.equal(bounty.availableStockKg, 0);
  assert.equal(bounty.shortageKg, 0.8);
  await assert.rejects(
    execute(f.admin, ["drops", constrained.id, "allocate-material"], {
      sourceId: f.sourceB,
      requirementId: constrained.requirements[0].id,
      kg: 0.8,
      requestKey: crypto.randomUUID(),
    }),
    /Cross-brand material allocation/,
  );
  await assert.rejects(
    execute(f.brandA, ["inventory", f.batchB, "analyse"], {}),
    /another brand/,
  );
  await assert.rejects(
    execute(f.brandA, ["concepts", f.conceptB, "approve"], {
      makerName: "Wrong reviewer",
      note: "Must not cross the tenant boundary",
    }),
    /another brand/,
  );
  await assert.rejects(
    transaction((c) =>
      c.query("UPDATE inventory_batches SET brand_id=$2 WHERE id=$1", [
        f.batchB,
        f.brandA.brand_id,
      ]),
    ),
    /ownership is immutable/,
  );
  await assert.rejects(
    transaction((c) =>
      c.query("UPDATE drops SET brand_id=$2 WHERE id=$1", [
        f.dropB,
        f.brandA.brand_id,
      ]),
    ),
  );
  await assert.rejects(
    transaction((c) =>
      c.query("UPDATE remix_concepts SET unit_cost=1 WHERE id=$1", [f.conceptB]),
    ),
    /economics and feasibility are frozen/,
  );
});

