import {
  getKitchenMembers,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
} from '../db.js';

const TASK = 'kitchen';

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Assign today's kitchen person and advance the rotation.
// Idempotent for a given day: if today's duty is already assigned it returns
// the existing assignee without advancing, unless force is set. Sends no
// message — the daily duty list is announced once by sendDutyList().
export async function assignKitchen(force = false) {
  const date = today();

  if (!force) {
    const existing = await getOpenLog(TASK, date);
    if (existing) {
      const members = await getKitchenMembers();
      return members.find((m) => String(m.id) === String(existing.member_ids[0])) ?? null;
    }
  }

  const members = await getKitchenMembers();
  if (members.length === 0) return null;

  const idx = await getRotationIdx(TASK);
  const assigned = members[idx % members.length];

  await createTaskLog(TASK, date, [assigned.id]);
  await advanceRotation(TASK, (idx + 1) % members.length);

  return assigned;
}

// Set rotation so the next assignment starts from a specific member.
export async function setKitchenStartingMember(memberName) {
  const members = await getKitchenMembers();
  const idx = members.findIndex(
    (m) => m.name.toLowerCase() === memberName.toLowerCase()
  );
  if (idx === -1) throw new Error(`Member "${memberName}" not found in kitchen order`);
  await advanceRotation(TASK, idx);
  return members[idx];
}
