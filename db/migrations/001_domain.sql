CREATE TABLE workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE brands (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces, name text NOT NULL);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces, brand_id uuid REFERENCES brands, name text NOT NULL, role text NOT NULL CHECK(role IN ('brand_user','consumer','admin/demo')), UNIQUE(workspace_id,name));
CREATE TABLE demo_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days');
CREATE TABLE inventory_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,brand_id uuid NOT NULL REFERENCES brands,code text NOT NULL,product text NOT NULL,
 original_quantity integer NOT NULL CHECK(original_quantity>0),original_weight numeric(14,3) CHECK(original_weight>=0 AND original_weight<1000001),
 estimated_material_type text NOT NULL,verified_material_type text,condition text NOT NULL,original_price numeric(14,2) NOT NULL CHECK(original_price>0 AND original_price<1000001),
 estimated_reusable_kg numeric(14,3) NOT NULL CHECK(estimated_reusable_kg>=0 AND estimated_reusable_kg<1000001),verified_reusable_kg numeric(14,3) CHECK(verified_reusable_kg>=0 AND verified_reusable_kg<=estimated_reusable_kg),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','analysed','route_selected','allocated','partially_allocated','closed')),route text,analysis jsonb,created_at timestamptz NOT NULL DEFAULT now(),verified_at timestamptz,UNIQUE(workspace_id,code)
);
CREATE TABLE inventory_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES inventory_batches,description text NOT NULL,quantity integer NOT NULL CHECK(quantity>0));
CREATE TABLE remix_concepts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,batch_id uuid REFERENCES inventory_batches,recipe_key text NOT NULL,name text NOT NULL,
 selling_price numeric(14,2) NOT NULL CHECK(selling_price>0 AND selling_price<1000001),unit_cost numeric(14,2) NOT NULL CHECK(unit_cost>=0 AND unit_cost<1000001),
 input_kg numeric(14,6) NOT NULL CHECK(input_kg>0 AND input_kg<1000001),preorder_threshold integer NOT NULL CHECK(preorder_threshold>0),utilisation integer NOT NULL CHECK(utilisation BETWEEN 0 AND 100),
 reasoning text NOT NULL DEFAULT '',approved boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(batch_id,recipe_key)
);
CREATE TABLE drops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,brand_id uuid NOT NULL REFERENCES brands,concept_id uuid NOT NULL REFERENCES remix_concepts,code text NOT NULL,
 phase text NOT NULL DEFAULT 'draft' CHECK(phase IN ('draft','market_test','unlocked','production','completed','cancelled')),created_at timestamptz NOT NULL DEFAULT now(),unlocked_at timestamptz,UNIQUE(workspace_id,code));
CREATE TABLE drop_material_requirements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,component text NOT NULL,material_type text NOT NULL,
 minimum_kg numeric(14,3) NOT NULL CHECK(minimum_kg>0 AND minimum_kg<1000001),maximum_kg numeric(14,3) NOT NULL CHECK(maximum_kg>=minimum_kg AND maximum_kg<1000001),
 kg_per_unit numeric(14,6) NOT NULL CHECK(kg_per_unit>0 AND kg_per_unit<1000001),allowed_blend boolean NOT NULL DEFAULT false,UNIQUE(drop_id,component));
CREATE TABLE collection_points (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,name text NOT NULL,hours text NOT NULL,is_mock boolean NOT NULL DEFAULT true,UNIQUE(workspace_id,name));
CREATE TABLE consumer_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,user_id uuid NOT NULL REFERENCES users,item_type text NOT NULL,
 estimated_material_type text NOT NULL,estimated_condition text NOT NULL,age_months integer NOT NULL CHECK(age_months BETWEEN 0 AND 1200),usage text NOT NULL,
 estimated_recoverable_kg numeric(14,3) NOT NULL CHECK(estimated_recoverable_kg>=0 AND estimated_recoverable_kg<1000001),recommendation text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE return_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,user_id uuid NOT NULL REFERENCES users,consumer_item_id uuid NOT NULL UNIQUE REFERENCES consumer_items,
 target_drop_id uuid NOT NULL REFERENCES drops,collection_point_id uuid NOT NULL REFERENCES collection_points,
 status text NOT NULL CHECK(status IN ('draft','reserved','received','inspected','accepted','partially_accepted','rejected','allocated','completed')),
 estimated_material_kg numeric(14,3) NOT NULL CHECK(estimated_material_kg>=0 AND estimated_material_kg<1000001),reserved_at timestamptz,received_at timestamptz,verified_at timestamptz,return_by date NOT NULL);
