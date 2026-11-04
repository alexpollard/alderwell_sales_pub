import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

// Each action type gets a short label and a badge colour for the table.
const ACTION_LABELS = {
  user_login:                   { label: 'Login',                 color: 'bg-green-100 text-green-800' },
  user_logout:                  { label: 'Logout',                color: 'bg-gray-100 text-gray-700' },
  password_changed:             { label: 'Password Changed',      color: 'bg-blue-100 text-blue-800' },
  screen_accessed:              { label: 'Screen Accessed',       color: 'bg-purple-100 text-purple-800' },
  campaign_created:             { label: 'Campaign Created',      color: 'bg-emerald-100 text-emerald-800' },
  campaign_updated:             { label: 'Campaign Updated',      color: 'bg-lime-100 text-lime-800' },
  document_uploaded:            { label: 'Doc Uploaded',          color: 'bg-brand-sage text-brand-deep' },
  document_version_uploaded:    { label: 'New Version',           color: 'bg-cyan-100 text-cyan-800' },
  document_version_archived:    { label: 'Version Archived',      color: 'bg-orange-100 text-orange-800' },
  document_version_restored:    { label: 'Version Restored',      color: 'bg-emerald-100 text-emerald-800' },
  document_downloaded:          { label: 'Doc Downloaded',        color: 'bg-indigo-100 text-indigo-800' },
  document_previewed:           { label: 'Doc Previewed',         color: 'bg-slate-100 text-slate-800' },
  document_archived:            { label: 'Doc Archived',          color: 'bg-orange-100 text-orange-800' },
  folder_created:               { label: 'Folder Created',        color: 'bg-yellow-100 text-yellow-800' },
  interaction_logged:           { label: 'Interaction Logged',    color: 'bg-sky-100 text-sky-800' },
  follow_up_logged:             { label: 'Follow-Up Logged',      color: 'bg-orange-100 text-orange-800' },
  follow_up_completed:          { label: 'Follow-Up Completed',   color: 'bg-green-100 text-green-800' },
  staff_created:                { label: 'Staff Created',         color: 'bg-teal-100 text-teal-800' },
  staff_deleted:                { label: 'Staff Deleted',         color: 'bg-red-100 text-red-800' },
  staff_role_changed:           { label: 'Role Changed',          color: 'bg-pink-100 text-pink-800' },
  staff_status_changed:         { label: 'Status Changed',        color: 'bg-amber-100 text-amber-800' },
  staff_password_reset_flagged: { label: 'Password Reset Forced', color: 'bg-violet-100 text-violet-800' },
  task_created:                 { label: 'Task Created',          color: 'bg-sky-100 text-sky-800' },
  task_status_changed:          { label: 'Task Status Changed',   color: 'bg-blue-100 text-blue-800' },
  task_archived:                { label: 'Task Archived',         color: 'bg-orange-100 text-orange-800' },
  task_note_added:              { label: 'Task Note Added',       color: 'bg-indigo-100 text-indigo-800' },
  staff_password_reset:         { label: 'Staff Password Reset',  color: 'bg-violet-100 text-violet-800' },
};

// The categories shown in the first filter dropdown.
const ACTION_GROUPS = [
  { id: 'all', label: 'All groups' },
  { id: 'auth', label: 'Authentication' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'documents', label: 'Documents' },
  { id: 'sales', label: 'Sales Activity' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'staff', label: 'Staff Management' },
  { id: 'system', label: 'System' },
];

// Which action types belong to each category, for the second filter dropdown.
const ACTION_GROUP_MAP = {
  auth: ['user_login', 'user_logout', 'password_changed', 'staff_password_reset', 'staff_password_reset_flagged'],
  campaigns: ['campaign_created', 'campaign_updated'],
  documents: ['document_uploaded', 'document_version_uploaded', 'document_version_archived', 'document_version_restored', 'document_downloaded', 'document_previewed', 'document_archived', 'folder_created'],
  sales: ['interaction_logged', 'follow_up_logged', 'follow_up_completed'],
  tasks: ['task_created', 'task_status_changed', 'task_archived', 'task_note_added'],
  staff: ['staff_created', 'staff_deleted', 'staff_role_changed', 'staff_status_changed'],
  system: ['screen_accessed'],
};

