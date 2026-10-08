CREATE FUNCTION guard_verified_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt return_receipts; request return_requests; batch inventory_batches; run production_runs;
BEGIN
 IF NEW.source_type='consumer_return' THEN
   SELECT * INTO STRICT receipt FROM return_receipts WHERE id=NEW.receipt_id;
   SELECT * INTO STRICT request FROM return_requests WHERE id=receipt.return_request_id;
   IF receipt.inspection_result='rejected' OR NEW.verified_kg<>receipt.verified_material_kg OR NEW.material_type<>receipt.verified_material_type OR request.workspace_id<>NEW.workspace_id THEN RAISE EXCEPTION 'Source must equal accepted inspected material'; END IF;
 ELSIF NEW.source_type='brand_inventory' THEN
   SELECT * INTO STRICT batch FROM inventory_batches WHERE id=NEW.batch_id;
   IF batch.verified_at IS NULL OR NEW.verified_kg<>batch.verified_reusable_kg OR NEW.material_type<>batch.verified_material_type OR batch.workspace_id<>NEW.workspace_id THEN RAISE EXCEPTION 'Inventory source must be verified'; END IF;
 ELSE
   SELECT * INTO STRICT run FROM production_runs WHERE id=NEW.production_run_id;
   IF run.status<>'in_production' THEN RAISE EXCEPTION 'Residual requires active production completion'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verified_source_guard BEFORE INSERT ON material_sources FOR EACH ROW EXECUTE FUNCTION guard_verified_source();
CREATE FUNCTION guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req drop_material_requirements; movement material_movements; source material_sources; total numeric;
BEGIN
 SELECT * INTO STRICT req FROM drop_material_requirements WHERE id=NEW.requirement_id FOR UPDATE;
 SELECT * INTO STRICT movement FROM material_movements WHERE id=NEW.movement_id;
 SELECT * INTO STRICT source FROM material_sources WHERE id=movement.source_id;
 IF NEW.drop_id<>req.drop_id OR movement.destination_drop_id<>NEW.drop_id OR movement.destination_type<>'drop' THEN RAISE EXCEPTION 'Allocation destination mismatch'; END IF;
 IF NOT (source.material_type=req.material_type AND source.material_type<>'Unknown' OR source.material_type='Cotton Blend Denim' AND req.material_type='Cotton Denim' AND req.allowed_blend) THEN RAISE EXCEPTION 'Incompatible material'; END IF;
 SELECT COALESCE(sum(m.quantity_kg),0) INTO total FROM drop_material_allocations a JOIN material_movements m ON m.id=a.movement_id WHERE a.requirement_id=req.id;
 IF total+movement.quantity_kg>req.maximum_kg THEN RAISE EXCEPTION 'Requirement maximum exceeded'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_guard BEFORE INSERT ON drop_material_allocations FOR EACH ROW EXECUTE FUNCTION guard_allocation();
CREATE FUNCTION guard_reward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt return_receipts; request return_requests;
BEGIN
 SELECT * INTO STRICT receipt FROM return_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO STRICT request FROM return_requests WHERE id=receipt.return_request_id;
 IF receipt.inspection_result='rejected' OR receipt.verified_material_kg<=0 OR NEW.user_id<>request.user_id OR NEW.workspace_id<>request.workspace_id THEN RAISE EXCEPTION 'Rewards require accepted verification and correct owner'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reward_guard BEFORE INSERT ON reward_transactions FOR EACH ROW EXECUTE FUNCTION guard_reward();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON return_receipts FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_allocations BEFORE UPDATE OR DELETE ON drop_material_allocations FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_consumptions BEFORE UPDATE OR DELETE ON production_consumptions FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION guard_production_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE demand integer; capacity integer; ready boolean; d drops; recipe remix_concepts;
BEGIN
 SELECT * INTO STRICT d FROM drops WHERE id=NEW.drop_id FOR UPDATE;
 SELECT * INTO STRICT recipe FROM remix_concepts WHERE id=d.concept_id;
 SELECT count(*) INTO demand FROM preorders WHERE drop_id=d.id AND status='confirmed';
 SELECT min(floor(t.allocated/r.kg_per_unit)),bool_and(t.allocated>=r.minimum_kg) INTO capacity,ready FROM drop_material_requirements r CROSS JOIN LATERAL (SELECT COALESCE(sum(m.quantity_kg),0) allocated FROM drop_material_allocations a JOIN material_movements m ON m.id=a.movement_id WHERE a.requirement_id=r.id) t WHERE r.drop_id=d.id;
 IF d.phase<>'unlocked' OR NEW.status<>'planned' OR NOT COALESCE(ready,false) OR demand<recipe.preorder_threshold OR NEW.confirmed_units>demand OR NEW.confirmed_units>COALESCE(capacity,0) OR NEW.selling_price<>recipe.selling_price OR NEW.estimated_unit_cost<>recipe.unit_cost THEN RAISE EXCEPTION 'Invalid production commitment'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_plan_guard BEFORE INSERT ON production_runs FOR EACH ROW EXECUTE FUNCTION guard_production_plan();
