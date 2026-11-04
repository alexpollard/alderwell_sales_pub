import { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusIcon, CheckIcon, ClockIcon, XMarkIcon, ArchiveBoxIcon, ArchiveBoxArrowDownIcon } from '@heroicons/react/24/outline';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { supabase } from '../utils/supabase';
import { logActivity } from '../utils/logActivity';

// The types of interaction a sales rep can log.
const INTERACTION_TYPES = [
  { id: 'meeting',    label: 'Meeting' },
  { id: 'call',       label: 'Phone Call' },
  { id: 'email',      label: 'Email' },
  { id: 'conference', label: 'Conference' },
  { id: 'other',      label: 'Other' },
];

// Badge colours for each interaction type used in the table and quick-view panel.
const TYPE_COLORS = {
  meeting:    'bg-brand-mist text-white',
  call:       'bg-brand-sage text-brand-deep',
  email:      'bg-brand-cream text-brand-deep',
  conference: 'bg-blue-100 text-blue-800',
  other:      'bg-gray-100 text-gray-700',
};

// Follow-up purpose options shown when the original interaction didn't result in an order.
const PRE_PURCHASE_FOLLOW_UP_OPTIONS = [
  { label: 'Continue discussions', description: 'Use this when no order has been placed and you want to keep talks moving.' },
];

// Follow-up purpose options shown when the interaction already had an order.
const POST_PURCHASE_FOLLOW_UP_OPTIONS = [
  { label: 'Check-in', description: 'Use this after an order to check satisfaction, support needs, or next steps.' },
];

// The label shown when the user selects a custom follow-up purpose.
const OTHER_FOLLOW_UP_PURPOSE = 'Other';

// Short descriptions shown below the purpose dropdown to help the user pick the right option.
const FOLLOW_UP_TYPE_DESCRIPTION_BY_LABEL = {
  'Continue discussions': 'Use this when no order has been placed and you want to keep talks moving.',
  'Check-in': 'Use this after an order to check satisfaction, support needs, or next steps.',
  [OTHER_FOLLOW_UP_PURPOSE]: 'Use this if neither option fits. You can enter your own purpose.',
};

// Maps older/variant follow-up type labels to the current standard ones.
// Keeps historical data readable even if the labels have changed over time.
const FOLLOW_UP_TYPE_LABELS = {
  'Check-in': 'Check-in',
  'Check-in call': 'Check-in',
  'Status update': 'Continue discussions',
  'Relationship check-in': 'Check-in',
  'Relationship touchpoint': 'Check-in',
  'Product': 'Continue discussions',
  'Product discussion': 'Continue discussions',
  'Clinical': 'Continue discussions',
  'Clinical information follow-up': 'Continue discussions',
  'Commercial': 'Continue discussions',
  'Commercial discussion': 'Continue discussions',
  'Support': 'Check-in',
  'Support follow-up': 'Check-in',
  'Relationship': 'Check-in',
  'Routine check-in': 'Check-in',
  'Information request': 'Continue discussions',
  'Meeting follow-up': 'Continue discussions',
  'Commercial follow-up': 'Continue discussions',
  'Post-sale support': 'Check-in',
};

// Default empty state for the log interaction form.
const EMPTY_FORM = {
  hcp_name: '',
  interaction_type: '',
  interaction_date: new Date().toISOString().split('T')[0],
  notes: '',
  did_convert: false,
  conversion_value: '',
  quantity: '',
  product_name: '',
  campaign_id: '',
};

// Default empty state for the schedule follow-up form.
const EMPTY_FOLLOW_UP = {
  follow_up_type: '',
  follow_up_type_other: '',
  planned_notes: '',
  follow_up_date: '',
};

// Default empty state for the complete follow-up form.
const EMPTY_COMPLETE_FOLLOW_UP = {
  completion_notes: '',
  did_convert: false,
  conversion_value: '',
  quantity: '',
  product_name: '',
};

// Time period options for the metrics section at the top of the page.
const METRIC_PERIOD_OPTIONS = [
  { id: 'month', label: 'Last month' },
  { id: 'quarter', label: 'Last quarter' },
  { id: 'year', label: 'Last year' },
];

// Formats a date string into a readable date like "07 May 2026".
function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Returns true if a follow-up date has already passed.
function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
}

// Formats a number as GBP currency with two decimal places.
function formatMoney(value) {
  if (value == null || value === '') return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return null;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(numericValue);
}

// Converts a stored follow-up type value into a clean label for display.
function formatFollowUpType(type) {
  if (!type) return '—';
  return FOLLOW_UP_TYPE_LABELS[type] || type;
}

// Returns the start date (as an ISO string) for the selected metrics period.
function startDateForMetricPeriod(period) {
  const now = new Date();
  const start = new Date(now);

  if (period === 'quarter') {
    start.setMonth(now.getMonth() - 3);
  } else if (period === 'year') {
    start.setFullYear(now.getFullYear() - 1);
  } else {
    start.setMonth(now.getMonth() - 1);
  }

  return start.toISOString().split('T')[0];
}

// Returns the start and end dates for the period before the current one.
// Used to compare this period's revenue against the previous one.
function prevPeriodRange(period) {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);

  if (period === 'quarter') {
    end.setMonth(now.getMonth() - 3);
    start.setMonth(now.getMonth() - 6);
  } else if (period === 'year') {
    end.setFullYear(now.getFullYear() - 1);
    start.setFullYear(now.getFullYear() - 2);
  } else {
    end.setMonth(now.getMonth() - 1);
    start.setMonth(now.getMonth() - 2);
  }

  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
}

