-- Data migration for the "notify-only" rework (June 2026).
-- Safe to run once against the existing production database. Schema is
-- unchanged; this only fixes member data and rotation pointers.

BEGIN;

-- Anna has moved out.
DELETE FROM members WHERE name = 'Anna';

-- Kitchen rotation is now driven by config.kitchenOrder (Nandhana first), so
-- the stored index must restart at 0 to line up with that list.
UPDATE rotation_state SET current_idx = 0, updated_at = NOW()
WHERE task_type = 'kitchen';

-- Retired rotations — no longer assigned.
DELETE FROM rotation_state WHERE task_type IN ('fullclean', 'waste');

COMMIT;
