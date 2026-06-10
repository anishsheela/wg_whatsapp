# Karyasthan 🧹

WhatsApp cleaning rotation bot for a shared flat (WG). Each morning at 8 AM it
announces the day's duties — daily kitchen plus the standing weekly toilet
rotation. It is notify-only: it does not track completion, send reminders, or
call out misses.

## Stack
- **Runtime** Node 20
- **WhatsApp** @whiskeysockets/baileys
- **Scheduler** node-cron
- **Database** PostgreSQL (pg)
- **Process manager** systemd (NixOS) / PM2

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd karyasthan
npm install
```

### 2. Configure

```bash
cp config.example.json config.json
```

Edit `config.json`:

| Field | Description |
|---|---|
| `groupJid` | WhatsApp group ID — see step 5 below |
| `botName` | Display name prefixed to every message (default: `Karyasthan`) |
| `kitchenOrder` | Member names, in the exact daily kitchen-duty order |
| `schedule` | Notification times — see table below |
| `databaseUrl` | PostgreSQL connection string |
| `triggerPort` | Port for the internal trigger server (default: `3099`) |

**Schedule fields:**

| Field | Default | Description |
|---|---|---|
| `kitchenNotifyHour` | `8` | Hour the daily duty list is sent (8AM) |
| `weeklyDay` | `6` | Primary toilet rotation day (0=Sun … 6=Sat) |
| `toilet2Day` | `3` | Second toilet rotation day |

`config.json` is gitignored and never committed.

### 3. Create database tables

The bot expects a PostgreSQL database. Run the migrations — they create `members`, `rotation_state`, `task_log`, and `miss_streak`:

```bash
npm run migrate
```

### 4. Seed members

```bash
cp members_seed.example.sql members_seed.sql
# Edit members_seed.sql — fill in real names and phone numbers
psql $DATABASE_URL -f members_seed.sql
```

> **Phone number format:** strip `+` and spaces — e.g. `+49 151 12345678` → `4915112345678`.
> This is used as the member `id` and must match the WhatsApp JID local part.
> WhatsApp Business accounts still use phone-number JIDs.

The kitchen rotation order is set by `kitchenOrder` in `config.json`, not by the
table. Toilet rotation uses `gender` (`f`/`m`).

### 5. Find the group JID

1. Start the bot: `node index.js` — scan the QR code when prompted
2. Temporarily add `console.log('JID:', jid)` inside the `messages.upsert` handler in `index.js`
3. Send any message in the WhatsApp group — the JID prints to the console
4. Paste it into `config.json`, remove the debug line

JIDs look like `120363XXXXXXXXXX@g.us`.

### 6. Authenticate

```bash
node index.js
```

A QR code appears in the terminal. Open WhatsApp → **Linked Devices → Link a Device** and scan it.

Credentials are saved to `./auth_info/` (gitignored). Keep this directory private and persistent.

### 7. Run under PM2

```bash
npm install -g pm2
pm2 start index.js --name karyasthan
pm2 save
pm2 startup
```

---

## Group commands

| Command | What it does |
|---|---|
| `today` / `duties` | Re-send today's duty list |

Karyasthan is notify-only — there is no `done`, `takeover`, `skip`, or
`register`. It simply announces who is on duty.

---

## How rotation works

| Task | When | Cron |
|---|---|---|
| Daily duty list | Every day at 8AM | `0 8 * * *` |

The single 8 AM job rotates the kitchen, (re)assigns toilet on its days, and
sends one combined message.

- **Kitchen** — one person per day, in the order set by `kitchenOrder` in `config.json`
- **Toilet** — separate rotations for `gender = f` and `gender = m`, reassigned on `weeklyDay` and `toilet2Day`; the standing assignees are shown every day

---

## Manual triggers (GitHub Actions)

Go to **Actions → Trigger notification → Run workflow** and choose:

| Input | Options | Description |
|---|---|---|
| `action` | `assign` / `duties` | Rotate + announce a task, or just re-send today's list |
| `task` | `kitchen` / `toilet` | Which task to assign (ignored for `duties`) |
| `start_from` | Member name(s) — optional | Set rotation starting point before assigning (see below) |

**`start_from` behaviour per task:**

| Task | Example | Effect |
|---|---|---|
| `kitchen` | `Maya` | Starts kitchen rotation from Maya |
| `toilet` | `Leah` | Sets ladies rotation to start from Leah |
| `toilet` | `Tom` | Sets gents rotation to start from Tom |
| `toilet` | `Leah,Tom` | Sets both rotations at once |

Leave `start_from` blank to continue in the current rotation order.

Or trigger directly on the server:

```bash
# Assign kitchen starting from Maya, then announce the duty list
curl -s -X POST 'localhost:3099/assign/kitchen?from=Maya'

# Assign toilet starting from specific people
curl -s -X POST 'localhost:3099/assign/toilet?from=Leah,Tom'

# Just re-send today's duty list
curl -s -X POST 'localhost:3099/duties'
```

---

## Deployment (GitHub Actions)

Push to `main` triggers an automatic deploy:
1. Rsyncs all JS files to `/var/lib/wg-cleaning-bot/` on the server
2. Runs `npm ci --omit=dev`
3. Restarts the systemd service

**Required GitHub secrets:**

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_KEY` | Private SSH key (contents of `~/.ssh/id_ed25519`) |
| `DEPLOY_HOST_KEY` | Server host key (from `ssh-keyscan your.server`) |

`config.json` and `auth_info/` are never touched by the deploy.

---

## File layout

```
index.js                   — WhatsApp connection, message router, trigger server
scheduler.js               — All cron job definitions
db.js                      — All database queries
trigger.js                 — Internal HTTP server for manual/CI triggers
utils.js                   — Shared helpers (thisWeeklyDay)
tasks/
  kitchen.js               — Daily kitchen rotation (config-ordered)
  toilet.js                — Toilet rotation (per-gender)
  status.js                — Builds and sends the duty list
config.example.json        — Config template (copy to config.json)
config.json                — Your local config (gitignored)
migration.sql              — Creates all tables and applies schema changes
migrate.js                 — Runs migration.sql
members_seed.example.sql   — Member insert template
members_seed.sql           — Your seed with real numbers (gitignored)
.github/workflows/
  deploy.yml               — Auto-deploy on push to main
  trigger.yml              — Manual notification trigger
```
