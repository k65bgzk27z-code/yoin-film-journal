// Convert dot's export JSON into D1 import SQL.
// Usage: node import-sql.mjs export.json > import.sql
// Expected export shape (tolerant):
//   { "films": [{"id": "...", "body": "..." or {...}, "revision": 1}, ...],
//     "enrichment_snapshots": [{"id": "...", "body": "..." or {...}, "revision": 1}, ...] }
import fs from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: node import-sql.mjs <export.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const esc = v => "'" + String(v).replaceAll("'", "''") + "'";
function rowsOf(tableData, table) {
  if (!Array.isArray(tableData)) return [];
  return tableData.map(r => {
    const id = r.id;
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    const revision = Number.isInteger(r.revision) ? r.revision : 1;
    if (typeof id !== 'string' || !id) throw new Error(table + ': row without id');
    return `INSERT OR REPLACE INTO ${table} (id, body, revision) VALUES (${esc(id)}, ${esc(body)}, ${revision});`;
  });
}

const films = rowsOf(data.films, 'films');
const snaps = rowsOf(data.enrichment_snapshots, 'enrichment_snapshots');
console.error(`films: ${films.length}, enrichment_snapshots: ${snaps.length}`);

// Note: no explicit BEGIN TRANSACTION / COMMIT — D1 (wrangler d1 execute)
// rejects explicit transaction statements. The statements are applied as one
// file, and INSERT OR REPLACE is idempotent, so a re-run is safe.
const all = [
  ...films.map(s => s),
  ...snaps.map(s => s),
];
console.log(all.join('\n'));
