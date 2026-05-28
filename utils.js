import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

// Returns the YYYY-MM-DD of the nearest occurrence of the given day of week
// (today if today matches, otherwise the next occurrence).
export function nearestDayDate(targetDay) {
  const d = new Date();
  const diff = (targetDay - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function thisWeeklyDay() {
  return nearestDayDate(config.schedule.weeklyDay);
}
