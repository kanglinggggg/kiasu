import { PoolClient } from "pg";
import { Actor, assertDomain, roundKg } from "./domain";
import { StoredDrop } from "./types";
import { one, audit } from "./service";
import { command, finishInput } from "./accounting";
// Scrap is a subset of residual, never an extra term added to the conservation equation.
export async function reconcileProduction(
  c: PoolClient,
  a: Actor,
  run: { id: string; confirmed_units: number },
  d: StoredDrop,
  raw: unknown,
) {
  const input = finishInput.parse(raw),
    key = await command(c, a, {
      requestKey: input.requestKey ?? crypto.randomUUID(),
      reason:
        input.reason ??
        "Simulated production completion and explicit mass reconciliation",
    });
  let loss = input.nonRecoverableKg,
    scrap = input.processScrapKg;
  const pool = await one(
    c,
    "SELECT id FROM material_pools WHERE workspace_id=$1 AND name='Future Material Pool'",
    [a.workspace_id],
  );
  let totalAllocated = 0,
    totalConsumed = 0,
    totalResidual = 0;
  for (const req of d.requirements) {
    let consume = roundKg(
      Math.ceil(run.confirmed_units * req.kg_per_unit * 1000 - 1e-7) / 1000,
    );
    assertDomain(
      consume <= req.allocated_kg,
      "Production exceeds verified component allocation.",
    );
    const allocations = (
      await c.query(
        "SELECT e.*,s.material_type,s.quality_grade,s.composition,s.colour_family,s.fabric_weight,s.panel_grade,s.contamination_status FROM effective_allocations e JOIN material_sources s ON s.id=e.source_id JOIN material_movements m ON m.id=e.movement_id WHERE e.requirement_id=$1 AND e.quantity_kg>0 ORDER BY m.created_at,m.id",
        [req.id],
      )
    ).rows;
    for (const allocation of allocations) {
      const used = roundKg(Math.min(consume, allocation.quantity_kg));
      consume = roundKg(consume - used);
      const leftover = roundKg(allocation.quantity_kg - used),
        discard = roundKg(Math.min(loss, leftover)),
        process = roundKg(Math.min(scrap, leftover)),
        residual = roundKg(leftover - discard);
      loss = roundKg(loss - discard);
      scrap = roundKg(scrap - process);
      let residualId = null;
      if (residual > 0) {
        const source = await one(
          c,
          "INSERT INTO material_sources(workspace_id,source_type,production_run_id,pool_id,material_type,verified_kg,quality_grade,composition,colour_family,fabric_weight,panel_grade,contamination_status) VALUES($1,'residual_material',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
          [
            a.workspace_id,
            run.id,
            pool.id,
            allocation.material_type,
            residual,
            allocation.quality_grade,
            allocation.composition,
            allocation.colour_family,
            allocation.fabric_weight,
            allocation.panel_grade,
            allocation.contamination_status,
          ],
        );
        residualId = source.id;
        await c.query(
          "INSERT INTO material_movements(workspace_id,source_id,destination_type,destination_pool_id,quantity_kg,kind,idempotency_key) VALUES($1,$2,'future_pool',$3,$4,'pool_entry',$5)",
          [
            a.workspace_id,
            residualId,
            pool.id,
            residual,
            `residual-${run.id}-${allocation.id}`,
          ],
        );
        await audit(
          c,
          a,
          "residual_material_created",
          "material_source",
          residualId,
          { kg: residual, originalAllocation: allocation.id },
        );
      }
      await c.query(
        "INSERT INTO production_consumptions(production_run_id,allocation_id,consumed_kg,residual_source_id,process_scrap_kg,non_recoverable_kg) VALUES($1,$2,$3,$4,$5,$6)",
        [run.id, allocation.id, used, residualId, process, discard],
      );
      totalAllocated += allocation.quantity_kg;
      totalConsumed += used;
      totalResidual += residual;
    }
    assertDomain(consume === 0, "Missing recovered component input.");
  }
  assertDomain(
    loss === 0 && scrap === 0,
    "Declared scrap exceeds unused recovered material. Recipe consumption must remain supplied.",
  );
  for (const req of d.auxiliary) {
    let consume = roundKg(run.confirmed_units * req.per_unit);
    const allocations = (
      await c.query(
        "SELECT e.*,s.workspace_id,s.component,s.unit,s.mass_per_unit_kg FROM effective_auxiliary_allocations e JOIN auxiliary_sources s ON s.id=e.source_id WHERE e.requirement_id=$1 AND e.remaining_quantity>0 ORDER BY e.created_at,e.id",
        [req.id],
      )
    ).rows;
    for (const allocation of allocations) {
      const used = roundKg(Math.min(consume, allocation.remaining_quantity));
      consume = roundKg(consume - used);
      const residual = roundKg(allocation.remaining_quantity - used);
      let residualId = null;
      if (residual > 0) {
        const source = await one(
          c,
          "INSERT INTO auxiliary_sources(workspace_id,component,unit,quantity,mass_per_unit_kg,origin,production_run_id,command_id) VALUES($1,$2,$3,$4,$5,'production_residual',$6,$7) RETURNING id",
          [
            a.workspace_id,
            allocation.component,
            allocation.unit,
            residual,
            allocation.mass_per_unit_kg,
            run.id,
            key,
          ],
        );
        residualId = source.id;
        await audit(
          c,
          a,
          "auxiliary_residual_created",
          "auxiliary_source",
          source.id,
          { quantity: residual, unit: allocation.unit },
        );
      }
      await c.query(
        "INSERT INTO auxiliary_consumptions(production_run_id,allocation_id,consumed_quantity,residual_source_id) VALUES($1,$2,$3,$4)",
        [run.id, allocation.id, used, residualId],
      );
      totalAllocated +=
        allocation.remaining_quantity * allocation.mass_per_unit_kg;
      totalConsumed += used * allocation.mass_per_unit_kg;
      totalResidual += residual * allocation.mass_per_unit_kg;
    }
    assertDomain(consume === 0, "Missing required auxiliary component.");
  }
  await c.query(
    "INSERT INTO production_mass_balances(production_run_id,allocated_kg,consumed_kg,process_scrap_kg,recoverable_residual_kg,non_recoverable_residual_kg,command_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      run.id,
      roundKg(totalAllocated),
      roundKg(totalConsumed),
      input.processScrapKg,
      roundKg(totalResidual),
      input.nonRecoverableKg,
      key,
    ],
  );
  await audit(c, a, "production_mass_reconciled", "production_run", run.id, {
    allocatedKg: roundKg(totalAllocated),
    consumedKg: roundKg(totalConsumed),
    recoverableKg: roundKg(totalResidual),
    nonRecoverableKg: input.nonRecoverableKg,
    processScrapKg: input.processScrapKg,
    toleranceKg: 0.001,
  });
}