// How many log rows to load at a time.
const PAGE_SIZE = 50;

// Links each nav section to its URL path, so log rows can link to the right place.
const SCREEN_PATHS = {
  home: '/dashboard',
  documents: '/documents',
  sales: '/sales',
  campaigns: '/campaigns',
  tasks: '/tasks',
  audit: '/audit',
  admin: '/admin',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Formats a timestamp into a readable date and time (UK format).
function formatTs(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Turns a date string like "2026-05-07" into a timestamp for the start of that day.
function toDayStartIso(dateValue) {
  if (!dateValue) return null;
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

// Turns a date string like "2026-05-07" into a timestamp for the end of that day.
function toDayEndIso(dateValue) {
  if (!dateValue) return null;
  return new Date(`${dateValue}T23:59:59.999`).toISOString();
}

// Converts a value like "task_status_changed" into "Task Status Changed" for display.
function formatStatusValue(value) {
  if (!value) return value;
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Same as above but used when an action type isn't in the known labels list.
function formatActionType(actionType) {
  if (!actionType) return 'Unknown Action';
  return String(actionType)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Builds the detail text shown for each log row based on what type of action it was.
function renderDetails(actionType, details) {
  if (!details || Object.keys(details).length === 0) return null;

  const rows = [];
  switch (actionType) {
    case 'user_login':
      rows.push(['Email', details.email]);
      break;
    case 'password_changed':
      rows.push(['Reason', details.reason]);
      break;
    case 'screen_accessed':
      rows.push(['Screen', details.screen]);
      break;
    case 'campaign_created':
      rows.push(['Campaign', details.name]);
      break;
    case 'campaign_updated':
      rows.push(['Campaign', details.name]);
      if (details.status) rows.push(['Status', formatStatusValue(details.status)]);
      break;
    case 'document_uploaded':
    case 'document_version_uploaded':
      rows.push(['File', details.file_name]);
      if (details.version) rows.push(['Version', `v${details.version}`]);
      if (details.folder_id) rows.push(['Folder', details.folder_id]);
      break;
    case 'document_version_archived':
    case 'document_version_restored':
      rows.push(['File', details.file_name]);
      if (details.document_version) rows.push(['Version', `v${details.document_version}`]);
      break;
    case 'document_downloaded':
      rows.push(['File', details.file_name]);
      if (details.version) rows.push(['Version', `v${details.version}`]);
      break;
    case 'document_previewed':
      rows.push(['File', details.file_name]);
      if (details.version) rows.push(['Version', `v${details.version}`]);
      break;
    case 'document_archived':
      rows.push(['File', details.file_name]);
      break;
    case 'folder_created':
      rows.push(['Name', details.folder_name]);
      break;
    case 'interaction_logged':
      rows.push(['HCP', details.hcp]);
      if (details.type) rows.push(['Type', formatStatusValue(details.type)]);
      if (typeof details.did_convert === 'boolean') rows.push(['Converted', details.did_convert ? 'Yes' : 'No']);
      break;
    case 'follow_up_logged':
      rows.push(['HCP', details.hcp]);
      break;
    case 'follow_up_completed':
      rows.push(['HCP', details.hcp]);
      if (details.additional_order_prompted) rows.push(['Additional Order', 'Prompted']);
      break;
    case 'staff_created':
      rows.push(['Username', details.username]);
      rows.push(['Role', details.role]);
      break;
    case 'staff_deleted':
      rows.push(['Username', details.username]);
      break;
    case 'staff_role_changed':
      rows.push(['User', details.target_user]);
      rows.push(['From', details.old_role]);
      rows.push(['To', details.new_role]);
      break;
    case 'staff_status_changed':
      rows.push(['User', details.target_user]);
      rows.push(['Active', details.is_active ? 'Yes' : 'No']);
      break;
    case 'staff_password_reset_flagged':
      rows.push(['User', details.target_user]);
      break;
    case 'task_created':
      rows.push(['Task', details.task]);
      break;
    case 'task_status_changed':
      rows.push(['Task', details.task]);
      rows.push(['Status', formatStatusValue(details.status)]);
      break;
    case 'task_archived':
      rows.push(['Task', details.task]);
      break;
    case 'task_note_added':
      rows.push(['Task', details.task]);
      if (details.note_text) rows.push(['Note', details.note_text]);
      break;
    case 'staff_password_reset':
      rows.push(['User', details.username]);
      break;
    default:
      return (
        <span className="text-xs text-gray-400 font-mono">
          {JSON.stringify(details)}
        </span>
      );
  }

  return (
    <span className="text-xs text-gray-600">
      {rows.filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ')}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Tracks whether there are more logs to load and where we are in the list.
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // What the user has typed or selected in the filter bar.
  const [search, setSearch] = useState('');
  const [actionGroupFilter, setActionGroupFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Used to open the date picker when the user clicks the date field wrapper.
  const startDateRef = useRef(null);
  const endDateRef = useRef(null);

  // Builds the list of action types shown in the sub-filter based on the selected group.
  const knownActionTypes = useMemo(() => Object.keys(ACTION_LABELS), []);
  const actionTypesForGroup = useMemo(
    () => (actionGroupFilter === 'all'
      ? knownActionTypes
      : (ACTION_GROUP_MAP[actionGroupFilter] || [])),
    [actionGroupFilter, knownActionTypes]
  );

  // If the user picked a specific action type that doesn't belong to the newly selected group, reset it.
  useEffect(() => {
    if (actionFilter !== 'all' && !actionTypesForGroup.includes(actionFilter)) {
      setActionFilter('all');
    }
  }, [actionFilter, actionTypesForGroup]);

  const handleStartDateClick = useCallback(() => {
    if (startDateRef.current) startDateRef.current.showPicker();
  }, []);

  const handleEndDateClick = useCallback(() => {
    if (endDateRef.current) endDateRef.current.showPicker();
  }, []);

  // Loads logs from the database. Used by the Refresh button (starts over) and Load More button (adds to the list).
  const fetchLogs = useCallback(async ({ reset = true } = {}) => {
    if (reset) {
      setLoading(true);
      setError('');
    } else {
      setLoadingMore(true);
    }

    const currentOffset = reset ? 0 : offset;

    let query = supabase
      .from('activity_logs')
      .select('log_id, occurred_at, person_name, action_type, details')
      .order('occurred_at', { ascending: false })
      .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    if (actionFilter !== 'all') {
      query = query.eq('action_type', actionFilter);
    } else if (actionGroupFilter !== 'all') {
      query = query.in('action_type', actionTypesForGroup);
    }

    const customStart = toDayStartIso(startDate);
    const customEnd = toDayEndIso(endDate);
    if (customStart) {
      query = query.gte('occurred_at', customStart);
    }
    if (customEnd) {
      query = query.lte('occurred_at', customEnd);
    }

    if (search.trim()) {
      query = query.ilike('person_name', `%${search.trim()}%`);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message || 'Could not load audit logs.');
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    const results = data || [];
    setHasMore(results.length === PAGE_SIZE);

    if (reset) {
      setLogs(results);
      setOffset(PAGE_SIZE);
      setLoading(false);
    } else {
      setLogs((prev) => [...prev, ...results]);
      setOffset((prev) => prev + PAGE_SIZE);
      setLoadingMore(false);
    }
  }, [actionFilter, actionGroupFilter, actionTypesForGroup, startDate, endDate, search, offset]);

  // Re-fetches from scratch whenever any filter changes, and on initial mount.
  useEffect(() => {
    let mounted = true;
    async function loadInitial() {
      setLoading(true);
      setError('');

      let query = supabase
        .from('activity_logs')
        .select('log_id, occurred_at, person_name, action_type, details')
        .order('occurred_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (actionFilter !== 'all') {
        query = query.eq('action_type', actionFilter);
      } else if (actionGroupFilter !== 'all') {
        query = query.in('action_type', actionTypesForGroup);
      }

      const customStart = toDayStartIso(startDate);
      const customEnd = toDayEndIso(endDate);
      if (customStart) query = query.gte('occurred_at', customStart);
      if (customEnd) query = query.lte('occurred_at', customEnd);

      if (search.trim()) query = query.ilike('person_name', `%${search.trim()}%`);

      const { data, error: fetchError } = await query;
      if (!mounted) return;

      if (fetchError) {
        setError(fetchError.message || 'Could not load audit logs.');
        setLoading(false);
        return;
      }

      const results = data || [];
      setLogs(results);
      setHasMore(results.length === PAGE_SIZE);
      setOffset(PAGE_SIZE);
      setLoading(false);
    }
    loadInitial();
    return () => { mounted = false; };
  }, [actionFilter, actionGroupFilter, actionTypesForGroup, startDate, endDate, search]);

  // Works out which page in the app a log row relates to, so we can show a link to it.
  function getActionTarget(actionType, details) {
    switch (actionType) {
      case 'document_uploaded':
      case 'document_version_uploaded':
      case 'document_version_archived':
      case 'document_version_restored':
      case 'document_downloaded':
      case 'document_previewed':
      case 'document_archived':
      case 'folder_created': {
        const fileName = details?.file_name;
        if (fileName) {
          return `/documents?file=${encodeURIComponent(fileName)}`;
        }
        return '/documents';
      }
      case 'campaign_created':
      case 'campaign_updated':
        return '/campaigns';
      case 'interaction_logged':
      case 'follow_up_logged':
      case 'follow_up_completed':
        return '/sales';
      case 'task_created':
      case 'task_status_changed':
      case 'task_archived':
      case 'task_note_added':
        return '/tasks';
      case 'staff_created':
      case 'staff_deleted':
      case 'staff_role_changed':
      case 'staff_status_changed':
      case 'staff_password_reset':
      case 'staff_password_reset_flagged':
        return '/admin';
      case 'screen_accessed': {
        const screen = details?.screen;
        return SCREEN_PATHS[screen] || null;
      }
      default:
        return null;
    }
  }

  function handleRefresh() {
    fetchLogs({ reset: true });
  }

  function handleLoadMore() {
    fetchLogs({ reset: false });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Audit Logs</h2>
          <p className="text-gray-500 mt-2">Full trace of who did what, when, and why.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-medium disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700">
          <FunnelIcon className="h-4 w-4" />
          Filters
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Person search */}
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by person…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
              />
            </div>

            {/* Action group */}
            <select
              value={actionGroupFilter}
              onChange={(e) => setActionGroupFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
            >
              {ACTION_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>{group.label}</option>
              ))}
            </select>

            {/* Action type (optional finer filter) */}
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
            >
              <option value="all">All in group</option>
              {actionTypesForGroup.map((t) => (
                <option key={t} value={t}>{ACTION_LABELS[t].label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">From</label>
              <div
                onClick={handleStartDateClick}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white cursor-pointer hover:bg-gray-50"
              >
                <input
                  ref={startDateRef}
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">To</label>
              <div
                onClick={handleEndDateClick}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white cursor-pointer hover:bg-gray-50"
              >
                <input
                  ref={endDateRef}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear dates
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading logs…</div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No logs found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-44">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-36">Person</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider w-44">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = ACTION_LABELS[log.action_type];
                    const targetPath = getActionTarget(log.action_type, log.details);
                    return (
                      <tr key={log.log_id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 text-xs text-gray-500 tabular-nums">{formatTs(log.occurred_at)}</td>
                        <td className="px-6 py-3 text-sm text-gray-900 font-medium">{log.person_name}</td>
                        <td className="px-6 py-3">
                          {targetPath ? (
                            <button
                              type="button"
                              onClick={() => navigate(targetPath)}
                              className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full hover:opacity-90 ${meta ? meta.color : 'bg-gray-100 text-gray-700'}`}
                              title="Open related location"
                            >
                              {meta ? meta.label : formatActionType(log.action_type)}
                            </button>
                          ) : (
                            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${meta ? meta.color : 'bg-gray-100 text-gray-700'}`}>
                              {meta ? meta.label : formatActionType(log.action_type)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            {renderDetails(log.action_type, log.details)}
                            {targetPath && (
                              <button
                                type="button"
                                onClick={() => navigate(targetPath)}
                                className="text-xs text-brand-deep hover:underline"
                              >
                                Open related location
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="border-t border-gray-200 px-6 py-4 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 text-sm text-brand-deep hover:underline disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : `Load more`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
