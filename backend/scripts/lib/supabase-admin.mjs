// Small helpers for talking to Supabase with the service role key.
// Used by the backup and demo reset scripts. No npm packages needed (Node 18+).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../..');

// Load KEY=value lines from backend/.env and frontend/.env when running locally.
// In GitHub Actions the values come from repository secrets instead.
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
loadEnvFile(path.join(repoRoot, 'backend/.env'));
loadEnvFile(path.join(repoRoot, 'frontend/.env'));

export const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set them in backend/.env or as environment variables).');
  process.exit(1);
}

const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

export async function api(urlPath, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const isJson = body !== undefined && !(body instanceof Uint8Array) && !(body instanceof Blob);
  const response = await fetch(`${supabaseUrl}${urlPath}`, {
    method,
    headers: { ...authHeaders, ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: isJson ? JSON.stringify(body) : body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${urlPath} failed (${response.status}): ${text}`);
  }
  if (raw) return response;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Every table the app uses, in an order where parents come before children.
export const TABLES = [
  'profiles',
  'folders',
  'folder_access_policies',
  'folder_access_roles',
  'campaigns',
  'campaign_assignees',
  'tasks',
  'task_assignees',
  'task_notes',
  'documents',
  'campaign_materials',
  'interactions',
  'follow_ups',
  'sales',
  'todos',
  'activity_logs',
];

// Primary key columns for each table, used to match rows when restoring.
export const PRIMARY_KEYS = {
  profiles: ['user_id'],
  folders: ['folder_id'],
  folder_access_policies: ['policy_id'],
  folder_access_roles: ['access_role_id'],
  campaigns: ['campaign_id'],
  campaign_assignees: ['campaign_id', 'user_id'],
  tasks: ['task_id'],
  task_assignees: ['task_id', 'user_id'],
  task_notes: ['note_id'],
  documents: ['document_id'],
  campaign_materials: ['campaign_id', 'document_id'],
  interactions: ['interaction_id'],
  follow_ups: ['follow_up_id'],
  sales: ['sale_id'],
  todos: ['id'],
  activity_logs: ['log_id'],
};

export const rowKey = (table, row) => PRIMARY_KEYS[table].map((col) => row[col]).join('|');

export const STORAGE_BUCKET = 'documents';
// Private bucket holding the saved copy of the real data that the demo resets to.
export const SNAPSHOT_BUCKET = 'demo-snapshot';

export async function downloadFile(bucket, filePath) {
  const response = await api(`/storage/v1/object/${bucket}/${encodeStoragePath(filePath)}`, { raw: true });
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadFile(bucket, filePath, bytes, contentType = 'application/octet-stream') {
  await api(`/storage/v1/object/${bucket}/${encodeStoragePath(filePath)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
}

// Read every row of a table, 1000 at a time.
export async function readTable(table) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = await api(`/rest/v1/${table}?select=*`, {
      headers: { Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
    });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// List every file in a storage bucket, including files inside folders.
export async function listStorageFiles(prefix = '', bucket = STORAGE_BUCKET) {
  const files = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const items = await api(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      body: { prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } },
    });
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listStorageFiles(fullPath, bucket)));
      else files.push({ path: fullPath, mimetype: item.metadata?.mimetype, size: item.metadata?.size });
    }
    if (items.length < limit) return files;
  }
}

export function encodeStoragePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

// List all login accounts (emails and ids only; passwords can't be exported).
export async function listAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const batch = result?.users || [];
    users.push(...batch);
    if (batch.length < 200) return users;
  }
}
