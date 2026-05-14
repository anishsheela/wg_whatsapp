import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

// Returns the YYYY-MM-DD of the nearest occurrence of the configured weekly day
// (today if today matches, otherwise the next occurrence).
export function thisWeeklyDay() {
  const target = config.schedule.weeklyDay; // 0=Sun … 6=Sat
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
