import { plannedQuantity, requiredMaterial } from "../unlock-engine";
import { executeAccounting } from "./accounting";
import { reconcileProduction } from "./production-accounting";
import {
  qualityCompatible,
  qualityInput,
  defaultQuality,
} from "../material-quality";
import { PoolClient } from "pg";
import { transaction } from "./db";
import {
  Actor,
  assertDomain,
  role,
  owns,
  brandOwns,
  compatibility,
  roundKg,
} from "./domain";
import * as v from "./validation";
import { calculateRoutes } from "../circular-engine";
import { calculateConcepts, materialEstimate } from "../remix-engine";
import { verifyOpportunities } from "../ai/concept-generator";
import { Batch, materialProfiles, conditionProfiles } from "../mock-data";
import { calculateRecoveryReward } from "../rewards-engine";
import { ConsumerItem, recommendAction, recoverableKg } from "../return-engine";
import { StoredDrop, Requirement, Match } from "./types";
// Database rows are internal; every external payload is parsed by a strict schema.
type Row = Record<string, any>;
export async function one(
  c: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<Row> {
  const row = (await c.query(sql, params)).rows[0];
  assertDomain(row, "Record not found.", 404);
  return row;
}
export async function audit(
  c: PoolClient,
  a: Actor,
  type: string,
  entity: string,
  id: string,
  details: unknown = {},
) {
  await c.query(
    "INSERT INTO audit_events(workspace_id,actor_id,type,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)",
    [a.workspace_id, a.id, type, entity, id, JSON.stringify(details)],
  );
}
export async function getDrop(
  c: PoolClient,
  workspace: string,
  id: string,
  actorId = "",
): Promise<StoredDrop> {
  const d = await one(
    c,
    `SELECT d.*,c.name,c.batch_id,c.recipe_key,c.selling_price,c.unit_cost,c.preorder_threshold FROM drops d JOIN remix_concepts c ON c.id=d.concept_id WHERE d.id=$1 AND d.workspace_id=$2`,
    [id, workspace],
  );
  const reqs = (
    await c.query(
      `SELECT r.*,COALESCE(sum(a.quantity_kg),0) allocated_kg FROM drop_material_requirements r LEFT JOIN effective_allocations a ON a.requirement_id=r.id WHERE r.drop_id=$1 GROUP BY r.id ORDER BY r.component`,
      [id],
    )
  ).rows.map((r) => ({
    ...r,
    capacity: Math.floor((r.allocated_kg + 1e-7) / r.kg_per_unit),
  })) as Requirement[];
  const auxiliary = (
    await c.query(
      "SELECT r.id,c.component,c.unit,c.per_unit,c.mass_per_unit_kg,COALESCE(sum(a.remaining_quantity),0) available FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id LEFT JOIN effective_auxiliary_allocations a ON a.requirement_id=r.id WHERE r.drop_id=$1 GROUP BY r.id,c.id ORDER BY c.component",
      [id],
    )
  ).rows.map((r) => ({
    ...r,
    capacity: Math.floor((r.available + 1e-7) / r.per_unit),
    ready: false,
    required_quantity: 0,
  }));
  const counts = await one(
    c,
    `SELECT (SELECT count(*) FROM preorders WHERE drop_id=$1 AND status='confirmed') orders,(SELECT COALESCE(sum(unit_price),0) FROM preorders WHERE drop_id=$1 AND status='confirmed') gross_sales,(SELECT count(*) FROM votes WHERE drop_id=$1) votes,(SELECT count(*) FROM reservations WHERE drop_id=$1) reservations,(SELECT EXISTS(SELECT 1 FROM preorders WHERE drop_id=$1 AND user_id::text=$2 AND status='confirmed')) my_order,(SELECT status FROM preorders WHERE drop_id=$1 AND user_id::text=$2) my_preorder_status,(SELECT EXISTS(SELECT 1 FROM votes WHERE drop_id=$1 AND user_id::text=$2)) my_vote,(SELECT EXISTS(SELECT 1 FROM reservations WHERE drop_id=$1 AND user_id::text=$2)) my_reservation`,
    [id, actorId],
  );
  const committed = (await c.query("SELECT confirmed_units FROM production_runs WHERE drop_id=$1 AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
  const planned_units = plannedQuantity(counts.orders,d.preorder_threshold,committed?.confirmed_units);
  reqs.forEach(r=>{r.required_kg=requiredMaterial(planned_units,r.kg_per_unit);});
  auxiliary.forEach(r=>{r.required_quantity=requiredMaterial(planned_units,r.per_unit);r.ready=r.available+1e-8>=r.required_quantity;});
  const maximum_capacity = reqs.length ? Math.min(...reqs.map(r=>Math.floor((r.maximum_kg+1e-7)/r.kg_per_unit))) : 0;
  const capacity = reqs.length
      ? Math.min(
          ...reqs.map((r) => r.capacity),
          ...auxiliary.map((r) => r.capacity),
        )
      : 0,
    demand_ready = counts.orders >= planned_units,
    material_ready =
      reqs.length > 0 &&
      reqs.every((r) => r.allocated_kg + 1e-8 >= r.required_kg) &&
      auxiliary.every((r) => r.ready);
  const eligible = demand_ready && material_ready && counts.orders <= capacity;
  const state =
    d.phase !== "market_test"
      ? d.phase
      : eligible
        ? "ready_to_unlock"
        : demand_ready
          ? "demand_ready"
          : material_ready
            ? "material_ready"
            : "market_test";
  return {
    ...d,
    ...counts,
    requirements: reqs,
    auxiliary,
    capacity,
    maximum_capacity,
    planned_units,
    demand_ready,
    material_ready,
    eligible,
    state,
    allocated_kg: roundKg(reqs.reduce((n, r) => n + r.allocated_kg, 0)),
  } as StoredDrop;
}
export function batchFrom(row: Row): Batch {
  return {
    product: row.product,
    quantity: row.original_quantity,
    material: row.estimated_material_type,
    condition: row.condition,
    price: row.original_price,
    weight: row.original_weight,
  };
}
export async function batchAvailable(c: PoolClient, row: Row) {
  const source = (
    await c.query("SELECT * FROM source_balances WHERE batch_id=$1", [row.id])
  ).rows[0];
  return {
    source,
    kg: source ? Number(source.remaining_kg) : row.estimated_reusable_kg,
  };
}
export const rewardQuote = calculateRecoveryReward;
export async function findMatches(
  c: PoolClient,
  workspace: string,
  item: ConsumerItem,
  inspectedQuality?: typeof defaultQuality,
): Promise<Match[]> {
  const kg = recoverableKg(item),
    drops = (
      await c.query(
        "SELECT id FROM drops WHERE workspace_id=$1 AND phase='market_test' ORDER BY code",
        [workspace],
      )
    ).rows;
  const results: Match[] = [];
  for (const row of drops) {
    const drop = await getDrop(c, workspace, row.id);
    for (const req of drop.requirements) {
      const materialMatch = compatibility(item.material, req),
        qualityReady = qualityCompatible(
          inspectedQuality ?? defaultQuality,
          req.accepted_grades,
        ),
        match = {
          ...materialMatch,
          compatible: materialMatch.compatible && qualityReady,
          reason:
            materialMatch.reason +
            (inspectedQuality
              ? ` Inspected grade ${inspectedQuality.quality_grade}: ${qualityReady ? "compatible" : "not compatible"}.`
              : " Provisional grade B assumption; inspected quality is checked again before allocation."),
        },
        needed = roundKg(Math.max(0, req.required_kg - req.allocated_kg));
      results.push({
        ...match,
        dropId: drop.id,
        dropCode: drop.code,
        name: drop.name,
        requirementId: req.id,
        recoverableKg: kg,
        neededKg: needed,
        reward: rewardQuote(kg, match.compatibilityScore, needed, drop.orders),
      });
    }
  }
  return results.sort(
    (a, b) =>
      Number(b.compatible && b.neededKg > 0) -
        Number(a.compatible && a.neededKg > 0) ||
      b.compatibilityScore - a.compatibilityScore ||
      b.reward.total - a.reward.total ||
      a.dropCode.localeCompare(b.dropCode),
  );
}
export async function allocate(
  c: PoolClient,
  a: Actor,
  dropId: string,
  input: ReturnType<typeof v.allocationInput.parse>,
) {
  const d = await getDrop(c, a.workspace_id, dropId, a.id);
  assertDomain(
    d.phase === "market_test",
    "Material allocation is closed for this drop.",
  );
  const req = d.requirements.find((r) => r.id === input.requirementId);
  assertDomain(req, "Requirement does not belong to this drop.");
  const source = await one(
    c,
    "SELECT * FROM source_balances WHERE id=$1 AND workspace_id=$2",
    [input.sourceId, a.workspace_id],
  );
  if (a.role === "consumer") {
    assertDomain(
      source.source_type === "consumer_return",
      "Consumers may allocate only their own accepted return.",
      403,
    );
    const owner = await one(
      c,
      "SELECT r.user_id FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE rr.id=$1",
      [source.receipt_id],
    );
    owns(a, owner.user_id);
  } else {
    brandOwns(a, d.brand_id);
    if (a.role === "brand_user") {
      const origin = source.batch_id
        ? await one(c, "SELECT brand_id FROM inventory_batches WHERE id=$1", [
            source.batch_id,
          ])
        : source.production_run_id
          ? await one(
              c,
              "SELECT d.brand_id FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE p.id=$1",
              [source.production_run_id],
            )
          : await one(
              c,
              "SELECT d.brand_id FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id JOIN drops d ON d.id=r.target_drop_id WHERE rr.id=$1",
              [source.receipt_id],
            );
      brandOwns(a, origin.brand_id);
    }
  }
  assertDomain(
    compatibility(source.material_type, req).compatible,
    "Material is incompatible with this requirement.",
  );
  assertDomain(
    qualityCompatible(source as typeof defaultQuality, req.accepted_grades),
    "Inspected quality does not meet recipe grades, composition or cleanliness.",
  );
  assertDomain(
    input.kg <= source.remaining_kg,
    "Material exceeds verified unallocated source quantity.",
  );
  assertDomain(
    roundKg(req.allocated_kg + input.kg) <= req.maximum_kg,
    "Material exceeds this requirement maximum.",
  );
  const movement = await one(
    c,
    `INSERT INTO material_movements(workspace_id,source_id,destination_type,destination_drop_id,quantity_kg,idempotency_key) VALUES($1,$2,'drop',$3,$4,$5) RETURNING id`,
    [a.workspace_id, source.id, dropId, input.kg, input.requestKey],
  );
  const allocation = await one(
    c,
    "INSERT INTO drop_material_allocations(drop_id,requirement_id,movement_id) VALUES($1,$2,$3) RETURNING id",
    [dropId, req.id, movement.id],
  );
  if (source.batch_id)
    await c.query(
      "UPDATE inventory_batches SET status=CASE WHEN $2::numeric=remaining_kg THEN 'allocated' ELSE 'partially_allocated' END FROM (SELECT $3::numeric remaining_kg) q WHERE id=$1",
      [source.batch_id, input.kg, source.remaining_kg],
    );
  if (source.receipt_id)
    await c.query(
      "UPDATE return_requests SET status='allocated' WHERE id=(SELECT return_request_id FROM return_receipts WHERE id=$1)",
      [source.receipt_id],
    );
  await audit(c, a, "material_allocated", "material_movement", movement.id, {
    sourceId: source.id,
    dropId,
    kg: input.kg,
    compatibility: compatibility(source.material_type, req).compatibilityScore,
  });
  return allocation;
}
async function inspect(
  c: PoolClient,
  a: Actor,
  id: string,
  input: ReturnType<typeof v.inspectInput.parse>,
) {
  const r = await one(
    c,
    "SELECT * FROM return_requests WHERE id=$1 AND workspace_id=$2",
    [id, a.workspace_id],
  );
  assertDomain(
    r.status === "received",
    "Receive this return once before inspection.",
  );
  const item = await one(c, "SELECT * FROM consumer_items WHERE id=$1", [
    r.consumer_item_id,
  ]);
  const consumer = {
    type: item.item_type,
    material: input.material,
    condition: input.condition,
    usage: item.usage,
    ageMonths: item.age_months,
  } as ConsumerItem;
  const accepted = input.result !== "rejected";
  if (accepted) {
    assertDomain(
      input.kg > 0,
      "Accepted material must have positive verified kg.",
    );
    assertDomain(
      input.kg <= r.estimated_material_kg,
      "Verified quantity exceeds this item’s conservative recipe limit. Reassess the item first.",
    );
    assertDomain(
      input.material !== "Unknown" && input.material !== "Polyester",
      "Unsupported verified material.",
    );
    assertDomain(
      recommendAction(consumer).action === "RETURN FOR REMIX",
      "Wearable or repairable clothing must follow a higher-value route.",
    );
  } else
    assertDomain(
      input.kg === 0,
      "Rejected returns must have zero accepted material.",
    );
  if (input.result === "partially_accepted")
    assertDomain(
      input.kg < r.estimated_material_kg,
      "Partial acceptance must be below the estimated recoverable weight.",
    );
  const receipt = await one(
    c,
    `INSERT INTO return_receipts(return_request_id,inspector_id,verified_material_type,verified_condition,verified_material_kg,inspection_result,inspection_note,quality_grade,composition,colour_family,fabric_weight,panel_grade,contamination_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      id,
      a.id,
      input.material,
      input.condition,
      input.kg,
      input.result,
      input.note,
      ...Object.values(qualityInput.parse(input.quality ?? {})),
    ],
  );
  await c.query(
    "UPDATE return_requests SET status='inspected',verified_at=now() WHERE id=$1",
    [id],
  );
  await audit(c, a, "return_inspected", "return_request", id, {
    result: input.result,
  });
  await c.query("UPDATE return_requests SET status=$2 WHERE id=$1", [
    id,
    input.result,
  ]);
  if (accepted) {
    await c.query(
      "INSERT INTO material_sources(workspace_id,source_type,receipt_id,material_type,verified_kg) VALUES($1,'consumer_return',$2,$3,$4)",
      [a.workspace_id, receipt.id, input.material, input.kg],
    );
    const drop = await getDrop(c, a.workspace_id, r.target_drop_id),
      req = drop.requirements.find(
        (req) =>
          compatibility(input.material, req).compatible &&
          qualityCompatible(
            qualityInput.parse(input.quality ?? {}),
            req.accepted_grades,
          ),
      );
    const reward = rewardQuote(
      input.kg,
      req ? compatibility(input.material, req).compatibilityScore : 0,
      drop.phase === "market_test" && req
        ? req.required_kg - req.allocated_kg
        : 0,
      drop.orders,
    );
    for (const [type, amount, reason] of [
      [
        "return_base",
        reward.base,
        "Accepted verified material matching an active requirement",
      ],
      [
        "material_bonus",
        reward.bonus,
        `Active material demand bonus for ${drop.code}`,
      ],
    ] as const) {
      if (amount > 0) {
        const rewardRow = await one(
          c,
          "INSERT INTO reward_transactions(workspace_id,user_id,receipt_id,type,amount,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [a.workspace_id, r.user_id, receipt.id, type, amount, reason],
        );
        await audit(c, a, "reward_issued", "reward_transaction", rewardRow.id, {
          returnId: id,
          amount,
          type,
        });
      }
    }
  }
  await audit(c, a, "return_verified", "return_request", id, {
    accepted,
    kg: input.kg,
    material: input.material,
    simulated: true,
  });
  return receipt;
}
async function plan(c: PoolClient, a: Actor, dropId: string, units?: number) {
  const d = await getDrop(c, a.workspace_id, dropId);
  brandOwns(a, d.brand_id);
  assertDomain(
    d.phase === "unlocked" && d.eligible,
    "Unlock a valid drop before planning production.",
  );
  const count = units ?? d.planned_units;
  assertDomain(
    count === d.planned_units && count <= d.orders && count <= d.capacity && count >= d.preorder_threshold,
    "Production cannot exceed confirmed demand or verified material capacity.",
  );
  const run = await one(
    c,
    "INSERT INTO production_runs(drop_id,confirmed_units,allocated_material_kg,estimated_unit_cost,selling_price) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [dropId, count, d.allocated_kg, d.unit_cost, d.selling_price],
  );
  await audit(c, a, "production_planned", "production_run", run.id, {
    units: count,
  });
  return run;
}
export async function execute(a: Actor, path: string[], raw: unknown) {
  return transaction(async (c) => {
    // Coarse workspace lock provides predictable serial semantics across all API instances.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      a.workspace_id,
    ]);
    const [resource, id, action] = path;
    if (id && !(resource === "rewards" && id === "redeem")) v.id.parse(id);
    const accountingResult = await executeAccounting(c, a, path, raw);
    if (accountingResult !== undefined) return accountingResult;
    if (resource === "inventory" && !id) {
      role(a, "brand_user");
      const input = v.batchInput.parse(raw),
        stock = materialEstimate(input);
      const brandId =
        a.brand_id ??
        (
          await one(c, "SELECT id FROM brands WHERE workspace_id=$1 LIMIT 1", [
            a.workspace_id,
          ])
        ).id;
      const r = await one(
        c,
        `INSERT INTO inventory_batches(workspace_id,brand_id,code,product,original_quantity,original_weight,estimated_material_type,condition,original_price,estimated_reusable_kg) VALUES($1,$2,'B-'||substr(gen_random_uuid()::text,1,8),$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          a.workspace_id,
          brandId,
          input.product,
          input.quantity,
          input.weight,
          input.material,
          input.condition,
          input.price,
          roundKg(stock.effectiveKg),
        ],
      );
      await c.query(
        "INSERT INTO inventory_items(batch_id,description,quantity) VALUES($1,$2,$3)",
        [r.id, input.product, input.quantity],
      );
      await audit(c, a, "inventory_created", "inventory_batch", r.id);
      return r;
    }
    if (resource === "inventory" && id) {
      const batch = await one(
        c,
        "SELECT * FROM inventory_batches WHERE id=$1 AND workspace_id=$2",
        [id, a.workspace_id],
      );
      brandOwns(a, batch.brand_id);
      if (action === "analyse") {
        v.empty.parse(raw);
        assertDomain(
          ["draft", "analysed"].includes(batch.status),
          "Committed inventory cannot be reanalysed in place. Create a new batch.",
        );
        const analysis = calculateRoutes(batchFrom(batch));
        await c.query(
          "UPDATE inventory_batches SET status='analysed',analysis=$2 WHERE id=$1",
          [id, JSON.stringify(analysis)],
        );
        await audit(c, a, "inventory_analysed", "inventory_batch", id);
        return { id, analysis };
      }
      if (action === "select-route") {
        const input = v.routeInput.parse(raw);
        assertDomain(
          ["analysed", "route_selected"].includes(batch.status),
          "Analyse the batch before selecting a route.",
        );
        const routes = calculateRoutes(batchFrom(batch));
        assertDomain(
          routes.routes.some((r) => r.name === input.route && r.viable),
          "This route is not feasible.",
        );
        await c.query(
          "UPDATE inventory_batches SET status='route_selected',route=$2 WHERE id=$1",
          [id, input.route],
        );
        await audit(
          c,
          a,
          "inventory_route_selected",
          "inventory_batch",
          id,
          input,
        );
        return { id };
      }
      if (action === "verify") {
        const input = v.verifyBatchInput.parse(raw);
        assertDomain(
          batch.route === "Remix" && batch.status === "route_selected",
          "Choose a feasible Remix route before verifying material.",
        );
        assertDomain(
          input.material === batch.estimated_material_type,
          "Material changed. Create a corrected inventory batch.",
        );
        assertDomain(
          input.kg > 0 && input.kg <= batch.estimated_reusable_kg,
          "Verified weight must be within the conservative reusable-material limit.",
        );
        assertDomain(!batch.verified_at, "Inventory is already verified.");
        await c.query(
          "UPDATE inventory_batches SET verified_material_type=$2,verified_reusable_kg=$3,verified_at=now() WHERE id=$1",
          [id, input.material, input.kg],
        );
        await c.query(
          "INSERT INTO material_sources(workspace_id,source_type,batch_id,material_type,verified_kg,quality_grade,composition,colour_family,fabric_weight,panel_grade,contamination_status) VALUES($1,'brand_inventory',$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            a.workspace_id,
            id,
            input.material,
            input.kg,
            ...Object.values(qualityInput.parse(input.quality ?? {})),
          ],
        );
        await audit(c, a, "inventory_verified", "inventory_batch", id, {
          ...input,
          simulated: true,
        });
        return { id };
      }
      if (action === "concepts") {
        const input = v.conceptsInput.parse(raw);
        assertDomain(
          batch.route === "Remix",
          "Select Remix before generating manufacturing concepts.",
        );
        const availability = await batchAvailable(c, batch);
        const original = batchFrom(batch),
          yieldFactor =
            materialProfiles[original.material].yield *
            conditionProfiles[original.condition].panels;
        const sourceBatch = {
          ...original,
          weight: yieldFactor > 0 ? availability.kg / yieldFactor : 0,
        };
        const checks = verifyOpportunities(sourceBatch, input.suggestions);
        const funded = (
          await c.query(
            "SELECT d.id,c.recipe_key FROM drops d JOIN remix_concepts c ON c.id=d.concept_id WHERE c.batch_id=$1",
            [id],
          )
        ).rows;
        for (let i = 0; i < checks.length; i++) {
          const prior = funded.find(
            (d) => d.recipe_key === checks[i].concept?.id,
          );
          if (prior) {
            const d = await getDrop(c, a.workspace_id, prior.id);
            const existing = verifyOpportunities(original, [
              input.suggestions[i],
            ])[0];
            if (existing.concept)
              existing.concept = {
                ...existing.concept,
                max: d.capacity,
                feasible: d.capacity >= d.preorder_threshold,
              };
            existing.approved = d.capacity >= d.preorder_threshold;
            existing.checks[0] = {
              label: "Material feasibility",
              passed: existing.approved,
              detail: `${d.capacity} units backed by ${d.allocated_kg} kg already allocated to ${d.code}.`,
            };
            existing.why.unshift(
              "Existing drop allocation; this material cannot fund another concept.",
            );
            checks[i] = existing;
          }
        }
        for (const result of checks) {
          if (!result.concept) continue;
          const x = result.concept;
          await c.query(
            `INSERT INTO remix_concepts(workspace_id,batch_id,recipe_key,name,selling_price,unit_cost,input_kg,preorder_threshold,utilisation,reasoning,approved) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(batch_id,recipe_key) DO UPDATE SET reasoning=EXCLUDED.reasoning,approved=EXCLUDED.approved WHERE NOT EXISTS(SELECT 1 FROM drops WHERE concept_id=remix_concepts.id)`,
            [
              a.workspace_id,
              id,
              x.id,
              x.name,
              x.price,
              x.cost,
              x.inputKg,
              x.threshold,
              x.utilisation,
              result.suggestion.reason,
              result.approved,
            ],
          );
        }
        await audit(c, a, "concepts_verified", "inventory_batch", id, {
          approved: checks.filter((x) => x.approved).length,
        });
        return { id, checks };
      }
    }
    if (resource === "consumer-items" && !id) {
      role(a, "consumer");
      const input = v.itemInput.parse(raw),
        action = recommendAction(input);
      const r = await one(
        c,
        "INSERT INTO consumer_items(workspace_id,user_id,item_type,estimated_material_type,estimated_condition,age_months,usage,estimated_recoverable_kg,recommendation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          a.workspace_id,
          a.id,
          input.type,
          input.material,
          input.condition,
          input.ageMonths,
          input.usage,
          recoverableKg(input),
          action.action,
        ],
      );
      await audit(c, a, "wardrobe_item_confirmed", "consumer_item", r.id);
      return { ...r, matches: await findMatches(c, a.workspace_id, input) };
    }
    if (resource === "matches" && !id) {
      role(a, "consumer");
      const input = v.itemInput.parse(raw),
        matches = await findMatches(c, a.workspace_id, input);
      return {
        best_match:
          matches.find(
            (m) => m.compatible && m.neededKg > 0 && m.recoverableKg > 0,
          ) ?? null,
        other_matches: matches,
      };
    }
    if (resource === "returns" && !id) {
      role(a, "consumer");
      const input = v.returnInput.parse(raw),
        item = await one(
          c,
          "SELECT * FROM consumer_items WHERE id=$1 AND workspace_id=$2",
          [input.itemId, a.workspace_id],
        );
      owns(a, item.user_id);
      assertDomain(
        item.recommendation === "RETURN FOR REMIX",
        "This item should remain in use or follow another circular route.",
      );
      const point = await one(
        c,
        "SELECT * FROM collection_points WHERE id=$1 AND workspace_id=$2",
        [input.collectionPointId, a.workspace_id],
      );
      const d = await getDrop(c, a.workspace_id, input.dropId);
      assertDomain(
        d.phase === "market_test" &&
          d.requirements.some(
            (r) =>
              compatibility(item.estimated_material_type, r).compatible &&
              r.allocated_kg < r.required_kg,
          ),
        "No compatible active material need.",
      );
      const r = await one(
        c,
        `INSERT INTO return_requests(workspace_id,user_id,consumer_item_id,target_drop_id,collection_point_id,status,estimated_material_kg,reserved_at,return_by) VALUES($1,$2,$3,$4,$5,'reserved',$6,now(),(now() AT TIME ZONE 'Asia/Singapore')::date+7) RETURNING id`,
        [
          a.workspace_id,
          a.id,
          item.id,
          d.id,
          point.id,
          item.estimated_recoverable_kg,
        ],
      );
      await audit(c, a, "return_reserved", "return_request", r.id);
      return r;
    }
    if (resource === "returns" && id) {
      role(a, "consumer");
      const r = await one(
        c,
        "SELECT * FROM return_requests WHERE id=$1 AND workspace_id=$2",
        [id, a.workspace_id],
      );
      owns(a, r.user_id);
      if (action === "matches") {
        v.empty.parse(raw);
        const item = await one(c, "SELECT * FROM consumer_items WHERE id=$1", [
          r.consumer_item_id,
        ]);
        const receipt = (
          await c.query(
            "SELECT * FROM return_receipts WHERE return_request_id=$1",
            [r.id],
          )
        ).rows[0];
        const matches =
          r.status === "corrected"
            ? []
            : await findMatches(
                c,
                a.workspace_id,
                {
                  type: item.item_type,
                  material:
                    receipt?.verified_material_type ??
                    item.estimated_material_type,
                  condition:
                    receipt?.verified_condition ?? item.estimated_condition,
                  usage: item.usage,
                  ageMonths: item.age_months,
                },
                receipt
                  ? qualityInput.parse({
                      quality_grade: receipt.quality_grade,
                      composition: receipt.composition,
                      colour_family: receipt.colour_family,
                      fabric_weight: receipt.fabric_weight,
                      panel_grade: receipt.panel_grade,
                      contamination_status: receipt.contamination_status,
                    })
                  : undefined,
              );
        return {
          other_matches: matches,
          best_match:
            matches.find((m) => m.compatible && m.neededKg > 0) ?? null,
        };
      }
      if (action === "receive") {
        v.empty.parse(raw);
        assertDomain(
          r.status === "reserved",
          "Only a reserved return can be received, once.",
        );
        await c.query(
          "UPDATE return_requests SET status='received',received_at=now() WHERE id=$1",
          [id],
        );
        await audit(c, a, "return_received", "return_request", id, {
          simulated: true,
        });
        return { id };
      }
      if (action === "inspect") {
        role(a);
        return inspect(c, a, id, v.inspectInput.parse(raw));
      }
      if (action === "simulate-inspection") {
        const review = v.simulatedInspectionInput.parse(raw);
        const item = await one(c, "SELECT * FROM consumer_items WHERE id=$1", [
          r.consumer_item_id,
        ]);
        return inspect(c, a, id, {
          quality: review.quality,
          result: "accepted",
          kg: r.estimated_material_kg,
          material: item.estimated_material_type,
          condition: item.estimated_condition,
          note: "Human-confirmed simulated inspection; recipe mass estimate used. Not physical verification.",
        });
      }
    }
    if (resource === "drops" && !id) {
      role(a, "brand_user");
      const input = v.createDropInput.parse(raw),
        concept = await one(
          c,
          "SELECT * FROM remix_concepts WHERE id=$1 AND workspace_id=$2",
          [input.conceptId, a.workspace_id],
        );
      assertDomain(
        concept.approved && concept.batch_id,
        "Select a verified, feasible inventory concept.",
      );
      const batch = await one(
        c,
        "SELECT * FROM inventory_batches WHERE id=$1",
        [concept.batch_id],
      );
      brandOwns(a, batch.brand_id);
      assertDomain(
        batch.route === "Remix",
        "Inventory route does not permit remanufacture.",
      );
      const { source, kg } = await batchAvailable(c, batch);
      assertDomain(
        source,
        "Human verification is required before allocating brand material.",
      );
      const min = roundKg(
        Math.ceil(concept.preorder_threshold * concept.input_kg * 1000) / 1000,
      );
      assertDomain(
        kg >= min,
        "Remaining verified material cannot cover the maker minimum.",
      );
      const d = await one(
        c,
        "INSERT INTO drops(workspace_id,brand_id,concept_id,code,phase) VALUES($1,$2,$3,'DROP-'||substr(gen_random_uuid()::text,1,6),'market_test') RETURNING id",
        [a.workspace_id, batch.brand_id, concept.id],
      );
      const req = await one(
        c,
        "INSERT INTO drop_material_requirements(drop_id,component,material_type,minimum_kg,maximum_kg,kg_per_unit,allowed_blend) VALUES($1,'main fabric',$2,$3,$4,$5,$6) RETURNING id",
        [
          d.id,
          batch.verified_material_type,
          min,
          kg,
          concept.input_kg,
          batch.verified_material_type === "Cotton Blend Denim",
        ],
      );
      await allocate(c, a, d.id, {
        sourceId: source.id,
        requirementId: req.id,
        kg,
        requestKey: crypto.randomUUID(),
      });
      await audit(c, a, "drop_created", "drop", d.id);
      return d;
    }
    if (resource === "drops" && id) {
      const d = await getDrop(c, a.workspace_id, id, a.id);
      if (["preorder", "vote", "reserve"].includes(action)) {
        role(a, "consumer");
        const orderInput =
          action === "preorder"
            ? v.preorderInput.parse(raw)
            : v.empty.parse(raw);
        assertDomain(d.phase === "market_test", "This market test is closed.");
        if (action === "preorder") {
          const capacity = Math.min(
            ...d.requirements.map((r) =>
              Math.floor((r.maximum_kg + 1e-6) / r.kg_per_unit),
            ),
            ...d.auxiliary.map((r) => r.capacity),
          );
          assertDomain(
            d.orders < capacity,
            "Preorders would exceed the material-constrained production ceiling.",
          );
          const order = await one(
            c,
            "INSERT INTO preorders(drop_id,user_id,unit_price,status) VALUES($1,$2,$3,$4) RETURNING id",
            [
              id,
              a.id,
              d.selling_price,
              "status" in orderInput ? orderInput.status : "confirmed",
            ],
          );
          await audit(c, a, "preorder_created", "preorder", order.id, {
            dropId: id,
            payment_status: "simulated",
          });
          return order;
        }
        const table = action === "vote" ? "votes" : "reservations";
        const interaction = await one(
          c,
          `INSERT INTO ${table}(drop_id,user_id) VALUES($1,$2) RETURNING id`,
          [id, a.id],
        );
        await audit(
          c,
          a,
          action === "vote" ? "vote_created" : "reservation_created",
          table,
          interaction.id,
          { dropId: id },
        );
        return interaction;
      }
      if (action === "allocate-material")
        return allocate(c, a, id, v.allocationInput.parse(raw));
      if (action === "unlock") {
        v.empty.parse(raw);
        role(a, "brand_user");
        brandOwns(a, d.brand_id);
        assertDomain(
          d.phase === "market_test" && d.eligible,
          "Both demand and verified material must be ready, within capacity.",
        );
        await c.query(
          "UPDATE drops SET phase='unlocked',unlocked_at=now() WHERE id=$1",
          [id],
        );
        await audit(c, a, "drop_unlocked", "drop", id);
        return plan(c, a, id);
      }
      if (action === "cancel") {
        v.empty.parse(raw);
        brandOwns(a, d.brand_id);
        assertDomain(
          d.phase === "draft",
          "Only an uncommitted draft can be cancelled in this version. Committed material requires a reversal workflow.",
        );
        await c.query("UPDATE drops SET phase='cancelled' WHERE id=$1", [id]);
        await audit(c, a, "drop_cancelled", "drop", id);
        return { id };
      }
    }
    if (resource === "production-runs" && !id) {
      role(a, "brand_user");
      const input = v.productionInput.parse(raw);
      return plan(c, a, input.dropId, input.units);
    }
    if (resource === "production-runs" && id) {
      if (action !== "complete") v.empty.parse(raw);
      const run = await one(
        c,
        "SELECT p.* FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE p.id=$1 AND d.workspace_id=$2",
        [id, a.workspace_id],
      );
      const d = await getDrop(c, a.workspace_id, run.drop_id);
      brandOwns(a, d.brand_id);
      if (action === "approve") {
        assertDomain(
          run.status === "planned",
          "Only a planned run can be approved.",
        );
        assertDomain(
          d.eligible &&
            run.confirmed_units <= d.orders &&
            run.confirmed_units <= d.capacity,
          "Demand or capacity no longer supports this run.",
        );
        await c.query(
          "UPDATE production_runs SET status='approved' WHERE id=$1",
          [id],
        );
        await audit(c, a, "production_approved", "production_run", id);
        return { id };
      }
      if (action === "start") {
        assertDomain(
          run.status === "approved",
          "Approve this production run first.",
        );
        assertDomain(
          d.eligible &&
            run.confirmed_units <= d.orders &&
            run.confirmed_units <= d.capacity,
          "Invalid production commitments.",
        );
        await c.query(
          "UPDATE production_runs SET status='in_production' WHERE id=$1",
          [id],
        );
        await c.query("UPDATE drops SET phase='production' WHERE id=$1", [
          d.id,
        ]);
        await audit(c, a, "production_started", "production_run", id);
        return { id };
      }
      if (action === "complete") {
        assertDomain(
          run.status === "in_production",
          "Only an in-production run can complete, once.",
        );
        await reconcileProduction(
          c,
          a,
          run as { id: string; confirmed_units: number },
          d,
          raw,
        );
        await c.query(
          "UPDATE production_runs SET status='completed',completed_at=now() WHERE id=$1",
          [id],
        );
        await c.query("UPDATE drops SET phase='completed' WHERE id=$1", [d.id]);
        await c.query(
          "UPDATE return_requests r SET status='completed' WHERE id IN (SELECT rr.return_request_id FROM return_receipts rr JOIN material_sources s ON s.receipt_id=rr.id JOIN material_movements m ON m.source_id=s.id WHERE m.destination_drop_id=$1) AND NOT EXISTS(SELECT 1 FROM return_receipts rr JOIN source_balances s ON s.receipt_id=rr.id WHERE rr.return_request_id=r.id AND s.remaining_kg>0) AND NOT EXISTS(SELECT 1 FROM return_receipts rr JOIN material_sources s ON s.receipt_id=rr.id JOIN material_movements m ON m.source_id=s.id JOIN drops d ON d.id=m.destination_drop_id WHERE rr.return_request_id=r.id AND d.phase<>'completed')",
          [d.id],
        );
        await c.query(
          "INSERT INTO impact_records(production_run_id,method) VALUES($1,'Simulated production; verified-in-demo material ledger, recipe consumption, no lifecycle or CO2 claim')",
          [id],
        );
        await c.query(
          "UPDATE inventory_batches b SET status='closed' WHERE b.id IN (SELECT s.batch_id FROM material_sources s JOIN material_movements m ON m.source_id=s.id WHERE m.destination_drop_id=$1 AND s.batch_id IS NOT NULL) AND EXISTS(SELECT 1 FROM source_balances s WHERE s.batch_id=b.id AND s.remaining_kg=0) AND NOT EXISTS(SELECT 1 FROM material_sources s JOIN material_movements m ON m.source_id=s.id JOIN drops d ON d.id=m.destination_drop_id WHERE s.batch_id=b.id AND d.phase<>'completed')",
          [d.id],
        );
        await audit(c, a, "production_completed", "production_run", id, {
          units: run.confirmed_units,
        });
        return { id };
      }
    }
    assertDomain(false, "Unknown domain operation.", 404);
  });
}
