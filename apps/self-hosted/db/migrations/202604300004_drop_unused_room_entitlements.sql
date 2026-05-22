-- migrate:up
DROP INDEX IF EXISTS room_entitlements_kind_idx;
DROP INDEX IF EXISTS room_entitlements_room_id_idx;
DROP TABLE IF EXISTS room_entitlements;

-- migrate:down
