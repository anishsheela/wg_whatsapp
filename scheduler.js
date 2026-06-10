import cron from 'node-cron';
import { assignKitchen } from './tasks/kitchen.js';
import { assignToilet } from './tasks/toilet.js';
import { sendDutyList } from './tasks/status.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

// Rotate today's duties and announce the day's duty list in one message.
// Toilet is (re)assigned only on its scheduled days; on other days the
// standing weekly assignment is shown.
async function announceDailyDuties(sock, groupJid, s) {
  await assignKitchen();

  const day = new Date().getDay();
  if (day === s.weeklyDay || day === s.toilet2Day) {
    await assignToilet(day);
  }

  await sendDutyList(sock, groupJid);
}

export function startScheduler(sock) {
  const g = config.groupJid;
  const s = config.schedule;
  const tz = { timezone: 'Europe/Berlin' };

  // Daily duty list at 8 AM.
  cron.schedule(`0 ${s.kitchenNotifyHour} * * *`,
    () => announceDailyDuties(sock, g, s).catch(console.error), tz);

  console.log(
    `Scheduler started. Daily duty list at ${s.kitchenNotifyHour}:00. ` +
    `Toilet rotates on days ${s.weeklyDay} and ${s.toilet2Day}.`
  );
}
