ALTER TABLE auxiliary_sources ADD CHECK((origin='simulated_supplier' AND production_run_id IS NULL) OR (origin='production_residual' AND production_run_id IS NOT NULL));
CREATE FUNCTION guard_auxiliary_source_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.origin='production_residual' AND NOT EXISTS(SELECT 1 FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE p.id=NEW.production_run_id AND p.status='in_production' AND d.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Auxiliary residual requires matching active production'; END IF;
 IF NEW.command_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_commands WHERE id=NEW.command_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Auxiliary command scope mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER auxiliary_source_origin BEFORE INSERT ON auxiliary_sources FOR EACH ROW EXECUTE FUNCTION guard_auxiliary_source_origin();
CREATE FUNCTION guard_auxiliary_residual_identity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original auxiliary_sources; residual auxiliary_sources; BEGIN
 IF NEW.residual_source_id IS NOT NULL THEN
 SELECT s.* INTO STRICT original FROM auxiliary_sources s JOIN auxiliary_allocations a ON a.source_id=s.id WHERE a.id=NEW.allocation_id;
 SELECT * INTO STRICT residual FROM auxiliary_sources WHERE id=NEW.residual_source_id;
 IF residual.production_run_id<>NEW.production_run_id OR residual.origin<>'production_residual' OR residual.component<>original.component OR residual.unit<>original.unit OR residual.mass_per_unit_kg<>original.mass_per_unit_kg OR residual.workspace_id<>original.workspace_id THEN RAISE EXCEPTION 'Auxiliary residual identity mismatch'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER auxiliary_residual_identity BEFORE INSERT ON auxiliary_consumptions FOR EACH ROW EXECUTE FUNCTION guard_auxiliary_residual_identity();
CREATE TRIGGER production_no_delete BEFORE DELETE ON production_runs FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
