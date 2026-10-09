-- V7 release hardening: ledger lineage, checkout arithmetic, and entitlement linkage.
CREATE OR REPLACE VIEW material_bonus_balances AS
WITH RECURSIVE bonus_tree AS (
  SELECT id AS root_id,id AS transaction_id,workspace_id,user_id,receipt_id,amount
  FROM reward_transactions WHERE type='material_bonus'
  UNION ALL
  SELECT tree.root_id,child.id,tree.workspace_id,tree.user_id,tree.receipt_id,child.amount
  FROM bonus_tree tree
  JOIN reward_transactions child ON child.original_transaction_id=tree.transaction_id
)
SELECT root_id,workspace_id,user_id,receipt_id,sum(amount)::bigint AS balance
FROM bonus_tree
GROUP BY root_id,workspace_id,user_id,receipt_id;

CREATE OR REPLACE FUNCTION guard_bonus_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE budget bigint; spent bigint;
BEGIN
  IF NEW.type='material_bonus' THEN
    PERFORM 1 FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
    SELECT COALESCE((SELECT bonus_budget FROM commerce_policies WHERE workspace_id=NEW.workspace_id),10000) INTO budget;
    SELECT COALESCE(sum(balance),0) INTO spent FROM material_bonus_balances WHERE workspace_id=NEW.workspace_id;
    IF NEW.amount>120 OR spent+NEW.amount>budget THEN
      RAISE EXCEPTION 'Material bonus cap or workspace budget exceeded';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX one_active_checkout_per_entitlement
ON checkout_records(entitlement_id)
WHERE entitlement_id IS NOT NULL AND status IN ('reserved','confirmed');

CREATE OR REPLACE FUNCTION guard_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rr return_receipts; r return_requests; p preorders; recipe text;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO STRICT rr FROM return_receipts WHERE id=NEW.receipt_id;
    SELECT * INTO STRICT r FROM return_requests WHERE id=rr.return_request_id;
    IF rr.inspection_result='rejected' OR rr.verified_material_kg<=0 OR r.user_id<>NEW.user_id OR r.workspace_id<>NEW.workspace_id OR rr.verified_condition<>'Damaged / reusable panels' OR rr.verified_material_type='Unknown' OR EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=rr.id) THEN
      RAISE EXCEPTION 'Discount requires eligible accepted inspection';
    END IF;
    IF NEW.status<>'available' OR NEW.preorder_id IS NOT NULL THEN
      RAISE EXCEPTION 'A new entitlement must be available and unassigned';
    END IF;
  ELSE
    IF (NEW.user_id,NEW.receipt_id,NEW.workspace_id,NEW.percent,NEW.eligible_recipes,NEW.expires_at) IS DISTINCT FROM (OLD.user_id,OLD.receipt_id,OLD.workspace_id,OLD.percent,OLD.eligible_recipes,OLD.expires_at) THEN
      RAISE EXCEPTION 'Entitlement terms are immutable';
    END IF;
    IF NOT ((OLD.status='available' AND NEW.status IN ('reserved','revoked')) OR (OLD.status='reserved' AND NEW.status IN ('available','redeemed','revoked')) OR (OLD.status='redeemed' AND NEW.status IN ('available','revoked'))) THEN
      RAISE EXCEPTION 'Invalid discount transition';
    END IF;
  END IF;
  IF NEW.status IN ('reserved','redeemed') THEN
    IF NEW.preorder_id IS NULL THEN RAISE EXCEPTION 'Active entitlement requires a preorder'; END IF;
    SELECT p0.* INTO STRICT p FROM preorders p0 JOIN drops d ON d.id=p0.drop_id WHERE p0.id=NEW.preorder_id AND d.workspace_id=NEW.workspace_id;
    SELECT c.recipe_key INTO recipe FROM preorders p0 JOIN drops d ON d.id=p0.drop_id JOIN remix_concepts c ON c.id=d.concept_id WHERE p0.id=NEW.preorder_id;
    IF p.user_id<>NEW.user_id OR NOT recipe=ANY(NEW.eligible_recipes) OR NOT EXISTS(SELECT 1 FROM checkout_records cr WHERE cr.entitlement_id=NEW.id AND cr.preorder_id=NEW.preorder_id AND cr.user_id=NEW.user_id AND cr.workspace_id=NEW.workspace_id AND cr.status IN ('reserved','confirmed')) THEN
      RAISE EXCEPTION 'Entitlement checkout, owner, workspace or recipe mismatch';
    END IF;
  ELSIF NEW.preorder_id IS NOT NULL THEN
    RAISE EXCEPTION 'Inactive entitlement cannot retain a preorder';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_checkout_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p preorders; e discount_entitlements; t reward_transactions; recipe text; expected_discount integer; expected_credit integer;
