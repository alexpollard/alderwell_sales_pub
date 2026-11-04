import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
    return json(403, { error: 'Only active admins can reset staff passwords.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const targetUserId = String(payload.user_id || '').trim();
  const temporaryPassword = String(payload.temporary_password || '');

  if (!targetUserId || !temporaryPassword.trim()) {
    return json(400, { error: 'user_id and temporary_password are required.' });
  }

  if (targetUserId === caller.id) {
    return json(400, { error: 'Use the in-app password change flow for your own account.' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from('profiles')
    .select('user_id, username')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (targetProfileError || !targetProfile) {
    return json(404, { error: 'Staff profile not found.' });
  }

  const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    password: temporaryPassword,
  });

  if (updateAuthError) {
    return json(400, { error: updateAuthError.message || 'Failed to reset password.' });
  }

  const { error: updateProfileError } = await adminClient
    .from('profiles')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('user_id', targetUserId);

  if (updateProfileError) {
    return json(400, { error: updateProfileError.message || 'Password was reset but profile could not be updated.' });
  }

  return json(200, {
    success: true,
    user_id: targetUserId,
    username: targetProfile.username,
    must_change_password: true,
  });
});
