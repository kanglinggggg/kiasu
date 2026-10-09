-- Single-brand pilot boundaries inside a shared marketplace workspace.
ALTER TABLE remix_concepts
  ADD COLUMN brand_id uuid REFERENCES brands,
  ADD COLUMN proposal_source text NOT NULL DEFAULT 'ai_assisted' CHECK(proposal_source IN ('ai_assisted','seeded_demo','human')),
  ADD COLUMN recipe_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN brand_approved_at timestamptz,
  ADD COLUMN maker_approved_at timestamptz,
  ADD COLUMN maker_name text,
  ADD COLUMN image_role text NOT NULL DEFAULT 'illustrative' CHECK(image_role='illustrative');

UPDATE remix_concepts c SET brand_id=COALESCE(
  (SELECT b.brand_id FROM inventory_batches b WHERE b.id=c.batch_id),
  (SELECT d.brand_id FROM drops d WHERE d.concept_id=c.id ORDER BY d.created_at LIMIT 1)
);

UPDATE remix_concepts c SET
  proposal_source='seeded_demo',
  recipe_registered=EXISTS(SELECT 1 FROM recipe_components r WHERE r.concept_id=c.id),
  brand_approved_at=c.created_at,
  maker_approved_at=c.created_at,
  maker_name='Prototype maker review · simulated'
WHERE EXISTS(SELECT 1 FROM drops d WHERE d.concept_id=c.id);

ALTER TABLE remix_concepts ALTER COLUMN brand_id SET NOT NULL;

CREATE VIEW source_brand_ownership AS
SELECT s.id source_id,COALESCE(b.brand_id,residual_drop.brand_id,return_drop.brand_id) brand_id
FROM material_sources s
LEFT JOIN inventory_batches b ON b.id=s.batch_id
LEFT JOIN production_runs pr ON pr.id=s.production_run_id
LEFT JOIN drops residual_drop ON residual_drop.id=pr.drop_id
LEFT JOIN return_receipts rr ON rr.id=s.receipt_id
LEFT JOIN return_requests rq ON rq.id=rr.return_request_id
LEFT JOIN drops return_drop ON return_drop.id=rq.target_drop_id;

CREATE FUNCTION guard_material_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_brand uuid; target_brand uuid;
BEGIN
  IF NEW.destination_type='drop' THEN
    SELECT brand_id INTO STRICT source_brand FROM source_brand_ownership WHERE source_id=NEW.source_id;
    SELECT brand_id INTO STRICT target_brand FROM drops WHERE id=NEW.destination_drop_id;
    IF source_brand IS NULL OR source_brand<>target_brand THEN
      RAISE EXCEPTION 'Cross-brand material allocation is not enabled';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_tenant_guard BEFORE INSERT ON material_movements FOR EACH ROW EXECUTE FUNCTION guard_material_tenant();

CREATE FUNCTION guard_concept_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch inventory_batches;
BEGIN
  IF NEW.batch_id IS NOT NULL THEN
    SELECT * INTO STRICT batch FROM inventory_batches WHERE id=NEW.batch_id;
    IF batch.workspace_id<>NEW.workspace_id OR batch.brand_id<>NEW.brand_id THEN
      RAISE EXCEPTION 'Concept brand or workspace mismatch';
    END IF;
  END IF;
  IF NEW.recipe_registered AND NOT EXISTS(SELECT 1 FROM recipe_components WHERE concept_id=NEW.id) THEN
    RAISE EXCEPTION 'Registered concept requires a recipe BOM';
  END IF;
  IF (NEW.brand_approved_at IS NULL)<>(NEW.maker_approved_at IS NULL) THEN
    RAISE EXCEPTION 'Brand and maker approvals must be recorded together';
  END IF;
  IF NEW.maker_approved_at IS NOT NULL AND (NEW.maker_name IS NULL OR length(trim(NEW.maker_name))<3) THEN
    RAISE EXCEPTION 'Maker approval requires a reviewer';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER concept_tenant_guard BEFORE INSERT OR UPDATE ON remix_concepts FOR EACH ROW EXECUTE FUNCTION guard_concept_tenant();

CREATE FUNCTION guard_drop_concept_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE concept remix_concepts;
BEGIN
  SELECT * INTO STRICT concept FROM remix_concepts WHERE id=NEW.concept_id;
  IF concept.workspace_id<>NEW.workspace_id OR concept.brand_id<>NEW.brand_id THEN
    RAISE EXCEPTION 'Drop concept belongs to another brand or workspace';
  END IF;
  IF NEW.phase<>'draft' AND (NOT concept.approved OR NOT concept.recipe_registered OR concept.brand_approved_at IS NULL OR concept.maker_approved_at IS NULL) THEN
    RAISE EXCEPTION 'Published drop requires deterministic feasibility, a registered recipe, and explicit brand and maker approval';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drop_concept_approval_guard BEFORE INSERT OR UPDATE OF concept_id,brand_id,workspace_id,phase ON drops FOR EACH ROW EXECUTE FUNCTION guard_drop_concept_approval();

CREATE INDEX remix_concepts_brand_created ON remix_concepts(brand_id,created_at DESC);
CREATE INDEX drops_brand_phase ON drops(brand_id,phase,created_at DESC);
CREATE INDEX inventory_batches_brand_created ON inventory_batches(brand_id,created_at DESC);
