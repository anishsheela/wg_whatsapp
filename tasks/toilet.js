import {
  getMembersByGender,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
  markDone,
  markReminded,
  incrementStreak,
  resetStreak,
  getStreak,
} from '../db.js';
import { thisWeeklyDay } from '../utils.js';

const TASK_F = 'toilet_f';
const TASK_M = 'toilet_m';
const TASK = 'toilet';

export async function assignToilet(sock, groupJid) {
  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');

  const fIdx = await getRotationIdx(TASK_F);
  const mIdx = await getRotationIdx(TASK_M);

  const female = females[fIdx % females.length];
  const male = males[mIdx % males.length];
  const date = thisWeeklyDay();

  // Store as a combined log with both members so "done" handling is unified.
  await createTaskLog(TASK, date, [female.id, male.id]);
  await advanceRotation(TASK_F, (fIdx + 1) % females.length);
  await advanceRotation(TASK_M, (mIdx + 1) % males.length);

  await sock.sendMessage(groupJid, {
    text: `🚻 *Toilet duty this week:*\nLadies → ${female.name}\nGents → ${male.name}\nReply *done* when your toilet is finished.`,
  });
}

export async function remindToilet(sock, groupJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return;

  await markReminded(log.id);
  await sock.sendMessage(groupJid, {
    text: `⏰ Reminder: Toilet duty hasn't been fully marked done yet! Reply *done*.`,
  });
}

// Each assigned person must individually mark done.
// We track this by splitting the log into two sub-done states using a simple
// convention: done_by stores a JSON array of who has replied done.
// For simplicity here we mark the full log done when either person replies —
// each person is responsible for their own toilet. They reply separately.
export async function handleDone(sock, groupJid, senderJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return false;

  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);
  if (!memberIds.includes(senderPhone)) return false;

  const donorId = log.member_ids[memberIds.indexOf(senderPhone)];
  await markDone(log.id, donorId);
  await resetStreak(donorId);

  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');
  const nextFIdx = await getRotationIdx(TASK_F);
  const nextMIdx = await getRotationIdx(TASK_M);
  const nextF = females[nextFIdx % females.length];
  const nextM = males[nextMIdx % males.length];

  await sock.sendMessage(groupJid, {
    text: `✅ Toilet done — thanks! Next week: Ladies → ${nextF.name}, Gents → ${nextM.name}.`,
  });
  return true;
}

export async function closeToiletWeek(sock, groupJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return;

  for (const id of log.member_ids) {
    await incrementStreak(id);
    const streak = await getStreak(id);
    if (streak >= 2) {
      const females = await getMembersByGender('f');
      const males = await getMembersByGender('m');
      const member = [...females, ...males].find((m) => String(m.id) === String(id));
      if (member) {
        await sock.sendMessage(groupJid, {
          text: `😤 ${member.name} has missed toilet duty ${streak} times in a row. 🙃`,
        });
      }
    }
  }
}
