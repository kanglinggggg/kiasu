CREATE OR REPLACE VIEW source_balances AS SELECT s.id,s.workspace_id,s.source_type,s.batch_id,s.receipt_id,s.production_run_id,s.pool_id,s.material_type,s.verified_kg,s.created_at,
s.verified_kg-COALESCE((SELECT sum(m.quantity_kg) FROM material_movements m WHERE m.source_id=s.id AND m.kind='allocation'),0)+COALESCE((SELECT sum(r.quantity_kg) FROM allocation_releases r JOIN drop_material_allocations a ON a.id=r.allocation_id JOIN material_movements m ON m.id=a.movement_id WHERE m.source_id=s.id),0)-CASE WHEN EXISTS(SELECT 1 FROM return_corrections c WHERE c.receipt_id=s.receipt_id) THEN s.verified_kg ELSE 0 END AS remaining_kg,
s.quality_grade,s.composition,s.colour_family,s.fabric_weight,s.panel_grade,s.contamination_status FROM material_sources s;
CREATE FUNCTION copy_inspected_quality() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r return_receipts; BEGIN
 IF NEW.receipt_id IS NOT NULL THEN SELECT * INTO STRICT r FROM return_receipts WHERE id=NEW.receipt_id; NEW.quality_grade=r.quality_grade;NEW.composition=r.composition;NEW.colour_family=r.colour_family;NEW.fabric_weight=r.fabric_weight;NEW.panel_grade=r.panel_grade;NEW.contamination_status=r.contamination_status; END IF; RETURN NEW; END $$;
CREATE TRIGGER source_quality BEFORE INSERT ON material_sources FOR EACH ROW EXECUTE FUNCTION copy_inspected_quality();
CREATE FUNCTION guard_preorder_event() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p preorders; d drops; BEGIN
 SELECT * INTO STRICT p FROM preorders WHERE id=NEW.preorder_id FOR UPDATE;
 SELECT * INTO STRICT d FROM drops WHERE id=p.drop_id FOR UPDATE;
 IF NEW.from_state<>p.status OR NOT ((p.status='pending' AND NEW.to_state IN ('confirmed','failed','cancelled')) OR (p.status='confirmed' AND NEW.to_state='cancelled') OR (p.status='cancelled' AND NEW.to_state='refunded')) THEN RAISE EXCEPTION 'Invalid preorder transition'; END IF;
 IF NEW.to_state='confirmed' AND d.phase<>'market_test' THEN RAISE EXCEPTION 'Market test closed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_commands WHERE id=NEW.command_id AND workspace_id=d.workspace_id) THEN RAISE EXCEPTION 'Command workspace mismatch'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER preorder_event_guard BEFORE INSERT ON preorder_events FOR EACH ROW EXECUTE FUNCTION guard_preorder_event();
CREATE FUNCTION apply_preorder_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE preorders SET status=NEW.to_state WHERE id=NEW.preorder_id; RETURN NEW; END $$;
CREATE TRIGGER preorder_event_apply AFTER INSERT ON preorder_events FOR EACH ROW EXECUTE FUNCTION apply_preorder_event();
CREATE FUNCTION guard_preorder_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.drop_id<>OLD.drop_id OR NEW.user_id<>OLD.user_id OR NEW.unit_price<>OLD.unit_price OR NEW.quantity<>OLD.quantity OR NEW.payment_status<>OLD.payment_status THEN RAISE EXCEPTION 'Preorder commitments are immutable'; END IF;
 IF NEW.status<>OLD.status AND NOT EXISTS(SELECT 1 FROM preorder_events WHERE preorder_id=OLD.id AND from_state=OLD.status AND to_state=NEW.status) THEN RAISE EXCEPTION 'Preorder transition requires an event'; END IF; RETURN NEW; END $$;
