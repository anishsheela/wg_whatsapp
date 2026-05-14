import { pool } from '../db.js';
import { thisWeeklyDay } from '../utils.js';

export async function getStatusMessage() {
  const today = new Date().toISOString().slice(0, 10);
  const weeklyDay = thisWeeklyDay();

  const { rows } = await pool.query(`
    SELECT
      t.task_type,
      t.assigned_date,
      t.done,
      array_agg(m.name ORDER BY m.id) AS names
    FROM task_log t
    JOIN members m ON m.id = ANY(t.member_ids)
    WHERE
      (t.task_type = 'kitchen'  AND t.assigned_date = $1) OR
      (t.task_type = 'fullclean' AND t.assigned_date = $2) OR
      (t.task_type = 'toilet'   AND t.assigned_date = $2)
    GROUP BY t.id
    ORDER BY t.task_type
  `, [today, weeklyDay]);

  const { rows: wasteRows } = await pool.query(`
    SELECT t.assigned_date, t.done, m.name
    FROM task_log t
    JOIN members m ON m.id = t.member_ids[1]
    WHERE t.task_type = 'waste'
    ORDER BY t.id DESC LIMIT 1
  `);

  const byType = Object.fromEntries(rows.map((r) => [r.task_type, r]));

  const fmt = (row) => (row ? (row.done ? '✅' : '⏳') : '—');
  const names = (row) => (row ? row.names.join(' & ') : 'not assigned yet');

  const kitchen  = byType['kitchen'];
  const full     = byType['fullclean'];
  const toilet   = byType['toilet'];
  const waste    = wasteRows[0] ?? null;

  // For toilet, names[0] = female (ordered by id), names[1] = male
  const toiletLine = toilet
    ? `🚻 Toilet: Ladies → ${toilet.names[0]}, Gents → ${toilet.names[1]} ${fmt(toilet)}`
    : `🚻 Toilet: not assigned yet`;

  const wasteLine = waste
    ? `🗑️ Waste (${waste.assigned_date.toISOString().slice(0, 10)}): ${waste.name} ${fmt(waste)}`
    : `🗑️ Waste: not assigned yet`;

  return [
    `*📋 Current duties:*`,
    `🍳 Kitchen (today): ${names(kitchen)} ${fmt(kitchen)}`,
    `🧹 Full clean (this week): ${names(full)} ${fmt(full)}`,
    toiletLine,
    wasteLine,
  ].join('\n');
}
