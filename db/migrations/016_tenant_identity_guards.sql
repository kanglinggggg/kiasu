-- Ownership and lineage keys cannot be reassigned after creation.
CREATE FUNCTION guard_return_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id,NEW.user_id,NEW.consumer_item_id,NEW.target_drop_id,NEW.collection_point_id,
      NEW.estimated_material_kg,NEW.reserved_at,NEW.return_by)
     IS DISTINCT FROM
     (OLD.workspace_id,OLD.user_id,OLD.consumer_item_id,OLD.target_drop_id,OLD.collection_point_id,
      OLD.estimated_material_kg,OLD.reserved_at,OLD.return_by) THEN
    RAISE EXCEPTION 'Return ownership and destination are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER return_request_identity_guard BEFORE UPDATE ON return_requests FOR EACH ROW EXECUTE FUNCTION guard_return_request_identity();

CREATE FUNCTION guard_drop_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id,NEW.brand_id,NEW.concept_id,NEW.code)
     IS DISTINCT FROM (OLD.workspace_id,OLD.brand_id,OLD.concept_id,OLD.code) THEN
    RAISE EXCEPTION 'Drop ownership and concept are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drop_identity_guard BEFORE UPDATE ON drops FOR EACH ROW EXECUTE FUNCTION guard_drop_identity();

CREATE FUNCTION guard_batch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id,NEW.brand_id,NEW.code)
     IS DISTINCT FROM (OLD.workspace_id,OLD.brand_id,OLD.code) THEN
    RAISE EXCEPTION 'Inventory batch ownership is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER batch_identity_guard BEFORE UPDATE ON inventory_batches FOR EACH ROW EXECUTE FUNCTION guard_batch_identity();

CREATE FUNCTION guard_concept_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id,NEW.brand_id,NEW.batch_id,NEW.recipe_key)
     IS DISTINCT FROM (OLD.workspace_id,OLD.brand_id,OLD.batch_id,OLD.recipe_key) THEN
    RAISE EXCEPTION 'Concept ownership and recipe identity are immutable';
  END IF;
  IF OLD.brand_approved_at IS NOT NULL AND
     (NEW.selling_price,NEW.unit_cost,NEW.input_kg,NEW.preorder_threshold,NEW.utilisation,NEW.approved)
     IS DISTINCT FROM
     (OLD.selling_price,OLD.unit_cost,OLD.input_kg,OLD.preorder_threshold,OLD.utilisation,OLD.approved) THEN
    RAISE EXCEPTION 'Approved concept economics and feasibility are frozen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER concept_identity_guard BEFORE UPDATE ON remix_concepts FOR EACH ROW EXECUTE FUNCTION guard_concept_identity();
