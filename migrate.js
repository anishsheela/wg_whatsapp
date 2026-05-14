import { readFileSync } from 'fs';
import { createPool } from './db.js';

const pool = createPool();
const sql = readFileSync('./migration.sql', 'utf8');

await pool.query(sql);
console.log('Migration complete.');
await pool.end();
