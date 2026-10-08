-- Append-only accounting; historical quantities are never rewritten.
CREATE TABLE accounting_commands(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces,actor_id uuid NOT NULL REFERENCES users,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE allocation_releases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),allocation_id uuid NOT NULL REFERENCES drop_material_allocations,quantity_kg numeric(14,3) NOT NULL CHECK(quantity_kg>0 AND quantity_kg<1000001),command_id uuid NOT NULL REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(allocation_id,command_id));
CREATE TABLE return_corrections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_id uuid NOT NULL UNIQUE REFERENCES return_receipts,command_id uuid NOT NULL REFERENCES accounting_commands,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW effective_allocations AS SELECT a.*,m.source_id,m.quantity_kg original_kg,m.quantity_kg-COALESCE((SELECT sum(quantity_kg) FROM allocation_releases r WHERE r.allocation_id=a.id),0) quantity_kg FROM drop_material_allocations a JOIN material_movements m ON m.id=a.movement_id;
CREATE OR REPLACE VIEW source_balances AS SELECT s.*,s.verified_kg-COALESCE((SELECT sum(m.quantity_kg) FROM material_movements m WHERE m.source_id=s.id AND m.kind='allocation'),0)+COALESCE((SELECT sum(r.quantity_kg) FROM allocation_releases r JOIN drop_material_allocations a ON a.id=r.allocation_id JOIN material_movements m ON m.id=a.movement_id WHERE m.source_id=s.id),0)-CASE WHEN EXISTS(SELECT 1 FROM return_corrections c WHERE c.receipt_id=s.receipt_id) THEN s.verified_kg ELSE 0 END AS remaining_kg FROM material_sources s;
ALTER TABLE preorders DROP CONSTRAINT preorders_status_check;
ALTER TABLE preorders ADD CHECK(status IN ('pending','confirmed','cancelled','refunded','failed'));
CREATE TABLE preorder_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),preorder_id uuid NOT NULL REFERENCES preorders,from_state text NOT NULL,to_state text NOT NULL CHECK(to_state IN ('pending','confirmed','cancelled','refunded','failed')),command_id uuid NOT NULL REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(preorder_id,to_state));
CREATE TABLE production_cancellations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_run_id uuid NOT NULL UNIQUE REFERENCES production_runs,command_id uuid NOT NULL REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE business_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_run_id uuid NOT NULL REFERENCES production_runs,preorder_event_id uuid NOT NULL UNIQUE REFERENCES preorder_events,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE production_runs DROP CONSTRAINT production_runs_drop_id_key;
CREATE UNIQUE INDEX active_production_per_drop ON production_runs(drop_id) WHERE status<>'cancelled';
ALTER TABLE production_consumptions DROP CONSTRAINT production_consumptions_allocation_id_key;
CREATE UNIQUE INDEX consumption_run_allocation ON production_consumptions(production_run_id,allocation_id);
ALTER TABLE reward_transactions ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE reward_transactions DROP CONSTRAINT reward_transactions_type_check;
ALTER TABLE reward_transactions DROP CONSTRAINT reward_transactions_amount_check;
ALTER TABLE reward_transactions ADD CHECK(type IN ('return_base','material_bonus','redeem','reverse','expire'));
ALTER TABLE reward_transactions ADD CHECK(amount<>0);
ALTER TABLE reward_transactions ADD COLUMN original_transaction_id uuid REFERENCES reward_transactions;
ALTER TABLE reward_transactions ADD COLUMN command_id uuid REFERENCES accounting_commands;
CREATE UNIQUE INDEX single_reward_reversal ON reward_transactions(original_transaction_id) WHERE type='reverse';
CREATE UNIQUE INDEX reward_command_type ON reward_transactions(command_id,type,original_transaction_id) NULLS NOT DISTINCT WHERE command_id IS NOT NULL;
ALTER TABLE reward_transactions ADD COLUMN lifecycle text GENERATED ALWAYS AS (CASE WHEN type IN ('return_base','material_bonus') THEN 'earn' ELSE type END) STORED;
ALTER TABLE return_requests DROP CONSTRAINT return_requests_status_check;
ALTER TABLE return_requests ADD CHECK(status IN ('draft','reserved','received','inspected','accepted','partially_accepted','rejected','allocated','completed','corrected'));

