import http from 'http';
import { assignKitchen, remindKitchen, setKitchenStartingMember } from './tasks/kitchen.js';
import { assignFullClean, remindFullClean, setFullCleanStartingMember } from './tasks/fullclean.js';
import { assignToilet, remindToilet, setToiletStartingMember } from './tasks/toilet.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('./config.json');

const PORT = config.triggerPort ?? 3099;

const HANDLERS = {
  'assign/kitchen':  (bot, g, from) => from
    ? setKitchenStartingMember(from).then(() => assignKitchen(bot, g))
    : assignKitchen(bot, g),
  'assign/fullclean': (bot, g, from) => from
    ? setFullCleanStartingMember(from).then(() => assignFullClean(bot, g))
    : assignFullClean(bot, g),
  'assign/toilet':    (bot, g, from) => from
    ? setToiletStartingMember(from).then(() => assignToilet(bot, g))
    : assignToilet(bot, g),
  'remind/kitchen':   (bot, g) => remindKitchen(bot, g),
  'remind/fullclean': (bot, g) => remindFullClean(bot, g),
  'remind/toilet':    (bot, g) => remindToilet(bot, g),
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
