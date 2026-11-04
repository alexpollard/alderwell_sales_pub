import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, DocumentTextIcon, ArrowTrendingUpIcon, CheckCircleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { supabase } from '../utils/supabase';

// Turns a timestamp into something readable like "3 hours ago" or "2 weeks ago".
function formatRelativeTime(value, isDateOnly = false) {
  if (!value) return '—';
  const ts = isDateOnly ? `${value}T00:00:00` : value;
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return '—';

  const diffMs = Date.now() - parsed.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diffMs / day);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return parsed.toLocaleDateString('en-GB');
}

// Picks the 3 most recently touched documents from activity log events, skipping duplicates.
function uniqueRecentDocumentsFromActivity(events) {
  const byFileName = new Map();
  for (const event of events || []) {
    const fileName = event?.details?.file_name;
    if (!fileName || byFileName.has(fileName)) continue;
    byFileName.set(fileName, {
      document_id: `activity-${event.occurred_at}-${fileName}`,
      file_name: fileName,
      uploaded_at: event.occurred_at,
    });
    if (byFileName.size >= 3) break;
  }
  return Array.from(byFileName.values());
}

// Tidies up role strings so they always match the standard format stored in the database.
function normalizeRole(role) {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  if (['marketing', 'marketing_member', 'marketing_team'].includes(normalized)) {
    return 'marketing_team_member';
  }

  if (normalized === 'staff' || normalized === 'general') {
    return 'marketing_team_member';
  }

  return normalized || 'marketing_team_member';
}

// Returns the right label and colour for a campaign's status badge.
function campaignBadge(status) {
  if (status === 'active') return { label: 'Active', className: 'bg-brand-deep text-white' };
  if (status === 'archived') return { label: 'Completed', className: 'bg-gray-100 text-brand-deep' };
  if (status === 'pending_approval') return { label: 'Pending Approval', className: 'bg-yellow-100 text-yellow-800' };
  return { label: 'Draft', className: 'bg-brand-cream text-brand-deep' };
}

// Formats a date string into a readable date like "07 May 2026".
function formatFollowUpDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Returns true if a follow-up date has already passed.
function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
}

// Formats a number as GBP currency, e.g. 1500 → £1,500.
function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '£0';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(value));
}

