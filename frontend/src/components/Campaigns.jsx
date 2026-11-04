import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { logActivity } from '../utils/logActivity';

// Status values must match the check constraint in the DB .
const STATUS_OPTIONS = ['draft', 'pending_approval', 'active', 'archived'];

// ─── Document Picker Modal ────────────────────────────────────────────────────
// Turns a flat list of folders into a nested tree for the sidebar.
function buildFolderTree(folders, parentId = null) {
  return folders
    .filter((f) => f.parent_folder_id === parentId)
    .map((f) => ({ ...f, children: buildFolderTree(folders, f.folder_id) }));
}

// A single folder row in the picker sidebar, with expand/collapse for subfolders.
function PickerFolderNode({ node, activeFolderId, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;
  const isActive = activeFolderId === node.folder_id;
  return (
    <div>
      <button
        onClick={() => { onSelect(node.folder_id); if (hasChildren) setOpen((o) => !o); }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={`w-full flex items-center gap-1.5 pr-2 py-1.5 rounded-lg text-sm transition-colors ${
          isActive ? 'bg-brand-sage text-brand-deep font-medium' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        {hasChildren ? (
          <ChevronRightIcon className={`h-3 w-3 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {open && hasChildren ? (
          <FolderOpenIcon className="h-4 w-4 flex-shrink-0 text-brand-mist" />
        ) : (
          <FolderIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <PickerFolderNode key={child.folder_id} node={child} activeFolderId={activeFolderId} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// The full-screen modal for browsing and attaching documents to a campaign.
function DocumentPickerModal({ campaign, linkedMaterials, allCampaigns, personName, onClose, onLinked }) {
  const [folders, setFolders] = useState([]);
  const [folderTree, setFolderTree] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(null);
  const [error, setError] = useState(null);

  const linkedGroupIds = useMemo(
    () => new Set(linkedMaterials.map((m) => m.document_group_id)),
    [linkedMaterials]
  );

  const campaignNameById = useMemo(
    () => new Map((allCampaigns || []).map((c) => [c.campaign_id, c.campaign_name])),
    [allCampaigns]
  );

  useEffect(() => {
    async function loadFolders() {
      const { data } = await supabase.from('folders').select('folder_id, name, parent_folder_id').order('name');
      setFolders(data || []);
      setFolderTree(buildFolderTree(data || []));
    }
    loadFolders();
  }, []);

  useEffect(() => {
    async function loadDocs() {
      setLoadingDocs(true);
      setError(null);
      let query = supabase
        .from('documents')
        .select('document_id, file_name, document_group_id, document_version, uploaded_at, mime_type, campaign_id')
        .eq('archive_status', false)
        .eq('document_category', 'campaign_material')
        .order('document_group_id')
        .order('document_version', { ascending: false });
      if (activeFolderId) query = query.eq('folder_id', activeFolderId);
      const { data, error: err } = await query;
      if (err) { setError(err.message); setLoadingDocs(false); return; }
      // deduplicate to latest version per group
      const latestMap = new Map();
      for (const doc of (data || [])) {
        const existing = latestMap.get(doc.document_group_id);
        if (!existing || (doc.document_version || 0) > (existing.document_version || 0)) {
          latestMap.set(doc.document_group_id, doc);
        }
      }
      setDocuments([...latestMap.values()]);
      setLoadingDocs(false);
    }
    loadDocs();
  }, [activeFolderId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? documents.filter((d) => d.file_name.toLowerCase().includes(q)) : documents;
  }, [documents, search]);

  async function linkDocument(doc) {
    setError(null);

    if (doc.campaign_id && doc.campaign_id !== campaign.campaign_id) {
      const existingCampaignName = campaignNameById.get(doc.campaign_id) || 'another campaign';
      const confirmed = window.confirm(
        `"${doc.file_name}" is currently linked to "${existingCampaignName}".\n\n` +
        `If you add it to "${campaign.campaign_name}", it will be unlinked from "${existingCampaignName}".\n\n` +
        'Do you want to continue?'
      );
      if (!confirmed) return;
    }

    setLinking(doc.document_group_id);

    // fetch all versions in the group
    const { data: groupRows, error: groupErr } = await supabase
      .from('documents')
      .select('document_id, document_version')
      .eq('document_group_id', doc.document_group_id);

    if (groupErr) { setError(groupErr.message); setLinking(null); return; }

    const groupIds = (groupRows || []).map((r) => r.document_id);
    const latestRow = (groupRows || []).reduce((best, r) =>
      !best || (r.document_version || 0) > (best.document_version || 0) ? r : best, null);

    // remove any existing campaign_materials entries for these docs
    if (groupIds.length > 0) {
      await supabase.from('campaign_materials').delete().in('document_id', groupIds);
    }

    // update campaign_id on all versions
    const { error: updateErr } = await supabase
      .from('documents')
      .update({ campaign_id: campaign.campaign_id })
      .eq('document_group_id', doc.document_group_id);

    if (updateErr) { setError(updateErr.message); setLinking(null); return; }

    // insert campaign_materials row for latest version
    if (latestRow?.document_id) {
      const { error: linkErr } = await supabase.from('campaign_materials').insert({
        campaign_id: campaign.campaign_id,
        document_id: latestRow.document_id,
      });
      if (linkErr) { setError(linkErr.message); setLinking(null); return; }
    }

    logActivity(personName, 'document_campaign_assignment_updated', {
      file_name: doc.file_name,
      document_group_id: doc.document_group_id,
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
    });

    setLinking(null);
    onLinked();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl mx-8 flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Add Document to Campaign</h3>
            <p className="text-xs text-gray-500">{campaign.campaign_name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Folder sidebar */}
          <div className="w-48 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-2 space-y-0.5">
            <button
              onClick={() => setActiveFolderId(null)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                activeFolderId === null ? 'bg-brand-sage text-brand-deep font-medium' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <FolderIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
              All Documents
            </button>
            {folderTree.map((node) => (
              <PickerFolderNode
                key={node.folder_id}
                node={node}
                activeFolderId={activeFolderId}
                onSelect={setActiveFolderId}
              />
            ))}
          </div>

          {/* Document list */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search documents…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                />
              </div>
            </div>

            {error && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}

            <div className="flex-1 overflow-y-auto">
              {loadingDocs ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No campaign materials found. Mark documents as campaign materials in the Documents page.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Uploaded</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((doc) => {
                      const alreadyLinked = linkedGroupIds.has(doc.document_group_id);
                      const isLinking = linking === doc.document_group_id;
                      const otherCampaignName = doc.campaign_id ? campaignNameById.get(doc.campaign_id) : null;
                      return (
                        <tr key={doc.document_group_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-gray-900 truncate max-w-xs">{doc.file_name}</p>
                            {doc.campaign_id && doc.campaign_id !== campaign.campaign_id && (
                              <p className="text-xs text-amber-600">
                                Linked to {otherCampaignName ? `"${otherCampaignName}"` : 'another campaign'}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                            {new Date(doc.uploaded_at).toLocaleDateString('en-GB')}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {alreadyLinked ? (
                              <span className="text-xs text-green-700 font-medium">Linked</span>
                            ) : (
                              <button
                                disabled={isLinking}
                                onClick={() => linkDocument(doc)}
                                className="text-xs px-2 py-1 rounded border border-brand-mist text-brand-deep hover:bg-brand-cream transition-colors disabled:opacity-50"
                              >
                                {isLinking ? 'Adding…' : 'Add to Campaign'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Converts a DB status key to a readable label e.g. 'pending_approval' → 'Pending Approval'.
const formatStatus = (status) => status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Badge colours for each campaign status.
const STATUS_COLORS = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  archived: 'bg-gray-200 text-gray-700',
};

// Default empty state for the create campaign form.
const EMPTY_FORM = {
  campaign_name: '',
  campaign_description: '',
  campaign_start_date: '',
  campaign_end_date: '',
};

// Formats a number as GBP currency.
function formatMoney(value) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(numericValue);
}

// Formats a number as a percentage with one decimal place.
function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

// Formats a date string (yyyy-mm-dd from the DB) into something readable
function formatDate(d) {
  if (!d) return '—';
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Turns a role key like 'marketing_team_member' into a readable label.
function roleLabel(role) {
  const map = {
    admin: 'Admin',
    manager: 'Manager',
    marketing_team_member: 'Marketing Team Member',
    sales_representative: 'Sales Representative',
    compliance_officer: 'Compliance Officer',
  };
  return map[role] || role || 'Unknown';
}

// The create campaign modal. Resets itself each time it opens.
function CampaignCreationForm({ open, onClose, onSubmit, saving }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">New Campaign</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form, () => setForm(EMPTY_FORM));
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
            <input
              value={form.campaign_name}
              onChange={(e) => setForm((p) => ({ ...p, campaign_name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.campaign_description}
              onChange={(e) => setForm((p) => ({ ...p, campaign_description: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={form.campaign_start_date}
                onChange={(e) => setForm((p) => ({ ...p, campaign_start_date: e.target.value }))}
                onClick={(e) => e.target.showPicker()}
                onKeyDown={(e) => e.preventDefault()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={form.campaign_end_date}
                onChange={(e) => setForm((p) => ({ ...p, campaign_end_date: e.target.value }))}
                onClick={(e) => e.target.showPicker()}
                onKeyDown={(e) => e.preventDefault()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist cursor-pointer"
              />
            </div>
          </div>

          <p className="text-xs text-gray-500">New campaigns start as drafts. A manager or admin will need to approve before the campaign goes live.</p>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.campaign_name.trim() || saving}
              className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// The campaign list table with filters along the top.
// Kept deliberately simple — all filtering logic lives in the main Campaigns page.
function CampaignListWithFilters({
  campaigns,
  filters,
  setFilters,
  viewMode,
  setViewMode,
  owners,
  performance,
  onSelectCampaign,
  onDoubleClickCampaign,
  selectedCampaignId,
  canSubmit,
  onSubmitForApproval,
  canManage,
  onManageCampaign,
}) {
  // This component is intentionally simple: it only renders based on props.
  // Filtering logic lives in the main Campaigns page so there's a single source of truth.
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('active')}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
              viewMode === 'active'
                ? 'border-brand-mist text-brand-deep bg-brand-cream'
                : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            Active Campaigns
          </button>
          <button
            type="button"
            onClick={() => setViewMode('archived')}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
              viewMode === 'archived'
                ? 'border-brand-mist text-brand-deep bg-brand-cream'
                : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            Archived Campaigns
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS
            .filter((s) => viewMode === 'archived' ? s === 'archived' : s !== 'archived')
            .map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}
        </select>

        <input
          type="date"
          value={filters.fromDate}
          onChange={(e) => setFilters((p) => ({ ...p, fromDate: e.target.value }))}
          onClick={(e) => e.target.showPicker()}
          onKeyDown={(e) => e.preventDefault()}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer"
        />

        <input
          type="date"
          value={filters.toDate}
          onChange={(e) => setFilters((p) => ({ ...p, toDate: e.target.value }))}
          onClick={(e) => e.target.showPicker()}
          onKeyDown={(e) => e.preventDefault()}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm cursor-pointer"
        />

        <select
          value={filters.owner}
          onChange={(e) => setFilters((p) => ({ ...p, owner: e.target.value }))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Owners</option>
          {Object.entries(owners).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>

        <input
          type="text"
          value={filters.campaignName}
          onChange={(e) => setFilters((p) => ({ ...p, campaignName: e.target.value }))}
          placeholder="Search by Campaign Name"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="py-14 text-center text-gray-400 text-sm">No campaigns match these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Start</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Interactions</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.campaign_id}
                  className={`border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer ${
                    selectedCampaignId === c.campaign_id ? 'bg-brand-cream/50' : ''
                  }`}
                  onClick={() => onSelectCampaign(c.campaign_id)}
                  onDoubleClick={() => onDoubleClickCampaign && onDoubleClickCampaign(c.campaign_id)}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{c.campaign_name}</p>
                    {c.campaign_description && <p className="text-xs text-gray-400 truncate max-w-xs">{c.campaign_description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_COLORS[c.campaign_status] || 'bg-gray-100 text-gray-700'}`}>
                      {formatStatus(c.campaign_status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{owners[c.created_by] || 'Unknown'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(c.campaign_start_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{performance[c.campaign_id]?.totalInteractions || 0}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {canManage(c) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onManageCampaign(c.campaign_id);
                          }}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                      )}
                      {canSubmit(c) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubmitForApproval(c);
                          }}
                          className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                        >
                          Submit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Manager-only panel that lets approvers quickly review, approve, reject or archive campaigns.
function CampaignApprovalPanel({ pendingCampaigns, ownerNames, onView, onApprove, onReject, onArchive }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Approval Panel</h3>
      {pendingCampaigns.length === 0 ? (
        <p className="text-sm text-gray-400">No campaigns pending approval.</p>
      ) : (
        <div className="space-y-3">
          {pendingCampaigns.map((c) => (
            <div key={c.campaign_id} className="rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">{c.campaign_name}</p>
              <p className="text-xs text-gray-500">Owner: {ownerNames[c.created_by] || 'Unknown'}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => onView(c)} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">View</button>
                <button onClick={() => onApprove(c)} className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50">Approve</button>
                <button onClick={() => onReject(c)} className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50">Reject</button>
                <button onClick={() => onArchive(c)} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Archive</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shows the documents attached to the selected campaign, with options to link or remove.
function CampaignMaterialsUploadSection({
  selectedCampaign,
  linkedMaterials,
  loading,
  canManageMaterials,
  onDetach,
  onPreviewMaterial,
  onOpenPicker,
}) {
  // Shows latest linked material(s) for whichever campaign is selected.
  // Document linking itself is done via the picker modal.
  if (!selectedCampaign) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Campaign Materials</h3>
        <p className="text-sm text-gray-400">Select a campaign to view materials.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Campaign Materials</h3>
          <p className="text-xs text-gray-500">Campaign: {selectedCampaign.campaign_name}</p>
        </div>
        {canManageMaterials && (
          <button
            onClick={onOpenPicker}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-brand-mist text-brand-deep hover:bg-brand-cream transition-colors font-medium"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Link Materials
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
        Only the latest version of each file is shown. Use the Add to Campaign button to attach files.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading materials…</p>
      ) : linkedMaterials.length === 0 ? (
        <p className="text-sm text-gray-400">No linked materials yet.</p>
      ) : (
        <div className="space-y-2">
          {linkedMaterials.map((m) => (
            <div key={m.document_id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <button
                type="button"
                onClick={() => onPreviewMaterial(m.document_id)}
                className="text-left min-w-0 flex-1"
              >
                <p className="text-sm text-brand-deep hover:underline truncate">{m.file_name}</p>
                <p className="text-xs text-gray-500">Uploaded {new Date(m.uploaded_at).toLocaleDateString('en-GB')}</p>
              </button>
              {canManageMaterials && (
                <button
                  onClick={() => onDetach(m.document_id)}
                  className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shows interaction counts, conversion rate and revenue for the selected campaign.
// Metrics are calculated once on the Campaigns page and passed in — no extra DB calls here.
function CampaignPerformanceView({ selectedCampaign, metrics }) {
  if (!selectedCampaign) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Performance</h3>
        <p className="text-sm text-gray-400">Select a campaign to view performance.</p>
      </div>
    );
  }

  const data = metrics[selectedCampaign.campaign_id] || {
    totalInteractions: 0,
    convertedInteractions: 0,
    conversionRate: 0,
    followUpsCompleted: 0,
    totalRevenue: 0,
    outcomes: {},
    engagement: [],
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Performance</h3>

      {/* 2-column stat grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Total interactions</p>
          <p className="text-2xl font-bold text-gray-900">{data.totalInteractions}</p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Converted</p>
          <p className="text-2xl font-bold text-green-700">{data.convertedInteractions}</p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Conversion rate</p>
          <p className="text-2xl font-bold text-gray-900">{formatPercent(data.conversionRate)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Follow-ups</p>
          <p className="text-2xl font-bold text-gray-900">{data.followUpsCompleted}</p>
        </div>
      </div>

      {/* Revenue — full width, highlighted */}
      <div className="rounded-lg bg-brand-deep text-white p-3">
        <p className="text-xs text-white mb-1">Total sales revenue</p>
        <p className="text-2xl font-bold">{formatMoney(data.totalRevenue)}</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1">Outcomes</p>
        {Object.keys(data.outcomes).length === 0 ? (
          <p className="text-xs text-gray-400">No outcomes yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.outcomes).map(([outcome, count]) => (
              <span key={outcome} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                {outcome}: {count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1">Engagement over time</p>
        {data.engagement.length === 0 ? (
          <p className="text-xs text-gray-400">No interaction timeline yet.</p>
        ) : (
          <div className="space-y-1">
            {data.engagement.map((point) => (
              <div key={point.date} className="flex items-center justify-between text-xs text-gray-600">
                <span>{point.date}</span>
                <span>{point.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Edit modal for a single campaign. Fields are locked based on the user's role.
function CampaignManageModal({
  open,
  campaign,
  owners,
  form,
  setForm,
  saving,
  canEditDetails,
  canEditStatus,
  allowedStatusOptions,
  onSave,
  onClose,
}) {
  // Fields are locked based on permissions passed in from the Campaigns page.
  if (!open || !campaign) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Manage Campaign</h3>
            <p className="text-xs text-gray-500">Owner: {owners[campaign.created_by] || 'Unknown'}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          className="h-[calc(88vh-73px)] overflow-y-auto"
        >
          <div className="p-5 space-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
                <input
                  value={form.campaign_name}
                  onChange={(e) => setForm((p) => ({ ...p, campaign_name: e.target.value }))}
                  disabled={!canEditDetails}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist disabled:bg-gray-100 disabled:text-gray-500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.campaign_description}
                  onChange={(e) => setForm((p) => ({ ...p, campaign_description: e.target.value }))}
                  rows={6}
                  disabled={!canEditDetails}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.campaign_start_date}
                    onChange={(e) => setForm((p) => ({ ...p, campaign_start_date: e.target.value }))}
                    onClick={(e) => !e.target.disabled && e.target.showPicker()}
                    onKeyDown={(e) => e.preventDefault()}
                    disabled={!canEditDetails}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist disabled:bg-gray-100 disabled:text-gray-500 enabled:cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.campaign_end_date}
                    onChange={(e) => setForm((p) => ({ ...p, campaign_end_date: e.target.value }))}
                    onClick={(e) => !e.target.disabled && e.target.showPicker()}
                    onKeyDown={(e) => e.preventDefault()}
                    disabled={!canEditDetails}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist disabled:bg-gray-100 disabled:text-gray-500 enabled:cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={form.campaign_status}
                    onChange={(e) => setForm((p) => ({ ...p, campaign_status: e.target.value }))}
                    disabled={!canEditStatus}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-mist disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {allowedStatusOptions.map((status) => (
                      <option key={status} value={status}>{formatStatus(status)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {(!canEditDetails || !canEditStatus) && (
            <div className="px-5 pb-3">
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Some fields are read-only based on your role or the current campaign status.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 px-5 pb-5">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Close
            </button>
            <button
              type="submit"
              disabled={saving || (!canEditDetails && !canEditStatus) || !form.campaign_name.trim()}
              className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Campaigns({ personName = 'Unknown', userRole = 'marketing_team_member', userId = null }) {
  // Work out what this user is allowed to do based on their role.
  const navigate = useNavigate();
  const isManager = ['admin', 'manager'].includes(userRole);
  const isMarketing = userRole === 'marketing_team_member';
  const marketingEditableStatuses = ['draft', 'pending_approval'];
  const allowedManageStatusOptions = isManager ? STATUS_OPTIONS : marketingEditableStatuses;
  const canCreateCampaign = isManager || isMarketing;
  const canManageMaterials = isManager || isMarketing;

  // All the data this page needs.
  const [campaigns, setCampaigns] = useState([]);
  const [ownerNames, setOwnerNames] = useState({});
  const [performance, setPerformance] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manageSaving, setManageSaving] = useState(false);
  // Which modals and banners are visible.
  const [showCreate, setShowCreate] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  // Form values for the edit modal.
  const [manageForm, setManageForm] = useState({
    campaign_name: '',
    campaign_description: '',
    campaign_start_date: '',
    campaign_end_date: '',
    campaign_status: 'draft',
  });

  // Documents linked to the currently selected campaign.
  const [linkedMaterials, setLinkedMaterials] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);

  // What the user has set in the filter bar above the table.
  const [filters, setFilters] = useState({
    status: 'all',
    fromDate: '',
    toDate: '',
    owner: 'all',
    campaignName: '',
  });
  const [viewMode, setViewMode] = useState('active');

  const selectedCampaign = useMemo(
    // The full campaign object for whatever row is currently highlighted.
    () => campaigns.find((c) => c.campaign_id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    // Fetch all campaigns — active and archived. Filtering happens client-side.
    const { data, error } = await supabase
      .from('campaigns')
      .select('campaign_id, campaign_name, campaign_description, campaign_start_date, campaign_end_date, campaign_status, created_by, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      setLoading(false);
      setMessage({ type: 'error', text: error.message });
      return;
    }

    const next = data || [];
    setCampaigns(next);
    setSelectedCampaignId((prev) => {
      if (!prev && next.length > 0) return next[0].campaign_id;
      return prev;
    });
    setLoading(false);
  }, []);

  const loadOwners = useCallback(async () => {
    // Load staff names so we can show who owns each campaign instead of a raw user ID.
    const { data } = await supabase
      .from('profiles')
      .select('user_id, full_name, company_role')
      .eq('is_active', true);

    setOwnerNames(Object.fromEntries((data || []).map((p) => [p.user_id, `${p.full_name || 'Unknown'} (${roleLabel(p.company_role)})`])));
  }, []);

  const loadPerformance = useCallback(async (campaignList) => {
    // Calculates interaction counts, conversion rates and revenue for every campaign
    // in one go, so the table and performance panel can just look up the results.
    const ids = campaignList.map((c) => c.campaign_id);
    if (ids.length === 0) {
      setPerformance({});
      return;
    }

    const { data: interactions } = await supabase
      .from('interactions')
      .select('interaction_id, campaign_id, interaction_date, did_convert, conversion_value')
      .in('campaign_id', ids);

    const interactionRows = interactions || [];

    const { data: followUps } = await supabase
      .from('follow_ups')
      .select('follow_up_id, interaction_id, is_completed, outcome');

    const followUpRows = followUps || [];

    const next = {};
    ids.forEach((id) => {
      const campaignInteractions = interactionRows.filter((i) => i.campaign_id === id);
      const campaignInteractionIds = new Set(campaignInteractions.map((i) => i.interaction_id));
      const campaignFollowUps = followUpRows.filter((f) => campaignInteractionIds.has(f.interaction_id));
      const convertedInteractions = campaignInteractions.filter((row) => row.did_convert).length;
      const conversionRate = campaignInteractions.length === 0
        ? 0
        : (convertedInteractions / campaignInteractions.length) * 100;
      const totalRevenue = campaignInteractions.reduce((sum, row) => {
        if (!row.did_convert || row.conversion_value == null) return sum;
        return sum + Number(row.conversion_value || 0);
      }, 0);

      const outcomes = campaignFollowUps.reduce((acc, row) => {
        if (!row.outcome) return acc;
        acc[row.outcome] = (acc[row.outcome] || 0) + 1;
        return acc;
      }, {});

      const engagementMap = campaignInteractions.reduce((acc, row) => {
        const key = row.interaction_date || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      next[id] = {
        totalInteractions: campaignInteractions.length,
        convertedInteractions,
        conversionRate,
        followUpsCompleted: campaignFollowUps.filter((f) => f.is_completed).length,
        totalRevenue,
        outcomes,
        engagement: Object.entries(engagementMap)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

    setPerformance(next);
  }, []);

  const loadMaterials = useCallback(async (campaignId) => {
    // Loads documents linked to the given campaign.
    // Only shows the latest version of each file.
    if (!campaignId) {
      setLinkedMaterials([]);
      return;
    }

    setMaterialsLoading(true);
    const { data: linked } = await supabase
      .from('documents')
      .select('document_id, document_group_id, file_name, uploaded_at, campaign_id, document_version')
      .eq('campaign_id', campaignId)
      .eq('archive_status', false)
      .order('uploaded_at', { ascending: false });

    // Only keep the latest version of each document group.
    const latestByGroup = (linked || []).reduce((acc, doc) => {
      const existing = acc.get(doc.document_group_id);
      if (!existing || (doc.document_version || 0) > (existing.document_version || 0)) {
        acc.set(doc.document_group_id, doc);
      }
      return acc;
    }, new Map());

    setLinkedMaterials(Array.from(latestByGroup.values()));
    setMaterialsLoading(false);
  }, []);

  useEffect(() => {
    // Load everything when the page first mounts.
    let mounted = true;
    async function init() {
      await Promise.all([loadCampaigns(), loadOwners()]);
      if (!mounted) return;
    }
    init();
    return () => { mounted = false; };
  }, [loadCampaigns, loadOwners]);

  useEffect(() => {
    // Recalculate performance stats whenever the campaigns list changes.
    loadPerformance(campaigns);
  }, [campaigns, loadPerformance]);

  useEffect(() => {
    // Refresh linked documents when the user selects a different campaign.
    loadMaterials(selectedCampaignId);
  }, [selectedCampaignId, loadMaterials]);

  async function createCampaign(form, reset) {
    // All new campaigns start as drafts and need manager approval before going live.
    if (!canCreateCampaign) return;
    setSaving(true);
    setMessage(null);

    const { error } = await supabase.from('campaigns').insert({
      campaign_name: form.campaign_name.trim(),
      campaign_description: form.campaign_description.trim() || null,
      campaign_start_date: form.campaign_start_date || null,
      campaign_end_date: form.campaign_end_date || null,
      campaign_status: 'draft',
      created_by: userId,
    });

    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }

    logActivity(personName, 'campaign_created', { name: form.campaign_name.trim() });
    reset();
    setShowCreate(false);
    setMessage({ type: 'success', text: 'Campaign created in Draft.' });
    await loadCampaigns();
  }

  async function updateCampaignStatus(campaign, nextStatus, actionType = 'campaign_status_changed') {
    // Shared helper used by approve, reject, archive and submit actions.
    const { error } = await supabase
      .from('campaigns')
      .update({ campaign_status: nextStatus })
      .eq('campaign_id', campaign.campaign_id);

    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }

    logActivity(personName, actionType, { name: campaign.campaign_name, status: nextStatus });
    setCampaigns((prev) => prev.map((c) => c.campaign_id === campaign.campaign_id ? { ...c, campaign_status: nextStatus } : c));
  }

  async function submitForApproval(campaign) {
    await updateCampaignStatus(campaign, 'pending_approval', 'campaign_submitted_for_approval');
  }

  async function approveCampaign(campaign) {
    await updateCampaignStatus(campaign, 'active', 'campaign_approved');
  }

  async function rejectCampaign(campaign) {
    await updateCampaignStatus(campaign, 'draft', 'campaign_rejected');
  }

  async function archiveCampaign(campaign) {
    await updateCampaignStatus(campaign, 'archived', 'campaign_archived');
  }

  function canEditCampaignDetails(campaign) {
    if (!campaign) return false;
    // Managers and admins can edit anything that isn't archived.
    if (isManager) return campaign.campaign_status !== 'archived';
    // Marketing members can edit details on draft campaigns.
    return isMarketing && campaign.campaign_status === 'draft';
  }

  function canEditCampaignStatus(campaign) {
    if (!campaign) return false;
    if (isManager) return true;
    return isMarketing && marketingEditableStatuses.includes(campaign.campaign_status);
  }

  function openManageCampaign(campaignId) {
    const campaign = campaigns.find((c) => c.campaign_id === campaignId);
    if (!campaign) return;

    // Pre-fill the form with the campaign's current values before opening.
    setSelectedCampaignId(campaignId);
    setManageForm({
      campaign_name: campaign.campaign_name || '',
      campaign_description: campaign.campaign_description || '',
      campaign_start_date: campaign.campaign_start_date || '',
      campaign_end_date: campaign.campaign_end_date || '',
      campaign_status: campaign.campaign_status || 'draft',
    });
    setShowManage(true);
  }

  async function saveCampaignChanges() {
    // Only saves the fields the user is actually allowed to edit.
    if (!selectedCampaign) return;
    const canEditDetails = canEditCampaignDetails(selectedCampaign);
    const canEditStatus = canEditCampaignStatus(selectedCampaign);
    if (!canEditDetails && !canEditStatus) return;

    if (!manageForm.campaign_name.trim()) {
      setMessage({ type: 'error', text: 'Campaign name is required.' });
      return;
    }
    if (manageForm.campaign_start_date && manageForm.campaign_end_date && manageForm.campaign_end_date < manageForm.campaign_start_date) {
      setMessage({ type: 'error', text: 'End date cannot be before start date.' });
      return;
    }

    const updatePayload = {};
    if (canEditDetails) {
      updatePayload.campaign_name = manageForm.campaign_name.trim();
      updatePayload.campaign_description = manageForm.campaign_description.trim() || null;
      updatePayload.campaign_start_date = manageForm.campaign_start_date || null;
      updatePayload.campaign_end_date = manageForm.campaign_end_date || null;
    }
    if (canEditStatus) {
      if (!allowedManageStatusOptions.includes(manageForm.campaign_status)) {
        setMessage({ type: 'error', text: 'You can only set status to Draft or Pending Approval.' });
        return;
      }
      updatePayload.campaign_status = manageForm.campaign_status;
    }

    setManageSaving(true);
    const { error } = await supabase
      .from('campaigns')
      .update(updatePayload)
      .eq('campaign_id', selectedCampaign.campaign_id);
    setManageSaving(false);

    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }

    logActivity(personName, 'campaign_updated', {
      name: manageForm.campaign_name.trim(),
      status: manageForm.campaign_status,
    });
    setMessage({ type: 'success', text: 'Campaign updated.' });
    setShowManage(false);
    await loadCampaigns();
  }

  async function detachDocument(documentId) {
    // Removes a document from this campaign in both the documents table and the materials link table.
    if (!selectedCampaignId || !canManageMaterials) return;

    const { error: docError } = await supabase
      .from('documents')
      .update({ campaign_id: null })
      .eq('document_id', documentId);

    if (docError) {
      setMessage({ type: 'error', text: docError.message });
      return;
    }

    await supabase
      .from('campaign_materials')
      .delete()
      .eq('document_id', documentId);

    setMessage({ type: 'success', text: 'Material removed from campaign.' });
    await loadMaterials(selectedCampaignId);
  }

  function openMaterialInDocuments(documentId) {
    // Jump to the Documents page and automatically open a preview for this file.
    setShowManage(false);
    navigate(`/documents?preview=${encodeURIComponent(documentId)}&t=${Date.now()}`);
  }

  const filteredCampaigns = useMemo(() => {
    // Applies all active filters so the table only shows matching campaigns.
    const campaignNameQuery = filters.campaignName.trim().toLowerCase();

    return campaigns.filter((c) => {
      const visibilityMatch = viewMode === 'archived'
        ? c.campaign_status === 'archived'
        : c.campaign_status !== 'archived';
      const statusMatch = filters.status === 'all' || c.campaign_status === filters.status;
      const ownerMatch = filters.owner === 'all' || c.created_by === filters.owner;
      const fromMatch = !filters.fromDate || (c.campaign_start_date && c.campaign_start_date >= filters.fromDate);
      const toMatch = !filters.toDate || (c.campaign_end_date && c.campaign_end_date <= filters.toDate);
      const nameMatch = !campaignNameQuery || (c.campaign_name || '').toLowerCase().includes(campaignNameQuery);
      return visibilityMatch && statusMatch && ownerMatch && fromMatch && toMatch && nameMatch;
    });
  }, [campaigns, filters, viewMode]);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: 'all' }));
  }, [viewMode]);

  useEffect(() => {
    if (filteredCampaigns.length === 0) {
      setSelectedCampaignId(null);
      return;
    }
    const stillVisible = filteredCampaigns.some((c) => c.campaign_id === selectedCampaignId);
    if (!stillVisible) {
      setSelectedCampaignId(filteredCampaigns[0].campaign_id);
    }
  }, [filteredCampaigns, selectedCampaignId]);

  const pendingCampaigns = useMemo(
    () => campaigns.filter((c) => c.campaign_status === 'pending_approval'),
    [campaigns]
  );

  function canSubmitCampaign(campaign) {
    // Only marketing users can submit their own draft campaigns for approval.
    return isMarketing && campaign.created_by === userId && campaign.campaign_status === 'draft';
  }

  function viewCampaignFromApproval(campaign) {
    // Clicking View in the approval panel highlights the campaign so the
    // materials and performance panels update automatically below.
    setSelectedCampaignId(campaign.campaign_id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold text-gray-900">Campaigns</h2>
        {canCreateCampaign && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors flex items-center gap-2 font-medium text-sm"
          >
            <PlusIcon className="h-4 w-4" />
            New Campaign
          </button>
        )}
      </div>

      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm border ${message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading campaigns…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <CampaignListWithFilters
              campaigns={filteredCampaigns}
              filters={filters}
              setFilters={setFilters}
              viewMode={viewMode}
              setViewMode={setViewMode}
              owners={ownerNames}
              performance={performance}
              onSelectCampaign={setSelectedCampaignId}
              onDoubleClickCampaign={openManageCampaign}
              selectedCampaignId={selectedCampaignId}
              canSubmit={canSubmitCampaign}
              onSubmitForApproval={submitForApproval}
              canManage={(c) => canEditCampaignDetails(c) || canEditCampaignStatus(c)}
              onManageCampaign={openManageCampaign}
            />

            <div className="mt-6">
              <CampaignMaterialsUploadSection
                selectedCampaign={selectedCampaign}
                linkedMaterials={linkedMaterials}
                loading={materialsLoading}
                canManageMaterials={canManageMaterials}
                onDetach={detachDocument}
                onPreviewMaterial={openMaterialInDocuments}
                onOpenPicker={() => setShowDocPicker(true)}
              />
            </div>
          </div>

          <div className="space-y-6">
            {isManager && (
              <CampaignApprovalPanel
                pendingCampaigns={pendingCampaigns}
                ownerNames={ownerNames}
                onView={viewCampaignFromApproval}
                onApprove={approveCampaign}
                onReject={rejectCampaign}
                onArchive={archiveCampaign}
              />
            )}

            <CampaignPerformanceView
              selectedCampaign={selectedCampaign}
              metrics={performance}
            />
          </div>
        </div>
      )}

      <CampaignCreationForm
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={createCampaign}
        saving={saving}
      />

      <CampaignManageModal
        open={showManage}
        campaign={selectedCampaign}
        owners={ownerNames}
        form={manageForm}
        setForm={setManageForm}
        saving={manageSaving}
        canEditDetails={canEditCampaignDetails(selectedCampaign)}
        canEditStatus={canEditCampaignStatus(selectedCampaign)}
        allowedStatusOptions={allowedManageStatusOptions}
        onSave={saveCampaignChanges}
        onClose={() => setShowManage(false)}
      />

      {showDocPicker && selectedCampaign && (
        <DocumentPickerModal
          campaign={selectedCampaign}
          linkedMaterials={linkedMaterials}
          allCampaigns={campaigns}
          personName={personName}
          onClose={() => setShowDocPicker(false)}
          onLinked={() => {
            setShowDocPicker(false);
            loadMaterials(selectedCampaign.campaign_id);
          }}
        />
      )}
    </div>
  );
}
