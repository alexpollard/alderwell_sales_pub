import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import { logActivity } from '../utils/logActivity';

// All selectable roles in the system, used for dropdowns and filters.
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'marketing_team_member', label: 'Marketing Team Member' },
  { value: 'sales_representative', label: 'Sales Representative' },
  { value: 'compliance_officer', label: 'Compliance Officer' },
];

// Word list used to generate human-readable temporary passwords (e.g. "ambermeadow247").
const PASSWORD_WORDS = [
  'amber', 'meadow', 'orchard', 'raven', 'cedar', 'atlas', 'harbor', 'ridge', 'willow', 'nova',
  'maple', 'river', 'lumen', 'thistle', 'ember', 'sable', 'copper', 'fable', 'echo', 'clover',
  'breeze', 'summit', 'anchor', 'velvet', 'birch', 'dawn', 'beacon', 'spruce', 'ivy', 'elm',
];

function pickRandomWord() {
  return PASSWORD_WORDS[Math.floor(Math.random() * PASSWORD_WORDS.length)];
}

// Generates a temporary password in the format "wordword123".
function generateTemporaryPassword() {
  const firstWord = pickRandomWord();
  const secondWord = pickRandomWord();
  const number = Math.floor(100 + Math.random() * 900);
  return `${firstWord}${secondWord}${number}`;
}

// Normalises a raw role string from the DB into a known ROLE_OPTIONS value.
// Handles legacy/variant spellings stored in older profile rows.
function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase().replace(/\s+/g, '_');

  if (['marketing', 'marketing_member', 'marketing_team'].includes(normalized)) {
    return 'marketing_team_member';
  }

  if (normalized === 'staff' || normalized === 'general') {
    return 'marketing_team_member';
  }

  return normalized || 'marketing_team_member';
}

// Extracts an error message from a Supabase edge function error.
// Edge function errors can be response body, string context, or .message.
async function getFunctionErrorMessage(error, fallback = 'Request failed.') {
  if (!error) {
    return fallback;
  }

  if (typeof Response !== 'undefined' && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string' && body.error.trim()) {
        return body.error;
      }
      if (typeof body?.message === 'string' && body.message.trim()) {
        return body.message;
      }
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text && text.trim()) {
          return text;
        }
      } catch {
        // Ignore parse errors and continue to other fallbacks.
      }
    }
  }

  if (typeof error.context === 'string' && error.context.trim()) {
    try {
      const parsed = JSON.parse(error.context);
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return parsed.error;
      }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      return error.context;
    }
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    const loweredMessage = error.message.toLowerCase();
    if (loweredMessage.includes('invalid jwt')) {
      return 'Your login session is invalid or expired. Please sign out, sign in again, and retry.';
    }
    if (
      loweredMessage.includes('failed to send a request to the edge function') ||
      loweredMessage.includes('404')
    ) {
      return 'Staff account service is not available yet (edge function not deployed or unreachable). Please deploy create-staff-account and try again.';
    }
    return error.message;
  }

  return fallback;
}

