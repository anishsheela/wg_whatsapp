# Karyasthan 🧹

WhatsApp cleaning rotation bot for a shared flat (WG). Manages daily kitchen duty and weekly full clean + toilet rotations, sends reminders, and calls out repeat offenders.

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
| `rotationStartDates` | YYYY-MM-DD dates from which rotation indices are calculated |
| `schedule` | Notification times — see table below |
| `databaseUrl` | PostgreSQL connection string |
| `triggerPort` | Port for the internal trigger server (default: `3099`) |

**Schedule fields:**

| Field | Default | Description |
|---|---|---|
| `kitchenNotifyHour` | `8` | Daily kitchen assignment (8AM) |
| `kitchenEveningReminderHour` | `22` | Evening reminder if not done (10PM) |
| `kitchenMorningReminderHour` | `10` | Next-morning reminder hour (10AM) |
| `kitchenMorningReminderMinute` | `30` | Next-morning reminder minute (10:30AM) |
| `weeklyDay` | `6` | Day for full clean + toilet (0=Sun … 6=Sat) |
| `fullCleanHour` | `10` | Full clean notification hour |
| `toiletHour` | `11` | Toilet notification hour |
| `weeklyReminderHour` | `22` | Weekly reminder hour (same day evening) |
| `wasteNotifyHour` | `8` | Waste disposal assignment hour |
| `wasteReminderHour` | `22` | Waste disposal reminder hour |

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

Two members must share each `roomnumber` (1–5) — they are paired for weekly full clean.

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

## Member registration

WhatsApp groups now use LIDs (privacy IDs) instead of phone numbers. Each member must register once so Karyasthan can identify them:

Send in the group:
```
register YourName
```

Example: `register Maya` → Karyasthan replies ✅ and remembers you permanently.

Names must match exactly (case-insensitive) what's in the `members` table.

---

## Group commands

| Command | What it does |
|---|---|
| `help` | List all commands |
| `done` | Mark your current duty as complete |
| `today` | Show all current duty assignments and their status |
| `register <name>` | Link your WhatsApp account to your member record (once per person) |
| `takeover <task>` | Do a task on behalf of the assigned person — you get the credit |
| `skip <task>` | Skip your duty; you move to the end of the rotation and the next person is assigned immediately |

Valid task names for `takeover` and `skip`: `kitchen`, `fullclean`, `toilet`, `waste`.

**Examples:**
```
takeover kitchen     — you cleaned the kitchen for whoever was assigned
skip toilet          — you can't do toilet this week; next person is assigned now
```

---

## How rotation works

| Task | Day | Time | Cron |
|---|---|---|---|
| Kitchen assign | Daily | 8AM | `0 8 * * *` |
| Kitchen reminder (evening) | Daily | 10PM | `0 22 * * *` |
| Kitchen reminder (morning) | Daily | 10:30AM | `30 10 * * *` |
| Kitchen close / penalise | Daily | 11AM | `0 11 * * *` |
| Full clean assign | Saturday | 10AM | `0 10 * * 6` |
| Toilet assign | Saturday | 11AM | `0 11 * * 6` |
| Weekly reminder | Saturday | 10PM | `0 22 * * 6` |
| Weekly close / penalise | Sunday | Midnight | `0 0 * * 0` |
| Waste assign | Daily* | 8AM | `0 8 * * *` |
| Waste reminder | Daily | 10PM | `0 22 * * *` |
| Waste close / penalise | Daily | 11AM | `0 11 * * *` |

\* Waste cron runs daily but only sends a notification every 2 days — it silently skips if fewer than 2 days have passed since the last assignment.

- **Kitchen** — all members ordered by `id`, one per day
- **Full clean** — the two members sharing each `roomnumber` are paired; pairs rotate weekly and clean all common areas
- **Toilet** — separate weekly rotations for `gender = f` and `gender = m`
- **Waste** — all members ordered by `id`, one person every 2 days
- Missing a duty 2+ times in a row triggers a group callout 🙃

---

## Manual triggers (GitHub Actions)

Go to **Actions → Trigger notification → Run workflow** and choose:

| Input | Options | Description |
|---|---|---|
| `action` | `assign` / `remind` | Send the duty assignment or a reminder nudge |
| `task` | `kitchen` / `fullclean` / `toilet` / `waste` | Which task to trigger |
| `start_from` | Member name(s) — optional | Set rotation starting point before assigning (see below) |

**`start_from` behaviour per task:**

| Task | Example | Effect |
|---|---|---|
| `kitchen` | `Maya` | Starts kitchen rotation from Maya |
| `fullclean` | `Maya` | Finds the pair containing Maya and starts from them |
| `toilet` | `Leah` | Sets ladies rotation to start from Leah |
| `toilet` | `Tom` | Sets gents rotation to start from Tom |
| `toilet` | `Leah,Tom` | Sets both rotations at once |

Leave `start_from` blank to continue in the current rotation order.

Or trigger directly on the server:

```bash
# Assign kitchen starting from Maya
curl -s -X POST 'localhost:3099/assign/kitchen?from=Maya'

# Assign fullclean starting from Maya's pair
curl -s -X POST 'localhost:3099/assign/fullclean?from=Maya'

# Assign toilet starting from specific people
curl -s -X POST 'localhost:3099/assign/toilet?from=Leah,Tom'

# Send a reminder for toilet
curl -s -X POST 'localhost:3099/remind/toilet'
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
  kitchen.js               — Daily kitchen logic (done / takeover / skip)
  fullclean.js             — Weekly full clean logic (done / takeover / skip)
  toilet.js                — Weekly toilet logic (done / takeover / skip, per-gender)
  waste.js                 — Waste disposal logic (done / takeover / skip)
  status.js                — "today" command query
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
