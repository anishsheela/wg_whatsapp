import cron from 'node-cron';
import { assignKitchen, remindKitchen, remindKitchenMorning, closeKitchenDay } from './tasks/kitchen.js';
import { assignFullClean, remindFullClean, closeFullCleanWeek } from './tasks/fullclean.js';
import { assignToilet, remindToilet, closeToiletWeek } from './tasks/toilet.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

export function startScheduler(sock) {
  const g = config.groupJid;
  const s = config.schedule;
  const tz = { timezone: 'Europe/Berlin' };

  // Day after the weekly day (for close/penalise jobs), wrapping Sun→Mon.
  const dayAfterWeekly = (s.weeklyDay + 1) % 7;

  // ── Kitchen ────────────────────────────────────────────────────────────────
  cron.schedule(`0 ${s.kitchenNotifyHour} * * *`,
    () => assignKitchen(sock, g).catch(console.error), tz);

  cron.schedule(`0 ${s.kitchenEveningReminderHour} * * *`,
    () => remindKitchen(sock, g).catch(console.error), tz);

  cron.schedule(`${s.kitchenMorningReminderMinute} ${s.kitchenMorningReminderHour} * * *`,
    () => remindKitchenMorning(sock, g).catch(console.error), tz);

  // Penalise at 11AM next day — gives the morning window to still get it done.
  cron.schedule('0 11 * * *',
    () => closeKitchenDay(sock, g).catch(console.error), tz);

  // ── Full Clean ─────────────────────────────────────────────────────────────
  cron.schedule(`0 ${s.fullCleanHour} * * ${s.weeklyDay}`,
    () => assignFullClean(sock, g).catch(console.error), tz);

  cron.schedule(`0 ${s.weeklyReminderHour} * * ${s.weeklyDay}`,
    () => remindFullClean(sock, g).catch(console.error), tz);

  cron.schedule(`0 0 * * ${dayAfterWeekly}`,
    () => closeFullCleanWeek(sock, g).catch(console.error), tz);

  // ── Toilet ─────────────────────────────────────────────────────────────────
  cron.schedule(`0 ${s.toiletHour} * * ${s.weeklyDay}`,
    () => assignToilet(sock, g).catch(console.error), tz);

  cron.schedule(`5 ${s.weeklyReminderHour} * * ${s.weeklyDay}`,
    () => remindToilet(sock, g).catch(console.error), tz);

  cron.schedule(`5 0 * * ${dayAfterWeekly}`,
    () => closeToiletWeek(sock, g).catch(console.error), tz);

  console.log(
    `Scheduler started. Weekly tasks on day ${s.weeklyDay} ` +
    `(fullclean ${s.fullCleanHour}:00, toilet ${s.toiletHour}:00, ` +
    `reminders ${s.weeklyReminderHour}:00).`
  );
}
