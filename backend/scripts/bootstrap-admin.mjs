#!/usr/bin/env node

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missing = required.filter((name) => !process.env[name] || !process.env[name].trim());

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Example: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node backend/scripts/bootstrap-admin.mjs');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL.trim().replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
const adminFullName = (process.env.ADMIN_FULL_NAME || 'System Administrator').trim();

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function api(path, init = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  return { ok: response.ok, status: response.status, payload };
}

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const result = await api(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { method: 'GET' });
    if (!result.ok) {
      throw new Error(`Failed to list auth users (${result.status}): ${JSON.stringify(result.payload)}`);
    }

    const users = result.payload?.users || [];
    const match = users.find((user) => String(user?.email || '').toLowerCase() === email.toLowerCase());
    if (match) return match;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function ensureAuthUser() {
  const createResult = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    }),
  });

  if (createResult.ok && createResult.payload?.user?.id) {
    return createResult.payload.user;
  }

  const alreadyExists = String(createResult.payload?.msg || createResult.payload?.message || '')
    .toLowerCase()
    .includes('already');

  if (!alreadyExists) {
    throw new Error(`Failed to create auth user (${createResult.status}): ${JSON.stringify(createResult.payload)}`);
  }

  const existing = await findUserByEmail(adminEmail);
  if (!existing?.id) {
    throw new Error('Auth user already exists but could not be retrieved by email.');
  }

  const updateResult = await api(`/auth/v1/admin/users/${existing.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      password: adminPassword,
      email_confirm: true,
    }),
  });

  if (!updateResult.ok) {
    throw new Error(`Failed to update existing auth user (${updateResult.status}): ${JSON.stringify(updateResult.payload)}`);
  }

  return updateResult.payload?.user || existing;
}

async function upsertAdminProfile(userId) {
  const profile = {
    user_id: userId,
    username: adminUsername,
    full_name: adminFullName,
    company_role: 'admin',
    must_change_password: true,
    is_active: true,
  };

  const result = await api('/rest/v1/profiles?on_conflict=user_id', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(profile),
  });

  if (!result.ok) {
    throw new Error(`Failed to upsert admin profile (${result.status}): ${JSON.stringify(result.payload)}`);
  }

  return Array.isArray(result.payload) ? result.payload[0] : result.payload;
}

async function main() {
  const authUser = await ensureAuthUser();
  const profile = await upsertAdminProfile(authUser.id);

  console.log('Admin bootstrap complete.');
  console.log(`- user_id: ${authUser.id}`);
  console.log(`- email: ${authUser.email}`);
  console.log(`- role: ${profile?.company_role || 'admin'}`);
  console.log('- must_change_password: true');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
