import {
  getAllMembers,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
  markDone,
  markSkipped,
  markReminded,
  getStreak,
  incrementStreak,
  resetStreak,
} from '../db.js';

const TASK = 'kitchen';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function assignKitchen(sock, groupJid) {
  const members = await getAllMembers();
  const idx = await getRotationIdx(TASK);
  const assigned = members[idx % members.length];
  const date = today();

  await createTaskLog(TASK, date, [assigned.id]);
  await advanceRotation(TASK, (idx + 1) % members.length);

  await sock.sendMessage(groupJid, {
    text: `🍳 *Kitchen duty today:* ${assigned.name}\nReply *done* when finished.`,
  });
}

export async function remindKitchen(sock, groupJid) {
  const date = today();
  const log = await getOpenLog(TASK, date);
  if (!log) return; // already done

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return;

  await markReminded(log.id);
  await sock.sendMessage(groupJid, {
    text: `⏰ Reminder: ${assigned.name}, kitchen duty isn't marked done yet! Reply *done*.`,
  });
}

// Called when someone sends "done" in the group.
// Returns true if the message was handled.
export async function handleDone(sock, groupJid, senderJid) {
  // Accept "done" for today's duty or yesterday's (morning catch-up).
  const log =
    (await getOpenLog(TASK, today())) ||
    (await getOpenLog(TASK, yesterday()));
  if (!log) return false;

  const members = await getAllMembers();
  const senderPhone = senderJid.split('@')[0];
  const assigned = members.find((m) => String(log.member_ids[0]) === String(m.id));
  if (!assigned) return false;

  // Check if the sender is the assigned person. We match by stored phone/id.
  // The bot relies on the JID's local part matching member.id (numeric phone).
  if (senderPhone !== String(assigned.id)) return false;

  await markDone(log.id, assigned.id);
  await resetStreak(assigned.id);

  // Determine who's next for the group message.
  const allMembers = await getAllMembers();
  const nextIdx = await getRotationIdx(TASK);
  const next = allMembers[nextIdx % allMembers.length];

  await sock.sendMessage(groupJid, {
    text: `✅ Kitchen done — thanks ${assigned.name}! Next up: ${next.name} tomorrow.`,
  });
  return true;
}

// Morning reminder — checks yesterday's duty (assigned previous 8AM).
export async function remindKitchenMorning(sock, groupJid) {
  const log = await getOpenLog(TASK, yesterday());
  if (!log) return;

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return;

  await sock.sendMessage(groupJid, {
    text: `⏰ Morning reminder: ${assigned.name}, kitchen duty still isn't marked done! Reply *done*.`,
  });
}

export async function handleTakeover(sock, groupJid, senderJid) {
  const log =
    (await getOpenLog(TASK, today())) ||
    (await getOpenLog(TASK, yesterday()));
  if (!log) return false;

  const members = await getAllMembers();
  const senderPhone = senderJid.split('@')[0];
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));

  if (assigned && senderPhone === String(assigned.id)) {
    return handleDone(sock, groupJid, senderJid);
  }

  const taker = members.find((m) => String(m.id) === senderPhone);
  if (!taker) return false;

  await markDone(log.id, taker.id);
  await resetStreak(taker.id);

  const nextIdx = await getRotationIdx(TASK);
  const next = members[nextIdx % members.length];

  await sock.sendMessage(groupJid, {
    text: `✅ Kitchen done — ${taker.name} took over for ${assigned?.name ?? 'the assigned person'}! Thanks! Next up: ${next.name} tomorrow.`,
  });
  return true;
}

export async function handleSkip(sock, groupJid, senderJid) {
  const log =
    (await getOpenLog(TASK, today())) ||
    (await getOpenLog(TASK, yesterday()));
  if (!log) return false;

  const members = await getAllMembers();
  const senderPhone = senderJid.split('@')[0];
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));

  if (!assigned || senderPhone !== String(assigned.id)) {
    const sender = members.find((m) => String(m.id) === senderPhone);
    await sock.sendMessage(groupJid, {
      text: `That's not your kitchen duty to skip, ${sender?.name ?? senderPhone}.`,
    });
    return true;
  }

  if (members.length <= 1) {
    await sock.sendMessage(groupJid, {
      text: `Can't skip — you're the only one in the kitchen rotation!`,
    });
    return true;
  }

  await markSkipped(log.id);
  await sock.sendMessage(groupJid, { text: `${assigned.name} has skipped kitchen duty.` });
  await assignKitchen(sock, groupJid);
  return true;
}

// Set rotation so the next assignment starts from a specific member.
export async function setKitchenStartingMember(memberName) {
  const members = await getAllMembers();
  const idx = members.findIndex(
    (m) => m.name.toLowerCase() === memberName.toLowerCase()
  );
  if (idx === -1) throw new Error(`Member "${memberName}" not found`);
  await advanceRotation(TASK, idx);
  return members[idx];
}

// Runs at 11AM — checks yesterday's log to give time for a morning clean.
export async function closeKitchenDay(sock, groupJid) {
  const date = yesterday();
  const log = await getOpenLog(TASK, date);
  if (!log) return; // was completed

  const members = await getAllMembers();
  const assigned = members.find((m) => String(m.id) === String(log.member_ids[0]));
  if (!assigned) return;

  await incrementStreak(assigned.id);
  const streak = await getStreak(assigned.id);

  if (streak >= 2) {
    await sock.sendMessage(groupJid, {
      text: `😤 ${assigned.name} has missed kitchen duty ${streak} times in a row. Sort it out! 🙃`,
    });
  }
}
