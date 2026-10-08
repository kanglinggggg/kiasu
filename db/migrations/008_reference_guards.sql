-- Retain the original receipt linkage on every reward reversal.
CREATE FUNCTION reward_reference_identity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original reward_transactions; BEGIN
 IF NEW.original_transaction_id IS NOT NULL THEN SELECT * INTO STRICT original FROM reward_transactions WHERE id=NEW.original_transaction_id;
 IF NEW.receipt_id IS DISTINCT FROM original.receipt_id OR NEW.user_id<>original.user_id THEN RAISE EXCEPTION 'Reversal must retain original earning reference'; END IF; END IF; RETURN NEW; END $$;
CREATE TRIGGER reward_reference_guard BEFORE INSERT ON reward_transactions FOR EACH ROW EXECUTE FUNCTION reward_reference_identity();
-- Recovered primary allocations cannot be increased after a run has been committed.
CREATE FUNCTION allocation_open_drop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM drops WHERE id=NEW.drop_id AND phase='market_test' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Drop material reservation is closed'; END IF; RETURN NEW; END $$;
CREATE TRIGGER allocation_open_guard BEFORE INSERT ON drop_material_allocations FOR EACH ROW EXECUTE FUNCTION allocation_open_drop();