-- Quality is authoritative only on inspected sources; legacy fixtures receive explicit prototype defaults.
ALTER TABLE material_sources ADD COLUMN quality_grade text NOT NULL DEFAULT 'B' CHECK(quality_grade IN ('A','B','C','fibre_only'));
ALTER TABLE material_sources ADD COLUMN composition text NOT NULL DEFAULT 'cotton_rich' CHECK(composition IN ('cotton_rich','cotton_blend','synthetic','unknown'));
ALTER TABLE material_sources ADD COLUMN colour_family text NOT NULL DEFAULT 'blue' CHECK(colour_family IN ('blue','dark','light','mixed','unknown'));
ALTER TABLE material_sources ADD COLUMN fabric_weight text NOT NULL DEFAULT 'medium' CHECK(fabric_weight IN ('light','medium','heavy','unknown'));
ALTER TABLE material_sources ADD COLUMN panel_grade text NOT NULL DEFAULT 'large' CHECK(panel_grade IN ('large','small','fibre_only'));
ALTER TABLE material_sources ADD COLUMN contamination_status text NOT NULL DEFAULT 'clean' CHECK(contamination_status IN ('clean','requires_cleaning','contaminated'));
ALTER TABLE return_receipts ADD COLUMN quality_grade text NOT NULL DEFAULT 'B' CHECK(quality_grade IN ('A','B','C','fibre_only'));
ALTER TABLE return_receipts ADD COLUMN composition text NOT NULL DEFAULT 'cotton_rich' CHECK(composition IN ('cotton_rich','cotton_blend','synthetic','unknown'));
ALTER TABLE return_receipts ADD COLUMN colour_family text NOT NULL DEFAULT 'blue' CHECK(colour_family IN ('blue','dark','light','mixed','unknown'));
ALTER TABLE return_receipts ADD COLUMN fabric_weight text NOT NULL DEFAULT 'medium' CHECK(fabric_weight IN ('light','medium','heavy','unknown'));
ALTER TABLE return_receipts ADD COLUMN panel_grade text NOT NULL DEFAULT 'large' CHECK(panel_grade IN ('large','small','fibre_only'));
ALTER TABLE return_receipts ADD COLUMN contamination_status text NOT NULL DEFAULT 'clean' CHECK(contamination_status IN ('clean','requires_cleaning','contaminated'));
ALTER TABLE drop_material_requirements ADD COLUMN accepted_grades text[] NOT NULL DEFAULT ARRAY['A','B'] CHECK(cardinality(accepted_grades)>0 AND accepted_grades<@ARRAY['A','B','C','fibre_only']);
UPDATE drop_material_requirements SET accepted_grades=ARRAY['A','B','C'] WHERE drop_id IN(SELECT d.id FROM drops d JOIN remix_concepts c ON c.id=d.concept_id WHERE c.recipe_key='pouch');

CREATE TABLE recipe_components(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),concept_id uuid NOT NULL REFERENCES remix_concepts,component text NOT NULL,unit text NOT NULL CHECK(unit IN ('kg','each')),per_unit numeric(14,6) NOT NULL CHECK(per_unit>0 AND per_unit<1000001),mass_per_unit_kg numeric(14,6) NOT NULL CHECK(mass_per_unit_kg>0 AND mass_per_unit_kg<1000001),recovered boolean NOT NULL,accepted_grades text[] NOT NULL DEFAULT ARRAY['A','B'],UNIQUE(concept_id,component));
CREATE FUNCTION populate_recipe_bom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO recipe_components(concept_id,component,unit,per_unit,mass_per_unit_kg,recovered,accepted_grades) VALUES(NEW.id,'main fabric','kg',NEW.input_kg,1,true,CASE WHEN NEW.recipe_key='pouch' THEN ARRAY['A','B','C'] ELSE ARRAY['A','B'] END);
 IF NEW.recipe_key='utility' THEN
 INSERT INTO recipe_components(concept_id,component,unit,per_unit,mass_per_unit_kg,recovered) VALUES(NEW.id,'lining','kg',.18,1,false),(NEW.id,'zipper','each',1,.01,false),(NEW.id,'hardware','each',2,.005,false);
 END IF; RETURN NEW; END $$;
