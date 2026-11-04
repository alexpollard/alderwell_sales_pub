#!/usr/bin/env node
// Saves the current real data as the state the demo resets back to.
//
// Run this once to set up the demo, and again any time you change the data
// yourself and want the change kept. Anything not in the snapshot gets removed
// by the next reset.
//
// The snapshot goes to a private Supabase storage bucket (not GitHub), because
// it contains real names and emails. Sample rows and demo-visitor activity logs
// are not saved; the reset re-creates the sample rows with fresh dates.
//
// Usage (from the repo root): node backend/scripts/demo/save-snapshot.mjs

import {
  api, TABLES, PRIMARY_KEYS, STORAGE_BUCKET, SNAPSHOT_BUCKET,
  readTable, listStorageFiles, downloadFile, uploadFile,
} from '../lib/supabase-admin.mjs';
import { SAMPLE_ID_PREFIX } from './sample-data.mjs';

const isSampleRow = (table, row) =>
  PRIMARY_KEYS[table].some((col) => String(row[col] ?? '').startsWith(SAMPLE_ID_PREFIX));

// Create the private bucket the first time.
const buckets = await api('/storage/v1/bucket');
if (!buckets.some((b) => b.id === SNAPSHOT_BUCKET)) {
  await api('/storage/v1/bucket', { method: 'POST', body: { id: SNAPSHOT_BUCKET, name: SNAPSHOT_BUCKET, public: false } });
  console.log(`Created private bucket "${SNAPSHOT_BUCKET}"`);
}

const snapshot = { saved_at: new Date().toISOString(), tables: {}, files: [] };

for (const table of TABLES) {
  const rows = await readTable(table);
  if (table === 'activity_logs') {
    // Only the newest id is needed: the reset removes log entries added after it.
    snapshot.max_log_id = rows.reduce((max, r) => Math.max(max, r.log_id), 0);
    console.log(`activity_logs: keeping entries up to id ${snapshot.max_log_id}`);
    continue;
  }
  snapshot.tables[table] = rows.filter((row) => !isSampleRow(table, row));
  console.log(`${table}: ${snapshot.tables[table].length} rows`);
}

// Copy every uploaded document into the snapshot bucket so deleted files can be put back.
const files = await listStorageFiles();
for (const file of files) {
  const bytes = await downloadFile(STORAGE_BUCKET, file.path);
  await uploadFile(SNAPSHOT_BUCKET, `files/${file.path}`, bytes, file.mimetype);
}
snapshot.files = files;
console.log(`uploaded files: ${files.length}`);

const json = new TextEncoder().encode(JSON.stringify(snapshot));
await uploadFile(SNAPSHOT_BUCKET, 'snapshot.json', json, 'application/json');
console.log('\nSnapshot saved. The demo will now reset to this state.');