export default function Dashboard({ allowedNav = [], userId = null }) {
  const navigate = useNavigate();

  // Page-level loading and error state.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // All the data shown on the dashboard.
  const [recentDocuments, setRecentDocuments] = useState([]);
  const [upcomingFollowUps, setUpcomingFollowUps] = useState([]);
  const [salesMetrics, setSalesMetrics] = useState({ interactions: 0, converted: 0, conversionRate: 0, revenue: 0 });
  const [campaignRevenue, setCampaignRevenue] = useState({});
  const [taskSummary, setTaskSummary] = useState({ todo: 0, inProgress: 0, completed: 0, blocked: 0, untakenForRole: 0 });
  const [campaigns, setCampaigns] = useState([]);

  useEffect(() => {
    if (!userId) {
      setLoading(true);
      setLoadError('');
      return undefined;
    }

    // Load all dashboard data once when the page opens.
    // All five requests run at the same time so the page loads quickly.
    let mounted = true;

    async function loadDashboardData() {
      setLoading(true);
      setLoadError('');

      try {
        // "Last 30 days" start date used for sales and campaign revenue figures.
        const metricStart = new Date();
        metricStart.setMonth(metricStart.getMonth() - 1);
        const metricStartIso = metricStart.toISOString().split('T')[0];

        const requests = await Promise.allSettled([
        // Request 1: recent documents this user has touched.
        (async () => {
          const { data: activityRows, error: activityError } = await supabase
            .from('activity_logs')
            .select('occurred_at, details')
            .eq('user_id', userId)
            .in('action_type', [
              'document_uploaded',
              'document_version_uploaded',
              'document_downloaded',
              'document_previewed',
            ])
            .order('occurred_at', { ascending: false })
            .limit(30);

          if (!activityError) {
            const recentFromActivity = uniqueRecentDocumentsFromActivity(activityRows || []);
            if (recentFromActivity.length > 0) {
              const fileNames = recentFromActivity.map((d) => d.file_name);
              const { data: docLookup } = await supabase
                .from('documents')
                .select('document_id, file_name')
                .in('file_name', fileNames)
                .eq('archive_status', false)
                .order('uploaded_at', { ascending: false });
              const idByFileName = {};
              for (const d of docLookup || []) {
                if (!idByFileName[d.file_name]) idByFileName[d.file_name] = d.document_id;
              }
              return {
                data: recentFromActivity.map((d) => ({
                  ...d,
                  document_id: idByFileName[d.file_name] || d.document_id,
                })),
              };
            }
          }

          const fallback = await supabase
            .from('documents')
            .select('document_id, file_name, uploaded_at')
            .eq('archive_status', false)
            .eq('uploaded_by', userId)
            .order('uploaded_at', { ascending: false })
            .limit(3);

          return fallback;
        })(),

        // Request 2: the next 3 incomplete follow-ups, soonest first.
        supabase
          .from('follow_ups')
          .select('follow_up_id, follow_up_date, outcome, interactions(hcp_name)')
          .eq('is_completed', false)
          .order('follow_up_date', { ascending: true })
          .limit(3),

        // Request 3: all interactions in the last 30 days for sales metrics.
        supabase
          .from('interactions')
          .select('interaction_id, did_convert, conversion_value, campaign_id')
          .gte('interaction_date', metricStartIso),

        // Request 4: task counts for this user.
        (async () => {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('company_role')
            .eq('user_id', userId)
            .maybeSingle();

          const normalizedRole = normalizeRole(profileRow?.company_role);

          const { data: taskRows, error } = await supabase
            .from('tasks')
            .select('task_id, task_status, assigned_role, assigned_user_id, taken_by')
            .eq('archive_status', false);

          if (error) return { error };

          const myTasks = (taskRows || []).filter(
            (task) => task.assigned_user_id === userId || task.taken_by === userId
          );

          const untakenRoleTasks = (taskRows || []).filter(
            (task) =>
              task.assigned_role === normalizedRole
              && !task.assigned_user_id
              && !task.taken_by
          );

          return {
            data: {
              todo: myTasks.filter((task) => task.task_status === 'pending').length,
              inProgress: myTasks.filter((task) => task.task_status === 'in_progress').length,
              completed: myTasks.filter((task) => task.task_status === 'done').length,
              blocked: myTasks.filter((task) => task.task_status === 'blocked').length,
              untakenForRole: untakenRoleTasks.length,
            },
          };
        })(),

        // Request 5: all non-archived campaigns for the campaign performance card.
        supabase
          .from('campaigns')
          .select('campaign_id, campaign_name, campaign_status, campaign_start_date, campaign_end_date, updated_at')
          .eq('archive_status', false)
          .order('updated_at', { ascending: false }),
      ]);

        if (!mounted) return;

        const [
          docsResult,
          followUpsResult,
          salesMetricsResult,
          scopedTasksResult,
          campaignsResult,
        ] = requests;

        if (docsResult.status === 'fulfilled' && !docsResult.value?.error) {
          setRecentDocuments(docsResult.value.data || []);
        } else {
          setRecentDocuments([]);
        }

        if (followUpsResult.status === 'fulfilled' && !followUpsResult.value?.error) {
          setUpcomingFollowUps(followUpsResult.value.data || []);
        } else {
          setUpcomingFollowUps([]);
        }

        if (salesMetricsResult.status === 'fulfilled' && !salesMetricsResult.value?.error) {
          const rows = salesMetricsResult.value.data || [];
          const interactions = rows.length;
          const converted = rows.filter((row) => Boolean(row.did_convert)).length;
          const conversionRate = interactions === 0 ? 0 : Math.round((converted / interactions) * 100);
          const revenue = rows.reduce((sum, row) => sum + (row.did_convert ? Number(row.conversion_value || 0) : 0), 0);
          setSalesMetrics({ interactions, converted, conversionRate, revenue });

          // Also build a revenue total per campaign from the same rows, used in the campaign card.
          const revenueMap = {};
          for (const row of rows) {
            if (row.did_convert && row.campaign_id && row.conversion_value) {
              revenueMap[row.campaign_id] = (revenueMap[row.campaign_id] || 0) + Number(row.conversion_value);
            }
          }
          setCampaignRevenue(revenueMap);
        } else {
          setSalesMetrics({ interactions: 0, converted: 0, conversionRate: 0, revenue: 0 });
          setCampaignRevenue({});
        }

        if (scopedTasksResult.status === 'fulfilled' && !scopedTasksResult.value?.error) {
          setTaskSummary(scopedTasksResult.value.data || { todo: 0, inProgress: 0, completed: 0, blocked: 0, untakenForRole: 0 });
        } else {
          setTaskSummary({ todo: 0, inProgress: 0, completed: 0, blocked: 0, untakenForRole: 0 });
        }

        if (campaignsResult.status === 'fulfilled' && !campaignsResult.value?.error) {
          setCampaigns(campaignsResult.value.data || []);
        } else {
          setCampaigns([]);
        }

        // If every single request failed, show an error message at the top.
        const hasAnySuccess = requests.some((result) => result.status === 'fulfilled' && !result.value?.error);
        if (!hasAnySuccess) {
          setLoadError('Could not load dashboard data right now.');
        }
      } catch (_error) {
        if (!mounted) return;
        setRecentDocuments([]);
        setUpcomingFollowUps([]);
        setSalesMetrics({ interactions: 0, converted: 0, conversionRate: 0, revenue: 0 });
        setCampaignRevenue({});
        setTaskSummary({ todo: 0, inProgress: 0, completed: 0, blocked: 0, untakenForRole: 0 });
        setCampaigns([]);
        setLoadError('Could not load dashboard data right now.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadDashboardData();
    return () => { mounted = false; };
  }, [userId]);

  // Counts and lists active/pending campaigns. Only shows up to 3 active campaigns in the card.
  const campaignSummary = useMemo(() => {
    const active = campaigns.filter((c) => c.campaign_status === 'active');
    const pending = campaigns.filter((c) => c.campaign_status === 'pending_approval');

    return {
      activeCount: active.length,
      pendingCount: pending.length,
      activeCampaigns: active.slice(0, 3),
    };
  }, [campaigns]);

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 mt-2">Overview of your recent activity.</p>
        {loadError ? <p className="text-sm text-red-600 mt-2">{loadError}</p> : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircleIcon className="h-5 w-5 text-brand-deep" />
            <h3 className="text-lg font-semibold text-gray-900">Tasks</h3>
          </div>
          <div className="space-y-3">
            <div className="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
              <p className="font-medium text-gray-700 text-sm">Group Tasks to be Taken</p>
              <p className="text-sm font-semibold text-gray-900">
                {taskSummary.untakenForRole} task{taskSummary.untakenForRole === 1 ? '' : 's'}
              </p>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Your Tasks</p>
              <div className="space-y-2">
                {[
                  { label: 'To Do', value: `${taskSummary.todo} task${taskSummary.todo === 1 ? '' : 's'}` },
                  { label: 'In Progress', value: `${taskSummary.inProgress} task${taskSummary.inProgress === 1 ? '' : 's'}` },
                  { label: 'Blocked', value: `${taskSummary.blocked} task${taskSummary.blocked === 1 ? '' : 's'}` },
                  { label: 'Completed', value: `${taskSummary.completed} task${taskSummary.completed === 1 ? '' : 's'}` },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <p className="font-medium text-gray-700 text-sm">{item.label}</p>
                    <p className="text-sm font-semibold text-gray-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {allowedNav.includes('tasks') ? (
            <button
              onClick={() => navigate('/tasks')}
              className="mt-4 w-full py-2 text-brand-deep hover:bg-brand-cream rounded-lg font-medium text-sm flex items-center justify-center gap-1"
            >
              My Tasks <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <ArrowTrendingUpIcon className="h-5 w-5 text-brand-deep" />
            <h3 className="text-lg font-semibold text-gray-900">Sales Activity</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Interactions (30d)', value: salesMetrics.interactions },
                { label: 'Converted', value: salesMetrics.converted },
                { label: 'Conversion Rate', value: `${salesMetrics.conversionRate}%` },
                { label: 'Revenue (30d)', value: formatCurrency(salesMetrics.revenue) },
              ].map((metric) => (
                <div key={metric.label} className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-lg font-bold text-brand-deep">{loading ? '—' : metric.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{metric.label}</p>
                </div>
              ))}
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Upcoming Follow-ups</p>
            {!loading && upcomingFollowUps.length === 0 ? (
              <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">No upcoming follow-ups.</p>
            ) : null}
            {(loading ? [] : upcomingFollowUps).map((fu) => {
              const overdue = isOverdue(fu.follow_up_date);
              return (
                <div key={fu.follow_up_id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 text-sm truncate">{fu.interactions?.hcp_name || '—'}</p>
                    <p className={`text-xs font-semibold ml-2 flex-shrink-0 ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
                      {overdue ? 'Overdue · ' : ''}{formatFollowUpDate(fu.follow_up_date)}
                    </p>
                  </div>
                  {fu.outcome ? (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{fu.outcome}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {allowedNav.includes('sales') ? (
            <button
              onClick={() => navigate('/sales')}
              className="mt-4 w-full py-2 text-brand-deep hover:bg-brand-cream rounded-lg font-medium text-sm flex items-center justify-center gap-1"
            >
              View Sales <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <DocumentTextIcon className="h-5 w-5 text-brand-deep" />
            <h3 className="text-lg font-semibold text-gray-900">Recent Documents</h3>
          </div>
          <div className="space-y-3">
            {(loading ? [] : recentDocuments).map((doc) => (
              <div
                key={doc.document_id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                onDoubleClick={() => {
                  const realId = doc.document_id && !doc.document_id.startsWith('activity-')
                    ? doc.document_id
                    : null;
                  navigate(realId ? `/documents?preview=${realId}` : '/documents');
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{doc.file_name}</p>
                  <p className="text-xs text-gray-500">{formatRelativeTime(doc.uploaded_at)}</p>
                </div>
              </div>
            ))}
            {!loading && recentDocuments.length === 0 ? (
              <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">No documents uploaded yet.</p>
            ) : null}
          </div>
          {allowedNav.includes('documents') ? (
            <button
              onClick={() => navigate('/documents')}
              className="mt-4 w-full py-2 text-brand-deep hover:bg-brand-cream rounded-lg font-medium text-sm flex items-center justify-center gap-1"
            >
              View All <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <SparklesIcon className="h-5 w-5 text-brand-deep" />
            <h3 className="text-lg font-semibold text-gray-900">Campaign Performance</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Active', value: campaignSummary.activeCount, color: 'text-brand-deep' },
                { label: 'Pending Approval', value: campaignSummary.pendingCount, color: 'text-yellow-700' },
                { label: 'Total Campaigns', value: campaigns.length, color: 'text-gray-700' },
                { label: 'Revenue (30d)', value: formatCurrency(Object.values(campaignRevenue).reduce((s, v) => s + v, 0)), color: 'text-brand-deep' },
              ].map((stat) => (
                <div key={stat.label} className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className={`text-xl font-bold ${stat.color}`}>{loading ? '—' : stat.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active Campaigns</p>
            {!loading && campaignSummary.activeCampaigns.length === 0 ? (
              <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">No active campaigns.</p>
            ) : null}
            {(loading ? [] : campaignSummary.activeCampaigns).map((campaign) => {
              const badge = campaignBadge(campaign.campaign_status);
              const rev = campaignRevenue[campaign.campaign_id];
              return (
                <div key={campaign.campaign_id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-gray-900 text-sm truncate pr-2">{campaign.campaign_name}</p>
                    <span className={`text-xs font-semibold px-2 py-1 rounded flex-shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Updated {formatRelativeTime(campaign.updated_at)}</p>
                    {rev != null ? (
                      <p className="text-xs font-semibold text-brand-deep">{formatCurrency(rev)}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {allowedNav.includes('campaigns') ? (
            <button
              onClick={() => navigate('/campaigns')}
              className="mt-4 w-full py-2 text-brand-deep hover:bg-brand-cream rounded-lg font-medium text-sm flex items-center justify-center gap-1"
            >
              View Campaigns <ArrowRightIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
