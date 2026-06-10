import { pool, getAnyOpenLog } from '../db.js';

export async function getStatusMessage() {
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(`
    SELECT array_agg(m.name ORDER BY array_position(t.member_ids, m.id)) AS names
    FROM task_log t
    JOIN members m ON m.id = ANY(t.member_ids)
    WHERE t.task_type = 'kitchen' AND t.assigned_date = $1
    GROUP BY t.id
    ORDER BY t.id DESC
    LIMIT 1
  `, [today]);

  const kitchen = rows[0] ? rows[0].names.join(' & ') : 'not assigned yet';

  const toiletLog = await getAnyOpenLog('toilet');
  let toiletLine = '🚻 Toilet: not assigned yet';
  if (toiletLog) {
    const { rows: tNames } = await pool.query(`
      SELECT m.name FROM members m
      WHERE m.id = ANY($1)
      ORDER BY array_position($1, m.id)
    `, [toiletLog.member_ids]);
    const names = tNames.map((r) => r.name);
    toiletLine = `🚻 Toilet — Ladies: ${names[0]}, Gents: ${names[1]}`;
  }

  return [
    `*📋 Today's duties:*`,
    `🍳 Kitchen: ${kitchen}`,
    toiletLine,
  ].join('\n');
}

export async function sendDutyList(sock, groupJid) {
  const msg = await getStatusMessage();
  await sock.sendMessage(groupJid, { text: msg });
}
