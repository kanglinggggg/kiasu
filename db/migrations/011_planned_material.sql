-- Readiness follows current demand until commitment, then the immutable run quantity.
-- Historical allocations and production records are not rewritten.
CREATE OR REPLACE VIEW component_readiness AS
 SELECT r.drop_id,r.id,r.component,'kg'::text unit,r.kg_per_unit per_unit,
 COALESCE((SELECT sum(a.quantity_kg) FROM effective_allocations a WHERE a.requirement_id=r.id),0) available,
 ceil(r.kg_per_unit*p.units*1000)/1000 minimum_quantity,true recovered
 FROM drop_material_requirements r JOIN drops d ON d.id=r.drop_id JOIN remix_concepts c ON c.id=d.concept_id
 CROSS JOIN LATERAL (SELECT COALESCE((SELECT confirmed_units FROM production_runs WHERE drop_id=d.id AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1),greatest(c.preorder_threshold,(SELECT count(*)::integer FROM preorders WHERE drop_id=d.id AND status='confirmed'))) units) p
 UNION ALL
 SELECT r.drop_id,r.id,c.component,c.unit,c.per_unit,
 COALESCE((SELECT sum(a.remaining_quantity) FROM effective_auxiliary_allocations a WHERE a.requirement_id=r.id),0),
 ceil(c.per_unit*p.units*1000)/1000,false
 FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id JOIN drops d ON d.id=r.drop_id JOIN remix_concepts co ON co.id=d.concept_id
 CROSS JOIN LATERAL (SELECT COALESCE((SELECT confirmed_units FROM production_runs WHERE drop_id=d.id AND status<>'cancelled' ORDER BY created_at DESC LIMIT 1),greatest(co.preorder_threshold,(SELECT count(*)::integer FROM preorders WHERE drop_id=d.id AND status='confirmed'))) units) p;

CREATE OR REPLACE FUNCTION guard_production_plan() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE demand integer; capacity integer; ready boolean; d drops; recipe remix_concepts; BEGIN
 SELECT * INTO STRICT d FROM drops WHERE id=NEW.drop_id FOR UPDATE;
 SELECT * INTO STRICT recipe FROM remix_concepts WHERE id=d.concept_id;
 SELECT count(*) INTO demand FROM preorders WHERE drop_id=d.id AND status='confirmed';
 SELECT min(floor((available+.0000001)/per_unit)),bool_and(available>=ceil(NEW.confirmed_units*per_unit*1000)/1000) INTO capacity,ready FROM component_readiness WHERE drop_id=d.id;
 IF d.phase<>'unlocked' OR NEW.status<>'planned' OR NEW.confirmed_units<>demand OR NEW.confirmed_units<recipe.preorder_threshold OR NOT COALESCE(ready,false) OR demand<recipe.preorder_threshold OR demand>COALESCE(capacity,0) OR NEW.confirmed_units>demand OR NEW.confirmed_units>COALESCE(capacity,0) OR NEW.selling_price<>recipe.selling_price OR NEW.estimated_unit_cost<>recipe.unit_cost THEN RAISE EXCEPTION 'Invalid production commitment'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_production_change() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE demand integer; capacity integer; ready boolean; threshold integer; BEGIN
 IF NEW.confirmed_units<>OLD.confirmed_units OR NEW.allocated_material_kg<>OLD.allocated_material_kg OR NEW.selling_price<>OLD.selling_price OR NEW.estimated_unit_cost<>OLD.estimated_unit_cost OR NEW.drop_id<>OLD.drop_id THEN RAISE EXCEPTION 'Production commitments are immutable'; END IF;
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF NOT ((OLD.status='planned' AND NEW.status IN ('approved','cancelled')) OR (OLD.status='approved' AND NEW.status IN ('in_production','cancelled')) OR (OLD.status='in_production' AND NEW.status='completed')) THEN RAISE EXCEPTION 'Invalid production transition'; END IF;
 IF NEW.status='cancelled' AND NOT EXISTS(SELECT 1 FROM production_cancellations WHERE production_run_id=NEW.id) THEN RAISE EXCEPTION 'Cancellation requires reversal record'; END IF;
 IF NEW.status IN ('approved','in_production') THEN
 SELECT count(*) INTO demand FROM preorders WHERE drop_id=NEW.drop_id AND status='confirmed';
 SELECT c.preorder_threshold INTO threshold FROM drops d JOIN remix_concepts c ON c.id=d.concept_id WHERE d.id=NEW.drop_id;
 SELECT min(floor((available+.0000001)/per_unit)),bool_and(available>=ceil(NEW.confirmed_units*per_unit*1000)/1000) INTO capacity,ready FROM component_readiness WHERE drop_id=NEW.drop_id;
 IF NOT COALESCE(ready,false) OR NEW.confirmed_units<threshold OR demand<threshold OR demand>capacity OR NEW.confirmed_units>demand OR NEW.confirmed_units>capacity THEN RAISE EXCEPTION 'Production no longer supported by demand/BOM'; END IF;
 END IF;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM production_mass_balances WHERE production_run_id=NEW.id) THEN RAISE EXCEPTION 'Completion requires mass reconciliation'; END IF;
 RETURN NEW; END $$;