CREATE TRIGGER recipe_bom AFTER INSERT ON remix_concepts FOR EACH ROW EXECUTE FUNCTION populate_recipe_bom();
INSERT INTO recipe_components(concept_id,component,unit,per_unit,mass_per_unit_kg,recovered,accepted_grades) SELECT id,'main fabric','kg',input_kg,1,true,CASE WHEN recipe_key='pouch' THEN ARRAY['A','B','C'] ELSE ARRAY['A','B'] END FROM remix_concepts;
INSERT INTO recipe_components(concept_id,component,unit,per_unit,mass_per_unit_kg,recovered) SELECT c.id,x.component,x.unit,x.amount,x.mass,false FROM remix_concepts c CROSS JOIN (VALUES('lining','kg',.18,1),('zipper','each',1,.01),('hardware','each',2,.005)) x(component,unit,amount,mass) WHERE c.recipe_key='utility';
CREATE TABLE auxiliary_requirements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,recipe_component_id uuid NOT NULL REFERENCES recipe_components,UNIQUE(drop_id,recipe_component_id));
CREATE TABLE auxiliary_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,component text NOT NULL,unit text NOT NULL CHECK(unit IN ('kg','each')),quantity numeric(14,3) NOT NULL CHECK(quantity>0 AND quantity<1000001 AND (unit<>'each' OR quantity=trunc(quantity))),mass_per_unit_kg numeric(14,6) NOT NULL CHECK(mass_per_unit_kg>0 AND mass_per_unit_kg<1000001),origin text NOT NULL CHECK(origin IN ('simulated_supplier','production_residual')),production_run_id uuid REFERENCES production_runs,command_id uuid REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auxiliary_allocations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requirement_id uuid NOT NULL REFERENCES auxiliary_requirements,source_id uuid NOT NULL REFERENCES auxiliary_sources,quantity numeric(14,3) NOT NULL CHECK(quantity>0 AND quantity<1000001),command_id uuid REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auxiliary_releases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),allocation_id uuid NOT NULL REFERENCES auxiliary_allocations,quantity numeric(14,3) NOT NULL CHECK(quantity>0 AND quantity<1000001),command_id uuid NOT NULL REFERENCES accounting_commands,UNIQUE(allocation_id,command_id));
CREATE VIEW effective_auxiliary_allocations AS SELECT a.*,a.quantity-COALESCE((SELECT sum(quantity) FROM auxiliary_releases r WHERE r.allocation_id=a.id),0) remaining_quantity FROM auxiliary_allocations a;
CREATE VIEW auxiliary_balances AS SELECT s.*,s.quantity-COALESCE((SELECT sum(a.remaining_quantity) FROM effective_auxiliary_allocations a WHERE a.source_id=s.id),0) remaining_quantity FROM auxiliary_sources s;
CREATE FUNCTION populate_drop_bom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO auxiliary_requirements(drop_id,recipe_component_id) SELECT NEW.id,id FROM recipe_components WHERE concept_id=NEW.concept_id AND NOT recovered; RETURN NEW; END $$;
CREATE TRIGGER drop_bom AFTER INSERT ON drops FOR EACH ROW EXECUTE FUNCTION populate_drop_bom();
-- Do not retroactively add physical inputs to historical or already-started production.
INSERT INTO auxiliary_requirements(drop_id,recipe_component_id) SELECT d.id,c.id FROM drops d JOIN recipe_components c ON c.concept_id=d.concept_id WHERE NOT c.recovered AND d.phase IN ('draft','market_test','unlocked');
CREATE TABLE auxiliary_consumptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_run_id uuid NOT NULL REFERENCES production_runs,allocation_id uuid NOT NULL REFERENCES auxiliary_allocations,consumed_quantity numeric(14,3) NOT NULL CHECK(consumed_quantity>=0),residual_source_id uuid UNIQUE REFERENCES auxiliary_sources,UNIQUE(production_run_id,allocation_id));
ALTER TABLE production_consumptions ADD COLUMN process_scrap_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK(process_scrap_kg>=0 AND process_scrap_kg<1000001);
ALTER TABLE production_consumptions ADD COLUMN non_recoverable_kg numeric(14,3) NOT NULL DEFAULT 0 CHECK(non_recoverable_kg>=0 AND non_recoverable_kg<=process_scrap_kg);
CREATE TABLE production_mass_balances(production_run_id uuid PRIMARY KEY REFERENCES production_runs,allocated_kg numeric(14,3) NOT NULL CHECK(allocated_kg>0 AND allocated_kg<1000001),consumed_kg numeric(14,3) NOT NULL CHECK(consumed_kg>=0),process_scrap_kg numeric(14,3) NOT NULL CHECK(process_scrap_kg>=0),recoverable_residual_kg numeric(14,3) NOT NULL CHECK(recoverable_residual_kg>=0),non_recoverable_residual_kg numeric(14,3) NOT NULL CHECK(non_recoverable_residual_kg>=0),command_id uuid REFERENCES accounting_commands,CHECK(abs(allocated_kg-consumed_kg-recoverable_residual_kg-non_recoverable_residual_kg)<=.001),CHECK(non_recoverable_residual_kg<=process_scrap_kg AND process_scrap_kg<=recoverable_residual_kg+non_recoverable_residual_kg),created_at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION guard_material_movement() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s material_sources; balance numeric; BEGIN
 SELECT * INTO STRICT s FROM material_sources WHERE id=NEW.source_id FOR UPDATE;
 IF NEW.workspace_id<>s.workspace_id THEN RAISE EXCEPTION 'Workspace mismatch'; END IF;
 IF NEW.kind='pool_entry' THEN
 IF s.source_type<>'residual_material' OR NEW.quantity_kg<>s.verified_kg OR EXISTS(SELECT 1 FROM material_movements WHERE source_id=s.id AND kind='pool_entry') THEN RAISE EXCEPTION 'Invalid residual pool entry'; END IF;
 ELSE SELECT remaining_kg INTO balance FROM source_balances WHERE id=s.id; IF NEW.quantity_kg>balance THEN RAISE EXCEPTION 'Material over-allocation'; END IF; END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_allocation_release() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE allocation effective_allocations; phase text; BEGIN
 SELECT * INTO STRICT allocation FROM effective_allocations WHERE id=NEW.allocation_id;
 PERFORM 1 FROM material_sources WHERE id=allocation.source_id FOR UPDATE;
 SELECT * INTO STRICT allocation FROM effective_allocations WHERE id=NEW.allocation_id;
 SELECT d.phase INTO phase FROM drops d WHERE id=allocation.drop_id FOR UPDATE;
 IF phase IN ('production','completed') OR EXISTS(SELECT 1 FROM production_runs p WHERE p.drop_id=allocation.drop_id AND p.status IN ('approved','in_production','completed')) THEN RAISE EXCEPTION 'Material is committed; cancel before approval or reconcile started production'; END IF;
 IF NEW.quantity_kg>allocation.quantity_kg THEN RAISE EXCEPTION 'Release exceeds original unconsumed allocation'; END IF; RETURN NEW; END $$;
CREATE TRIGGER allocation_release_guard BEFORE INSERT ON allocation_releases FOR EACH ROW EXECUTE FUNCTION guard_allocation_release();
CREATE OR REPLACE FUNCTION guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE req drop_material_requirements; movement material_movements; source material_sources; total numeric; BEGIN
 SELECT * INTO STRICT req FROM drop_material_requirements WHERE id=NEW.requirement_id FOR UPDATE;
 SELECT * INTO STRICT movement FROM material_movements WHERE id=NEW.movement_id;
 SELECT * INTO STRICT source FROM material_sources WHERE id=movement.source_id;
 IF NEW.drop_id<>req.drop_id OR movement.destination_drop_id<>NEW.drop_id OR movement.destination_type<>'drop' THEN RAISE EXCEPTION 'Allocation destination mismatch'; END IF;
 IF NOT(source.material_type=req.material_type AND source.material_type<>'Unknown' OR source.material_type='Cotton Blend Denim' AND req.material_type='Cotton Denim' AND req.allowed_blend) THEN RAISE EXCEPTION 'Incompatible material'; END IF;
 IF NOT(source.quality_grade=ANY(req.accepted_grades)) OR source.contamination_status<>'clean' OR source.panel_grade='fibre_only' THEN RAISE EXCEPTION 'Incompatible inspected quality'; END IF;
 SELECT COALESCE(sum(quantity_kg),0) INTO total FROM effective_allocations WHERE requirement_id=req.id;
 IF total+movement.quantity_kg>req.maximum_kg THEN RAISE EXCEPTION 'Requirement maximum exceeded'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION guard_reward() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original reward_transactions; receipt return_receipts; request return_requests; balance bigint; debited bigint; BEGIN
 PERFORM 1 FROM users WHERE id=NEW.user_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reward owner mismatch'; END IF;
 SELECT COALESCE(sum(amount),0) INTO balance FROM reward_transactions WHERE user_id=NEW.user_id;
 IF balance+NEW.amount<0 THEN RAISE EXCEPTION 'Reward balance cannot be negative'; END IF;
 IF NEW.type IN ('return_base','material_bonus') THEN
 SELECT * INTO STRICT receipt FROM return_receipts WHERE id=NEW.receipt_id;
 SELECT * INTO STRICT request FROM return_requests WHERE id=receipt.return_request_id;
 IF NEW.amount<=0 OR receipt.inspection_result='rejected' OR receipt.verified_material_kg<=0 OR NEW.user_id<>request.user_id OR NEW.workspace_id<>request.workspace_id OR EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=receipt.id) THEN RAISE EXCEPTION 'Rewards require accepted verification'; END IF;
 ELSIF NEW.type IN ('reverse','expire') THEN
 SELECT * INTO STRICT original FROM reward_transactions WHERE id=NEW.original_transaction_id;
 IF original.user_id<>NEW.user_id OR original.workspace_id<>NEW.workspace_id OR NEW.command_id IS NULL THEN RAISE EXCEPTION 'Invalid reward reference'; END IF;
 IF NEW.type='reverse' THEN
 IF NEW.amount<>-original.amount OR original.type NOT IN ('return_base','material_bonus','redeem','expire') THEN RAISE EXCEPTION 'Reversal must exactly offset original transaction'; END IF;
 IF original.amount>0 AND EXISTS(SELECT 1 FROM reward_transactions WHERE original_transaction_id=original.id) THEN RAISE EXCEPTION 'Earn already adjusted'; END IF;
 ELSE
 SELECT COALESCE(-sum(amount),0) INTO debited FROM reward_transactions WHERE original_transaction_id=original.id AND type IN ('reverse','expire');
 IF original.amount<=0 OR NEW.amount>=0 OR -NEW.amount+debited>original.amount THEN RAISE EXCEPTION 'Expiration exceeds original earn'; END IF;
 END IF;
 ELSIF NEW.type='redeem' THEN IF NEW.amount>=0 OR NEW.command_id IS NULL OR NEW.original_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid redemption'; END IF;
 END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_return_correction() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s source_balances; BEGIN
 PERFORM 1 FROM material_sources WHERE receipt_id=NEW.receipt_id FOR UPDATE;
 SELECT * INTO STRICT s FROM source_balances WHERE receipt_id=NEW.receipt_id;
 IF s.remaining_kg<>s.verified_kg OR EXISTS(SELECT 1 FROM effective_allocations a JOIN production_runs p ON p.drop_id=a.drop_id WHERE a.source_id=s.id AND p.status IN ('in_production','completed')) THEN RAISE EXCEPTION 'Return has committed or consumed material'; END IF;
 IF (SELECT COALESCE(sum(amount),0) FROM reward_transactions WHERE receipt_id=NEW.receipt_id)<>0 THEN RAISE EXCEPTION 'Reverse return rewards before correction'; END IF; RETURN NEW; END $$;
