import {
  getMembersByGender,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
  getAnyOpenLog,
  markDone,
  markSkipped,
  markReminded,
  incrementStreak,
  resetStreak,
  getStreak,
} from '../db.js';
import { nearestDayDate } from '../utils.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../config.json');

const TASK_F = 'toilet_f';
const TASK_M = 'toilet_m';
const TASK = 'toilet';

// Set toilet rotation starting from one or two members.
// Pass a single name or "FemaleName,MaleName" to set both at once.
export async function setToiletStartingMember(nameOrNames) {
  const names = nameOrNames.split(',').map((n) => n.trim());
  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');

  for (const name of names) {
    const fIdx = females.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
    if (fIdx !== -1) { await advanceRotation(TASK_F, fIdx); continue; }

    const mIdx = males.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
    if (mIdx !== -1) { await advanceRotation(TASK_M, mIdx); continue; }

    throw new Error(`Member "${name}" not found in any toilet rotation`);
  }
}

export async function assignToilet(sock, groupJid, dayOfWeek) {
  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');

  const fIdx = await getRotationIdx(TASK_F);
  const mIdx = await getRotationIdx(TASK_M);

  const female = females[fIdx % females.length];
  const male = males[mIdx % males.length];
  const date = nearestDayDate(dayOfWeek ?? config.schedule.weeklyDay);

  // Store as a combined log with both members so "done" handling is unified.
  await createTaskLog(TASK, date, [female.id, male.id]);
  await advanceRotation(TASK_F, (fIdx + 1) % females.length);
  await advanceRotation(TASK_M, (mIdx + 1) % males.length);

  await sock.sendMessage(groupJid, {
    text: `🚻 *Toilet duty:*\nLadies → ${female.name}\nGents → ${male.name}\nReply *done* when your toilet is finished.`,
  });
}

export async function remindToilet(sock, groupJid) {
  const log = await getAnyOpenLog(TASK);
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
  const log = await getAnyOpenLog(TASK);
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

export async function hasDuty(senderJid) {
  const log = await getAnyOpenLog(TASK);
  if (!log) return false;
  const senderPhone = senderJid.split('@')[0];
  return log.member_ids.map(String).includes(senderPhone);
}

export async function handleTakeover(sock, groupJid, senderJid) {
  const log = await getAnyOpenLog(TASK);
  if (!log) return false;

  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);

  if (memberIds.includes(senderPhone)) {
    return handleDone(sock, groupJid, senderJid);
  }

  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');
  const taker = [...females, ...males].find((m) => String(m.id) === senderPhone);
  if (!taker) return false;

  await markDone(log.id, taker.id);
  await resetStreak(taker.id);

  const assignedNames = [...females, ...males]
    .filter((m) => memberIds.includes(String(m.id)))
    .map((m) => m.name)
    .join(' & ');

  const nextFIdx = await getRotationIdx(TASK_F);
  const nextMIdx = await getRotationIdx(TASK_M);
  const nextF = females[nextFIdx % females.length];
  const nextM = males[nextMIdx % males.length];

  await sock.sendMessage(groupJid, {
    text: `✅ Toilet done — ${taker.name} took over for ${assignedNames}! Thanks! Next week: Ladies → ${nextF.name}, Gents → ${nextM.name}.`,
  });
  return true;
}

export async function handleSkip(sock, groupJid, senderJid) {
  const log = await getAnyOpenLog(TASK);
  if (!log) return false;

  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);
  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');

  if (!memberIds.includes(senderPhone)) {
    const sender = [...females, ...males].find((m) => String(m.id) === senderPhone);
    await sock.sendMessage(groupJid, {
      text: `That's not your toilet duty to skip, ${sender?.name ?? senderPhone}.`,
    });
    return true;
  }

  // member_ids[0] is female, member_ids[1] is male (per assignToilet ordering)
  const isFemale = String(log.member_ids[0]) === senderPhone;
  const skipper = [...females, ...males].find((m) => String(m.id) === senderPhone);

  if (isFemale && females.length <= 1) {
    await sock.sendMessage(groupJid, {
      text: `Can't skip — you're the only one in the ladies toilet rotation!`,
    });
    return true;
  }
  if (!isFemale && males.length <= 1) {
    await sock.sendMessage(groupJid, {
      text: `Can't skip — you're the only one in the gents toilet rotation!`,
    });
    return true;
  }

  await markSkipped(log.id);

  // Replace only the skipping gender's slot; keep the other person's assignment.
  // The rotation index for the skipping gender was already advanced at original
  // assignment time, so it already points to the correct next person.
  const skipDate = log.assigned_date.toISOString
    ? log.assigned_date.toISOString().slice(0, 10)
    : String(log.assigned_date).slice(0, 10);

  if (isFemale) {
    const fIdx = await getRotationIdx(TASK_F);
    const newFemale = females[fIdx % females.length];
    const male = males.find((m) => String(m.id) === String(log.member_ids[1]));

    await createTaskLog(TASK, skipDate, [newFemale.id, male.id]);
    await advanceRotation(TASK_F, (fIdx + 1) % females.length);

    await sock.sendMessage(groupJid, {
      text: `🚻 *Toilet duty reassigned* (${skipper.name} skipped):\nLadies → ${newFemale.name}\nGents → ${male.name} (unchanged)\nReply *done* when your toilet is finished.`,
    });
  } else {
    const mIdx = await getRotationIdx(TASK_M);
    const newMale = males[mIdx % males.length];
    const female = females.find((f) => String(f.id) === String(log.member_ids[0]));

    await createTaskLog(TASK, skipDate, [female.id, newMale.id]);
    await advanceRotation(TASK_M, (mIdx + 1) % males.length);

    await sock.sendMessage(groupJid, {
      text: `🚻 *Toilet duty reassigned* (${skipper.name} skipped):\nLadies → ${female.name} (unchanged)\nGents → ${newMale.name}\nReply *done* when your toilet is finished.`,
    });
  }

  return true;
}

export async function closeToiletWeek(sock, groupJid, dayOfWeek) {
  const date = nearestDayDate(dayOfWeek ?? config.schedule.weeklyDay);
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