CREATE TABLE return_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),return_request_id uuid NOT NULL UNIQUE REFERENCES return_requests,
 inspector_id uuid NOT NULL REFERENCES users,verified_material_type text NOT NULL,verified_condition text NOT NULL,verified_material_kg numeric(14,3) NOT NULL CHECK(verified_material_kg>=0 AND verified_material_kg<1000001),
 inspection_result text NOT NULL CHECK(inspection_result IN ('accepted','partially_accepted','rejected')),inspection_note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE votes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,user_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(drop_id,user_id));
CREATE TABLE reservations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,user_id uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(drop_id,user_id));
CREATE TABLE preorders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,user_id uuid NOT NULL REFERENCES users,quantity integer NOT NULL DEFAULT 1 CHECK(quantity=1),
 unit_price numeric(14,2) NOT NULL CHECK(unit_price>0 AND unit_price<1000001),payment_status text NOT NULL DEFAULT 'simulated' CHECK(payment_status='simulated'),status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(drop_id,user_id));
CREATE TABLE production_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL UNIQUE REFERENCES drops,confirmed_units integer NOT NULL CHECK(confirmed_units>0),
 allocated_material_kg numeric(14,3) NOT NULL CHECK(allocated_material_kg>0 AND allocated_material_kg<1000001),estimated_unit_cost numeric(14,2) NOT NULL CHECK(estimated_unit_cost>=0 AND estimated_unit_cost<1000001),
 selling_price numeric(14,2) NOT NULL CHECK(selling_price>0 AND selling_price<1000001),
 estimated_total_cost numeric(16,2) GENERATED ALWAYS AS (confirmed_units*estimated_unit_cost) STORED,
 gross_committed_sales numeric(16,2) GENERATED ALWAYS AS (confirmed_units*selling_price) STORED,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','approved','in_production','completed','cancelled')),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE TABLE material_pools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,name text NOT NULL,UNIQUE(workspace_id,name));
CREATE TABLE material_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,source_type text NOT NULL CHECK(source_type IN ('brand_inventory','consumer_return','residual_material')),
 batch_id uuid UNIQUE REFERENCES inventory_batches,receipt_id uuid UNIQUE REFERENCES return_receipts,production_run_id uuid REFERENCES production_runs,pool_id uuid REFERENCES material_pools,
 material_type text NOT NULL,verified_kg numeric(14,3) NOT NULL CHECK(verified_kg>0 AND verified_kg<1000001),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((source_type='brand_inventory' AND batch_id IS NOT NULL AND receipt_id IS NULL AND production_run_id IS NULL) OR (source_type='consumer_return' AND receipt_id IS NOT NULL AND batch_id IS NULL AND production_run_id IS NULL) OR (source_type='residual_material' AND production_run_id IS NOT NULL AND batch_id IS NULL AND receipt_id IS NULL)));
