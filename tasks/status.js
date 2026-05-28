import { pool, getAnyOpenLog } from '../db.js';
import { thisWeeklyDay } from '../utils.js';

export async function getStatusMessage() {
  const today = new Date().toISOString().slice(0, 10);
  const weeklyDay = thisWeeklyDay();

  const { rows } = await pool.query(`
    SELECT
      t.task_type,
      t.assigned_date,
      t.done,
      array_agg(m.name ORDER BY array_position(t.member_ids, m.id)) AS names
    FROM task_log t
    JOIN members m ON m.id = ANY(t.member_ids)
    WHERE
      (t.task_type = 'kitchen'   AND t.assigned_date = $1) OR
      (t.task_type = 'fullclean' AND t.assigned_date = $2)
    GROUP BY t.id
    ORDER BY t.task_type
  `, [today, weeklyDay]);

  const [wasteRow, toiletLog] = await Promise.all([
    pool.query(`
      SELECT t.assigned_date, t.done, m.name
      FROM task_log t
      JOIN members m ON m.id = t.member_ids[1]
      WHERE t.task_type = 'waste'
      ORDER BY t.id DESC LIMIT 1
    `).then((r) => r.rows[0] ?? null),
    getAnyOpenLog('toilet'),
  ]);

  // For toilet members we need names; fetch them separately if there's an open log.
  let toiletNames = null;
  if (toiletLog) {
    const { rows: tNames } = await pool.query(`
      SELECT m.name FROM members m
      WHERE m.id = ANY($1)
      ORDER BY array_position($1, m.id)
    `, [toiletLog.member_ids]);
    toiletNames = tNames.map((r) => r.name);
  }

  const byType = Object.fromEntries(rows.map((r) => [r.task_type, r]));

  const fmt = (row) => (row ? (row.done ? '✅' : '⏳') : '—');
  const names = (row) => (row ? row.names.join(' & ') : 'not assigned yet');

  const kitchen = byType['kitchen'];
  const full    = byType['fullclean'];

  // For toilet, toiletNames[0] = female, toiletNames[1] = male (per assignToilet ordering)
  const toiletLine = toiletLog && toiletNames
    ? `🚻 Toilet: Ladies → ${toiletNames[0]}, Gents → ${toiletNames[1]} ${fmt(toiletLog)}`
    : `🚻 Toilet: not assigned yet`;

  const wasteLine = wasteRow
    ? `🗑️ Waste (${wasteRow.assigned_date.toISOString().slice(0, 10)}): ${wasteRow.name} ${fmt(wasteRow)}`
    : `🗑️ Waste: not assigned yet`;

  return [
    `*📋 Current duties:*`,
    `🍳 Kitchen (today): ${names(kitchen)} ${fmt(kitchen)}`,
    `🧹 Full clean (this week): ${names(full)} ${fmt(full)}`,
    toiletLine,
    wasteLine,
  ].join('\n');
}