CREATE TRIGGER preorder_state_guard BEFORE UPDATE OR DELETE ON preorders FOR EACH ROW EXECUTE FUNCTION guard_preorder_update();
CREATE VIEW component_readiness AS
 SELECT r.drop_id,r.id,r.component,'kg'::text unit,r.kg_per_unit per_unit,COALESCE(sum(a.quantity_kg),0) available,r.minimum_kg minimum_quantity,true recovered FROM drop_material_requirements r LEFT JOIN effective_allocations a ON a.requirement_id=r.id GROUP BY r.id
 UNION ALL
 SELECT r.drop_id,r.id,c.component,c.unit,c.per_unit,COALESCE(sum(a.remaining_quantity),0),c.per_unit*co.preorder_threshold,false FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id JOIN drops d ON d.id=r.drop_id JOIN remix_concepts co ON co.id=d.concept_id LEFT JOIN effective_auxiliary_allocations a ON a.requirement_id=r.id GROUP BY r.id,c.id,co.preorder_threshold;
CREATE OR REPLACE FUNCTION guard_production_plan() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE demand integer; capacity integer; ready boolean; d drops; recipe remix_concepts; BEGIN
 SELECT * INTO STRICT d FROM drops WHERE id=NEW.drop_id FOR UPDATE;
 SELECT * INTO STRICT recipe FROM remix_concepts WHERE id=d.concept_id;
 SELECT count(*) INTO demand FROM preorders WHERE drop_id=d.id AND status='confirmed';
 SELECT min(floor((available+.0000001)/per_unit)),bool_and(available>=minimum_quantity) INTO capacity,ready FROM component_readiness WHERE drop_id=d.id;
 IF d.phase<>'unlocked' OR NEW.status<>'planned' OR NOT COALESCE(ready,false) OR demand<recipe.preorder_threshold OR demand>COALESCE(capacity,0) OR NEW.confirmed_units>demand OR NEW.confirmed_units>COALESCE(capacity,0) OR NEW.selling_price<>recipe.selling_price OR NEW.estimated_unit_cost<>recipe.unit_cost THEN RAISE EXCEPTION 'Invalid production commitment'; END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_production_change() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE demand integer; capacity integer; ready boolean; threshold integer; BEGIN
 IF NEW.confirmed_units<>OLD.confirmed_units OR NEW.allocated_material_kg<>OLD.allocated_material_kg OR NEW.selling_price<>OLD.selling_price OR NEW.estimated_unit_cost<>OLD.estimated_unit_cost OR NEW.drop_id<>OLD.drop_id THEN RAISE EXCEPTION 'Production commitments are immutable'; END IF;
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF NOT ((OLD.status='planned' AND NEW.status IN ('approved','cancelled')) OR (OLD.status='approved' AND NEW.status IN ('in_production','cancelled')) OR (OLD.status='in_production' AND NEW.status='completed')) THEN RAISE EXCEPTION 'Invalid production transition'; END IF;
 IF NEW.status='cancelled' AND NOT EXISTS(SELECT 1 FROM production_cancellations WHERE production_run_id=NEW.id) THEN RAISE EXCEPTION 'Cancellation requires reversal record'; END IF;
 IF NEW.status IN ('approved','in_production') THEN
 SELECT count(*) INTO demand FROM preorders WHERE drop_id=NEW.drop_id AND status='confirmed';
 SELECT c.preorder_threshold INTO threshold FROM drops d JOIN remix_concepts c ON c.id=d.concept_id WHERE d.id=NEW.drop_id;
 SELECT min(floor((available+.0000001)/per_unit)),bool_and(available>=minimum_quantity) INTO capacity,ready FROM component_readiness WHERE drop_id=NEW.drop_id;
 IF NOT COALESCE(ready,false) OR demand<threshold OR demand>capacity OR NEW.confirmed_units>demand OR NEW.confirmed_units>capacity THEN RAISE EXCEPTION 'Production no longer supported by demand/BOM'; END IF;
 END IF;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM production_mass_balances WHERE production_run_id=NEW.id) THEN RAISE EXCEPTION 'Completion requires mass reconciliation'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER production_change_guard BEFORE UPDATE ON production_runs FOR EACH ROW EXECUTE FUNCTION guard_production_change();