export default function AdminManagement({ currentUserId, personName = 'Admin' }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [resettingUserId, setResettingUserId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [deleteProfilePending, setDeleteProfilePending] = useState(null);
  const [applyingRoleChange, setApplyingRoleChange] = useState(false);
  const [roleChangePending, setRoleChangePending] = useState(null);
  const [message, setMessage] = useState(null);
  const [createdStaffCredentials, setCreatedStaffCredentials] = useState(null);
  const [resetStaffCredentials, setResetStaffCredentials] = useState(null);
  const [copiedField, setCopiedField] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState('all');
  const [newStaff, setNewStaff] = useState({
    email: '',
    temporaryPassword: generateTemporaryPassword(),
    username: '',
    fullName: '',
    companyRole: '',
    mustChangePassword: true,
    isActive: true,
  });

  // Fetches all staff profiles from Supabase. Used on initial mount and the Refresh button.
  const loadAdminData = async () => {
    setLoading(true);
    setMessage(null);

    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, username, full_name, company_role, must_change_password, is_active, updated_at')
      .order('updated_at', { ascending: false });

    if (profilesError) {
      setMessage({
        type: 'error',
        text: profilesError?.message || 'Could not load admin data.',
      });
      setLoading(false);
      return;
    }

    setProfiles(profilesData || []);
    setLoading(false);
  };

  // Load profiles on mount.
  useEffect(() => {
    loadAdminData();
  }, []);

  // Applies an update to a profile row and optimistically updates local state.
  // Also logs the specific type of change (role, active status, or password flag).
  const updateProfile = async (userId, updates) => {
    const targetProfile = profiles.find((p) => p.user_id === userId);
    const { error } = await supabase.from('profiles').update(updates).eq('user_id', userId);

    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }

    setMessage({ type: 'success', text: 'User profile updated.' });
    setProfiles((prev) =>
      prev.map((profile) => (profile.user_id === userId ? { ...profile, ...updates } : profile))
    );

    // Determine and log what changed
    if (updates.company_role !== undefined) {
      logActivity(personName, 'staff_role_changed', {
        target_user: targetProfile?.username || userId,
        old_role: targetProfile?.company_role,
        new_role: updates.company_role,
      });
    } else if (updates.is_active !== undefined) {
      logActivity(personName, 'staff_status_changed', {
        target_user: targetProfile?.username || userId,
        is_active: updates.is_active,
      });
    } else if (updates.must_change_password !== undefined) {
      logActivity(personName, 'staff_password_reset_flagged', {
        target_user: targetProfile?.username || userId,
      });
    }
  };

  // Submits the create staff form by calling the create-staff-account edge function.
  // On success, shows a credential modal so the admin can share login details.
  const handleCreateStaff = async (event) => {
    event.preventDefault();

    if (creatingStaff) return;

    setCreatingStaff(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage({ type: 'error', text: 'Your session has expired. Please sign in again.' });
      setCreatingStaff(false);
      return;
    }

    if (!newStaff.email.trim() || !newStaff.temporaryPassword.trim() || !newStaff.username.trim()) {
      setMessage({ type: 'error', text: 'Email, temporary password, and username are required.' });
      setCreatingStaff(false);
      return;
    }

    if (!newStaff.companyRole) {
      setMessage({ type: 'error', text: 'Please select a role.' });
      setCreatingStaff(false);
      return;
    }

    if (newStaff.temporaryPassword.trim().length < 8) {
      setMessage({
        type: 'error',
        text: 'Temporary password must be at least 8 characters long.',
      });
      setCreatingStaff(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke('create-staff-account', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: {
        email: newStaff.email.trim().toLowerCase(),
        password: newStaff.temporaryPassword,
        username: newStaff.username.trim(),
        full_name: newStaff.fullName.trim() || null,
        company_role: newStaff.companyRole,
        must_change_password: newStaff.mustChangePassword,
        is_active: newStaff.isActive,
      },
    });

    if (error) {
      setMessage({
        type: 'error',
        text: await getFunctionErrorMessage(error, 'Failed to create staff account.'),
      });
      setCreatingStaff(false);
      return;
    }

    if (!data?.profile) {
      setMessage({ type: 'error', text: 'Unexpected response from staff creation function.' });
      setCreatingStaff(false);
      return;
    }

    const createdEmail = newStaff.email.trim().toLowerCase();
    const createdPassword = newStaff.temporaryPassword;

    setProfiles((prev) => [data.profile, ...prev]);
    setNewStaff({
      email: '',
      temporaryPassword: generateTemporaryPassword(),
      username: '',
      fullName: '',
      companyRole: '',
      mustChangePassword: true,
      isActive: true,
    });
    logActivity(personName, 'staff_created', {
      username: data.profile.username,
      role: data.profile.company_role,
      email: data.email,
    });
    setMessage({ type: 'success', text: 'Staff account created.' });
    setCreatedStaffCredentials({
      email: createdEmail,
      temporaryPassword: createdPassword,
      username: data.profile.username,
    });
    setCreatingStaff(false);
  };

  // Generates a new temporary password and calls the reset-staff-password edge function.
  // Flags the account as must_change_password and shows a credential modal.
  const resetStaffPassword = async (userId, username) => {
    if (resettingUserId) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage({ type: 'error', text: 'Your session has expired. Please sign in again.' });
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    setResettingUserId(userId);

    const { error } = await supabase.functions.invoke('reset-staff-password', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: {
        user_id: userId,
        temporary_password: temporaryPassword,
      },
    });

    if (error) {
      setMessage({
        type: 'error',
        text: await getFunctionErrorMessage(error, 'Failed to reset staff password.'),
      });
      setResettingUserId(null);
      return;
    }

    setProfiles((prev) =>
      prev.map((profile) => (
        profile.user_id === userId
          ? { ...profile, must_change_password: true }
          : profile
      ))
    );
    logActivity(personName, 'staff_password_reset', { username });
    setMessage({
      type: 'success',
      text: `Temporary password set for ${username}. They will be required to change it on next login.`,
    });
    setResetStaffCredentials({
      username,
      temporaryPassword,
    });
    setResettingUserId(null);
  };

  // Stages a staff deletion for confirmation in the app modal.
  const requestDeleteProfile = (profile) => {
    if (!profile || profile.user_id === currentUserId || deletingUserId) return;
    setDeleteProfilePending({
      userId: profile.user_id,
      username: profile.username,
      fullName: profile.full_name,
    });
  };

  // Permanently deletes a staff account (auth + profile) via the delete-staff-account edge function.
  // Called after confirming in the in-app modal.
  const confirmDeleteProfile = async () => {
    if (!deleteProfilePending || deletingUserId) return;

    const { userId, username } = deleteProfilePending;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage({ type: 'error', text: 'Your session has expired. Please sign in again.' });
      return;
    }

    setDeletingUserId(userId);

    const { error } = await supabase.functions.invoke('delete-staff-account', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: { user_id: userId },
    });

    if (error) {
      setMessage({
        type: 'error',
        text: await getFunctionErrorMessage(error, 'Failed to delete staff account.'),
      });
      setDeletingUserId(null);
      return;
    }

    setProfiles((prev) => prev.filter((profile) => profile.user_id !== userId));
    logActivity(personName, 'staff_deleted', { username });
    setMessage({
      type: 'success',
      text: 'Staff account deleted.',
    });
    setDeleteProfilePending(null);
    setDeletingUserId(null);
  };

  // Copies a credential value to the clipboard and briefly highlights the copied field.
  const copyCredential = async (value, field) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((prev) => (prev === field ? '' : prev));
      }, 1800);
    } catch {
      setMessage({ type: 'error', text: 'Could not copy to clipboard. Please copy manually.' });
    }
  };

  // Filters the profiles list by the search box and role dropdown.
  const filteredProfiles = useMemo(() => {
    const query = staffSearch.trim().toLowerCase();

    return profiles.filter((profile) => {
      const matchesRole = staffRoleFilter === 'all' || normalizeRole(profile.company_role) === staffRoleFilter;

      if (!matchesRole) return false;
      if (!query) return true;

      const username = String(profile.username || '').toLowerCase();
      const fullName = String(profile.full_name || '').toLowerCase();
      return username.includes(query) || fullName.includes(query);
    });
  }, [profiles, staffRoleFilter, staffSearch]);

  // Returns the display label for a given role value.
  const getRoleLabel = (roleValue) => ROLE_OPTIONS.find((r) => r.value === normalizeRole(roleValue))?.label || roleValue;

  // Stages a role change for confirmation rather than applying immediately.
  const requestRoleChange = (profile, nextRole) => {
    const currentRole = normalizeRole(profile.company_role);
    if (currentRole === nextRole) return;

    setRoleChangePending({
      userId: profile.user_id,
      username: profile.username,
      fullName: profile.full_name,
      oldRole: currentRole,
      newRole: nextRole,
    });
  };

  // Applies the staged role change after the user confirms in the modal.
  const confirmRoleChange = async () => {
    if (!roleChangePending || applyingRoleChange) return;

    setApplyingRoleChange(true);
    await updateProfile(roleChangePending.userId, { company_role: roleChangePending.newRole });
    setApplyingRoleChange(false);
    setRoleChangePending(null);
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <p className="text-sm text-gray-600">Loading admin data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Admin</h2>
        <p className="text-gray-500 mt-2">Manage staff access and review recent system activity.</p>
      </div>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-green-200 bg-green-50 text-green-700'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {createdStaffCredentials ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-7 py-5 border-b border-gray-200 bg-brand-cream/40">
              <h3 className="text-2xl font-bold text-gray-900">Account Created Successfully</h3>
              <p className="text-sm text-gray-600 mt-1">Please share these login credentials with the new staff member.</p>
            </div>
            <div className="px-7 py-6 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                  <button
                    type="button"
                    onClick={() => copyCredential(createdStaffCredentials.email, 'email')}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  >
                    {copiedField === 'email' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-base text-gray-900 font-semibold break-all">{createdStaffCredentials.email}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Temporary Password</p>
                  <button
                    type="button"
                    onClick={() => copyCredential(createdStaffCredentials.temporaryPassword, 'password')}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  >
                    {copiedField === 'password' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-base text-gray-900 font-semibold break-all">{createdStaffCredentials.temporaryPassword}</p>
              </div>
              <p className="text-sm text-gray-600">Username: <span className="font-medium text-gray-900">{createdStaffCredentials.username}</span></p>
            </div>
            <div className="px-7 py-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setCreatedStaffCredentials(null);
                  setCopiedField('');
                }}
                className="px-5 py-2.5 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-semibold"
              >
                I Have Saved These Details
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetStaffCredentials ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-7 py-5 border-b border-gray-200 bg-brand-cream/40">
              <h3 className="text-2xl font-bold text-gray-900">Password Reset Complete</h3>
              <p className="text-sm text-gray-600 mt-1">Share this temporary password with the staff member.</p>
            </div>
            <div className="px-7 py-6 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Username</p>
                <p className="text-base text-gray-900 font-semibold break-all">{resetStaffCredentials.username}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Temporary Password</p>
                  <button
                    type="button"
                    onClick={() => copyCredential(resetStaffCredentials.temporaryPassword, 'reset-password')}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  >
                    {copiedField === 'reset-password' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-base text-gray-900 font-semibold break-all">{resetStaffCredentials.temporaryPassword}</p>
              </div>
            </div>
            <div className="px-7 py-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setResetStaffCredentials(null);
                  setCopiedField('');
                }}
                className="px-5 py-2.5 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {roleChangePending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Role Change</h3>
              <p className="text-sm text-gray-600 mt-1">Please confirm this update before saving.</p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700">
                User: <span className="font-semibold text-gray-900">{roleChangePending.fullName || roleChangePending.username}</span>
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <p>From: <span className="font-medium text-gray-900">{getRoleLabel(roleChangePending.oldRole)}</span></p>
                <p className="mt-1">To: <span className="font-medium text-gray-900">{getRoleLabel(roleChangePending.newRole)}</span></p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRoleChangePending(null)}
                disabled={applyingRoleChange}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRoleChange}
                disabled={applyingRoleChange}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-brand-deep text-white hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-60"
              >
                {applyingRoleChange ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Confirm Change'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteProfilePending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Delete Staff Account</h3>
              <p className="text-sm text-gray-600 mt-1">This action permanently deletes login and profile data.</p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700">
                Account: <span className="font-semibold text-gray-900">{deleteProfilePending.fullName || deleteProfilePending.username}</span>
              </p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This cannot be undone.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteProfilePending(null)}
                disabled={Boolean(deletingUserId)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProfile}
                disabled={Boolean(deletingUserId)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deletingUserId ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Account'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Staff Account</h3>

        <form onSubmit={handleCreateStaff} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={newStaff.email}
              onChange={(event) =>
                setNewStaff((prev) => ({ ...prev, email: event.target.value }))
              }
              placeholder="jane.doe@alderwell.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={creatingStaff}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
            <input
              type="text"
              value={newStaff.temporaryPassword}
              placeholder="wordword123"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={creatingStaff}
              readOnly
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={newStaff.username}
              onChange={(event) =>
                setNewStaff((prev) => ({ ...prev, username: event.target.value }))
              }
              placeholder="jdoe"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={creatingStaff}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={newStaff.fullName}
              onChange={(event) =>
                setNewStaff((prev) => ({ ...prev, fullName: event.target.value }))
              }
              placeholder="Jane Doe"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={creatingStaff}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={newStaff.companyRole}
              onChange={(event) =>
                setNewStaff((prev) => ({ ...prev, companyRole: event.target.value }))
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={creatingStaff}
              required
            >
              <option value="" disabled>Select a Role</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newStaff.mustChangePassword}
                  onChange={(event) =>
                    setNewStaff((prev) => ({ ...prev, mustChangePassword: event.target.checked }))
                  }
                  disabled={creatingStaff}
                  className="h-4 w-4"
                />
                Require password change on next login
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">User will be taken to the password update screen before accessing the app.</p>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={newStaff.isActive}
                onChange={(event) =>
                  setNewStaff((prev) => ({ ...prev, isActive: event.target.checked }))
                }
                disabled={creatingStaff}
                className="h-4 w-4"
              />
              Active
            </label>
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={creatingStaff}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creatingStaff ? (
                <>
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                  Creating Account...
                </>
              ) : (
                'Create Staff'
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Staff Accounts</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={loadAdminData}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Refresh Accounts
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              type="text"
              value={staffSearch}
              onChange={(event) => setStaffSearch(event.target.value)}
              placeholder="Search by username or full name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={staffRoleFilter}
              onChange={(event) => setStaffRoleFilter(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Username</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Full Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Password Change Required</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => (
                <tr key={profile.user_id} className="border-b border-gray-200 last:border-b-0">
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">{profile.username}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{profile.full_name || '-'}</td>
                  <td className="px-6 py-4 text-sm">
                    <select
                      value={normalizeRole(profile.company_role)}
                      onChange={(event) => requestRoleChange(profile, event.target.value)}
                      disabled={applyingRoleChange || profile.user_id === currentUserId}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <label className="inline-flex items-center gap-2 text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(profile.is_active)}
                        onChange={(event) => updateProfile(profile.user_id, { is_active: event.target.checked })}
                        className="h-4 w-4"
                      />
                      Active
                    </label>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <label className="inline-flex items-center gap-2 text-gray-700" title="When enabled, this user must set a new password at next login.">
                      <input
                        type="checkbox"
                        checked={Boolean(profile.must_change_password)}
                        onChange={(event) => updateProfile(profile.user_id, { must_change_password: event.target.checked })}
                        className="h-4 w-4"
                      />
                      Change on next login
                    </label>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        disabled={profile.user_id === currentUserId || Boolean(resettingUserId)}
                        onClick={() => resetStaffPassword(profile.user_id, profile.username)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-amber-200 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resettingUserId === profile.user_id ? 'Resetting...' : 'Reset Password'}
                      </button>
                      <button
                        disabled={profile.user_id === currentUserId || Boolean(deletingUserId)}
                        onClick={() => requestDeleteProfile(profile)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {profile.user_id === currentUserId
                          ? 'Current User'
                          : deletingUserId === profile.user_id
                            ? 'Deleting...'
                            : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    No staff accounts match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}