import http from 'http';
import { assignKitchen, setKitchenStartingMember } from './tasks/kitchen.js';
import { assignToilet, setToiletStartingMember } from './tasks/toilet.js';
import { sendDutyList } from './tasks/status.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

const PORT = config.triggerPort ?? 3099;

const HANDLERS = {
  'assign/kitchen': async (bot, g, from) => {
    if (from) await setKitchenStartingMember(from);
    await assignKitchen(true);
    await sendDutyList(bot, g);
  },
  'assign/toilet': async (bot, g, from) => {
    if (from) await setToiletStartingMember(from);
    await assignToilet(config.schedule.weeklyDay, true);
    await sendDutyList(bot, g);
  },
  'duties': (bot, g) => sendDutyList(bot, g),
};

export function startTriggerServer(bot) {
  const g = config.groupJid;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end('POST only'); return;
    }

    const url = new URL(req.url, `http://localhost`);
    const key = url.pathname.replace(/^\//, '');
    const from = url.searchParams.get('from') ?? null;
    const handler = HANDLERS[key];

    if (!handler) {
      res.writeHead(404);
      res.end(`Unknown trigger "${key}". Valid: ${Object.keys(HANDLERS).join(', ')}`);
      return;
    }

    try {
      await handler(bot, g, from);
      res.writeHead(200); res.end('OK');
    } catch (err) {
      console.error('Trigger error:', err);
      res.writeHead(500); res.end(String(err));
    }
  });

  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Trigger server listening on localhost:${PORT}`)
  );
}
