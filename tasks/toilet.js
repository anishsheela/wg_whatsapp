import {
  getMembersByGender,
  getRotationIdx,
  advanceRotation,
  createTaskLog,
  getOpenLog,
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

// Assign the toilet duty for the given weekday and advance both rotations.
// Idempotent for that day: if it's already assigned it returns the standing
// assignees without advancing, unless force is set. Sends no message.
export async function assignToilet(dayOfWeek, force = false) {
  const date = nearestDayDate(dayOfWeek ?? config.schedule.weeklyDay);
  const females = await getMembersByGender('f');
  const males = await getMembersByGender('m');

  if (!force) {
    const existing = await getOpenLog(TASK, date);
    if (existing) {
      const all = [...females, ...males];
      return {
        female: all.find((m) => String(m.id) === String(existing.member_ids[0])) ?? null,
        male: all.find((m) => String(m.id) === String(existing.member_ids[1])) ?? null,
      };
    }
  }

  const fIdx = await getRotationIdx(TASK_F);
  const mIdx = await getRotationIdx(TASK_M);

  const female = females[fIdx % females.length];
  const male = males[mIdx % males.length];

  await createTaskLog(TASK, date, [female.id, male.id]);
  await advanceRotation(TASK_F, (fIdx + 1) % females.length);
  await advanceRotation(TASK_M, (mIdx + 1) % males.length);

  return { female, male };
}
