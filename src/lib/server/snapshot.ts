import { Actor } from "./domain";
import { transaction } from "./db";
import { one, getDrop, batchFrom } from "./service";
import { Snapshot } from "./types";
export async function snapshot(a: Actor): Promise<Snapshot> {
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scoped = a.role === "consumer",
      params = [a.workspace_id, a.id, scoped];
    const workspace = await one(c, "SELECT name FROM workspaces WHERE id=$1", [
      a.workspace_id,
    ]);
    const workspaces = (
      await c.query(
        "SELECT id,name FROM workspaces WHERE name='Remix Demo' OR name LIKE 'Demo run %' OR id=$1 ORDER BY created_at DESC",
        [a.workspace_id],
      )
    ).rows;
    const users = (
      await c.query(
        "SELECT * FROM users WHERE workspace_id=$1 AND name IN ('Demo Operator','Consumer Alex','Brand Team') ORDER BY name",
        [a.workspace_id],
      )
    ).rows;
    const dropIds = (
      await c.query(
        "SELECT id FROM drops WHERE workspace_id=$1 ORDER BY code",
        [a.workspace_id],
      )
    ).rows;
    const drops = [];
    for (const r of dropIds)
      drops.push(await getDrop(c, a.workspace_id, r.id, a.id));
    const batches = [];
    const rows = (
      await c.query(
        "SELECT * FROM inventory_batches WHERE workspace_id=$1 AND ($2::uuid IS NULL OR brand_id=$2) ORDER BY created_at DESC,code",
        [a.workspace_id, a.role === "brand_user" ? a.brand_id : null],
      )
    ).rows;
    for (const row of rows) {
      const source = (
        await c.query("SELECT * FROM source_balances WHERE batch_id=$1", [
          row.id,
        ])
      ).rows[0];
      const used = (
        await c.query(
          "SELECT d.code drop_code,sum(e.quantity_kg) kg FROM effective_allocations e JOIN drops d ON d.id=e.drop_id WHERE e.source_id=$1 GROUP BY d.code HAVING sum(e.quantity_kg)>0",
          [source?.id ?? null],
        )
      ).rows;
      batches.push({
        id: row.id,
        code: row.code,
        brand_id: row.brand_id,
        status: row.status,
        route: row.route,
        analysis: row.analysis,
        inputs: batchFrom(row),
        estimated_kg: row.estimated_reusable_kg,
        verified_kg: row.verified_reusable_kg,
        allocated_kg: source ? source.verified_kg - source.remaining_kg : 0,
        remaining_kg: source?.remaining_kg ?? 0,
        source_id: source?.id ?? null,
        used_by: used,
      });
    }
    const concepts = (
      await c.query("SELECT * FROM remix_concepts WHERE workspace_id=$1", [
        a.workspace_id,
      ])
    ).rows;
    const items = (
      await c.query(
        "SELECT * FROM consumer_items WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC",
        [a.workspace_id, a.id],
      )
    ).rows;
    const returns = (
      await c.query(
        `SELECT r.*,rr.verified_material_kg,rr.verified_material_type,rr.inspection_result,rr.quality_grade,rr.composition,rr.colour_family,rr.fabric_weight,rr.panel_grade,rr.contamination_status,cp.name point_name,s.id source_id,COALESCE((SELECT sum(quantity_kg) FROM effective_allocations WHERE source_id=s.id),0) allocated_kg,COALESCE(s.remaining_kg,0) remaining_kg,COALESCE((SELECT sum(amount) FROM reward_transactions WHERE receipt_id=rr.id),0) reward,COALESCE((SELECT sum(amount) FROM reward_transactions WHERE receipt_id=rr.id AND (type='material_bonus' OR original_transaction_id IN(SELECT id FROM reward_transactions WHERE receipt_id=rr.id AND type='material_bonus'))),0) reward_bonus FROM return_requests r JOIN collection_points cp ON cp.id=r.collection_point_id LEFT JOIN return_receipts rr ON rr.return_request_id=r.id LEFT JOIN source_balances s ON s.receipt_id=rr.id WHERE r.workspace_id=$1 AND r.user_id=$2 ORDER BY r.reserved_at DESC`,
        [a.workspace_id, a.id],
      )
    ).rows;
    const sources = (
      await c.query(
        `SELECT s.*,COALESCE(b.code,'Return '||substr(rr.return_request_id::text,1,8),'Residual '||substr(s.production_run_id::text,1,8)) label FROM source_balances s LEFT JOIN inventory_batches b ON b.id=s.batch_id LEFT JOIN return_receipts rr ON rr.id=s.receipt_id LEFT JOIN return_requests r ON r.id=rr.return_request_id WHERE s.workspace_id=$1 AND (NOT $3::boolean OR r.user_id=$2) ORDER BY s.created_at`,
        params,
      )
    ).rows;
    const production = (
      await c.query(
        `SELECT p.*,COALESCE((SELECT sum(consumed_kg) FROM production_consumptions WHERE production_run_id=p.id),0) consumed_kg,COALESCE((SELECT sum(verified_kg) FROM material_sources WHERE production_run_id=p.id),0) residual_kg FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE d.workspace_id=$1 ORDER BY p.created_at DESC`,
        [a.workspace_id],
      )
    ).rows;
    const massBalances = (
      await c.query(
        "SELECT m.* FROM production_mass_balances m JOIN production_runs p ON p.id=m.production_run_id JOIN drops d ON d.id=p.drop_id WHERE d.workspace_id=$1",
        [a.workspace_id],
      )
    ).rows;
    const exceptions = (
      await c.query(
        "SELECT e.*,d.code FROM business_exceptions e JOIN production_runs p ON p.id=e.production_run_id JOIN drops d ON d.id=p.drop_id WHERE d.workspace_id=$1",
        [a.workspace_id],
      )
    ).rows;
    const releases = (
      await c.query(
        "SELECT r.*,d.code FROM allocation_releases r JOIN drop_material_allocations a ON a.id=r.allocation_id JOIN drops d ON d.id=a.drop_id WHERE d.workspace_id=$1",
        [a.workspace_id],
      )
    ).rows;
    const allocations = (
      await c.query(
        "SELECT e.*,d.code FROM effective_allocations e JOIN drops d ON d.id=e.drop_id WHERE d.workspace_id=$1 AND e.quantity_kg>0",
        [a.workspace_id],
      )
    ).rows;
    const auxiliarySources = (
      await c.query(
        "SELECT * FROM auxiliary_balances WHERE workspace_id=$1 AND remaining_quantity>0",
        [a.workspace_id],
      )
    ).rows;
    const points = (
      await c.query(
        "SELECT id,name,hours FROM collection_points WHERE workspace_id=$1 ORDER BY name DESC",
        [a.workspace_id],
      )
    ).rows;
    const rewards = (
      await c.query(
        "SELECT * FROM reward_transactions WHERE user_id=$1 ORDER BY created_at DESC",
        [a.id],
      )
    ).rows;
    const preorders = (
      await c.query(
        "SELECT p.*,d.code FROM preorders p JOIN drops d ON d.id=p.drop_id WHERE p.user_id=$1 ORDER BY p.created_at DESC",
        [a.id],
      )
    ).rows;
    const contributions = (
      await c.query(
        `SELECT m.*,s.source_type,d.code drop_code,COALESCE((SELECT sum(r.quantity_kg) FROM allocation_releases r JOIN drop_material_allocations a ON a.id=r.allocation_id WHERE a.movement_id=m.id),0) released_kg,m.quantity_kg-COALESCE((SELECT sum(r.quantity_kg) FROM allocation_releases r JOIN drop_material_allocations a ON a.id=r.allocation_id WHERE a.movement_id=m.id),0) net_kg FROM material_movements m JOIN material_sources s ON s.id=m.source_id LEFT JOIN drops d ON d.id=m.destination_drop_id LEFT JOIN return_receipts rr ON rr.id=s.receipt_id LEFT JOIN return_requests r ON r.id=rr.return_request_id WHERE m.workspace_id=$1 AND (NOT $3::boolean OR r.user_id=$2) ORDER BY m.created_at DESC`,
        params,
      )
    ).rows;
    const audit = (
      await c.query(
        "SELECT id,type,details,created_at FROM audit_events WHERE workspace_id=$1 AND (NOT $3::boolean OR actor_id=$2) ORDER BY created_at DESC LIMIT 30",
        params,
      )
    ).rows;
    const stats = await one(
      c,
      `SELECT (SELECT count(*) FROM preorders p JOIN drops d ON d.id=p.drop_id WHERE d.workspace_id=$1 AND p.status='confirmed') preorders,(SELECT count(*) FROM reservations r JOIN drops d ON d.id=r.drop_id WHERE d.workspace_id=$1) reservations,(SELECT count(*) FROM reservations r JOIN preorders p ON p.drop_id=r.drop_id AND p.user_id=r.user_id JOIN drops d ON d.id=r.drop_id WHERE d.workspace_id=$1 AND p.status='confirmed') converted,(SELECT count(*) FROM return_requests WHERE workspace_id=$1) returns,(SELECT count(*) FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE r.workspace_id=$1 AND rr.inspection_result<>'rejected' AND NOT EXISTS(SELECT 1 FROM return_corrections rc WHERE rc.receipt_id=rr.id)) accepted`,
      [a.workspace_id],
    );
    const popular = (
      await c.query(
        "SELECT co.name,count(*) FROM preorders p JOIN drops d ON d.id=p.drop_id JOIN remix_concepts co ON co.id=d.concept_id WHERE d.workspace_id=$1 AND p.status='confirmed' GROUP BY co.name ORDER BY count(*) DESC,co.name LIMIT 1",
        [a.workspace_id],
      )
    ).rows[0];
    const common = (
      await c.query(
        "SELECT rr.verified_material_type,count(*) FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE r.workspace_id=$1 AND rr.inspection_result<>'rejected' AND NOT EXISTS(SELECT 1 FROM return_corrections rc WHERE rc.receipt_id=rr.id) GROUP BY rr.verified_material_type ORDER BY count(*) DESC LIMIT 1",
        [a.workspace_id],
      )
    ).rows[0];
    const avg = await one(
      c,
      "SELECT COALESCE(avg((details->>'compatibility')::numeric),0) score FROM audit_events WHERE workspace_id=$1 AND type='material_allocated'",
      [a.workspace_id],
    );
    const routes = (
      await c.query(
        "SELECT route,count(*) FROM inventory_batches WHERE workspace_id=$1 AND route IS NOT NULL GROUP BY route",
        [a.workspace_id],
      )
    ).rows;
    return {
      actor: a,
      workspaceName: workspace.name,
      workspaces,
      users,
      batches: scoped ? [] : batches,
      concepts,
      drops,
      items,
      returns,
      sources,
      production,
      massBalances,
      exceptions,
      releases: scoped ? [] : releases,
      allocations: scoped ? [] : allocations,
      auxiliarySources: scoped ? [] : auxiliarySources,
      points,
      rewards,
      balance: rewards.reduce((sum, r) => sum + r.amount, 0),
      preorders,
      contributions,
      audit,
      analytics: {
        preorders: stats.preorders,
        reservations: stats.reservations,
        reservationConversion: stats.reservations
          ? stats.converted / stats.reservations
          : 0,
        returns: stats.returns,
        acceptedReturns: stats.accepted,
        returnRate: stats.returns ? stats.accepted / stats.returns : 0,
        popularConcept: popular?.name ?? "No orders",
        commonMaterial:
          common?.verified_material_type ?? "No inspected returns",
        averageMatch: avg.score,
        routes,
      },
    } as Snapshot;
  });
}
