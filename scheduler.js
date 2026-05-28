import cron from 'node-cron';
import { assignKitchen, remindKitchen, remindKitchenMorning, closeKitchenDay } from './tasks/kitchen.js';
import { assignFullClean, remindFullClean, closeFullCleanWeek } from './tasks/fullclean.js';
import { assignToilet, remindToilet, closeToiletWeek } from './tasks/toilet.js';
import { assignWaste, remindWaste, closeWasteDay } from './tasks/waste.js';
import { getStatusMessage } from './tasks/status.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

export function startScheduler(sock) {
  const g = config.groupJid;
  const s = config.schedule;
  const tz = { timezone: 'Europe/Berlin' };

  // Day after the weekly day (for close/penalise jobs), wrapping Sun→Mon.
  const dayAfterWeekly = (s.weeklyDay + 1) % 7;
  const dayAfterToilet2 = (s.toilet2Day + 1) % 7;

  // ── Daily status ───────────────────────────────────────────────────────────
  // Fires 5 min after the kitchen/waste assign jobs so DB is already populated.
  cron.schedule(`5 ${s.kitchenNotifyHour} * * *`,
    async () => {
      try {
        const msg = await getStatusMessage();
        await sock.sendMessage(g, { text: msg });
      } catch (err) { console.error(err); }
    }, tz);

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

  // ── Toilet (primary — weeklyDay) ───────────────────────────────────────────
  cron.schedule(`0 ${s.toiletHour} * * ${s.weeklyDay}`,
    () => assignToilet(sock, g, s.weeklyDay).catch(console.error), tz);

  cron.schedule(`5 ${s.weeklyReminderHour} * * ${s.weeklyDay}`,
    () => remindToilet(sock, g).catch(console.error), tz);

  cron.schedule(`5 0 * * ${dayAfterWeekly}`,
    () => closeToiletWeek(sock, g, s.weeklyDay).catch(console.error), tz);

  // ── Toilet (second day — toilet2Day) ───────────────────────────────────────
  cron.schedule(`0 ${s.toilet2Hour} * * ${s.toilet2Day}`,
    () => assignToilet(sock, g, s.toilet2Day).catch(console.error), tz);

  cron.schedule(`5 ${s.weeklyReminderHour} * * ${s.toilet2Day}`,
    () => remindToilet(sock, g).catch(console.error), tz);

  cron.schedule(`10 0 * * ${dayAfterToilet2}`,
    () => closeToiletWeek(sock, g, s.toilet2Day).catch(console.error), tz);

  // ── Waste ──────────────────────────────────────────────────────────────────
  // assignWaste skips internally if < 2 days since last assignment.
  cron.schedule(`0 ${s.wasteNotifyHour} * * *`,
    () => assignWaste(sock, g).catch(console.error), tz);

  cron.schedule(`0 ${s.wasteReminderHour} * * *`,
    () => remindWaste(sock, g).catch(console.error), tz);

  cron.schedule('10 11 * * *',
    () => closeWasteDay(sock, g).catch(console.error), tz);

  console.log(
    `Scheduler started. Weekly tasks on day ${s.weeklyDay} ` +
    `(fullclean ${s.fullCleanHour}:00, toilet ${s.toiletHour}:00, ` +
    `reminders ${s.weeklyReminderHour}:00). ` +
    `Second toilet day: ${s.toilet2Day} at ${s.toilet2Hour}:00. ` +
    `Daily status at ${s.kitchenNotifyHour}:05.`
  );
}
