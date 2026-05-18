import {
  getMemberPairs,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
  markDone,
  markSkipped,
  markReminded,
  incrementStreak,
  resetStreak,
  getStreak,
} from '../db.js';
import { thisWeeklyDay } from '../utils.js';

const TASK = 'fullclean';

// Set rotation so the next assignment starts from the pair containing memberName.
export async function setFullCleanStartingMember(memberName) {
  const pairs = await getMemberPairs();
  const idx = pairs.findIndex((p) =>
    p.members.some((m) => m.name.toLowerCase() === memberName.toLowerCase())
  );
  if (idx === -1) throw new Error(`No pair found containing member "${memberName}"`);
  await advanceRotation(TASK, idx);
  return pairs[idx];
}

export async function assignFullClean(sock, groupJid) {
  const pairs = await getMemberPairs();
  const idx = await getRotationIdx(TASK);
  const pair = pairs[idx % pairs.length];
  const date = thisWeeklyDay();

  await createTaskLog(TASK, date, pair.members.map((m) => m.id));
  await advanceRotation(TASK, idx + 1);

  const names = pair.members.map((m) => m.name).join(' & ');
  await sock.sendMessage(groupJid, {
    text: `🧹 *Full clean today:* ${names}\nPlease clean all common areas.\nEither of you can reply *done* when finished.`,
  });
}

export async function remindFullClean(sock, groupJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return;

  await markReminded(log.id);
  await sock.sendMessage(groupJid, {
    text: `⏰ Reminder: Saturday full clean hasn't been marked done yet! Reply *done*.`,
  });
}

export async function handleDone(sock, groupJid, senderJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return false;

  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);

  if (!memberIds.includes(senderPhone)) return false;

  const donorId = log.member_ids[memberIds.indexOf(senderPhone)];
  await markDone(log.id, donorId);

  for (const id of log.member_ids) {
    await resetStreak(id);
  }

  const pairs = await getMemberPairs();
  const nextIdx = await getRotationIdx(TASK);
  const nextNames = pairs[nextIdx % pairs.length].members.map((m) => m.name).join(' & ');

  await sock.sendMessage(groupJid, {
    text: `✅ Full clean done — great work! Next week: ${nextNames}.`,
  });
  return true;
}

export async function hasDuty(senderJid) {
  const log = await getOpenLog(TASK, thisWeeklyDay());
  if (!log) return false;
  const senderPhone = senderJid.split('@')[0];
  return log.member_ids.map(String).includes(senderPhone);
}

export async function handleTakeover(sock, groupJid, senderJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return false;

  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);

  if (memberIds.includes(senderPhone)) {
    return handleDone(sock, groupJid, senderJid);
  }

  const pairs = await getMemberPairs();
  const allMembers = pairs.flatMap((p) => p.members);
  const taker = allMembers.find((m) => String(m.id) === senderPhone);
  if (!taker) return false;

  await markDone(log.id, taker.id);
  await resetStreak(taker.id);

  const assignedNames = allMembers
    .filter((m) => memberIds.includes(String(m.id)))
    .map((m) => m.name)
    .join(' & ');

  const nextIdx = await getRotationIdx(TASK);
  const nextNames = pairs[nextIdx % pairs.length].members.map((m) => m.name).join(' & ');

  await sock.sendMessage(groupJid, {
    text: `✅ Full clean done — ${taker.name} took over for ${assignedNames}! Thanks! Next week: ${nextNames}.`,
  });
  return true;
}

export async function handleSkip(sock, groupJid, senderJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return false;

  const pairs = await getMemberPairs();
  const senderPhone = senderJid.split('@')[0];
  const memberIds = log.member_ids.map(String);

  if (!memberIds.includes(senderPhone)) {
    const allMembers = pairs.flatMap((p) => p.members);
    const sender = allMembers.find((m) => String(m.id) === senderPhone);
    await sock.sendMessage(groupJid, {
      text: `That's not your full clean duty to skip, ${sender?.name ?? senderPhone}.`,
    });
    return true;
  }

  if (pairs.length <= 1) {
    await sock.sendMessage(groupJid, {
      text: `Can't skip — there's only one pair in the full clean rotation!`,
    });
    return true;
  }

  const assignedNames = pairs
    .flatMap((p) => p.members)
    .filter((m) => memberIds.includes(String(m.id)))
    .map((m) => m.name)
    .join(' & ');

  await markSkipped(log.id);
  await sock.sendMessage(groupJid, { text: `${assignedNames} have skipped full clean duty.` });
  await assignFullClean(sock, groupJid);
  return true;
}

export async function closeFullCleanWeek(sock, groupJid) {
  const date = thisWeeklyDay();
  const log = await getOpenLog(TASK, date);
  if (!log) return;

  for (const id of log.member_ids) {
    await incrementStreak(id);
    const streak = await getStreak(id);
    if (streak >= 2) {
      const pairs = await getMemberPairs();
      const pair = pairs.find((p) => p.members.some((m) => String(m.id) === String(id)));
      if (pair) {
        const names = pair.members.map((m) => m.name).join(' & ');
        await sock.sendMessage(groupJid, {
          text: `😤 ${names} have missed full clean duty ${streak} times in a row. 🙃`,
        });
      }
    }
  }
}
