ALTER TABLE reward_transactions DROP CONSTRAINT reward_transactions_receipt_id_type_key;
CREATE UNIQUE INDEX unique_return_earning ON reward_transactions(receipt_id,type) WHERE type IN ('return_base','material_bonus');
-- Keep release and correction references in the same workspace as their command.
CREATE FUNCTION guard_accounting_reference() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE workspace uuid; BEGIN
 IF TG_TABLE_NAME='allocation_releases' THEN SELECT d.workspace_id INTO workspace FROM drop_material_allocations a JOIN drops d ON d.id=a.drop_id WHERE a.id=NEW.allocation_id;
 ELSIF TG_TABLE_NAME='auxiliary_releases' THEN SELECT d.workspace_id INTO workspace FROM auxiliary_allocations a JOIN auxiliary_requirements r ON r.id=a.requirement_id JOIN drops d ON d.id=r.drop_id WHERE a.id=NEW.allocation_id;
 ELSIF TG_TABLE_NAME='production_cancellations' THEN SELECT d.workspace_id INTO workspace FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE p.id=NEW.production_run_id;IF NOT EXISTS(SELECT 1 FROM production_runs WHERE id=NEW.production_run_id AND status IN ('planned','approved')) THEN RAISE EXCEPTION 'Cannot cancel started or completed production'; END IF;
 ELSIF TG_TABLE_NAME='return_corrections' THEN SELECT r.workspace_id INTO workspace FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE rr.id=NEW.receipt_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_commands WHERE id=NEW.command_id AND workspace_id=workspace) THEN RAISE EXCEPTION 'Accounting command scope mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER release_scope BEFORE INSERT ON allocation_releases FOR EACH ROW EXECUTE FUNCTION guard_accounting_reference();
CREATE TRIGGER auxiliary_release_scope BEFORE INSERT ON auxiliary_releases FOR EACH ROW EXECUTE FUNCTION guard_accounting_reference();
CREATE TRIGGER production_cancellation_scope BEFORE INSERT ON production_cancellations FOR EACH ROW EXECUTE FUNCTION guard_accounting_reference();
CREATE TRIGGER return_correction_scope BEFORE INSERT ON return_corrections FOR EACH ROW EXECUTE FUNCTION guard_accounting_reference();
CREATE FUNCTION enforce_source_quality() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s material_sources; r drop_material_requirements; BEGIN
 SELECT s1.* INTO STRICT s FROM material_sources s1 JOIN material_movements m ON m.source_id=s1.id WHERE m.id=NEW.movement_id;
 SELECT * INTO STRICT r FROM drop_material_requirements WHERE id=NEW.requirement_id;
 IF s.composition NOT IN ('cotton_rich','cotton_blend') OR s.contamination_status<>'clean' OR s.panel_grade='fibre_only' OR NOT(s.quality_grade=ANY(r.accepted_grades)) THEN RAISE EXCEPTION 'Inspected source quality incompatible'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER allocation_quality BEFORE INSERT ON drop_material_allocations FOR EACH ROW EXECUTE FUNCTION enforce_source_quality();
CREATE FUNCTION validate_residual_origin() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original material_sources; residual material_sources; BEGIN
 SELECT s.* INTO STRICT original FROM effective_allocations e JOIN material_sources s ON s.id=e.source_id WHERE e.id=NEW.allocation_id;
 IF NEW.residual_source_id IS NOT NULL THEN SELECT * INTO STRICT residual FROM material_sources WHERE id=NEW.residual_source_id;
 IF residual.production_run_id<>NEW.production_run_id OR residual.source_type<>'residual_material' OR residual.workspace_id<>original.workspace_id OR residual.material_type<>original.material_type OR residual.quality_grade<>original.quality_grade OR residual.composition<>original.composition OR residual.contamination_status<>original.contamination_status THEN RAISE EXCEPTION 'Residual must preserve origin and inspection attributes'; END IF; END IF; RETURN NEW; END $$;
CREATE TRIGGER residual_origin BEFORE INSERT ON production_consumptions FOR EACH ROW EXECUTE FUNCTION validate_residual_origin();
