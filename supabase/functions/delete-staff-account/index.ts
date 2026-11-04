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
    return json(403, { error: 'Only active admins can delete staff accounts.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const targetUserId = String(payload.user_id || '').trim();
  if (!targetUserId) {
    return json(400, { error: 'user_id is required.' });
  }

  if (targetUserId === caller.id) {
    return json(400, { error: 'You cannot delete your own account.' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('username, company_role')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!targetProfile) {
    return json(404, { error: 'Staff profile not found.' });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    return json(400, { error: deleteError.message || 'Failed to delete staff account.' });
  }

  return json(200, {
    success: true,
    user_id: targetUserId,
    username: targetProfile.username,
  });
});
