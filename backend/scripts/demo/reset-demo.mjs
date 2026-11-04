#!/usr/bin/env node
// Puts the demo back to a clean state:
//   1. makes sure the demo logins exist, with their published password
//   2. restores every table to the saved snapshot plus fresh sample data,
//      removing anything visitors added and putting back anything they changed or deleted
//   3. does the same for uploaded document files
//
// Runs on a schedule from .github/workflows/demo-reset.yml. You can also run it
// yourself from the repo root: node backend/scripts/demo/reset-demo.mjs

import {
  api, TABLES, PRIMARY_KEYS, rowKey, STORAGE_BUCKET, SNAPSHOT_BUCKET,
  readTable, listStorageFiles, listAuthUsers, downloadFile, uploadFile,
} from '../lib/supabase-admin.mjs';
import { buildSampleData } from './sample-data.mjs';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../frontend/src/demoAccounts.js';

const snapshot = JSON.parse(new TextDecoder().decode(await downloadFile(SNAPSHOT_BUCKET, 'snapshot.json')));
console.log(`Resetting to snapshot saved ${snapshot.saved_at}`);

// 1. Demo logins
const existingUsers = await listAuthUsers();
const demoUserIds = {};
for (const account of DEMO_ACCOUNTS) {
  const existing = existingUsers.find((u) => (u.email || '').toLowerCase() === account.email);
  const credentials = { password: DEMO_PASSWORD, email_confirm: true };
  const user = existing
    ? await api(`/auth/v1/admin/users/${existing.id}`, { method: 'PUT', body: { ...credentials, ban_duration: 'none' } })
    : await api('/auth/v1/admin/users', { method: 'POST', body: { email: account.email, ...credentials } });
  demoUserIds[account.key] = user.id;
}
const demoProfiles = DEMO_ACCOUNTS.map((a) => ({
  user_id: demoUserIds[a.key], username: a.username, full_name: a.full_name,
  company_role: a.company_role, must_change_password: false, is_active: true,
}));
console.log(`Demo logins ready: ${DEMO_ACCOUNTS.map((a) => a.email).join(', ')}`);

// 2. Tables
const sample = buildSampleData(demoUserIds);

async function upsert(table, rows) {
  const onConflict = PRIMARY_KEYS[table].join(',');
  for (let i = 0; i < rows.length; i += 500) {
    await api(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows.slice(i, i + 500),
    });
  }
}

async function deleteRows(table, rows) {
  const keys = PRIMARY_KEYS[table];
  if (keys.length === 1) {
    const ids = rows.map((r) => r[keys[0]]);
    for (let i = 0; i < ids.length; i += 100) {
      const list = ids.slice(i, i + 100).map((v) => `"${v}"`).join(',');
      await api(`/rest/v1/${table}?${keys[0]}=in.(${list})`, { method: 'DELETE' });
    }
  } else {
    for (const row of rows) {
      const filter = keys.map((k) => `${k}=eq.${encodeURIComponent(row[k])}`).join('&');
      await api(`/rest/v1/${table}?${filter}`, { method: 'DELETE' });
    }
  }
}

for (const table of TABLES) {
  if (table === 'activity_logs') {
    // Remove log entries added since the snapshot (demo visitor activity).
    await api(`/rest/v1/activity_logs?log_id=gt.${snapshot.max_log_id}`, { method: 'DELETE' });
    continue;
  }

  const savedRows = snapshot.tables[table] || [];
  const sampleRows = table === 'profiles' ? demoProfiles : (sample[table] || []);
  const currentRows = await readTable(table);

  // Profiles are tied to login accounts, so never delete them; just restore names and roles.
  if (table !== 'profiles') {
    const wanted = new Set([...savedRows, ...sampleRows].map((r) => rowKey(table, r)));
    const extras = currentRows.filter((r) => !wanted.has(rowKey(table, r)));
    if (extras.length) {
      await deleteRows(table, extras);
      console.log(`${table}: removed ${extras.length} added row(s)`);
    }
  }

  // Only write rows that are missing or were changed, so untouched records keep
  // their original "updated at" times.
  const current = new Map(currentRows.map((r) => [rowKey(table, r), r]));
  const needsWrite = (row) => {
    const now = current.get(rowKey(table, row));
    // updated_at is skipped: the database sets it itself on every update.
    return !now || Object.keys(row).some((col) => col !== 'updated_at' && !sameValue(row[col], now[col]));
  };
  const changedSaved = savedRows.filter(needsWrite);
  const changedSample = sampleRows.filter(needsWrite);

  // Saved rows and sample rows have different columns, so send them separately.
  if (changedSaved.length) await upsert(table, changedSaved);
  if (changedSample.length) await upsert(table, changedSample);
  if (changedSaved.length) console.log(`${table}: restored ${changedSaved.length} changed or deleted row(s)`);
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  // Timestamps can come back in a slightly different format, so compare them as dates.
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (/\d{4}-\d{2}-\d{2}T/.test(a) && !Number.isNaN(ta) && ta === tb) return true;
  return String(a) === String(b);
}
console.log('Tables restored');

// 3. Uploaded files
const savedPaths = new Set(snapshot.files.map((f) => f.path));
const currentFiles = await listStorageFiles();
const currentPaths = new Set(currentFiles.map((f) => f.path));

const addedFiles = currentFiles.filter((f) => !savedPaths.has(f.path)).map((f) => f.path);
if (addedFiles.length) {
  await api(`/storage/v1/object/${STORAGE_BUCKET}`, { method: 'DELETE', body: { prefixes: addedFiles } });
  console.log(`Removed ${addedFiles.length} uploaded file(s)`);
}

let restoredFiles = 0;
for (const file of snapshot.files) {
  if (currentPaths.has(file.path)) continue;
  const bytes = await downloadFile(SNAPSHOT_BUCKET, `files/${file.path}`);
  await uploadFile(STORAGE_BUCKET, file.path, bytes, file.mimetype);
  restoredFiles += 1;
}
if (restoredFiles) console.log(`Restored ${restoredFiles} deleted file(s)`);

console.log('Demo reset complete');
