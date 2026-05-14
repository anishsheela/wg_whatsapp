import pg from 'pg';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

const { Pool } = pg;

export function createPool() {
  return new Pool({ connectionString: config.databaseUrl });
}

const pool = createPool();

// ── members ──────────────────────────────────────────────────────────────────

export async function getAllMembers() {
  const { rows } = await pool.query('SELECT * FROM members ORDER BY id');
  return rows;
}

export async function getMembersByGender(gender) {
  const { rows } = await pool.query(
    'SELECT * FROM members WHERE gender = $1 ORDER BY id',
    [gender]
  );
  return rows;
}

export async function getMemberPairs() {
  // Returns [{roomnumber, members: [m1, m2]}, …] sorted by roomnumber
  const { rows } = await pool.query(
    'SELECT * FROM members ORDER BY roomnumber, id'
  );
  const rooms = {};
  for (const m of rows) {
    (rooms[m.roomnumber] ??= []).push(m);
  }
  return Object.entries(rooms)
    .sort(([a], [b]) => a - b)
    .map(([roomnumber, members]) => ({ roomnumber: Number(roomnumber), members }));
}

export async function getMemberById(id) {
  const { rows } = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// ── rotation state ────────────────────────────────────────────────────────────

export async function getRotationIdx(taskType) {
  const { rows } = await pool.query(
    'SELECT current_idx FROM rotation_state WHERE task_type = $1',
    [taskType]
  );
  return rows[0]?.current_idx ?? 0;
}

export async function advanceRotation(taskType, newIdx) {
  await pool.query(
    `INSERT INTO rotation_state (task_type, current_idx, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (task_type) DO UPDATE
       SET current_idx = $2, updated_at = NOW()`,
    [taskType, newIdx]
  );
}

// ── task log ──────────────────────────────────────────────────────────────────

export async function createTaskLog(taskType, assignedDate, memberIds) {
  const { rows } = await pool.query(
    `INSERT INTO task_log (task_type, assigned_date, member_ids)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [taskType, assignedDate, memberIds]
  );
  return rows[0];
}

export async function getOpenLog(taskType, assignedDate) {
  const { rows } = await pool.query(
    `SELECT * FROM task_log
     WHERE task_type = $1 AND assigned_date = $2 AND done = FALSE
     ORDER BY id DESC LIMIT 1`,
    [taskType, assignedDate]
  );
  return rows[0] ?? null;
}

export async function markDone(logId, doneByMemberId) {
  await pool.query(
    `UPDATE task_log
     SET done = TRUE, done_at = NOW(), done_by = $2
     WHERE id = $1`,
    [logId, doneByMemberId]
  );
}

export async function markReminded(logId) {
  await pool.query('UPDATE task_log SET reminded = TRUE WHERE id = $1', [logId]);
}

// ── miss streak ───────────────────────────────────────────────────────────────

export async function getStreak(memberId) {
  const { rows } = await pool.query(
    'SELECT streak FROM miss_streak WHERE member_id = $1',
    [memberId]
  );
  return rows[0]?.streak ?? 0;
}

export async function incrementStreak(memberId) {
  await pool.query(
    `INSERT INTO miss_streak (member_id, streak, updated_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (member_id) DO UPDATE
       SET streak = miss_streak.streak + 1, updated_at = NOW()`,
    [memberId]
  );
}

export async function resetStreak(memberId) {
  await pool.query(
    `INSERT INTO miss_streak (member_id, streak, updated_at)
     VALUES ($1, 0, NOW())
     ON CONFLICT (member_id) DO UPDATE
       SET streak = 0, updated_at = NOW()`,
    [memberId]
  );
}

export { pool };
