import { supabase } from './supabase';

/**
 * Write a fire-and-forget entry to activity_logs.
 * Errors are swallowed — logging must never block the calling operation.
 *
 * @param {string} personName  Display name of the actor (from profiles.full_name)
 * @param {string} actionType  Snake_case event type, e.g. 'document_uploaded'
 * @param {object} details     Arbitrary JSON context for the event
 */
export async function logActivity(personName, actionType, details = {}) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from('activity_logs').insert({
      user_id: user?.id ?? null,
      person_name: personName || 'Unknown',
      action_type: actionType,
      details,
    });
  } catch {
    // Intentionally silent — audit logging must never disrupt UX
  }
}
