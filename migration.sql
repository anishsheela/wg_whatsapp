-- Creates all tables including members.

CREATE TABLE IF NOT EXISTS members (
  id         NUMERIC PRIMARY KEY,
  name       TEXT    NOT NULL,
  roomnumber INT     NOT NULL,
  gender     CHAR(1) NOT NULL
);

-- Bot-specific tables only. Do NOT modify the existing `members` table.

-- Tracks the current rotation index and last assignment for each task type.
CREATE TABLE IF NOT EXISTS rotation_state (
  task_type   TEXT PRIMARY KEY,   -- 'kitchen' | 'fullclean' | 'toilet_f' | 'toilet_m'
  current_idx INT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialise rows so UPSERTs work from day one.
INSERT INTO rotation_state (task_type, current_idx)
VALUES
  ('kitchen',  0),
  ('fullclean', 0),
  ('toilet_f',  0),
  ('toilet_m',  0)
ON CONFLICT (task_type) DO NOTHING;

-- One row per assignment instance (a "duty").
CREATE TABLE IF NOT EXISTS task_log (
  id            BIGSERIAL PRIMARY KEY,
  task_type     TEXT        NOT NULL,
  assigned_date DATE        NOT NULL,            -- the canonical day/week the duty belongs to
  member_ids    NUMERIC[]   NOT NULL,             -- one or two member ids
  done          BOOLEAN     NOT NULL DEFAULT FALSE,
  done_at       TIMESTAMPTZ,
  done_by       NUMERIC,                          -- member id who sent "done"
  reminded      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_log_type_date ON task_log (task_type, assigned_date);

-- Counts consecutive misses per member (reset to 0 on completion).
CREATE TABLE IF NOT EXISTS miss_streak (
  member_id   NUMERIC PRIMARY KEY,
  streak      INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
