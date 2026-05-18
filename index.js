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
import { handleDone as kitchenDone, hasDuty as kitchenHasDuty, handleTakeover as kitchenTakeover, handleSkip as kitchenSkip } from './tasks/kitchen.js';
import { handleDone as fullcleanDone, hasDuty as fullcleanHasDuty, handleTakeover as fullcleanTakeover, handleSkip as fullcleanSkip } from './tasks/fullclean.js';
import { handleDone as toiletDone, hasDuty as toiletHasDuty, handleTakeover as toiletTakeover, handleSkip as toiletSkip } from './tasks/toilet.js';
import { handleDone as wasteDone, hasDuty as wasteHasDuty, handleTakeover as wasteTakeover, handleSkip as wasteSkip } from './tasks/waste.js';
import { getMemberByLid, getMemberByName, setMemberLid, getMemberById } from './db.js';
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

let schedulerStarted = false;

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
      if (!schedulerStarted) {
        schedulerStarted = true;
        startScheduler(bot);
        startTriggerServer(bot);
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

      const rawSender = msg.key.participant ?? jid;

      if (text === 'help') {
        await bot.sendMessage(jid, {
          text: [
            `*Commands:*`,
            ``,
            `*today* — show current duty status`,
            ``,
            `*done* — mark your assigned duty as done (if you have multiple open duties, you'll be asked to specify)`,
            `*done <task>* — mark a specific duty as done`,
            ``,
            `*takeover <task>* — do a task on behalf of the assigned person`,
            `*takeover kitchen* | *takeover fullclean* | *takeover toilet* | *takeover waste*`,
            ``,
            `*skip <task>* — skip your duty; you move to the end of the rotation and the next person is assigned immediately`,
            `*skip kitchen* | *skip fullclean* | *skip toilet* | *skip waste*`,
            ``,
            `*register <name>* — link your WhatsApp account to your name (first-time setup)`,
          ].join('\n'),
        });
        continue;
      }

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

      const isDone = text === 'done' || text.startsWith('done ');
      const isTakeover = text.startsWith('takeover ');
      const isSkip = text.startsWith('skip ');

      if (!isDone && !isTakeover && !isSkip) continue;

      const phoneJid = await resolveToPhoneJid(rawSender, msg.pushName).catch(logErr);

      if (!phoneJid) {
        await bot.sendMessage(jid, {
          text: `I don't recognise you yet. Please send: *register YourName*\nExample: register Anish`,
        });
        continue;
      }

      const taskHandlers = {
        kitchen:  { done: kitchenDone,   hasDuty: kitchenHasDuty,   takeover: kitchenTakeover,   skip: kitchenSkip   },
        fullclean:{ done: fullcleanDone, hasDuty: fullcleanHasDuty, takeover: fullcleanTakeover, skip: fullcleanSkip },
        toilet:   { done: toiletDone,    hasDuty: toiletHasDuty,    takeover: toiletTakeover,    skip: toiletSkip    },
        waste:    { done: wasteDone,     hasDuty: wasteHasDuty,     takeover: wasteTakeover,     skip: wasteSkip     },
      };

      if (isDone) {
        const taskKey = text === 'done' ? '' : text.slice(5).trim();

        if (taskKey) {
          const entry = taskHandlers[taskKey];
          if (!entry) {
            await bot.sendMessage(jid, {
              text: `Unknown task. Try: *done kitchen*, *done toilet*, *done fullclean*, or *done waste*.`,
            });
            continue;
          }
          const handled = await entry.done(bot, jid, phoneJid).catch(logErr);
          if (!handled) {
            await bot.sendMessage(jid, { text: `You're not assigned to ${taskKey} duty right now.` });
          }
        } else {
          const openTasks = (await Promise.all(
            Object.entries(taskHandlers).map(async ([key, entry]) => {
              const has = await entry.hasDuty(phoneJid).catch(() => false);
              return has ? key : null;
            })
          )).filter(Boolean);

          if (openTasks.length === 0) {
            const phone = phoneJid.split('@')[0];
            const member = await getMemberById(phone).catch(() => null);
            await bot.sendMessage(jid, {
              text: `You don't have an open duty right now, ${member?.name ?? phone}.`,
            });
          } else if (openTasks.length === 1) {
            await taskHandlers[openTasks[0]].done(bot, jid, phoneJid).catch(logErr);
          } else {
            const options = openTasks.map((t) => `*done ${t}*`).join(', ');
            await bot.sendMessage(jid, {
              text: `You have multiple open duties. Which one did you finish? ${options}`,
            });
          }
        }
        continue;
      }

      if (isTakeover) {
        const taskKey = text.slice(9).trim();
        const entry = taskHandlers[taskKey];
        if (!entry) {
          await bot.sendMessage(jid, {
            text: `Unknown task. Try: *takeover kitchen*, *takeover toilet*, *takeover fullclean*, or *takeover waste*.`,
          });
          continue;
        }
        const handled = await entry.takeover(bot, jid, phoneJid).catch(logErr);
        if (!handled) {
          await bot.sendMessage(jid, { text: `No open ${taskKey} duty to take over right now.` });
        }
        continue;
      }

      if (isSkip) {
        const taskKey = text.slice(5).trim();
        const entry = taskHandlers[taskKey];
        if (!entry) {
          await bot.sendMessage(jid, {
            text: `Unknown task. Try: *skip kitchen*, *skip toilet*, *skip fullclean*, or *skip waste*.`,
          });
          continue;
        }
        const handled = await entry.skip(bot, jid, phoneJid).catch(logErr);
        if (!handled) {
          await bot.sendMessage(jid, { text: `No open ${taskKey} duty to skip right now.` });
        }
        continue;
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