CREATE FUNCTION guard_aux_consumption() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a record; residual numeric; BEGIN
 SELECT ea.*,s.unit,r.drop_id INTO STRICT a FROM effective_auxiliary_allocations ea JOIN auxiliary_sources s ON s.id=ea.source_id JOIN auxiliary_requirements r ON r.id=ea.requirement_id WHERE ea.id=NEW.allocation_id;
 SELECT COALESCE((SELECT quantity FROM auxiliary_sources WHERE id=NEW.residual_source_id),0) INTO residual;
 IF NOT EXISTS(SELECT 1 FROM production_runs WHERE id=NEW.production_run_id AND drop_id=a.drop_id AND status='in_production') OR NEW.consumed_quantity+residual<>a.remaining_quantity OR (a.unit='each' AND NEW.consumed_quantity<>trunc(NEW.consumed_quantity)) THEN RAISE EXCEPTION 'Auxiliary consumption must reconcile'; END IF; RETURN NEW; END $$;
CREATE TRIGGER aux_consumption_guard BEFORE INSERT ON auxiliary_consumptions FOR EACH ROW EXECUTE FUNCTION guard_aux_consumption();
CREATE FUNCTION guard_mass_balance() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p production_runs; recovered record; aux record; BEGIN
 SELECT * INTO STRICT p FROM production_runs WHERE id=NEW.production_run_id FOR UPDATE;
 IF p.status<>'in_production' THEN RAISE EXCEPTION 'Only active production can reconcile'; END IF;
 SELECT COALESCE(sum(e.quantity_kg),0) allocated,COALESCE(sum(pc.consumed_kg),0) consumed,COALESCE(sum(pc.process_scrap_kg),0) scrap,COALESCE(sum(s.verified_kg),0) residual,COALESCE(sum(pc.non_recoverable_kg),0) loss,count(*) expected,count(pc.id) actual INTO recovered FROM effective_allocations e LEFT JOIN production_consumptions pc ON pc.allocation_id=e.id AND pc.production_run_id=p.id LEFT JOIN material_sources s ON s.id=pc.residual_source_id WHERE e.drop_id=p.drop_id AND e.quantity_kg>0;
 SELECT COALESCE(sum(e.remaining_quantity*s.mass_per_unit_kg),0) allocated,COALESCE(sum(ac.consumed_quantity*s.mass_per_unit_kg),0) consumed,COALESCE(sum(rs.quantity*rs.mass_per_unit_kg),0) residual,count(*) expected,count(ac.id) actual INTO aux FROM effective_auxiliary_allocations e JOIN auxiliary_sources s ON s.id=e.source_id JOIN auxiliary_requirements r ON r.id=e.requirement_id LEFT JOIN auxiliary_consumptions ac ON ac.allocation_id=e.id AND ac.production_run_id=p.id LEFT JOIN auxiliary_sources rs ON rs.id=ac.residual_source_id WHERE r.drop_id=p.drop_id AND e.remaining_quantity>0;
 IF recovered.expected<>recovered.actual OR aux.expected<>aux.actual OR abs(NEW.allocated_kg-recovered.allocated-aux.allocated)>.001 OR abs(NEW.consumed_kg-recovered.consumed-aux.consumed)>.001 OR abs(NEW.recoverable_residual_kg-recovered.residual-aux.residual)>.001 OR NEW.non_recoverable_residual_kg<>recovered.loss OR NEW.process_scrap_kg<>recovered.scrap THEN RAISE EXCEPTION 'Mass statement must match complete allocation consumption ledger'; END IF; RETURN NEW; END $$;
CREATE TRIGGER mass_balance_guard BEFORE INSERT ON production_mass_balances FOR EACH ROW EXECUTE FUNCTION guard_mass_balance();
