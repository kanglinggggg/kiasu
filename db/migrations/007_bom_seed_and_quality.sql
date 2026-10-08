CREATE OR REPLACE FUNCTION guard_reward() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original reward_transactions; receipt return_receipts; request return_requests; balance bigint; debited bigint; BEGIN
 PERFORM 1 FROM users WHERE id=NEW.user_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reward owner mismatch'; END IF;
 SELECT COALESCE(sum(amount),0) INTO balance FROM reward_transactions WHERE user_id=NEW.user_id;
 IF NEW.command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_commands WHERE id=NEW.command_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Reward command scope mismatch'; END IF;
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
 IF original.amount>0 AND EXISTS(SELECT 1 FROM reward_transactions t WHERE t.original_transaction_id=original.id AND NOT EXISTS(SELECT 1 FROM reward_transactions r WHERE r.original_transaction_id=t.id AND r.type='reverse')) THEN RAISE EXCEPTION 'Earn already adjusted'; END IF;
 ELSE
 SELECT COALESCE(-sum(t.amount+COALESCE((SELECT sum(r.amount) FROM reward_transactions r WHERE r.original_transaction_id=t.id AND r.type='reverse'),0)),0) INTO debited FROM reward_transactions t WHERE t.original_transaction_id=original.id AND t.type IN ('reverse','expire');
 IF original.amount<=0 OR NEW.amount>=0 OR -NEW.amount+debited>original.amount THEN RAISE EXCEPTION 'Expiration exceeds original earn'; END IF;
 END IF;
 ELSIF NEW.type='redeem' THEN IF NEW.amount>=0 OR NEW.command_id IS NULL OR NEW.original_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid redemption'; END IF;
 END IF; RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION guard_auxiliary() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source auxiliary_sources; req record; available numeric; allocation record; BEGIN
 IF TG_TABLE_NAME='auxiliary_allocations' THEN
 SELECT * INTO STRICT source FROM auxiliary_sources WHERE id=NEW.source_id FOR UPDATE;
 SELECT r.drop_id,c.*,d.workspace_id,d.phase INTO STRICT req FROM auxiliary_requirements r JOIN recipe_components c ON c.id=r.recipe_component_id JOIN drops d ON d.id=r.drop_id WHERE r.id=NEW.requirement_id;
 SELECT remaining_quantity INTO available FROM auxiliary_balances WHERE id=source.id;
 IF source.workspace_id<>req.workspace_id OR source.component<>req.component OR source.unit<>req.unit OR source.mass_per_unit_kg<>req.mass_per_unit_kg OR NEW.quantity>available OR req.phase NOT IN ('market_test','unlocked') OR (source.unit='each' AND NEW.quantity<>trunc(NEW.quantity)) THEN RAISE EXCEPTION 'Invalid auxiliary allocation'; END IF;
 ELSE
 SELECT a.*,s.unit,r.drop_id INTO STRICT allocation FROM effective_auxiliary_allocations a JOIN auxiliary_sources s ON s.id=a.source_id JOIN auxiliary_requirements r ON r.id=a.requirement_id WHERE a.id=NEW.allocation_id;
 PERFORM 1 FROM auxiliary_sources WHERE id=allocation.source_id FOR UPDATE;
 SELECT remaining_quantity INTO available FROM effective_auxiliary_allocations WHERE id=allocation.id;
 IF NEW.quantity>available OR (allocation.unit='each' AND NEW.quantity<>trunc(NEW.quantity)) OR EXISTS(SELECT 1 FROM production_runs WHERE drop_id=allocation.drop_id AND status IN ('approved','in_production','completed')) THEN RAISE EXCEPTION 'Invalid auxiliary release'; END IF;
 END IF; RETURN NEW; END $$;

CREATE FUNCTION requirement_recipe_quality() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.component='main fabric' THEN SELECT c.accepted_grades INTO NEW.accepted_grades FROM recipe_components c JOIN drops d ON d.concept_id=c.concept_id WHERE d.id=NEW.drop_id AND c.component='main fabric'; END IF; RETURN NEW; END $$;
CREATE TRIGGER requirement_grades BEFORE INSERT ON drop_material_requirements FOR EACH ROW EXECUTE FUNCTION requirement_recipe_quality();
DO $$ DECLARE r record; source uuid; BEGIN
 FOR r IN SELECT ar.id,d.workspace_id,c.component,c.unit,c.per_unit,c.mass_per_unit_kg FROM auxiliary_requirements ar JOIN drops d ON d.id=ar.drop_id JOIN recipe_components c ON c.id=ar.recipe_component_id WHERE d.code='DROP024' AND d.phase IN ('market_test','unlocked') AND NOT EXISTS(SELECT 1 FROM auxiliary_allocations WHERE requirement_id=ar.id) LOOP
 INSERT INTO auxiliary_sources(workspace_id,component,unit,quantity,mass_per_unit_kg,origin) VALUES(r.workspace_id,r.component,r.unit,r.per_unit*68,r.mass_per_unit_kg,'simulated_supplier') RETURNING id INTO source;
 INSERT INTO auxiliary_allocations(requirement_id,source_id,quantity) VALUES(r.id,source,r.per_unit*68);
 END LOOP; END $$;
