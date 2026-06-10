import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { createRequire } from 'module';

import { startScheduler } from './scheduler.js';
import { getStatusMessage } from './tasks/status.js';
import { startTriggerServer } from './trigger.js';

const require = createRequire(import.meta.url);
const config = require('./config.json');

const logger = pino({ level: 'silent' });

function namedSock(sock) {
  const prefix = `${config.botName}:`;
  return new Proxy(sock, {
    get(target, prop) {
      if (prop !== 'sendMessage') return target[prop];
      return (jid, content, options) => {
        if (typeof content.text === 'string') {
          content = { ...content, text: `${prefix} ${content.text}` };
        }
        return target.sendMessage(jid, content, options);
      };
    },
  });
}

let schedulerStarted = false;

// The Baileys socket is replaced on every reconnect. The scheduler and trigger
// server are started only once, so they must not capture a specific socket —
// they get this stable handle that always forwards to the *current* one.
// (Capturing the first socket was the bug behind "8 AM message never arrived,
// but `today` still works": cron held a dead socket after the first reconnect.)
let activeBot = null;
const liveBot = new Proxy({}, {
  get(_t, prop) {
    if (!activeBot) throw new Error('WhatsApp socket not connected yet');
    const value = activeBot[prop];
    return typeof value === 'function' ? value.bind(activeBot) : value;
  },
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  const bot = namedSock(sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('Connection closed, reason:', code, '— reconnecting:', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    }

    if (connection === 'open') {
      console.log('Connected to WhatsApp.');
      activeBot = bot; // point the stable handle at the live socket
      if (!schedulerStarted) {
        schedulerStarted = true;
        startScheduler(liveBot);
        startTriggerServer(liveBot);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (jid !== config.groupJid) continue;

      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim().toLowerCase();

      // Read-only: anyone can ask for the current duty list.
      if (text === 'today' || text === 'duties') {
        const status = await getStatusMessage().catch(logErr);
        if (status) await bot.sendMessage(jid, { text: status });
      }
    }
  });

  return sock;
}

function logErr(err) {
  console.error(err);
  return false;
}

connectToWhatsApp();