// The sales activity page. Shows metrics, pending follow-ups, an interaction table, and charts.
export default function SalesActivityLogging({ personName = 'Unknown' }) {
  // The full interaction list and the pending follow-up queue.
  const [interactions, setInteractions] = useState([]);
  const [pendingFollowUps, setPendingFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  // Active campaigns are needed for the optional campaign link on the log form.
  const [activeCampaigns, setActiveCampaigns] = useState([]);
  // The currently selected time window for the metrics tiles and charts.
  const [metricPeriod, setMetricPeriod] = useState('month');
  // Interactions within the selected period (and the one before it, for comparison).
  const [metricInteractions, setMetricInteractions] = useState([]);
  const [prevMetricInteractions, setPrevMetricInteractions] = useState([]);
  // Controls the log interaction slide-over and the archived view toggle.
  const [logInteractionOpen, setLogInteractionOpen] = useState(false);
  const [showArchivedInteractions, setShowArchivedInteractions] = useState(false);

  // Log interaction form values.
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);
  // Set to true when completing a follow-up that already has an order, to prompt a new interaction.
  const [isAdditionalOrderFlow, setIsAdditionalOrderFlow] = useState(false);

  // Which interaction row is expanded to show its follow-ups inline.
  const [expandedId, setExpandedId] = useState(null);
  const [followUpsByInteraction, setFollowUpsByInteraction] = useState({});

  // Schedule follow-up modal — holds the interaction being followed up.
  const [followUpModal, setFollowUpModal] = useState(null);
  const [followUpForm, setFollowUpForm] = useState(EMPTY_FOLLOW_UP);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  // Complete follow-up modal.
  const [completeFollowUpModal, setCompleteFollowUpModal] = useState(null);
  const [completeFollowUpForm, setCompleteFollowUpForm] = useState(EMPTY_COMPLETE_FOLLOW_UP);
  const [completingFollowUp, setCompletingFollowUp] = useState(false);

  // Search, filter and sort controls for the interactions table.
  const [interactionManagement, setInteractionManagement] = useState({
    search: '',
    type: 'all',
    converted: 'all',
    sortBy: 'latest',
  });

  // Loads interactions, pending follow-ups, and metric data for the selected time period.
  const loadData = useCallback(async () => {
    setLoading(true);
    const metricStartDate = startDateForMetricPeriod(metricPeriod);

    // All four requests run at the same time for speed.
    const [{ data: ints }, { data: fps }, { data: metricRows }, { data: prevRows }] = await Promise.all([
      supabase
        .from('interactions')
        .select('interaction_id, employee_id, hcp_name, interaction_type, interaction_date, notes, created_at, did_convert, conversion_value, quantity, product_name, campaign_id, is_archived, campaigns(campaign_name), follow_ups(follow_up_id, is_completed)')
        .order('interaction_date', { ascending: false })
        .limit(500),

      // Pending follow-ups the current user needs to action. The database restricts what each role can see.
      supabase
        .from('follow_ups')
        .select('follow_up_id, interaction_id, outcome, next_steps, follow_up_date, is_completed, interactions(hcp_name, campaign_id, did_convert, conversion_value, product_name)')
        .eq('is_completed', false)
        .order('follow_up_date', { ascending: true })
        .limit(50),

      supabase
        .from('interactions')
        .select('interaction_id, interaction_date, did_convert, conversion_value')
        .gte('interaction_date', metricStartDate),

      (() => {
        const [prevStart, prevEnd] = prevPeriodRange(metricPeriod);
        return supabase
          .from('interactions')
          .select('interaction_id, interaction_date, did_convert, conversion_value')
          .gte('interaction_date', prevStart)
          .lt('interaction_date', prevEnd);
      })(),
    ]);

    // The database handles access control — sales reps see only their own follow-ups.
    setInteractions(ints || []);
    setPendingFollowUps(fps || []);
    setMetricInteractions(metricRows || []);
    setPrevMetricInteractions(prevRows || []);
    setLoading(false);
  }, [metricPeriod]);

  const loadActiveCampaigns = useCallback(async () => {
    // Only active campaigns are offered in the dropdown — no point linking to drafts or archived ones.
    const { data } = await supabase
      .from('campaigns')
      .select('campaign_id, campaign_name')
      .eq('campaign_status', 'active')
      .order('campaign_name', { ascending: true });
    setActiveCampaigns(data || []);
  }, []);

  useEffect(() => {
    // Load everything when the page opens, and again whenever the metric period changes.
    let mounted = true;
    async function init() {
      if (mounted) await Promise.all([loadData(), loadActiveCampaigns()]);
    }
    init();
    return () => { mounted = false; };
  }, [loadData, loadActiveCampaigns]);

  // Fetches all follow-ups for one interaction and stores them so the expanded row can show them.
  async function refreshFollowUpsForInteraction(interactionId) {
    if (!interactionId) return;
    const { data } = await supabase
      .from('follow_ups')
      .select('follow_up_id, outcome, next_steps, follow_up_date, is_completed, created_at')
      .eq('interaction_id', interactionId)
      .order('created_at', { ascending: true });
    setFollowUpsByInteraction((prev) => ({ ...prev, [interactionId]: data || [] }));
  }

  // Saves a new interaction to the database and briefly shows a success message before closing.
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.hcp_name.trim() || !form.interaction_date) return;
    if (form.did_convert && !form.conversion_value) {
      setSubmitMessage({ type: 'error', text: 'Please enter an order value when marking an interaction as converted.' });
      return;
    }
    setSubmitting(true);
    setSubmitMessage(null);

    const { data: { user } } = await supabase.auth.getUser();
    // campaign_id is optional — the column allows null.
    const { error } = await supabase.from('interactions').insert({
      employee_id: user.id,
      hcp_name: form.hcp_name.trim(),
      interaction_type: form.interaction_type,
      interaction_date: form.interaction_date,
      notes: form.notes.trim() || null,
      did_convert: form.did_convert,
      conversion_value: form.did_convert ? Number(form.conversion_value) : null,
      quantity: form.did_convert && form.quantity ? Number(form.quantity) : null,
      product_name: form.did_convert ? (form.product_name.trim() || null) : null,
      campaign_id: isAdditionalOrderFlow ? null : (form.campaign_id || null),
    });

    setSubmitting(false);
    if (error) {
      setSubmitMessage({ type: 'error', text: error.message });
      return;
    }

    // lightweight audit trail used by the global audit log screen
    logActivity(personName, 'interaction_logged', {
      hcp: form.hcp_name.trim(),
      type: form.interaction_type,
      did_convert: form.did_convert,
    });
    setSubmitMessage({ type: 'success', text: 'Interaction logged.' });
    setForm(EMPTY_FORM);
    setIsAdditionalOrderFlow(false);
    // Close the modal after a short delay so the user sees the success message.
    setTimeout(() => { setLogInteractionOpen(false); setSubmitMessage(null); }, 1200);
    loadData();
  }

  // Toggles the archive status of an interaction (hide it without deleting).
  async function archiveInteraction(interactionId, archive) {
    await supabase
      .from('interactions')
      .update({ is_archived: archive })
      .eq('interaction_id', interactionId);
    setInteractions((prev) =>
      prev.map((r) => r.interaction_id === interactionId ? { ...r, is_archived: archive } : r),
    );
  }

  // Expands or collapses the follow-up detail row for an interaction.
  // Follow-ups are loaded from the database the first time the row is opened, then cached.
  async function handleExpandInteraction(interaction) {
    const id = interaction.interaction_id;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!followUpsByInteraction[id]) {
      const { data } = await supabase
        .from('follow_ups')
        .select('follow_up_id, outcome, next_steps, follow_up_date, is_completed, created_at')
        .eq('interaction_id', id)
        .order('created_at', { ascending: false });
      setFollowUpsByInteraction((prev) => ({ ...prev, [id]: data || [] }));
    }
  }

  // Saves a new follow-up record linked to the interaction.
  async function handleLogFollowUp(e) {
    e.preventDefault();
    if (!followUpModal) return;
    if (!followUpForm.follow_up_type) {
      alert('Please select a follow-up purpose.');
      return;
    }
    if (!followUpForm.follow_up_date) {
      alert('Please choose a planned follow-up date.');
      return;
    }
    if (followUpForm.follow_up_type === OTHER_FOLLOW_UP_PURPOSE && !followUpForm.follow_up_type_other.trim()) {
      alert('Please enter a custom follow-up purpose.');
      return;
    }

    const resolvedPurpose = followUpForm.follow_up_type === OTHER_FOLLOW_UP_PURPOSE
      ? followUpForm.follow_up_type_other.trim()
      : followUpForm.follow_up_type.trim();

    setSavingFollowUp(true);

    const { data: { user } } = await supabase.auth.getUser();
    const followUpPayload = {
      interaction_id: followUpModal.interaction_id,
      employee_id: user.id,
      outcome: resolvedPurpose || null,
      next_steps: followUpForm.planned_notes.trim() || null,
      follow_up_date: followUpForm.follow_up_date || null,
      is_completed: false,
    };

    const { error } = await supabase.from('follow_ups').insert(followUpPayload);

    setSavingFollowUp(false);
    if (error) { alert('Error: ' + error.message); return; }

    logActivity(personName, 'follow_up_logged', { hcp: followUpModal.hcp_name });
    await refreshFollowUpsForInteraction(followUpModal.interaction_id);
    setFollowUpModal(null);
    setFollowUpForm(EMPTY_FOLLOW_UP);
    loadData();
  }

  // Opens the complete follow-up modal and resets its form.
  function markComplete(followUp) {
    setCompleteFollowUpModal(followUp);
    setCompleteFollowUpForm(EMPTY_COMPLETE_FOLLOW_UP);
  }

  // Used when a follow-up's linked interaction already has an order and the user wants to log another one.
  // Marks the follow-up as complete and then opens the log form pre-filled for the same HCP.
  async function promptNewInteractionForAdditionalOrder() {
    if (!completeFollowUpModal) return;

    setCompletingFollowUp(true);

    const timestamp = new Date().toLocaleDateString('en-GB');
    const systemNote = `System note: Follow-up completed via additional-order flow. User prompted to log a new interaction on ${timestamp}.`;
    const existingNotes = completeFollowUpModal.next_steps?.trim() || '';
    const mergedNotes = existingNotes ? `${existingNotes}\n${systemNote}` : systemNote;

    const { error } = await supabase
      .from('follow_ups')
      .update({
        is_completed: true,
        next_steps: mergedNotes,
      })
      .eq('follow_up_id', completeFollowUpModal.follow_up_id);

    if (error) {
      setCompletingFollowUp(false);
      alert('Could not complete this follow-up before creating a new interaction: ' + error.message);
      return;
    }

    setPendingFollowUps((prev) => prev.filter((fp) => fp.follow_up_id !== completeFollowUpModal.follow_up_id));
    await refreshFollowUpsForInteraction(completeFollowUpModal.interaction_id);

    setForm((prev) => ({
      ...prev,
      hcp_name: completeFollowUpModal.interactions?.hcp_name || prev.hcp_name,
      campaign_id: '',
      interaction_date: new Date().toISOString().split('T')[0],
      did_convert: true,
      conversion_value: '',
      quantity: '',
      product_name: '',
    }));
    setIsAdditionalOrderFlow(true);
    setSubmitMessage({
      type: 'success',
      text: 'Follow-up completed. Log a new converted interaction below for the additional order. Campaign linking is disabled for this flow.',
    });
    logActivity(personName, 'follow_up_completed', {
      hcp: completeFollowUpModal.interactions?.hcp_name || null,
      additional_order_prompted: true,
    });
    setCompletingFollowUp(false);
    setCompleteFollowUpModal(null);
    setCompleteFollowUpForm(EMPTY_COMPLETE_FOLLOW_UP);
    setLogInteractionOpen(true);
    loadData();
  }

  // Marks a follow-up as complete. If an order was recorded, updates the linked interaction too.
  async function handleCompleteFollowUp(e) {
    e.preventDefault();
    if (!completeFollowUpModal) return;
    if (completeFollowUpForm.did_convert && !completeFollowUpForm.conversion_value) {
      alert('Please enter an order value before completing this follow-up.');
      return;
    }

    setCompletingFollowUp(true);

    const { error } = await supabase
      .from('follow_ups')
      .update({
        is_completed: true,
        next_steps: completeFollowUpForm.completion_notes.trim() || completeFollowUpModal.next_steps || null,
      })
      .eq('follow_up_id', completeFollowUpModal.follow_up_id);

    if (error) {
      setCompletingFollowUp(false);
      alert(error.message);
      return;
    }

    if (completeFollowUpForm.did_convert && !completeFollowUpModal.interactions?.did_convert) {
      const { error: interactionError } = await supabase
        .from('interactions')
        .update({
          did_convert: true,
          conversion_value: Number(completeFollowUpForm.conversion_value),
          quantity: completeFollowUpForm.quantity ? Number(completeFollowUpForm.quantity) : null,
          product_name: completeFollowUpForm.product_name.trim() || null,
        })
        .eq('interaction_id', completeFollowUpModal.interaction_id);

      if (interactionError) {
        setCompletingFollowUp(false);
        alert('Follow-up completed, but order details could not be saved: ' + interactionError.message);
        return;
      }
    }

    setPendingFollowUps((prev) => prev.filter((fp) => fp.follow_up_id !== completeFollowUpModal.follow_up_id));
    await refreshFollowUpsForInteraction(completeFollowUpModal.interaction_id);
    setCompletingFollowUp(false);
    setCompleteFollowUpModal(null);
    setCompleteFollowUpForm(EMPTY_COMPLETE_FOLLOW_UP);
    logActivity(personName, 'follow_up_completed', { hcp: completeFollowUpModal.interactions?.hcp_name || null });
    loadData();
  }

  // Calculates the summary numbers shown in the metrics tiles at the top of the page.
  const salesMetrics = useMemo(() => {
    const totalInteractions = metricInteractions.length;
    const convertedInteractions = metricInteractions.filter((row) => row.did_convert).length;
    const conversionRate = totalInteractions === 0 ? 0 : (convertedInteractions / totalInteractions) * 100;
    const totalRevenue = metricInteractions.reduce((sum, row) => {
      if (!row.did_convert || row.conversion_value == null) return sum;
      return sum + Number(row.conversion_value || 0);
    }, 0);
    const prevRevenue = prevMetricInteractions.reduce((sum, row) => {
      if (!row.did_convert || row.conversion_value == null) return sum;
      return sum + Number(row.conversion_value || 0);
    }, 0);
    const revenueChange = prevRevenue === 0 ? null : ((totalRevenue - prevRevenue) / prevRevenue) * 100;
    const overdueFollowUps = pendingFollowUps.filter((fp) => isOverdue(fp.follow_up_date)).length;

    return {
      totalInteractions,
      convertedInteractions,
      conversionRate,
      totalRevenue,
      prevRevenue,
      revenueChange,
      pendingFollowUps: pendingFollowUps.length,
      overdueFollowUps,
    };
  }, [metricInteractions, prevMetricInteractions, pendingFollowUps]);

  // Groups interactions into time buckets (day/week/month) for the two charts below.
  const chartData = useMemo(() => {
    if (!metricInteractions.length) return [];

    // Bucket key depends on the selected period: daily for month, weekly for quarter, monthly for year.
    function bucketKey(dateStr) {
      const d = new Date(dateStr);
      if (metricPeriod === 'year') {
        // YYYY-MM
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (metricPeriod === 'quarter') {
        // ISO week label: Mon dd
        const weekStart = new Date(d);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day; // Monday
        weekStart.setDate(d.getDate() + diff);
        return weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      }
      // month → daily
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }

    const buckets = {};
    for (const row of metricInteractions) {
      const key = bucketKey(row.interaction_date);
      if (!buckets[key]) buckets[key] = { label: key, interactions: 0, converted: 0, revenue: 0 };
      buckets[key].interactions += 1;
      if (row.did_convert) {
        buckets[key].converted += 1;
        buckets[key].revenue += Number(row.conversion_value || 0);
      }
    }

    // Sort the buckets in date order so the chart reads left to right.
    const sortedRows = [...metricInteractions].sort((a, b) => new Date(a.interaction_date) - new Date(b.interaction_date));
    const seenOrder = [];
    const seen = new Set();
    for (const row of sortedRows) {
      const k = bucketKey(row.interaction_date);
      if (!seen.has(k)) { seen.add(k); seenOrder.push(k); }
    }

    return seenOrder.map((k) => ({
      ...buckets[k],
      rate: buckets[k].interactions === 0 ? 0 : +((buckets[k].converted / buckets[k].interactions) * 100).toFixed(1),
    }));
  }, [metricInteractions, metricPeriod]);

  // The 5 most recent non-archived interactions for the compact quick-view panel on the right.
  const recentInteractions = useMemo(() =>
    interactions.filter((r) => !r.is_archived).slice(0, 5),
  [interactions]);

  // Applies the search, type filter, converted filter, and sort order to the full interaction list.
  const managedInteractions = useMemo(() => {
    const query = interactionManagement.search.trim().toLowerCase();

    const filtered = interactions.filter((row) => {
      const archivedMatch = showArchivedInteractions ? row.is_archived : !row.is_archived;
      const typeMatch = interactionManagement.type === 'all' || row.interaction_type === interactionManagement.type;
      const convertedMatch = interactionManagement.converted === 'all'
        || (interactionManagement.converted === 'converted' && row.did_convert)
        || (interactionManagement.converted === 'non_converted' && !row.did_convert);

      const searchMatch = !query || [
        row.hcp_name,
        row.notes,
        row.product_name,
        row.campaigns?.campaign_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));

      return archivedMatch && typeMatch && convertedMatch && searchMatch;
    });

    return filtered.sort((a, b) => {
      if (interactionManagement.sortBy === 'oldest') {
        return new Date(a.interaction_date || a.created_at || 0) - new Date(b.interaction_date || b.created_at || 0);
      }
      if (interactionManagement.sortBy === 'highest_value') {
        return Number(b.conversion_value || 0) - Number(a.conversion_value || 0);
      }
      return new Date(b.interaction_date || b.created_at || 0) - new Date(a.interaction_date || a.created_at || 0);
    });
  }, [interactions, interactionManagement, showArchivedInteractions]);

  // Render
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold text-gray-900">Sales Activity Logging</h2>
        <button
          onClick={() => { setLogInteractionOpen(true); setSubmitMessage(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-medium"
        >
          <PlusIcon className="h-4 w-4" />
          Log New Interaction
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-800">Sales Metrics</p>
            <p className="text-xs text-gray-500">Interactions, conversion and sales value use the selected period.</p>
          </div>
          <select
            value={metricPeriod}
            onChange={(e) => setMetricPeriod(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {METRIC_PERIOD_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Interactions ({METRIC_PERIOD_OPTIONS.find((p) => p.id === metricPeriod)?.label})</p>
          <p className="text-2xl font-bold text-gray-900">{salesMetrics.totalInteractions}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Converted</p>
          <p className="text-2xl font-bold text-green-700">{salesMetrics.convertedInteractions}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Conversion Rate</p>
          <p className="text-2xl font-bold text-gray-900">{salesMetrics.conversionRate.toFixed(1)}%</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Sales Value</p>
          <p className="text-2xl font-bold text-brand-deep">{formatMoney(salesMetrics.totalRevenue) || '£0.00'}</p>
          {salesMetrics.revenueChange !== null && (
            <p className={`text-xs mt-1 font-medium ${salesMetrics.revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {salesMetrics.revenueChange >= 0 ? '▲' : '▼'} {Math.abs(salesMetrics.revenueChange).toFixed(1)}% vs prev period
            </p>
          )}
          {salesMetrics.revenueChange === null && salesMetrics.prevRevenue === 0 && (
            <p className="text-xs mt-1 text-gray-400">No data prev period</p>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Pending Follow-Ups (Current)</p>
          <p className="text-2xl font-bold text-orange-700">{salesMetrics.pendingFollowUps}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Overdue Follow-Ups (Current)</p>
          <p className={`text-2xl font-bold ${salesMetrics.overdueFollowUps > 0 ? 'text-red-700' : 'text-gray-900'}`}>{salesMetrics.overdueFollowUps}</p>
        </div>
      </div>

      {/* Pending Follow-Ups */}
      {pendingFollowUps.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ClockIcon className="h-5 w-5 text-orange-500" />
            Pending Follow-Ups
            <span className="ml-auto text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              {pendingFollowUps.length}
            </span>
          </h3>

          <div className="space-y-3">
            {pendingFollowUps.map((fp) => (
              <div
                key={fp.follow_up_id}
                className={`flex items-start gap-4 p-4 rounded-lg border ${isOverdue(fp.follow_up_date) ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {fp.interactions?.hcp_name || '—'}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">Purpose: {formatFollowUpType(fp.outcome)}</p>
                  {fp.next_steps && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">Plan: {fp.next_steps}</p>
                  )}
                  {fp.follow_up_date && (
                    <p className={`text-xs mt-1 font-medium ${isOverdue(fp.follow_up_date) ? 'text-red-600' : 'text-gray-500'}`}>
                      Planned: {formatDate(fp.follow_up_date)}
                      {isOverdue(fp.follow_up_date) && ' · Overdue'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => markComplete(fp)}
                  title="Complete and add details"
                  className="flex-shrink-0 p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                >
                  <CheckIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Interactions + Recent Interactions side by side */}
      <div className="flex gap-4 items-start">

      {/* All Interactions table — 2/3 width */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 flex-[2] min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-gray-900 flex-1">All Interactions</h3>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => setShowArchivedInteractions((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${showArchivedInteractions ? 'bg-gray-100 border-gray-300 text-gray-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              <ArchiveBoxIcon className="h-3.5 w-3.5" />
              {showArchivedInteractions ? 'Viewing Archived' : 'Show Archived'}
            </button>
            <input
              type="text"
              value={interactionManagement.search}
              onChange={(e) => setInteractionManagement((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Search HCP, notes, campaign…"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist w-40"
            />
            <select
              value={interactionManagement.type}
              onChange={(e) => setInteractionManagement((prev) => ({ ...prev, type: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
            >
              <option value="all">All types</option>
              {INTERACTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select
              value={interactionManagement.converted}
              onChange={(e) => setInteractionManagement((prev) => ({ ...prev, converted: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
            >
              <option value="all">All outcomes</option>
              <option value="converted">Converted</option>
              <option value="non_converted">Not converted</option>
            </select>
            <select
              value={interactionManagement.sortBy}
              onChange={(e) => setInteractionManagement((prev) => ({ ...prev, sortBy: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
            >
              <option value="latest">Latest</option>
              <option value="oldest">Oldest</option>
              <option value="highest_value">Highest value</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-4">Loading…</p>
        ) : managedInteractions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No interactions match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">HCP</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">Type</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">Date</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">Campaign</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">Outcome</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2">Notes</th>
                  <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-4">Follow-Ups</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {managedInteractions.map((int) => (
                  <>
                    <tr
                      key={int.interaction_id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleExpandInteraction(int)}
                    >
                      <td className="py-3 pr-4 font-medium text-gray-900 whitespace-nowrap">{int.hcp_name}</td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_COLORS[int.interaction_type] || TYPE_COLORS.other}`}>
                          {INTERACTION_TYPES.find((t) => t.id === int.interaction_type)?.label || int.interaction_type}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{formatDate(int.interaction_date)}</td>
                      <td className="py-3 pr-4">
                        {int.campaigns?.campaign_name ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-cream text-brand-deep font-medium whitespace-nowrap">
                            {int.campaigns.campaign_name}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 pr-4">
                        {int.did_convert ? (
                          <div className="flex flex-wrap gap-1">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Converted</span>
                            {formatMoney(int.conversion_value) && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{formatMoney(int.conversion_value)}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Not converted</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-400 max-w-xs">
                        {int.notes ? <span className="line-clamp-1">{int.notes}</span> : <span>—</span>}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        {(() => {
                          const fus = int.follow_ups || [];
                          const total = fus.length;
                          const pending = fus.filter((f) => !f.is_completed).length;
                          if (total === 0) return <span className="text-xs text-gray-300">No follow-ups</span>;
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pending > 0 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                              {pending > 0 ? `${pending} pending` : 'All done'} · {total} total
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!int.is_archived && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setFollowUpModal(int); setFollowUpForm(EMPTY_FOLLOW_UP); }}
                              title="Schedule Follow-Up"
                              className="flex items-center gap-1 text-xs text-brand-deep hover:bg-brand-cream px-2 py-1 rounded transition-colors whitespace-nowrap"
                            >
                              <PlusIcon className="h-3 w-3" />
                              Follow-Up
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); archiveInteraction(int.interaction_id, !int.is_archived); }}
                            title={int.is_archived ? 'Unarchive' : 'Archive'}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          >
                            {int.is_archived ? <ArchiveBoxArrowDownIcon className="h-4 w-4" /> : <ArchiveBoxIcon className="h-4 w-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === int.interaction_id && (
                      <tr key={`${int.interaction_id}-expand`}>
                        <td colSpan={8} className="bg-gray-50 px-4 py-3 border-b border-gray-100">
                          {(followUpsByInteraction[int.interaction_id] || []).length > 0 ? (
                            <div className="grid grid-cols-4 gap-2">
                              {followUpsByInteraction[int.interaction_id].map((fu, idx) => (
                                <div key={fu.follow_up_id} className="text-xs bg-white rounded border border-gray-200 px-3 py-2 space-y-0.5">
                                  <p className="text-gray-400 font-medium mb-1">#{idx + 1}</p>
                                  {fu.outcome && <p className="font-medium text-gray-800">Purpose: {formatFollowUpType(fu.outcome)}</p>}
                                  {fu.next_steps && <p className="text-gray-500">Details: {fu.next_steps}</p>}
                                  {fu.follow_up_date && <p className="text-gray-400">Planned: {formatDate(fu.follow_up_date)}</p>}
                                  <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded ${fu.is_completed ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                    {fu.is_completed ? 'Completed' : 'Pending'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400">No follow-ups logged yet.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Interactions — compact quick-view, 1/3 width */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 flex-[1] min-w-0">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Interactions</h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : recentInteractions.length === 0 ? (
          <p className="text-sm text-gray-400">No interactions logged yet.</p>
        ) : (
          <div className="space-y-2">
            {recentInteractions.map((int) => (
              <div key={int.interaction_id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{int.hcp_name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[int.interaction_type] || TYPE_COLORS.other}`}>
                      {INTERACTION_TYPES.find((t) => t.id === int.interaction_type)?.label || int.interaction_type}
                    </span>
                    {int.did_convert && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                        Converted {formatMoney(int.conversion_value) ? `· ${formatMoney(int.conversion_value)}` : ''}
                      </span>
                    )}
                    {int.campaigns?.campaign_name && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand-cream text-brand-deep font-medium">
                        {int.campaigns.campaign_name}
                      </span>
                    )}
                  </div>
                  {int.notes && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{int.notes}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(int.interaction_date)}</p>
                </div>
                <button
                  onClick={() => { setFollowUpModal(int); setFollowUpForm(EMPTY_FOLLOW_UP); }}
                  title="Schedule Follow-Up"
                  className="flex-shrink-0 flex items-center gap-1 text-xs text-brand-deep hover:bg-brand-cream px-2 py-1 rounded transition-colors whitespace-nowrap"
                >
                  <PlusIcon className="h-3 w-3" />
                  Follow-Up
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      </div>{/* end flex row */}

      {/* Log New Interaction Modal */}
      {logInteractionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 pb-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Log New Interaction</h3>
                {isAdditionalOrderFlow && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1">
                    Follow-up completed. Log the additional order below. Campaign linking is disabled for this flow.
                  </p>
                )}
              </div>
              <button
                onClick={() => { setLogInteractionOpen(false); setSubmitMessage(null); setForm(EMPTY_FORM); setIsAdditionalOrderFlow(false); }}
                className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              {submitMessage && (
                <div className={`mb-4 px-4 py-2 rounded-lg text-sm border ${submitMessage.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                  {submitMessage.text}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Healthcare Professional Name (HCP) *</label>
                  <input
                    type="text"
                    value={form.hcp_name}
                    onChange={(e) => setForm((p) => ({ ...p, hcp_name: e.target.value }))}
                    placeholder="Dr. First Last"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select
                      value={form.interaction_type}
                      onChange={(e) => setForm((p) => ({ ...p, interaction_type: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                    >
                      <option value="" disabled>Please select</option>
                      {INTERACTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                    <input
                      type="date"
                      value={form.interaction_date}
                      onChange={(e) => setForm((p) => ({ ...p, interaction_date: e.target.value }))}
                      onClick={(e) => e.target.showPicker()}
                      onKeyDown={(e) => e.preventDefault()}
                      required
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Link to Campaign <span className="text-gray-400 font-normal">(optional)</span></label>
                  {isAdditionalOrderFlow ? (
                    <>
                      <select
                        value=""
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-100 text-gray-500 cursor-not-allowed"
                      >
                        <option>Disabled for additional-order interactions</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Additional orders are captured as standalone interactions and cannot be linked to a campaign.</p>
                    </>
                  ) : activeCampaigns.length === 0 ? (
                    <p className="text-sm text-gray-400 italic px-1">No active campaigns at the moment.</p>
                  ) : (
                    <select
                      value={form.campaign_id}
                      onChange={(e) => setForm((p) => ({ ...p, campaign_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                    >
                      <option value="">No campaign</option>
                      {activeCampaigns.map((c) => (
                        <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 p-4 space-y-4 bg-gray-50">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Did this interaction result in an order?</p>
                      <p className="text-xs text-gray-500">Capture outcome details here if the customer purchased from Alderwell.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.did_convert}
                        onChange={(e) => setForm((p) => ({
                          ...p,
                          did_convert: e.target.checked,
                          conversion_value: e.target.checked ? p.conversion_value : '',
                          quantity: e.target.checked ? p.quantity : '',
                          product_name: e.target.checked ? p.product_name : '',
                        }))}
                        className="h-4 w-4 rounded border-gray-300 text-brand-deep focus:ring-brand-mist"
                      />
                      Yes
                    </label>
                  </div>

                  {form.did_convert && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Order Value (£) *</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.conversion_value}
                          onChange={(e) => setForm((p) => ({ ...p, conversion_value: e.target.value }))}
                          placeholder="0.00"
                          required={form.did_convert}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quantity <span className="text-gray-400 font-normal">(optional)</span></label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={form.quantity}
                          onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
                          placeholder="Units purchased"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product Name <span className="text-gray-400 font-normal">(optional)</span></label>
                        <input
                          type="text"
                          value={form.product_name}
                          onChange={(e) => setForm((p) => ({ ...p, product_name: e.target.value }))}
                          placeholder="Product or pack name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="What was discussed..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => { setLogInteractionOpen(false); setSubmitMessage(null); setForm(EMPTY_FORM); setIsAdditionalOrderFlow(false); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !form.interaction_type}
                    className="px-5 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Log Interaction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Follow-Up Modal */}
      {followUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Schedule Follow-Up</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {followUpModal.did_convert
                    ? 'This interaction already has an order, so use Check-in for post-purchase follow-up.'
                    : 'No order yet, so use Continue discussions to keep the conversation moving.'}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">{followUpModal.hcp_name} · {formatDate(followUpModal.interaction_date)}</p>
              </div>
              <button onClick={() => setFollowUpModal(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleLogFollowUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Follow-Up Purpose</label>
                <select
                  value={followUpForm.follow_up_type}
                  onChange={(e) => setFollowUpForm((p) => ({
                    ...p,
                    follow_up_type: e.target.value,
                    follow_up_type_other: e.target.value === OTHER_FOLLOW_UP_PURPOSE ? p.follow_up_type_other : '',
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                >
                  <option value="">Select follow-up purpose...</option>
                  {(followUpModal.did_convert ? POST_PURCHASE_FOLLOW_UP_OPTIONS : PRE_PURCHASE_FOLLOW_UP_OPTIONS).map((followUpType) => (
                    <option key={followUpType.label} value={followUpType.label}>{followUpType.label}</option>
                  ))}
                  <option value={OTHER_FOLLOW_UP_PURPOSE}>Other</option>
                </select>
                {followUpForm.follow_up_type && (
                  <p className="text-xs text-gray-500 mt-1">
                    {FOLLOW_UP_TYPE_DESCRIPTION_BY_LABEL[followUpForm.follow_up_type] || ''}
                  </p>
                )}
                {followUpForm.follow_up_type === OTHER_FOLLOW_UP_PURPOSE && (
                  <div className="mt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Custom Purpose *</label>
                    <input
                      type="text"
                      value={followUpForm.follow_up_type_other}
                      onChange={(e) => setFollowUpForm((p) => ({ ...p, follow_up_type_other: e.target.value }))}
                      placeholder="Enter custom follow-up purpose"
                      required={followUpForm.follow_up_type === OTHER_FOLLOW_UP_PURPOSE}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Planning Notes</label>
                <textarea
                  value={followUpForm.planned_notes}
                  onChange={(e) => setFollowUpForm((p) => ({ ...p, planned_notes: e.target.value }))}
                  placeholder="Optional: what should be covered during this follow-up?"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Planned Date</label>
                <input
                  type="date"
                  value={followUpForm.follow_up_date}
                  onChange={(e) => setFollowUpForm((p) => ({ ...p, follow_up_date: e.target.value }))}
                  onClick={(e) => e.target.showPicker()}
                  onKeyDown={(e) => e.preventDefault()}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist cursor-pointer"
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setFollowUpModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFollowUp}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                >
                  {savingFollowUp ? 'Saving…' : 'Schedule Follow-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {completeFollowUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Complete Follow-Up</h3>
                <p className="text-xs text-gray-500 mt-1">Record what happened during this follow-up.</p>
                <p className="text-sm text-gray-500 mt-0.5">{completeFollowUpModal.interactions?.hcp_name || '—'} · {formatFollowUpType(completeFollowUpModal.outcome) || 'No type'}</p>
              </div>
              <button onClick={() => setCompleteFollowUpModal(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteFollowUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Completion Notes</label>
                <textarea
                  value={completeFollowUpForm.completion_notes}
                  onChange={(e) => setCompleteFollowUpForm((p) => ({ ...p, completion_notes: e.target.value }))}
                  placeholder="What happened in this follow-up?"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
                />
              </div>

              {completeFollowUpModal.interactions?.did_convert ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <p className="text-sm font-medium text-green-800">This interaction already has an order recorded.</p>
                  <p className="text-xs text-green-700 mt-1">
                    {formatMoney(completeFollowUpModal.interactions?.conversion_value) || 'Order value recorded'}
                    {completeFollowUpModal.interactions?.product_name ? ` · ${completeFollowUpModal.interactions.product_name}` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={promptNewInteractionForAdditionalOrder}
                    disabled={completingFollowUp}
                    className="mt-2 text-xs font-medium text-green-800 underline hover:text-green-900 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {completingFollowUp ? 'Preparing new interaction…' : 'Record another order as a new interaction'}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={completeFollowUpForm.did_convert}
                      onChange={(e) => setCompleteFollowUpForm((p) => ({
                        ...p,
                        did_convert: e.target.checked,
                        conversion_value: e.target.checked ? p.conversion_value : '',
                        quantity: e.target.checked ? p.quantity : '',
                        product_name: e.target.checked ? p.product_name : '',
                      }))}
                      className="mt-1 rounded border-gray-300 text-brand-deep focus:ring-brand-mist"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-800">Did this follow-up result in an order?</span>
                      <span className="block text-xs text-gray-500">If yes, this interaction will be marked as converted for performance reporting.</span>
                    </span>
                  </label>

                  {completeFollowUpForm.did_convert && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Order Value (£) *</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={completeFollowUpForm.conversion_value}
                          onChange={(e) => setCompleteFollowUpForm((p) => ({ ...p, conversion_value: e.target.value }))}
                          required={completeFollowUpForm.did_convert}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={completeFollowUpForm.quantity}
                          onChange={(e) => setCompleteFollowUpForm((p) => ({ ...p, quantity: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                        <input
                          type="text"
                          value={completeFollowUpForm.product_name}
                          onChange={(e) => setCompleteFollowUpForm((p) => ({ ...p, product_name: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setCompleteFollowUpModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={completingFollowUp}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                >
                  {completingFollowUp ? 'Saving…' : 'Complete Follow-Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Charts — below main content */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Interactions over time */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Interactions Over Time</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="interactions" name="Total" fill="#6B9D8F" radius={[3, 3, 0, 0]} />
                <Bar dataKey="converted" name="Converted" fill="#2F5E4E" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sales value + conversion rate */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-800 mb-3">Sales Value &amp; Conversion Rate</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis yAxisId="value" tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
                <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                <Tooltip formatter={(value, name) => name === 'Sales Value (£)' ? `£${Number(value).toFixed(2)}` : `${value}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="value" type="monotone" dataKey="revenue" name="Sales Value (£)" stroke="#2F5E4E" strokeWidth={2} dot={false} />
                <Line yAxisId="rate" type="monotone" dataKey="rate" name="Conversion Rate (%)" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
