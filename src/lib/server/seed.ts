import { seedAuxiliaries } from "./accounting";
import { PoolClient } from "pg";
import { Actor } from "./domain";
import { one, allocate, audit } from "./service";
import { defaultBatch } from "../mock-data";
import { calculateConcepts } from "../remix-engine";
import { calculateRoutes } from "../circular-engine";
export async function seedWorkspace(c: PoolClient, name = "Remix Demo") {
  const w = await one(
    c,
    "INSERT INTO workspaces(name) VALUES($1) RETURNING id",
    [name],
  );
  const brand = await one(
    c,
    "INSERT INTO brands(workspace_id,name) VALUES($1,'Remix Studio') RETURNING id",
    [w.id],
  );
  const demoUsers = [];
  for (const [name, role] of [
    ["Demo Operator", "admin/demo"],
    ["Consumer Alex", "consumer"],
    ["Brand Team", "brand_user"],
  ])
    demoUsers.push(
      await one(
        c,
        "INSERT INTO users(workspace_id,brand_id,name,role) VALUES($1,$2,$3,$4) RETURNING *",
        [w.id, role === "consumer" ? null : brand.id, name, role],
      ),
    );
  const admin = demoUsers[0] as Actor;
  await c.query(
    "INSERT INTO material_pools(workspace_id,name) VALUES($1,'Future Material Pool')",
    [w.id],
  );
  for (const point of ["NUS UTown", "Kent Ridge collection desk"])
    await c.query(
      "INSERT INTO collection_points(workspace_id,name,hours) VALUES($1,$2,'11:00–19:00')",
      [w.id, point],
    );
  const point = await one(
    c,
    "SELECT id FROM collection_points WHERE workspace_id=$1 LIMIT 1",
    [w.id],
  );
  const batches: Record<string, string> = {},
    sources: Record<string, string> = {};
  for (const code of ["D102", "B017"]) {
    const batch = await one(
      c,
      `INSERT INTO inventory_batches(workspace_id,brand_id,code,product,original_quantity,original_weight,estimated_material_type,verified_material_type,condition,original_price,estimated_reusable_kg,verified_reusable_kg,status,route,analysis,verified_at) VALUES($1,$2,$3,'Denim Jeans',180,142,'Cotton Denim','Cotton Denim','Unsold / Minor Defects',69,142,142,'route_selected','Remix',$4,now()) RETURNING id`,
      [w.id, brand.id, code, JSON.stringify(calculateRoutes(defaultBatch))],
    );
    batches[code] = batch.id;
    await c.query(
      "INSERT INTO inventory_items(batch_id,description,quantity) VALUES($1,'Denim Jeans',180)",
      [batch.id],
    );
    const source = await one(
      c,
      "INSERT INTO material_sources(workspace_id,source_type,batch_id,material_type,verified_kg) VALUES($1,'brand_inventory',$2,'Cotton Denim',142) RETURNING id",
      [w.id, batch.id],
    );
    sources[code] = source.id;
    await audit(c, admin, "inventory_verified", "inventory_batch", batch.id, {
      seed: true,
      kg: 142,
      simulated: true,
    });
  }
  const concepts: Record<string, string> = {};
  for (const recipe of calculateConcepts(defaultBatch)) {
    const r = await one(
      c,
      "INSERT INTO remix_concepts(workspace_id,batch_id,recipe_key,name,selling_price,unit_cost,input_kg,preorder_threshold,utilisation,reasoning,approved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING id",
      [
        w.id,
        batches.B017,
        recipe.id,
        recipe.name,
        recipe.price,
        recipe.cost,
        recipe.inputKg,
        recipe.threshold,
        recipe.utilisation,
        recipe.reason,
      ],
    );
    concepts[recipe.id] = r.id;
  }
  const seededDrops: Record<string, string> = {};
  const recipeConfigs = [
    {
      code: "DROP017",
      key: "tote",
      name: "Denim Tote",
      price: 49,
      cost: 18,
      input: 142 / 68,
      threshold: 42,
      min: 87.706,
      max: 142,
      blend: false,
    },
    {
      code: "DROP024",
      key: "utility",
      name: "Denim Utility Bag",
      price: 49,
      cost: 18,
      input: 1,
      threshold: 42,
      min: 68,
      max: 68,
      blend: false,
    },
    {
      code: "DROP025",
      key: "blend-sleeve",
      name: "Cotton Blend Laptop Sleeve",
      price: 35,
      cost: 14,
      input: 1.25,
      threshold: 32,
      min: 40,
      max: 60,
      blend: true,
    },
    {
      code: "DROP026",
      key: "pouch",
      name: "Recovered Textile Pouch",
      price: 22,
      cost: 9,
      input: 0.5,
      threshold: 10,
      min: 5,
      max: 100,
      blend: true,
    },
  ];
  for (const recipe of recipeConfigs) {
    let conceptId = concepts[recipe.key];
    if (!conceptId) {
      const con = await one(
        c,
        "INSERT INTO remix_concepts(workspace_id,recipe_key,name,selling_price,unit_cost,input_kg,preorder_threshold,utilisation,reasoning,approved) VALUES($1,$2,$3,$4,$5,$6,$7,84,$8,true) RETURNING id",
        [
          w.id,
          recipe.key,
          recipe.name,
          recipe.price,
          recipe.cost,
          recipe.input,
          recipe.threshold,
          "Registered prototype recipe; economics are estimates.",
        ],
      );
      conceptId = con.id;
    }
    const drop = await one(
      c,
      "INSERT INTO drops(workspace_id,brand_id,concept_id,code,phase) VALUES($1,$2,$3,$4,'market_test') RETURNING id",
      [w.id, brand.id, conceptId, recipe.code],
    );
    seededDrops[recipe.code] = drop.id;
    await seedAuxiliaries(c, drop.id);
    const req = await one(
      c,
      "INSERT INTO drop_material_requirements(drop_id,component,material_type,minimum_kg,maximum_kg,kg_per_unit,allowed_blend) VALUES($1,'main fabric','Cotton Denim',$2,$3,$4,$5) RETURNING id",
      [drop.id, recipe.min, recipe.max, recipe.input, recipe.blend],
    );
    if (recipe.code === "DROP024")
      await allocate(c, admin, drop.id, {
        sourceId: sources.D102,
        requirementId: req.id,
        kg: 60,
        requestKey: crypto.randomUUID(),
      });
    if (recipe.code === "DROP017")
      await allocate(c, admin, drop.id, {
        sourceId: sources.B017,
        requirementId: req.id,
        kg: 142,
        requestKey: crypto.randomUUID(),
      });
  }
  // Actual stored demand rows, rather than counters presented as observed events.
  const people = (
    await c.query(
      "INSERT INTO users(workspace_id,name,role) SELECT $1,'Seed shopper '||n,'consumer' FROM generate_series(1,382) n RETURNING id",
      [w.id],
    )
  ).rows;
  for (const code of ["DROP017", "DROP024"]) {
    await c.query(
      "INSERT INTO preorders(drop_id,user_id,unit_price) SELECT $1,x,49 FROM unnest($2::uuid[]) x",
      [seededDrops[code], people.slice(0, 41).map((p) => p.id)],
    );
    await c.query(
      "INSERT INTO votes(drop_id,user_id) SELECT $1,x FROM unnest($2::uuid[]) x",
      [seededDrops[code], people.map((p) => p.id)],
    );
    await c.query(
      "INSERT INTO reservations(drop_id,user_id) SELECT $1,x FROM unnest($2::uuid[]) x",
      [seededDrops[code], people.slice(0, 71).map((p) => p.id)],
    );
  }
  const req = await one(
    c,
    "SELECT id FROM drop_material_requirements WHERE drop_id=$1",
    [seededDrops.DROP024],
  );
  for (let i = 0; i < 9; i++) {
    const user = people[i].id,
      item = await one(
        c,
        "INSERT INTO consumer_items(workspace_id,user_id,item_type,estimated_material_type,estimated_condition,age_months,usage,estimated_recoverable_kg,recommendation) VALUES($1,$2,'Denim Jeans','Cotton Denim','Damaged / reusable panels',24,'No longer used',.8,'RETURN FOR REMIX') RETURNING id",
        [w.id, user],
      );
    const ret = await one(
      c,
      "INSERT INTO return_requests(workspace_id,user_id,consumer_item_id,target_drop_id,collection_point_id,status,estimated_material_kg,reserved_at,received_at,verified_at,return_by) VALUES($1,$2,$3,$4,$5,'accepted',.8,now(),now(),now(),current_date) RETURNING id",
      [w.id, user, item.id, seededDrops.DROP024, point.id],
    );
    const receipt = await one(
      c,
      "INSERT INTO return_receipts(return_request_id,inspector_id,verified_material_type,verified_condition,verified_material_kg,inspection_result,inspection_note) VALUES($1,$2,'Cotton Denim','Damaged / reusable panels',.8,'accepted','Deterministic seed: simulated inspected return') RETURNING id",
      [ret.id, admin.id],
    );
    const source = await one(
      c,
      "INSERT INTO material_sources(workspace_id,source_type,receipt_id,material_type,verified_kg) VALUES($1,'consumer_return',$2,'Cotton Denim',.8) RETURNING id",
      [w.id, receipt.id],
    );
    await allocate(c, admin, seededDrops.DROP024, {
      sourceId: source.id,
      requirementId: req.id,
      kg: 0.8,
      requestKey: crypto.randomUUID(),
    });
    await c.query(
      "INSERT INTO reward_transactions(workspace_id,user_id,receipt_id,type,amount,reason) VALUES($1,$2,$3,'return_base',100,'Observed demo seed: accepted return'),($1,$2,$3,'material_bonus',80,'Observed demo seed: material demand bonus')",
      [w.id, user, receipt.id],
    );
    await audit(c, admin, "return_verified", "return_request", ret.id, {
      seed: true,
      kg: 0.8,
    });
  }
  await audit(c, admin, "demo_seeded", "workspace", w.id, {
    seedVersion: 1,
    simulated: true,
  });
  return { workspaceId: w.id, admin, users: demoUsers };
}