CREATE TABLE material_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,source_id uuid NOT NULL REFERENCES material_sources,
 destination_type text NOT NULL CHECK(destination_type IN ('drop','future_pool','recycling','repair','resale')),destination_drop_id uuid REFERENCES drops,destination_pool_id uuid REFERENCES material_pools,
 quantity_kg numeric(14,3) NOT NULL CHECK(quantity_kg>0 AND quantity_kg<1000001),status text NOT NULL DEFAULT 'posted' CHECK(status='posted'),
 -- pool_entry records residual creation without spending it a second time.
 kind text NOT NULL DEFAULT 'allocation' CHECK(kind IN ('allocation','pool_entry')),
 idempotency_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,idempotency_key),
 CHECK((destination_type='drop' AND destination_drop_id IS NOT NULL AND destination_pool_id IS NULL) OR (destination_type='future_pool' AND destination_pool_id IS NOT NULL AND destination_drop_id IS NULL) OR (destination_type IN ('recycling','repair','resale') AND destination_drop_id IS NULL AND destination_pool_id IS NULL)),
 CHECK(kind<>'pool_entry' OR destination_type='future_pool'));
CREATE TABLE drop_material_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),drop_id uuid NOT NULL REFERENCES drops,requirement_id uuid NOT NULL REFERENCES drop_material_requirements,movement_id uuid NOT NULL UNIQUE REFERENCES material_movements);
CREATE TABLE production_consumptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_run_id uuid NOT NULL REFERENCES production_runs,allocation_id uuid NOT NULL UNIQUE REFERENCES drop_material_allocations,consumed_kg numeric(14,3) NOT NULL CHECK(consumed_kg>=0 AND consumed_kg<1000001),residual_source_id uuid UNIQUE REFERENCES material_sources);
CREATE TABLE reward_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,user_id uuid NOT NULL REFERENCES users,receipt_id uuid NOT NULL REFERENCES return_receipts,
 type text NOT NULL CHECK(type IN ('return_base','material_bonus')),amount integer NOT NULL CHECK(amount>0),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(receipt_id,type));
CREATE TABLE impact_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),production_run_id uuid NOT NULL UNIQUE REFERENCES production_runs,estimated boolean NOT NULL DEFAULT true,method text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,actor_id uuid NOT NULL REFERENCES users,type text NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX movements_source ON material_movements(source_id);
CREATE INDEX allocations_drop ON drop_material_allocations(drop_id);
CREATE INDEX audit_workspace ON audit_events(workspace_id,created_at);
CREATE INDEX return_owner ON return_requests(user_id);

CREATE VIEW source_balances AS SELECT s.*,s.verified_kg-COALESCE((SELECT sum(m.quantity_kg) FROM material_movements m WHERE m.source_id=s.id AND m.kind='allocation'),0) AS remaining_kg FROM material_sources s;
CREATE VIEW reward_balances AS SELECT user_id,sum(amount) AS balance FROM reward_transactions GROUP BY user_id;

-- Defense in depth: even competing direct INSERTs cannot overdraw a verified source.
CREATE FUNCTION guard_material_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s material_sources; spent numeric;
BEGIN
 SELECT * INTO STRICT s FROM material_sources WHERE id=NEW.source_id FOR UPDATE;
 IF NEW.workspace_id<>s.workspace_id THEN RAISE EXCEPTION 'Workspace mismatch'; END IF;
 IF NEW.kind='pool_entry' THEN
   IF s.source_type<>'residual_material' OR NEW.quantity_kg<>s.verified_kg OR EXISTS(SELECT 1 FROM material_movements WHERE source_id=s.id AND kind='pool_entry') THEN RAISE EXCEPTION 'Invalid residual pool entry'; END IF;
 ELSE
   SELECT COALESCE(sum(quantity_kg),0) INTO spent FROM material_movements WHERE source_id=s.id AND kind='allocation';
   IF spent+NEW.quantity_kg>s.verified_kg THEN RAISE EXCEPTION 'Material over-allocation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER material_balance_guard BEFORE INSERT ON material_movements FOR EACH ROW EXECUTE FUNCTION guard_material_movement();
CREATE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ledger entries are immutable'; END $$;
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON material_movements FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_rewards BEFORE UPDATE OR DELETE ON reward_transactions FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_sources BEFORE UPDATE OR DELETE ON material_sources FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
