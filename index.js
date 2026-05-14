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
import { handleDone as kitchenDone } from './tasks/kitchen.js';
import { handleDone as fullcleanDone } from './tasks/fullclean.js';
import { handleDone as toiletDone } from './tasks/toilet.js';

const require = createRequire(import.meta.url);
const config = require('./config.json');

const logger = pino({ level: 'silent' }); // suppress Baileys internal noise

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // we print it ourselves for clarity
  });

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
      startScheduler(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (jid !== config.groupJid) continue; // only listen in the configured group

      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim().toLowerCase();

      if (text !== 'done') continue;

      const sender = msg.key.participant ?? jid; // participant is set in group messages

      // Try each task handler in order; stop at first match.
      const handled =
        (await kitchenDone(sock, jid, sender).catch(logErr)) ||
        (await fullcleanDone(sock, jid, sender).catch(logErr)) ||
        (await toiletDone(sock, jid, sender).catch(logErr));

      if (!handled) {
        await sock.sendMessage(jid, {
          text: `You don't have an open duty right now, ${sender.split('@')[0]}.`,
        });
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
