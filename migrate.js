import { readFileSync } from 'fs';
import { createPool } from './db.js';

// Defaults to the schema migration; pass a path to run a one-off, e.g.
//   node migrate.js migration_2026-06_notify_only.sql
const file = process.argv[2] ?? './migration.sql';

const pool = createPool();
const sql = readFileSync(file, 'utf8');

await pool.query(sql);
console.log(`Migration complete: ${file}`);
await pool.end();
