# WG Cleaning Rotation Bot

WhatsApp bot for managing a shared-flat (WG) cleaning schedule.

## Stack
- **Runtime** Node 20
- **WhatsApp** @whiskeysockets/baileys
- **Scheduler** node-cron
- **Database** PostgreSQL (pg)
- **Process manager** PM2

---

## Prerequisites

1. Node 20+ installed
2. PostgreSQL running (the `members` table must already exist and be populated — see below)
3. A WhatsApp account dedicated to the bot (a spare SIM is recommended)

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd wg-cleaning-bot
npm install
```

### 2. Configure

```bash
cp config.example.json config.json
```

Edit `config.json`:

| Field | Description |
|---|---|
| `groupJid` | WhatsApp group ID — see step 4 below |
| `rotationStartDates` | Dates from which rotation indices are calculated (YYYY-MM-DD) |
| `databaseUrl` | PostgreSQL connection string |

`config.json` is gitignored and never committed.

### 3. Create the database tables

The bot needs a PostgreSQL database with a `members` table that you manage separately:

```sql
CREATE TABLE IF NOT EXISTS members (
  id         NUMERIC PRIMARY KEY,  -- WhatsApp phone number (digits only, no +)
  name       TEXT    NOT NULL,
  roomnumber INT     NOT NULL,      -- 1–5, two members per room
  gender     CHAR(1) NOT NULL       -- 'm' or 'f'
);
```

Then populate it:

```bash
cp members_seed.example.sql members_seed.sql
# Edit members_seed.sql with real names and phone numbers
psql $DATABASE_URL -f members_seed.sql
```

> **Phone number format:** strip `+` and spaces — e.g. `+49 151 12345678` → `4915112345678`.
> WhatsApp Business accounts still use phone-number JIDs; no special handling needed.

Then run the bot's own migration (creates `rotation_state`, `task_log`, `miss_streak`):

```bash
npm run migrate
```

### 4. Find the group JID

The bot only listens in one configured group. To find its JID:

1. Start the bot: `node index.js` — scan the QR code when prompted
2. Add this temporary line inside the `messages.upsert` handler in `index.js`:
   ```js
   console.log('JID:', jid);
   ```
3. Send any message in your WhatsApp group — the JID prints to the terminal
4. Paste it into `config.json`, then remove the debug line

JIDs look like `12345678901234567890@g.us`.

### 5. Authenticate

```bash
node index.js
```

A QR code appears in the terminal. Open WhatsApp → **Linked Devices → Link a Device** and scan it.

Credentials are saved to `./auth_info/` (gitignored). Keep this directory private.

### 6. Run under PM2

```bash
npm install -g pm2
pm2 start index.js --name wg-bot
pm2 save
pm2 startup   # follow the printed command to enable autostart on reboot
```

---

## How rotation works

| Task | When | Cron |
|---|---|---|
| Kitchen — assign | Daily 8AM | `0 8 * * *` |
| Kitchen — reminder | Daily 8PM (if not done) | `0 20 * * *` |
| Full clean — assign | Saturday 10AM | `0 10 * * 6` |
| Full clean — reminder | Friday 8PM (if not done) | `0 20 * * 5` |
| Toilet — assign | Wednesday 9AM | `0 9 * * 3` |
| Toilet — reminder | Friday 8PM (if not done) | `5 20 * * 5` |

- **Kitchen** — all members ordered by `id`, one per day
- **Full clean** — the two members sharing each `roomnumber` are a pair; pairs rotate weekly and clean all common areas
- **Toilet** — separate weekly rotations for `gender = f` and `gender = m`
- Missing a duty 2+ times in a row triggers a callout in the group

## "done" command

Send `done` (case-insensitive) in the group. The bot checks whether you have an open duty and marks it complete, then announces who is next.

---

## File layout

```
index.js                   — WhatsApp connection & message router
scheduler.js               — cron job definitions
db.js                      — all database queries
tasks/
  kitchen.js               — daily kitchen logic
  fullclean.js             — weekly full clean logic
  toilet.js                — weekly toilet logic
config.example.json        — config template (copy to config.json)
config.json                — your local config (gitignored)
migration.sql              — creates bot-specific tables
migrate.js                 — runs migration.sql
members_seed.example.sql   — member insert template
members_seed.sql           — your local seed with real numbers (gitignored)
```
