-- V7: checkout incentives are separate from undiscounted merchandise value.
CREATE TABLE commerce_policies(workspace_id uuid PRIMARY KEY REFERENCES workspaces,credits_per_sgd integer NOT NULL DEFAULT 100 CHECK(credits_per_sgd BETWEEN 1 AND 100000),stack_cap_percent integer NOT NULL DEFAULT 25 CHECK(stack_cap_percent BETWEEN 0 AND 100),bonus_budget integer NOT NULL DEFAULT 10000 CHECK(bonus_budget>=0));
CREATE TABLE discount_entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,user_id uuid NOT NULL REFERENCES users,receipt_id uuid NOT NULL UNIQUE REFERENCES return_receipts,percent integer NOT NULL DEFAULT 10 CHECK(percent=10),eligible_recipes text[] NOT NULL DEFAULT ARRAY['tote','sleeve','jacket','utility','pouch'],status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','redeemed','revoked')),preorder_id uuid REFERENCES preorders,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',CHECK(expires_at>created_at));
CREATE TABLE checkout_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,user_id uuid NOT NULL REFERENCES users,preorder_id uuid NOT NULL UNIQUE REFERENCES preorders,entitlement_id uuid REFERENCES discount_entitlements,credit_transaction_id uuid UNIQUE REFERENCES reward_transactions,price_cents integer NOT NULL CHECK(price_cents>0),discount_cents integer NOT NULL CHECK(discount_cents>=0),credit_cents integer NOT NULL CHECK(credit_cents>=0),payable_cents integer NOT NULL CHECK(payable_cents>=0),credits integer NOT NULL CHECK(credits>=0),credits_per_sgd integer NOT NULL CHECK(credits_per_sgd>0),cap_percent integer NOT NULL CHECK(cap_percent BETWEEN 0 AND 100),status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','confirmed','cancelled','failed','refunded')),command_id uuid NOT NULL UNIQUE REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',CHECK(price_cents=discount_cents+credit_cents+payable_cents),CHECK(discount_cents+credit_cents<=floor(price_cents::numeric*cap_percent/100)),CHECK((credits=0 AND credit_transaction_id IS NULL) OR (credits>0 AND credit_transaction_id IS NOT NULL)));
CREATE TABLE entitlement_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entitlement_id uuid NOT NULL REFERENCES discount_entitlements,from_state text,to_state text NOT NULL,preorder_id uuid REFERENCES preorders,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE waitlist_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces,drop_id uuid NOT NULL REFERENCES drops,user_id uuid NOT NULL REFERENCES users,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),command_id uuid NOT NULL UNIQUE REFERENCES accounting_commands,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(drop_id,user_id));
CREATE FUNCTION grant_return_discount() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r return_requests; BEGIN
 IF NEW.inspection_result<>'rejected' AND NEW.verified_material_kg>0 AND NEW.verified_material_type<>'Unknown' AND NEW.verified_condition='Damaged / reusable panels' THEN
 SELECT * INTO STRICT r FROM return_requests WHERE id=NEW.return_request_id;
 INSERT INTO discount_entitlements(workspace_id,user_id,receipt_id) VALUES(r.workspace_id,r.user_id,NEW.id) ON CONFLICT(receipt_id) DO NOTHING;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER verified_return_discount AFTER INSERT ON return_receipts FOR EACH ROW EXECUTE FUNCTION grant_return_discount();
CREATE FUNCTION guard_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE rr return_receipts; r return_requests; BEGIN
 IF TG_OP='INSERT' THEN
 SELECT * INTO STRICT rr FROM return_receipts WHERE id=NEW.receipt_id; SELECT * INTO STRICT r FROM return_requests WHERE id=rr.return_request_id;
 IF rr.inspection_result='rejected' OR rr.verified_material_kg<=0 OR r.user_id<>NEW.user_id OR r.workspace_id<>NEW.workspace_id OR rr.verified_condition<>'Damaged / reusable panels' OR rr.verified_material_type='Unknown' OR EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=rr.id) THEN RAISE EXCEPTION 'Discount requires eligible accepted inspection'; END IF;
 ELSE
 IF (NEW.user_id,NEW.receipt_id,NEW.workspace_id,NEW.percent,NEW.eligible_recipes,NEW.expires_at) IS DISTINCT FROM (OLD.user_id,OLD.receipt_id,OLD.workspace_id,OLD.percent,OLD.eligible_recipes,OLD.expires_at) THEN RAISE EXCEPTION 'Entitlement terms are immutable'; END IF;
 IF NOT ((OLD.status='available' AND NEW.status IN ('reserved','revoked')) OR (OLD.status='reserved' AND NEW.status IN ('available','redeemed','revoked')) OR (OLD.status='redeemed' AND NEW.status IN ('available','revoked'))) THEN RAISE EXCEPTION 'Invalid discount transition'; END IF;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER entitlement_guard BEFORE INSERT OR UPDATE ON discount_entitlements FOR EACH ROW EXECUTE FUNCTION guard_entitlement();
CREATE FUNCTION log_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO entitlement_events(entitlement_id,from_state,to_state,preorder_id) VALUES(NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status,NEW.preorder_id); RETURN NEW; END $$;
CREATE TRIGGER entitlement_log AFTER INSERT OR UPDATE ON discount_entitlements FOR EACH ROW EXECUTE FUNCTION log_entitlement();
CREATE FUNCTION guard_checkout_record() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p preorders; e discount_entitlements; t reward_transactions; BEGIN
 SELECT * INTO STRICT p FROM preorders WHERE id=NEW.preorder_id;
 IF p.user_id<>NEW.user_id OR NOT EXISTS(SELECT 1 FROM drops WHERE id=p.drop_id AND workspace_id=NEW.workspace_id) OR NEW.price_cents<>round(p.unit_price*100) THEN RAISE EXCEPTION 'Checkout owner, drop or price mismatch'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Checkout amounts are immutable'; END IF;
 IF NEW.entitlement_id IS NOT NULL THEN SELECT * INTO STRICT e FROM discount_entitlements WHERE id=NEW.entitlement_id; IF e.user_id<>NEW.user_id OR e.workspace_id<>NEW.workspace_id THEN RAISE EXCEPTION 'Discount owner mismatch'; END IF; END IF;
 IF NEW.credit_transaction_id IS NOT NULL THEN SELECT * INTO STRICT t FROM reward_transactions WHERE id=NEW.credit_transaction_id; IF t.user_id<>NEW.user_id OR t.type<>'redeem' OR t.amount<>-NEW.credits THEN RAISE EXCEPTION 'Invalid checkout credit ledger reference'; END IF; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER checkout_guard BEFORE INSERT OR UPDATE ON checkout_records FOR EACH ROW EXECUTE FUNCTION guard_checkout_record();
CREATE FUNCTION revoke_corrected_discount() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM discount_entitlements WHERE receipt_id=NEW.receipt_id AND status IN ('reserved','redeemed')) THEN RAISE EXCEPTION 'Cancel or refund the linked checkout before correcting this return'; END IF;
 UPDATE discount_entitlements SET status='revoked' WHERE receipt_id=NEW.receipt_id AND status='available'; RETURN NEW; END $$;
CREATE TRIGGER corrected_discount BEFORE INSERT ON return_corrections FOR EACH ROW EXECUTE FUNCTION revoke_corrected_discount();
CREATE TRIGGER immutable_checkout_delete BEFORE DELETE ON checkout_records FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER immutable_entitlement_events BEFORE UPDATE OR DELETE ON entitlement_events FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
