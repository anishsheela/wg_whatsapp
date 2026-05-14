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
import { getMemberByLid, getMemberByName, setMemberLid, getMemberById } from './db.js';
import { getStatusMessage } from './tasks/status.js';

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

// WhatsApp groups now use LIDs (@lid) instead of phone numbers (@s.whatsapp.net).
// On first contact we match by pushName and store the LID for future lookups.
async function resolveToPhoneJid(senderJid, pushName) {
  if (!senderJid.endsWith('@lid')) return senderJid; // already a phone JID

  const lid = senderJid.split('@')[0];

  let member = await getMemberByLid(lid);
  if (member) return `${member.id}@s.whatsapp.net`;

  // Bootstrap: match by display name and persist the LID.
  if (pushName) {
    member = await getMemberByName(pushName);
    if (member) {
      await setMemberLid(member.id, lid);
      console.log(`Mapped LID ${lid} → ${member.name} (${member.id})`);
      return `${member.id}@s.whatsapp.net`;
    }
  }

  return null; // unknown sender
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
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
      startScheduler(namedSock(sock));
    }
  });

  const bot = namedSock(sock);

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

      const rawSender = msg.key.participant ?? jid;

      if (text === 'today') {
        const status = await getStatusMessage().catch(logErr);
        if (status) await bot.sendMessage(jid, { text: status });
        continue;
      }

      // Registration: "register <name>" links this sender's LID to a member.
      if (text.startsWith('register ')) {
        const nameArg = text.slice(9).trim();
        const member = await getMemberByName(nameArg).catch(() => null);
        if (!member) {
          await bot.sendMessage(jid, { text: `❌ No member named "${nameArg}" found.` });
          continue;
        }
        const lid = rawSender.split('@')[0];
        await setMemberLid(member.id, lid).catch(logErr);
        await bot.sendMessage(jid, { text: `✅ Registered! I'll recognise you as ${member.name} from now on.` });
        continue;
      }

      if (text !== 'done') continue;

      const phoneJid = await resolveToPhoneJid(rawSender, msg.pushName).catch(logErr);

      if (!phoneJid) {
        await bot.sendMessage(jid, {
          text: `I don't recognise you yet. Please send: *register YourName*\nExample: register Anish`,
        });
        continue;
      }

      const handled =
        (await kitchenDone(bot, jid, phoneJid).catch(logErr)) ||
        (await fullcleanDone(bot, jid, phoneJid).catch(logErr)) ||
        (await toiletDone(bot, jid, phoneJid).catch(logErr));

      if (!handled) {
        const phone = phoneJid.split('@')[0];
        const member = await getMemberById(phone).catch(() => null);
        const name = member?.name ?? phone;
        await bot.sendMessage(jid, {
          text: `You don't have an open duty right now, ${name}.`,
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
