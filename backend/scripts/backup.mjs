#!/usr/bin/env node
// Saves a full copy of the database tables, login accounts and uploaded files
// to backups/<date-time>/ in the repo folder. That folder is git-ignored.
//
// Usage (from the repo root): node backend/scripts/backup.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  api, repoRoot, TABLES, STORAGE_BUCKET, readTable, listStorageFiles, listAuthUsers, encodeStoragePath,
} from './lib/supabase-admin.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(repoRoot, 'backups', stamp);
mkdirSync(path.join(outDir, 'tables'), { recursive: true });

const summary = { created_at: new Date().toISOString(), tables: {}, auth_users: 0, files: 0 };

for (const table of TABLES) {
  const rows = await readTable(table);
  writeFileSync(path.join(outDir, 'tables', `${table}.json`), JSON.stringify(rows, null, 2));
  summary.tables[table] = rows.length;
  console.log(`${table}: ${rows.length} rows`);
}

const users = await listAuthUsers();
const userInfo = users.map((u) => ({
  id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
  user_metadata: u.user_metadata, app_metadata: u.app_metadata,
}));
writeFileSync(path.join(outDir, 'auth_users.json'), JSON.stringify(userInfo, null, 2));
summary.auth_users = users.length;
console.log(`login accounts: ${users.length}`);

const files = await listStorageFiles();
for (const file of files) {
  const response = await api(`/storage/v1/object/${STORAGE_BUCKET}/${encodeStoragePath(file.path)}`, { raw: true });
  const target = path.join(outDir, 'storage', STORAGE_BUCKET, ...file.path.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}
writeFileSync(path.join(outDir, 'storage_files.json'), JSON.stringify(files, null, 2));
summary.files = files.length;
console.log(`uploaded files: ${files.length}`);

writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nBackup saved to ${outDir}`);
