import {
  getKitchenMembers,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
} from '../db.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../config.json');

const TASK = 'kitchen';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(startDate, endDate) {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// A one-off catch-up sequence that takes precedence over the normal rotation
// for a fixed window of days, after which the usual rotation resumes. Configured
// via config.kitchenOverride = { startDate: "YYYY-MM-DD", order: [names...] }.
// Returns the member assigned for `date`, or null if no override applies.
function pickOverride(date, members) {
  const ov = config.kitchenOverride;
  if (!ov?.startDate || !Array.isArray(ov.order)) return null;

  const offset = daysBetween(ov.startDate, date);
  if (offset < 0 || offset >= ov.order.length) return null;

  const name = ov.order[offset];
  const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!member) {
    console.warn(`kitchenOverride: no member named "${name}" — falling back to rotation`);
    return null;
  }
  return member;
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

  // During the override window, assign the fixed catch-up person and leave the
  // rotation pointer untouched so the usual order resumes cleanly afterwards.
  const override = pickOverride(date, members);
  if (override) {
    await createTaskLog(TASK, date, [override.id]);
    return override;
  }

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