CREATE TRIGGER correction_guard BEFORE INSERT ON return_corrections FOR EACH ROW EXECUTE FUNCTION guard_return_correction();
CREATE FUNCTION guard_auxiliary() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source auxiliary_sources; req record; available numeric; allocation record; BEGIN
 IF TG_TABLE_NAME='auxiliary_allocations' THEN
 SELECT * INTO STRICT source FROM auxiliary_sources WHERE id=NEW.source_id FOR UPDATE;
 SELECT r.drop_id,c.*,d.workspace_id,d.phase INTO STRICT req FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id JOIN drops d ON d.id=r.drop_id WHERE r.id=NEW.requirement_id;
 SELECT remaining_quantity INTO available FROM auxiliary_balances WHERE id=source.id;
 IF source.workspace_id<>req.workspace_id OR source.component<>req.component OR source.unit<>req.unit OR source.mass_per_unit_kg<>req.mass_per_unit_kg OR NEW.quantity>available OR req.phase<>'market_test' OR (source.unit='each' AND NEW.quantity<>trunc(NEW.quantity)) THEN RAISE EXCEPTION 'Invalid auxiliary allocation'; END IF;
 ELSE
 SELECT a.*,s.unit,r.drop_id INTO STRICT allocation FROM effective_auxiliary_allocations a JOIN auxiliary_sources s ON s.id=a.source_id JOIN auxiliary_requirements r ON r.id=a.requirement_id WHERE a.id=NEW.allocation_id;
 PERFORM 1 FROM auxiliary_sources WHERE id=allocation.source_id FOR UPDATE;
 SELECT remaining_quantity INTO available FROM effective_auxiliary_allocations WHERE id=allocation.id;
 IF NEW.quantity>available OR (allocation.unit='each' AND NEW.quantity<>trunc(NEW.quantity)) OR EXISTS(SELECT 1 FROM production_runs WHERE drop_id=allocation.drop_id AND status IN ('approved','in_production','completed')) THEN RAISE EXCEPTION 'Invalid auxiliary release'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER auxiliary_allocation_guard BEFORE INSERT ON auxiliary_allocations FOR EACH ROW EXECUTE FUNCTION guard_auxiliary();
