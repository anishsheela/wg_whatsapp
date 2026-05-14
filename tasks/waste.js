import {
  getAllMembers,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getLastLog,
  markDone,
  markReminded,
  getStreak,
  incrementStreak,
  resetStreak,
} from '../db.js';

const TASK = 'waste';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateStr(pgDate) {
  return new Date(pgDate).toISOString().slice(0, 10);
}

function daysSince(pgDate) {
  return Math.round((new Date(todayStr()) - new Date(dateStr(pgDate))) / 86400000);
}

export async function assignWaste(sock, groupJid, force = false) {
  if (!force) {
    const last = await getLastLog(TASK);
    if (last && daysSince(last.assigned_date) < 2) return; // not time yet
  }

  const members = await getAllMembers();
  const idx = await getRotationIdx(TASK);
  const member = members[idx % members.length];

  await createTaskLog(TASK, todayStr(), [member.id]);
  await advanceRotation(TASK, (idx + 1) % members.length);

  await sock.sendMessage(groupJid, {
    text: `🗑️ *Waste disposal today:* ${member.name}\nPlease take out the trash!\nReply *done* when finished.`,
  });
}

export async function remindWaste(sock, groupJid) {
  const log = await getLastLog(TASK);
  if (!log || log.done) return;

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return;

  await markReminded(log.id);
  await sock.sendMessage(groupJid, {
    text: `⏰ Reminder: ${assigned.name}, waste disposal hasn't been done yet! Reply *done*.`,
  });
}

export async function handleDone(sock, groupJid, senderJid) {
  const log = await getLastLog(TASK);
  if (!log || log.done) return false;

  const senderPhone = senderJid.split('@')[0];
  if (String(log.member_ids[0]) !== senderPhone) return false;

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return false;

  await markDone(log.id, assigned.id);
  await resetStreak(assigned.id);

  const nextIdx = await getRotationIdx(TASK);
  const next = members[nextIdx % members.length];

  await sock.sendMessage(groupJid, {
    text: `✅ Waste taken out — thanks ${assigned.name}! Next up in 2 days: ${next.name}.`,
  });
  return true;
}

export async function closeWasteDay(sock, groupJid) {
  const log = await getLastLog(TASK);
  if (!log || log.done) return;
  if (dateStr(log.assigned_date) >= todayStr()) return; // assigned today, still open

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return;

  await incrementStreak(assigned.id);
  const streak = await getStreak(assigned.id);

  if (streak >= 2) {
    await sock.sendMessage(groupJid, {
      text: `😤 ${assigned.name} has missed waste disposal ${streak} times in a row. Sort it out! 🙃`,
    });
  }
}

export async function setWasteStartingMember(memberName) {
  const members = await getAllMembers();
  const idx = members.findIndex((m) => m.name.toLowerCase() === memberName.toLowerCase());
  if (idx === -1) throw new Error(`Member "${memberName}" not found`);
  await advanceRotation(TASK, idx);
  return members[idx];
}
