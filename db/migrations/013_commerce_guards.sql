-- Preserve ledger history while extending eligibility to prior accepted receipts.
INSERT INTO discount_entitlements(workspace_id,user_id,receipt_id,created_at,expires_at)
SELECT r.workspace_id,r.user_id,rr.id,COALESCE(r.verified_at,now()),COALESCE(r.verified_at,now())+interval '90 days'
FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id
WHERE rr.inspection_result<>'rejected' AND rr.verified_material_kg>0 AND rr.verified_material_type<>'Unknown'
AND rr.verified_condition='Damaged / reusable panels'
AND NOT EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=rr.id)
ON CONFLICT(receipt_id) DO NOTHING;
CREATE FUNCTION guard_bonus_budget() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE budget bigint; spent bigint; BEGIN
 IF NEW.type='material_bonus' THEN
 PERFORM 1 FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT COALESCE((SELECT bonus_budget FROM commerce_policies WHERE workspace_id=NEW.workspace_id),10000) INTO budget;
 SELECT COALESCE(sum(amount),0) INTO spent FROM reward_transactions WHERE workspace_id=NEW.workspace_id AND (type='material_bonus' OR original_transaction_id IN(SELECT id FROM reward_transactions WHERE type='material_bonus'));
 IF NEW.amount>120 OR spent+NEW.amount>budget THEN RAISE EXCEPTION 'Material bonus cap or workspace budget exceeded'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER material_bonus_budget BEFORE INSERT ON reward_transactions FOR EACH ROW EXECUTE FUNCTION guard_bonus_budget();
CREATE TRIGGER immutable_entitlement_delete BEFORE DELETE ON discount_entitlements FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