BEGIN
  SELECT p0.* INTO STRICT p FROM preorders p0 JOIN drops d ON d.id=p0.drop_id WHERE p0.id=NEW.preorder_id AND d.workspace_id=NEW.workspace_id;
  SELECT c.recipe_key INTO recipe FROM preorders p0 JOIN drops d ON d.id=p0.drop_id JOIN remix_concepts c ON c.id=d.concept_id WHERE p0.id=NEW.preorder_id;
  IF p.user_id<>NEW.user_id OR NEW.price_cents<>round(p.unit_price*100) THEN
    RAISE EXCEPTION 'Checkout owner, drop or price mismatch';
  END IF;
  expected_discount:=0;
  IF NEW.entitlement_id IS NOT NULL THEN
    SELECT * INTO STRICT e FROM discount_entitlements WHERE id=NEW.entitlement_id;
    IF e.user_id<>NEW.user_id OR e.workspace_id<>NEW.workspace_id OR NOT recipe=ANY(e.eligible_recipes) OR e.status NOT IN ('available','reserved','redeemed') THEN
      RAISE EXCEPTION 'Discount owner, workspace, recipe or state mismatch';
    END IF;
    expected_discount:=least(floor(NEW.price_cents::numeric*NEW.cap_percent/100),floor(NEW.price_cents::numeric*e.percent/100));
  END IF;
  expected_credit:=floor(NEW.credits::numeric*100/NEW.credits_per_sgd);
  IF NEW.discount_cents<>expected_discount OR NEW.credit_cents<>expected_credit THEN
    RAISE EXCEPTION 'Checkout incentive arithmetic mismatch';
  END IF;
  IF NEW.credit_transaction_id IS NOT NULL THEN
    SELECT * INTO STRICT t FROM reward_transactions WHERE id=NEW.credit_transaction_id;
    IF t.user_id<>NEW.user_id OR t.workspace_id<>NEW.workspace_id OR t.type<>'redeem' OR t.amount<>-NEW.credits THEN
      RAISE EXCEPTION 'Invalid checkout credit ledger reference';
    END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'reserved' OR p.status<>'pending' THEN RAISE EXCEPTION 'New checkout must reserve a pending preorder'; END IF;
  ELSE
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Checkout amounts are immutable'; END IF;
    IF NEW.status<>OLD.status AND NOT ((OLD.status='reserved' AND NEW.status IN ('confirmed','cancelled','failed')) OR (OLD.status='confirmed' AND NEW.status='cancelled') OR (OLD.status='cancelled' AND NEW.status='refunded')) THEN
      RAISE EXCEPTION 'Invalid checkout transition';
    END IF;
  END IF;
  IF (NEW.status='reserved' AND p.status<>'pending') OR (NEW.status='confirmed' AND p.status<>'confirmed') OR (NEW.status='cancelled' AND p.status NOT IN ('cancelled','refunded')) OR (NEW.status='failed' AND p.status<>'failed') OR (NEW.status='refunded' AND p.status<>'refunded') THEN
    RAISE EXCEPTION 'Checkout and preorder states disagree';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_checkout_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cr checkout_records; e discount_entitlements;
BEGIN
  SELECT * INTO STRICT cr FROM checkout_records WHERE id=NEW.id;
  IF cr.entitlement_id IS NOT NULL THEN
    SELECT * INTO STRICT e FROM discount_entitlements WHERE id=cr.entitlement_id;
    IF cr.status='reserved' AND (e.status<>'reserved' OR e.preorder_id<>cr.preorder_id) THEN RAISE EXCEPTION 'Reserved checkout requires its reserved entitlement'; END IF;
    IF cr.status='confirmed' AND (e.status<>'redeemed' OR e.preorder_id<>cr.preorder_id) THEN RAISE EXCEPTION 'Confirmed checkout requires its redeemed entitlement'; END IF;
    IF cr.status IN ('cancelled','failed','refunded') AND (e.status NOT IN ('available','revoked') OR e.preorder_id IS NOT NULL) THEN RAISE EXCEPTION 'Terminal checkout must release its entitlement'; END IF;
  END IF;
  IF cr.credit_transaction_id IS NOT NULL THEN
    IF cr.status IN ('reserved','confirmed') AND EXISTS(SELECT 1 FROM reward_transactions WHERE original_transaction_id=cr.credit_transaction_id AND type='reverse') THEN RAISE EXCEPTION 'Active checkout cannot restore reserved credits'; END IF;
    IF cr.status IN ('cancelled','failed','refunded') AND NOT EXISTS(SELECT 1 FROM reward_transactions WHERE original_transaction_id=cr.credit_transaction_id AND type='reverse') THEN RAISE EXCEPTION 'Terminal checkout must restore reserved credits'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER checkout_link_guard
AFTER INSERT OR UPDATE ON checkout_records
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_checkout_links();

CREATE INDEX discount_entitlements_user_status ON discount_entitlements(user_id,status,created_at DESC);
CREATE INDEX checkout_records_user_status ON checkout_records(user_id,status,created_at DESC);
CREATE INDEX waitlist_entries_workspace_drop_status ON waitlist_entries(workspace_id,drop_id,status);
CREATE INDEX entitlement_events_entitlement_created ON entitlement_events(entitlement_id,created_at DESC);