CREATE TRIGGER auxiliary_release_guard BEFORE INSERT ON auxiliary_releases FOR EACH ROW EXECUTE FUNCTION guard_auxiliary();
CREATE FUNCTION guard_consumption() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE allocation effective_allocations; residual numeric; BEGIN
 SELECT * INTO STRICT allocation FROM effective_allocations WHERE id=NEW.allocation_id;
 IF NOT EXISTS(SELECT 1 FROM production_runs WHERE id=NEW.production_run_id AND drop_id=allocation.drop_id AND status='in_production') THEN RAISE EXCEPTION 'Consumption requires matching active production'; END IF;
 SELECT COALESCE((SELECT verified_kg FROM material_sources WHERE id=NEW.residual_source_id),0) INTO residual;
 IF abs(allocation.quantity_kg-NEW.consumed_kg-residual-NEW.non_recoverable_kg)>.001 OR NEW.process_scrap_kg>residual+NEW.non_recoverable_kg THEN RAISE EXCEPTION 'Allocation mass does not reconcile'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER consumption_guard BEFORE INSERT ON production_consumptions FOR EACH ROW EXECUTE FUNCTION guard_consumption();
-- Append-only records, including reversal and exception history.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['accounting_commands','allocation_releases','return_corrections','preorder_events','production_cancellations','business_exceptions','recipe_components','auxiliary_sources','auxiliary_allocations','auxiliary_releases','auxiliary_consumptions','production_mass_balances'] LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_ledger()',t,t); END LOOP; END $$;
