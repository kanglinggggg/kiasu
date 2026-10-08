ALTER TABLE allocation_releases DROP CONSTRAINT allocation_releases_allocation_id_command_id_key;
-- The command primary key is the request idempotency boundary. A single cascade may
-- append an explicit partial release and then release the remaining reservation.
CREATE INDEX releases_original_command ON allocation_releases(allocation_id,command_id);
