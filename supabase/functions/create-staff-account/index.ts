import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const ROLE_OPTIONS = new Set([
  'admin',
  'manager',
  'sales_representative',
  'compliance_officer',
  'marketing_team_member',
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing required function environment variables.' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json(401, { error: 'Missing authorization header.' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json(401, { error: 'Missing bearer token.' });
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser(token);

  if (callerError || !caller) {
    return json(401, { error: 'Invalid user session.' });
  }

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from('profiles')
    .select('company_role, is_active')
    .eq('user_id', caller.id)
    .single();

  if (callerProfileError || !callerProfile?.is_active || callerProfile.company_role !== 'admin') {
    return json(403, { error: 'Only active admins can create staff accounts.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const username = String(payload.username || '').trim();
  const fullName = String(payload.full_name || '').trim();
  const companyRole = String(payload.company_role || 'marketing_team_member').trim().toLowerCase();
  const mustChangePassword = Boolean(payload.must_change_password ?? true);
  const isActive = Boolean(payload.is_active ?? true);

  if (!email || !password || !username) {
    return json(400, { error: 'email, password, and username are required.' });
  }

  if (!ROLE_OPTIONS.has(companyRole)) {
    return json(400, { error: 'Invalid company_role value.' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authUserData, error: authUserError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (authUserError || !authUserData?.user?.id) {
    return json(400, { error: authUserError?.message || 'Failed to create auth user.' });
  }

  const userId = authUserData.user.id;

  const { data: profileData, error: profileError } = await adminClient
    .from('profiles')
    .insert({
      user_id: userId,
      username,
      full_name: fullName || null,
      company_role: companyRole,
      must_change_password: mustChangePassword,
      is_active: isActive,
    })
    .select('user_id, username, full_name, company_role, must_change_password, is_active, updated_at')
    .single();

  if (profileError || !profileData) {
    await adminClient.auth.admin.deleteUser(userId);
    return json(400, { error: profileError?.message || 'Failed to create profile.' });
  }

  return json(200, {
    email,
    profile: profileData,
  });
});
