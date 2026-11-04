import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  PlusIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../utils/supabase';
import { logActivity } from '../utils/logActivity';

// Turns a flat list of folders into a nested tree for the sidebar.
function buildTree(folders, parentId = null) {
  return folders
    .filter((f) => f.parent_folder_id === parentId)
    .map((f) => ({ ...f, children: buildTree(folders, f.folder_id) }));
}

// Converts a raw byte count into a readable size like "2.4 MB".
function formatBytes(bytes) {
  // convert raw byte counts into readable units for the table UI
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Formats a timestamp into a readable date like "07 May 2026".
function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// A single folder row in the sidebar.
// Clicking expands subfolders; action buttons (access, delete) appear on hover.
// The whole row is draggable so folders can be reorganised by dragging.
function FolderNode({
  node,
  activeFolderId,
  onSelect,
  onDelete,
  onManageAccess,
  canManageAccess,
  onUnarchive,
  isAdmin,
  showingArchived,
  draggedFolder,
  onDragStart,
  onDragOver,
  onDrop,
  depth = 0,
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isActive = activeFolderId === node.folder_id;
  const isDragging = draggedFolder?.folder_id === node.folder_id;
  const isDropTarget = draggedFolder && draggedFolder.folder_id !== node.folder_id;
  const isArchived = node.archive_status === true;

  return (
    <div>
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        draggable
        onDragStart={(e) => onDragStart(e, node)}
        onDragOver={(e) => onDragOver(e, node)}
        onDrop={(e) => onDrop(e, node)}
        className={`flex items-center group rounded-lg transition-colors
          ${isDragging ? 'bg-brand-cream/50' : ''}
          ${isDropTarget && hovering ? 'bg-blue-50' : ''}`}
      >
        <button
          onClick={() => {
            onSelect(node.folder_id);
            if (hasChildren) setOpen((o) => !o);
          }}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          className={`flex-1 flex items-center gap-2 pr-3 py-2 rounded-lg transition-colors text-sm font-medium
            ${isActive ? 'bg-brand-deep text-white' : 'text-gray-700 hover:bg-gray-100'}`}
        >
          {hasChildren ? (
            <ChevronRightIcon
              className={`h-3 w-3 flex-shrink-0 transition-transform ${isActive ? 'text-white' : 'text-gray-400'} ${open ? 'rotate-90' : ''}`}
            />
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          {open ? (
            <FolderOpenIcon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-brand-mist'}`} />
          ) : (
            <FolderIcon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
          )}
          <span className="truncate">{node.name}</span>
        </button>

        {/* Folder action buttons (show on hover) */}
        <div className="flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {canManageAccess && !isArchived && (
            <button
              onClick={() => onManageAccess(node)}
              title="Manage access"
              className="p-1 text-gray-400 hover:text-brand-deep hover:bg-brand-cream rounded transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.6 11.4A6 6 0 003 13v-2h14.6z" />
              </svg>
            </button>
          )}
          {isArchived && isAdmin && showingArchived ? (
            <button
              onClick={() => onUnarchive(node)}
              title="Unarchive folder"
              className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          ) : !isArchived ? (
            <button
              onClick={() => onDelete(node)}
              title="Archive folder"
              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderNode
              key={child.folder_id}
              node={child}
              activeFolderId={activeFolderId}
              onSelect={onSelect}
              onDelete={onDelete}
              onManageAccess={onManageAccess}
              canManageAccess={canManageAccess}
              onUnarchive={onUnarchive}
              isAdmin={isAdmin}
              showingArchived={showingArchived}
              draggedFolder={draggedFolder}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Left panel: folder tree. Right panel: document list with search, versioning, and preview.
// Campaign assignment also lives here — see the "Add to Campaign" button in the actions column.
export default function DocumentManagement({
  canCreateFolders = true,
  canUploadDocuments = true,
  canDeleteDocuments = true,
  userRole = 'marketing_team_member',
  personName = 'Unknown',
}) {
  const location = useLocation();
  // Timing used to tell a slow double-click (rename) apart from a fast double-click (preview).
  const RENAME_SLOW_CLICK_MS = 450;
  const RENAME_DEFER_MS = 320;
  // Only certain roles can link documents to campaigns.
  const canAssignCampaign = ['admin', 'manager', 'marketing_team_member'].includes(userRole);
  const canManageFolderAccess = ['admin', 'manager', 'compliance_officer'].includes(userRole);
  const isSalesOrMarketing = ['sales_representative', 'marketing_team_member'].includes(userRole);
  const isAdmin = userRole === 'admin';

  // Folder list and sidebar tree.
  const [folders, setFolders] = useState([]);
  const [folderTree, setFolderTree] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null); // null = show all documents

  // Documents shown in the table.
  const [documents, setDocuments] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Which row is selected, and rename state for inline editing.
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [editingDocId, setEditingDocId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameSuccessMessage, setRenameSuccessMessage] = useState('');
  const lastNameClickRef = useRef({ docId: null, ts: 0 });
  const renameTimerRef = useRef(null);
  const renameInputRef = useRef(null);

  // New folder modal.
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);

  // Upload modal.
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('general');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [newVersionGroupId, setNewVersionGroupId] = useState(null); // set when uploading a new version of an existing file
  const [nameConflictDoc, setNameConflictDoc] = useState(null);
  const [conflictResolution, setConflictResolution] = useState(null); // null | 'version' | 'rename'
  const fileInputRef = useRef(null);

  // Version history and preview panel.
  const [versionDoc, setVersionDoc] = useState(null); // the document whose history is open
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showArchivedVersions, setShowArchivedVersions] = useState(false);
  const [versionUploadFile, setVersionUploadFile] = useState(null);
  const [versionUploading, setVersionUploading] = useState(false);
  const [versionUploadError, setVersionUploadError] = useState(null);
  const versionUploadInputRef = useRef(null);

  // Preview panel — a short-lived secure link is fetched each time a file is opened.
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const lastPreviewRequestRef = useRef('');

  // Archive/delete confirmation modal.
  const [actionDoc, setActionDoc] = useState(null);
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false);

  // Campaign assignment modal.
  const [campaignOptions, setCampaignOptions] = useState([]);
  const [assignDoc, setAssignDoc] = useState(null);
  const [selectedCampaignForAssign, setSelectedCampaignForAssign] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  // Folder drag-and-drop and folder management modals.
  const [draggedFolder, setDraggedFolder] = useState(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState(null);
  const [folderToManageAccess, setFolderToManageAccess] = useState(null);
  const [folderAccessData, setFolderAccessData] = useState(null);
  const [loadingAccessData, setLoadingAccessData] = useState(false);
  const [savingAccessData, setSavingAccessData] = useState(false);
  const [accessError, setAccessError] = useState(null);
  // Modal shown to sales/marketing when they create a new folder
  const [showNewFolderAccessPrompt, setShowNewFolderAccessPrompt] = useState(false);
  const [pendingFolderName, setPendingFolderName] = useState('');
  const [newFolderAccessChoice, setNewFolderAccessChoice] = useState('public'); // 'public' or 'role-limited'
  // Show archived folders (admin only)
  const [showArchivedFolders, setShowArchivedFolders] = useState(false);
  const foldersRef = useRef([]);

  // Fetches all folders and rebuilds the sidebar tree.
  const loadFolders = useCallback(async () => {
    const { data, error } = await supabase
      .from('folders')
      .select('folder_id, name, parent_folder_id, archive_status')
      .order('name');
    if (error) return [];
    
    // Filter archived folders based on admin preference
    const filteredData = userRole === 'admin' && showArchivedFolders
      ? data
      : data.filter(f => !f.archive_status);
    
    foldersRef.current = filteredData;
    setFolders(filteredData);
    setFolderTree(buildTree(filteredData));
    return filteredData;
  }, [userRole, showArchivedFolders]);

  // Fetches documents for the selected folder (or all documents if no folder is selected).
  // Also looks up each uploader's name so it can be shown in the table.
  const loadDocuments = useCallback(async (folderId, archived = false, visibleFoldersOverride = null) => {
    setLoading(true);
    setLoadError(null);

    let query = supabase
      .from('documents')
      .select('document_id, file_name, storage_path, mime_type, size_bytes, uploaded_at, document_version, document_group_id, uploaded_by, archive_status, campaign_id, document_category, folder_id')
      .eq('archive_status', archived)
      .order('document_group_id')
      .order('document_version', { ascending: false });

    if (folderId) {
      query = query.eq('folder_id', folderId);
    }

    const { data: docs, error: docsErr } = await query;

    if (docsErr) {
      setLoadError(docsErr.message);
      setLoading(false);
      return;
    }

    const visibleFolderIds = new Set(
      (visibleFoldersOverride || foldersRef.current || []).map((f) => f.folder_id)
    );

    const accessibleDocs = (docs || []).filter(
      (d) => d.folder_id == null || visibleFolderIds.has(d.folder_id)
    );

    // Add each uploader's name to their documents.
    if (accessibleDocs.length > 0) {
      const uploaderIds = [...new Set(accessibleDocs.map((d) => d.uploaded_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', uploaderIds);
      const nameMap = Object.fromEntries((profiles || []).map((p) => [p.user_id, p.full_name]));
      setDocuments(accessibleDocs.map((d) => ({ ...d, uploader_name: nameMap[d.uploaded_by] || '—' })));
    } else {
      setDocuments([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    // Load folders and documents when the page first opens.
    let mounted = true;
    async function init() {
      const visibleFolders = await loadFolders();
      if (mounted) {
        await loadDocuments(null, false, visibleFolders);
      }
    }
    init();
    return () => { mounted = false; };
  }, [loadFolders, loadDocuments]);

  useEffect(() => {
    // Focus and highlight the rename input as soon as it appears.
    if (editingDocId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingDocId]);

  useEffect(() => {
    // Clear the rename success message after 2 seconds.
    if (!renameSuccessMessage) return;
    const timer = setTimeout(() => setRenameSuccessMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [renameSuccessMessage]);

  useEffect(() => {
    // Clean up any pending rename timer if the component is removed.
    return () => {
      if (renameTimerRef.current) {
        clearTimeout(renameTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // If the URL contains ?preview=<id>, automatically open that document's preview.
    const params = new URLSearchParams(location.search);
    const previewDocumentId = params.get('preview');
    const token = params.get('t') || '';
    const requestKey = `${previewDocumentId || ''}:${token}`;

    if (!previewDocumentId || lastPreviewRequestRef.current === requestKey) {
      return;
    }

    lastPreviewRequestRef.current = requestKey;

    async function openPreviewFromQuery() {
      const { data: doc, error } = await supabase
        .from('documents')
        .select('document_id, document_group_id, file_name, storage_path, mime_type, size_bytes, uploaded_at, document_version, uploaded_by, archive_status, folder_id, document_category')
        .eq('document_id', previewDocumentId)
        .maybeSingle();

      if (error || !doc) {
        return;
      }

      const archived = Boolean(doc.archive_status);
      if (showArchived !== archived) {
        setShowArchived(archived);
      }

      if ((doc.folder_id || null) !== (activeFolderId || null) || showArchived !== archived) {
        setActiveFolderId(doc.folder_id || null);
        await loadDocuments(doc.folder_id || null, archived);
      }

      // Open the full preview and version history panel for this document.
      await handleViewVersions(doc);
    }

    openPreviewFromQuery();
  }, [location.search, activeFolderId, showArchived, loadDocuments]);

  // Switches to a folder and reloads the document list for it.
  function handleFolderSelect(folderId) {
    setActiveFolderId(folderId);
    loadDocuments(folderId, showArchived);
  }

  // Clears folder selection and shows all documents.
  function handleAllDocsSelect() {
    setActiveFolderId(null);
    loadDocuments(null, showArchived);
  }

  // Switches between the active and archived document views.
  function handleArchiveViewChange(archived) {
    setShowArchived(archived);
    loadDocuments(activeFolderId, archived);
  }

  // Creates a new folder. If sales/marketing, first prompts about visibility.
  // Otherwise, creates it directly as a public folder.
  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    // Sales and marketing members must choose folder visibility
    if (isSalesOrMarketing) {
      setPendingFolderName(newFolderName.trim());
      setNewFolderAccessChoice('public');
      setShowNewFolderAccessPrompt(true);
      return;
    }

    // Other roles create public folders by default
    await createFolderWithAccess(newFolderName.trim(), 'public');
  }

  // Actually creates the folder and sets its access policy
  async function createFolderWithAccess(folderName, accessChoice) {
    setSavingFolder(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: newFolder, error: createErr } = await supabase.from('folders').insert({
      name: folderName,
      parent_folder_id: activeFolderId || null,
      created_by: user.id,
    }).select().single();

    if (createErr) {
      alert('Could not create folder: ' + createErr.message);
      setSavingFolder(false);
      return;
    }

    // A trigger creates the default policy row on folder insert.
    // We update that row instead of inserting a second policy.
    let allowAllRoles = true;
    let rolesToAllow = [];

    if (accessChoice === 'role-limited') {
      allowAllRoles = false;
      if (userRole === 'sales_representative') {
        // Sales-only: everyone except marketing
        rolesToAllow = ['admin', 'manager', 'sales_representative', 'compliance_officer'];
      } else if (userRole === 'marketing_team_member') {
        // Marketing-only: everyone except sales
        rolesToAllow = ['admin', 'manager', 'marketing_team_member', 'compliance_officer'];
      } else {
        rolesToAllow = [userRole];
      }
    }

    let { data: policy, error: policyErr } = await supabase
      .from('folder_access_policies')
      .select('policy_id')
      .eq('folder_id', newFolder.folder_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Safety fallback if trigger did not run in a target environment.
    if (!policy && !policyErr) {
      const fallback = await supabase
        .from('folder_access_policies')
        .insert({
          folder_id: newFolder.folder_id,
          allow_all_roles: true,
          created_by: user.id,
        })
        .select('policy_id')
        .single();

      policy = fallback.data;
      policyErr = fallback.error;
    }

    if (policyErr || !policy) {
      alert('Could not set folder access: ' + (policyErr?.message || 'Policy row missing'));
      setSavingFolder(false);
      return;
    }

    const { error: updatePolicyErr } = await supabase
      .from('folder_access_policies')
      .update({ allow_all_roles: allowAllRoles })
      .eq('policy_id', policy.policy_id);

    if (updatePolicyErr) {
      alert('Could not set folder access: ' + updatePolicyErr.message);
      setSavingFolder(false);
      return;
    }

    const { error: clearRolesErr } = await supabase
      .from('folder_access_roles')
      .delete()
      .eq('policy_id', policy.policy_id);

    if (clearRolesErr) {
      alert('Could not set folder access: ' + clearRolesErr.message);
      setSavingFolder(false);
      return;
    }

    // Insert role restrictions if not allowing all
    if (!allowAllRoles && rolesToAllow.length > 0) {
        const rolesToInsert = rolesToAllow.map((role) => ({
        policy_id: policy.policy_id,
        role,
      }));

      const { error: rolesErr } = await supabase
        .from('folder_access_roles')
        .insert(rolesToInsert);

      if (rolesErr) {
        alert('Could not set folder roles: ' + rolesErr.message);
        setSavingFolder(false);
        return;
      }
    }

    setSavingFolder(false);
    logActivity(personName, 'folder_created', {
      folder_name: folderName,
      parent_folder_id: activeFolderId || null,
      access_choice: accessChoice,
    });
    setNewFolderName('');
    setShowNewFolder(false);
    setShowNewFolderAccessPrompt(false);
    setPendingFolderName('');
    loadFolders();
  }

  // Uploads a file. Handles first-time uploads and new versions of existing files.
  // If there's a name clash, the user chooses whether to create a new version or rename.
  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) return;

    const effectiveUploadName = uploadName.trim() || uploadFile.name;

    if (!newVersionGroupId && nameConflictDoc && !conflictResolution) {
      setUploadError('A file with this name already exists. Choose whether this is a new version or rename the uploaded file.');
      return;
    }

    if (!newVersionGroupId && conflictResolution === 'rename') {
      if (!effectiveUploadName.trim()) {
        setUploadError('Please enter a file name before uploading.');
        return;
      }
      const stillConflicts = await findExistingDocumentByName(effectiveUploadName);
      if (stillConflicts) {
        setUploadError('That file name already exists. Please choose a different name.');
        return;
      }
    }

    setUploading(true);
    setUploadError(null);

    const { data: { user } } = await supabase.auth.getUser();

    const groupId = newVersionGroupId || crypto.randomUUID();

    // Work out the next version number for this file group.
    let nextVersion = 1;
    if (newVersionGroupId) {
      const { data: existing } = await supabase
        .from('documents')
        .select('document_version')
        .eq('document_group_id', newVersionGroupId)
        .order('document_version', { ascending: false })
        .limit(1);
      if (existing && existing.length > 0) {
        nextVersion = existing[0].document_version + 1;
      }
    }

    const storagePath = `${groupId}/v${nextVersion}/${effectiveUploadName}`;

    const { error: storageErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, uploadFile, { upsert: false });

    if (storageErr) {
      setUploadError(storageErr.message);
      setUploading(false);
      return;
    }

    const { error: insertErr } = await supabase.from('documents').insert({
      file_name: effectiveUploadName,
      storage_path: storagePath,
      mime_type: uploadFile.type || null,
      size_bytes: uploadFile.size,
      uploaded_by: user.id,
      folder_id: activeFolderId || null,
      document_group_id: groupId,
      document_version: nextVersion,
      document_category: newVersionGroupId ? undefined : uploadCategory,
    });

    setUploading(false);

    if (insertErr) {
      // Remove the uploaded file from storage if saving the record failed.
      await supabase.storage.from('documents').remove([storagePath]);
      setUploadError(insertErr.message);
      return;
    }

    setShowUpload(false);
    setUploadFile(null);
    setUploadName('');
    setUploadCategory('general');
    setNewVersionGroupId(null);
    setNameConflictDoc(null);
    setConflictResolution(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    logActivity(
      personName,
      newVersionGroupId ? 'document_version_uploaded' : 'document_uploaded',
      { file_name: effectiveUploadName, version: nextVersion, folder_id: activeFolderId || null }
    );
    loadDocuments(activeFolderId, showArchived);
  }

  // Starts an inline rename for a document row.
  function beginRename(doc) {
    setEditingDocId(doc.document_id);
    setRenameValue(doc.file_name || '');
    setRenameError('');
    setSelectedDocId(doc.document_id);
  }

  // Cancels the rename and clears any pending timer.
  function cancelRename() {
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    setEditingDocId(null);
    setRenameValue('');
    setRenameError('');
    setRenaming(false);
  }

  // Saves the new name, checking it doesn't clash with another document first.
  async function saveRename(doc) {
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      setRenameError('File name is required.');
      return;
    }

    if (trimmedName.toLowerCase() === (doc.file_name || '').trim().toLowerCase()) {
      cancelRename();
      return;
    }

    setRenaming(true);
    setRenameError('');

    const existing = await findExistingDocumentByName(trimmedName);
    if (existing && existing.document_group_id !== doc.document_group_id) {
      setRenameError('A document with this name already exists. Please use a different name.');
      setRenaming(false);
      return;
    }

    const { error } = await supabase
      .from('documents')
      .update({ file_name: trimmedName })
      .eq('document_group_id', doc.document_group_id);

    setRenaming(false);

    if (error) {
      setRenameError('Could not rename file: ' + error.message);
      return;
    }

    logActivity(personName, 'document_renamed', {
      old_file_name: doc.file_name,
      new_file_name: trimmedName,
      document_group_id: doc.document_group_id,
    });

    setRenameSuccessMessage('Document renamed successfully.');

    cancelRename();
    loadDocuments(activeFolderId, showArchived);
  }

  // Single click selects the row. A slow second click on the same row starts renaming.
  function handleDocumentNameClick(doc) {
    if (editingDocId === doc.document_id) return;

    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }

    const now = Date.now();
    const previous = lastNameClickRef.current;
    const isSlowSecondClick =
      previous.docId === doc.document_id && now - previous.ts > RENAME_SLOW_CLICK_MS;

    setSelectedDocId(doc.document_id);
    lastNameClickRef.current = { docId: doc.document_id, ts: now };

    if (isSlowSecondClick) {
      renameTimerRef.current = setTimeout(() => {
        beginRename(doc);
        renameTimerRef.current = null;
      }, RENAME_DEFER_MS);
    }
  }

  // Fast double-click opens the preview and version history panel.
  function handleDocumentNameDoubleClick(doc) {
    if (editingDocId) return;

    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }

    lastNameClickRef.current = { docId: null, ts: 0 };
    setSelectedDocId(doc.document_id);
    handleViewVersions(doc);
  }

  // Checks whether a document with this name already exists (case-insensitive).
  async function findExistingDocumentByName(fileName) {
    const trimmed = (fileName || '').trim();
    if (!trimmed) return null;

    const { data, error } = await supabase
      .from('documents')
      .select('document_id, file_name, storage_path, mime_type, size_bytes, uploaded_at, document_version, document_group_id, uploaded_by, archive_status')
      .eq('archive_status', false)
      .ilike('file_name', trimmed)
      .order('uploaded_at', { ascending: false })
      .limit(1);

    if (error) return null;
    return data?.[0] || null;
  }

  // When a file is chosen in the upload dialog, check if its name already exists.
  async function handleUploadFileSelect(e) {
    const selectedFile = e.target.files?.[0] || null;
    setUploadFile(selectedFile);
    setUploadError(null);
    setUploadName(selectedFile?.name || '');

    if (!selectedFile || newVersionGroupId) {
      setNameConflictDoc(null);
      setConflictResolution(null);
      return;
    }

    const existingDoc = await findExistingDocumentByName(selectedFile.name);

    if (!existingDoc) {
      setNameConflictDoc(null);
      setConflictResolution(null);
      return;
    }

    setNameConflictDoc(existingDoc);
    setConflictResolution(null);
  }

  // User chose to treat this upload as a new version of the existing file.
  function chooseConflictAsVersion() {
    if (!nameConflictDoc) return;
    setNewVersionGroupId(nameConflictDoc.document_group_id);
    setUploadName(nameConflictDoc.file_name);
    setConflictResolution('version');
    setUploadError(null);
  }

  // User chose to upload this as a separate file with a new name.
  function chooseConflictAsRename() {
    setNewVersionGroupId(null);
    setConflictResolution('rename');
    setUploadError(null);
  }

  // Downloads the file — tries a direct download first, falls back to a temporary link.
  async function handleDownload(doc) {
    let downloadComplete = false;

    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(doc.storage_path);

      if (!error && data) {
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.file_name || `document-v${doc.document_version || 1}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        downloadComplete = true;
      }
    } catch {
      downloadComplete = false;
    }

    if (!downloadComplete) {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 120);
      if (error || !data?.signedUrl) {
        alert('Could not download file: ' + (error?.message || 'Unknown error'));
        return;
      }

      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = doc.file_name || `document-v${doc.document_version || 1}`;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    logActivity(personName, 'document_downloaded', { file_name: doc.file_name, version: doc.document_version });
  }

  // Gets a short-lived secure link for the file and shows it in the preview pane.
  async function handleOpenPreview(doc) {
    // Clear the previous preview before loading the new one.
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 300);

    if (error) {
      setPreviewError(error.message);
      setPreviewLoading(false);
      return;
    }

    setPreviewUrl(data.signedUrl);
    setPreviewLoading(false);
    logActivity(personName, 'document_previewed', { file_name: doc.file_name, version: doc.document_version });
  }

  // Clears the preview pane.
  function closePreviewPanel() {
    setPreviewDoc(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  // Archives all versions of a document (hides it without deleting).
  async function archiveDocumentGroup(doc) {
    const { error } = await supabase
      .from('documents')
      .update({ archive_status: true })
      .eq('document_group_id', doc.document_group_id);
    if (error) {
      alert('Error archiving document: ' + error.message);
      return;
    }
    logActivity(personName, 'document_archived', { file_name: doc.file_name, document_group_id: doc.document_group_id });
    loadDocuments(activeFolderId, showArchived);
  }

  // Restores all versions of an archived document back to the active list.
  async function restoreDocumentGroup(doc) {
    const { error } = await supabase
      .from('documents')
      .update({ archive_status: false })
      .eq('document_group_id', doc.document_group_id);
    if (error) {
      alert('Error restoring document: ' + error.message);
      return;
    }
    logActivity(personName, 'document_restored', { file_name: doc.file_name, document_group_id: doc.document_group_id });
    loadDocuments(activeFolderId, showArchived);
  }

  // Permanently deletes every version of a document from both the database and storage.
  async function permanentlyDeleteDocumentGroup(doc) {
    if (!isAdmin) {
      alert('Only admins can permanently delete documents.');
      return;
    }

    const { data: groupDocs, error: groupErr } = await supabase
      .from('documents')
      .select('document_id, storage_path')
      .eq('document_group_id', doc.document_group_id);

    if (groupErr) {
      alert('Could not load document versions for deletion: ' + groupErr.message);
      return;
    }

    const storagePaths = (groupDocs || []).map((item) => item.storage_path).filter(Boolean);

    const { error: deleteErr } = await supabase
      .from('documents')
      .delete()
      .eq('document_group_id', doc.document_group_id);

    if (deleteErr) {
      alert('Error permanently deleting document: ' + deleteErr.message);
      return;
    }

    if (storagePaths.length > 0) {
      const { error: storageErr } = await supabase.storage.from('documents').remove(storagePaths);
      if (storageErr) {
        alert(`Document records were deleted, but storage cleanup failed: ${storageErr.message}`);
      }
    }

    logActivity(personName, 'document_permanently_deleted', {
      file_name: doc.file_name,
      document_group_id: doc.document_group_id,
    });
    if (versionDoc?.document_group_id === doc.document_group_id) {
      setVersionDoc(null);
    }
    loadDocuments(activeFolderId, showArchived);
  }

  async function handleDelete(doc) {
    setActionDoc(doc);
    setConfirmPermanentDelete(false);
  }

  function closeActionModal() {
    setActionDoc(null);
    setConfirmPermanentDelete(false);
  }

  async function handleArchiveFromModal() {
    if (!actionDoc) return;
    await archiveDocumentGroup(actionDoc);
    closeActionModal();
  }

  async function handlePermanentDeleteFromModal() {
    if (!actionDoc) return;
    if (!isAdmin) {
      alert('Only admins can permanently delete documents.');
      return;
    }
    await permanentlyDeleteDocumentGroup(actionDoc);
    closeActionModal();
  }

  async function handleRestore(doc) {
    await restoreDocumentGroup(doc);
  }

  // Opens the version history and preview panel for a document,
  // and automatically loads a preview of the latest version.
  async function handleViewVersions(doc) {
    setVersionDoc(doc);
    setVersionsLoading(true);
    setVersions([]);
    setShowArchivedVersions(false);
    setVersionUploadFile(null);
    setVersionUploadError(null);
    setPreviewDoc(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);

    const { data: vDocs, error } = await supabase
      .from('documents')
      .select('document_id, document_version, file_name, storage_path, mime_type, size_bytes, uploaded_at, uploaded_by, archive_status, document_category')
      .eq('document_group_id', doc.document_group_id)
      .order('document_version', { ascending: false });

    if (!error && vDocs && vDocs.length > 0) {
      const uploaderIds = [...new Set(vDocs.map((d) => d.uploaded_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', uploaderIds);
      const nameMap = Object.fromEntries((profiles || []).map((p) => [p.user_id, p.full_name]));
      const enrichedVersions = vDocs.map((d) => ({ ...d, uploader_name: nameMap[d.uploaded_by] || '—' }));
      setVersions(enrichedVersions);

      // Auto-open the latest version in the preview pane.
      await handleOpenPreview({
        ...enrichedVersions[0],
        mime_type: enrichedVersions[0].mime_type || doc.mime_type,
      });
    } else {
      setVersions(vDocs || []);
      setPreviewLoading(false);
    }

    setVersionsLoading(false);
  }

  // Stores the file chosen in the version upload input inside the history panel.
  function handleVersionWindowFileSelect(e) {
    const selectedFile = e.target.files?.[0] || null;
    setVersionUploadFile(selectedFile);
    setVersionUploadError(null);
  }

  // Uploads a new version from inside the version history panel.
  // Inherits the folder and campaign from the existing document group.
  async function handleUploadVersionFromWindow() {
    if (!versionDoc || !versionUploadFile) return;

    setVersionUploading(true);
    setVersionUploadError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const nextVersion = versions.length > 0
        ? Math.max(...versions.map((v) => v.document_version || 0)) + 1
        : 1;

      const baseFileName = (versionDoc.file_name || versionUploadFile.name || '').trim();
      const storagePath = `${versionDoc.document_group_id}/v${nextVersion}/${baseFileName}`;

      const { error: storageErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, versionUploadFile, { upsert: false });

      if (storageErr) throw storageErr;

      const { data: latestInGroup } = await supabase
        .from('documents')
        .select('folder_id, campaign_id')
        .eq('document_group_id', versionDoc.document_group_id)
        .order('document_version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: insertedRow, error: insertErr } = await supabase.from('documents').insert({
        file_name: baseFileName,
        storage_path: storagePath,
        mime_type: versionUploadFile.type || null,
        size_bytes: versionUploadFile.size,
        uploaded_by: user.id,
        folder_id: latestInGroup?.folder_id || null,
        campaign_id: latestInGroup?.campaign_id || null,
        document_group_id: versionDoc.document_group_id,
        document_version: nextVersion,
        archive_status: false,
      }).select('document_id').single();

      if (insertErr) {
        await supabase.storage.from('documents').remove([storagePath]);
        throw insertErr;
      }

      if (latestInGroup?.campaign_id && insertedRow?.document_id) {
        const { data: groupRows } = await supabase
          .from('documents')
          .select('document_id')
          .eq('document_group_id', versionDoc.document_group_id);

        const groupIds = (groupRows || []).map((row) => row.document_id);
        if (groupIds.length > 0) {
          await supabase
            .from('campaign_materials')
            .delete()
            .in('document_id', groupIds);
        }

        await supabase.from('campaign_materials').insert({
          campaign_id: latestInGroup.campaign_id,
          document_id: insertedRow.document_id,
        });
      }

      logActivity(personName, 'document_version_uploaded', {
        file_name: baseFileName,
        version: nextVersion,
        document_group_id: versionDoc.document_group_id,
      });

      setVersionUploadFile(null);
      if (versionUploadInputRef.current) versionUploadInputRef.current.value = '';

      await handleViewVersions(versionDoc);
      await loadDocuments(activeFolderId, showArchived);
    } catch (err) {
      setVersionUploadError(err.message || 'Could not upload this version.');
    } finally {
      setVersionUploading(false);
    }
  }

  // Archives a single version of a document (rather than the whole group).
  async function archiveDocumentVersion(versionDocItem) {
    const { error } = await supabase
      .from('documents')
      .update({ archive_status: true })
      .eq('document_id', versionDocItem.document_id);

    if (error) {
      alert('Error archiving version: ' + error.message);
      return;
    }

    logActivity(personName, 'document_version_archived', {
      file_name: versionDocItem.file_name,
      document_group_id: versionDocItem.document_group_id || versionDoc?.document_group_id,
      document_version: versionDocItem.document_version,
      document_id: versionDocItem.document_id,
    });

    if (versionDoc) {
      await handleViewVersions(versionDoc);
    }
    await loadDocuments(activeFolderId, showArchived);
  }

  // Restores a single archived version.
  async function restoreDocumentVersion(versionDocItem) {
    const { error } = await supabase
      .from('documents')
      .update({ archive_status: false })
      .eq('document_id', versionDocItem.document_id);

    if (error) {
      alert('Error restoring version: ' + error.message);
      return;
    }

    logActivity(personName, 'document_version_restored', {
      file_name: versionDocItem.file_name,
      document_group_id: versionDocItem.document_group_id || versionDoc?.document_group_id,
      document_version: versionDocItem.document_version,
      document_id: versionDocItem.document_id,
    });

    if (versionDoc) {
      await handleViewVersions(versionDoc);
    }
    await loadDocuments(activeFolderId, showArchived);
  }

  // Resets and closes the upload modal.
  function closeUploadModal() {
    setShowUpload(false);
    setUploadFile(null);
    setUploadName('');
    setUploadCategory('general');
    setNewVersionGroupId(null);
    setNameConflictDoc(null);
    setConflictResolution(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Toggles a document between "general" and "campaign material" categories.
  async function toggleDocumentCategory(doc) {
    const nextCategory = doc.document_category === 'campaign_material' ? 'general' : 'campaign_material';
    const { error } = await supabase
      .from('documents')
      .update({ document_category: nextCategory })
      .eq('document_group_id', doc.document_group_id);
    if (error) { alert('Could not update category: ' + error.message); return; }
    if (versionDoc?.document_group_id === doc.document_group_id) {
      setVersionDoc((prev) => (prev ? { ...prev, document_category: nextCategory } : prev));
      setVersions((prev) => prev.map((v) => ({ ...v, document_category: nextCategory })));
    }
    logActivity(personName, 'document_category_updated', {
      file_name: doc.file_name,
      document_group_id: doc.document_group_id,
      category: nextCategory,
    });
    loadDocuments(activeFolderId, showArchived);
  }

  // Loads the list of non-archived campaigns for the assignment dropdown.
  async function loadCampaignOptions() {
    const { data, error } = await supabase
      .from('campaigns')
      .select('campaign_id, campaign_name, campaign_status')
      .neq('campaign_status', 'archived')
      .order('campaign_name');

    if (error) {
      alert('Could not load campaigns: ' + error.message);
      return;
    }

    setCampaignOptions(data || []);
  }

  // Opens the "Add to Campaign" modal if the document is marked as campaign material.
  async function openAssignCampaignModal(doc) {
    if (!canAssignCampaign) return;
    if (doc.document_category !== 'campaign_material') return;

    setAssignDoc(doc);
    setSelectedCampaignForAssign(doc.campaign_id || '');
    if (campaignOptions.length === 0) {
      await loadCampaignOptions();
    }
  }

  function closeAssignCampaignModal() {
    setAssignDoc(null);
    setSelectedCampaignForAssign('');
    setAssignLoading(false);
  }

  // Links this document group to the selected campaign (or removes the link if none chosen).
  async function handleAssignCampaign() {
    if (!assignDoc) return;
    if (assignDoc.document_category !== 'campaign_material') {
      alert('Must be marked as campaign material in preview');
      return;
    }

    setAssignLoading(true);
    const nextCampaignId = selectedCampaignForAssign || null;

    const { data: groupRows, error: groupErr } = await supabase
      .from('documents')
      .select('document_id, document_version')
      .eq('document_group_id', assignDoc.document_group_id);

    if (groupErr) {
      alert('Could not load document versions: ' + groupErr.message);
      setAssignLoading(false);
      return;
    }

    const groupIds = (groupRows || []).map((row) => row.document_id);
    const latestRow = (groupRows || []).reduce((best, row) => {
      if (!best || (row.document_version || 0) > (best.document_version || 0)) return row;
      return best;
    }, null);

    const { error: updateErr } = await supabase
      .from('documents')
      .update({ campaign_id: nextCampaignId })
      .eq('document_group_id', assignDoc.document_group_id);

    if (updateErr) {
      alert('Could not assign campaign: ' + updateErr.message);
      setAssignLoading(false);
      return;
    }

    if (groupIds.length > 0) {
      await supabase
        .from('campaign_materials')
        .delete()
        .in('document_id', groupIds);
    }

    if (nextCampaignId && latestRow?.document_id) {
      const { error: linkErr } = await supabase.from('campaign_materials').insert({
        campaign_id: nextCampaignId,
        document_id: latestRow.document_id,
      });

      if (linkErr) {
        alert('Campaign assignment saved, but materials link failed: ' + linkErr.message);
      }
    }

    const selectedCampaignName = campaignOptions.find((c) => c.campaign_id === nextCampaignId)?.campaign_name || null;
    logActivity(personName, 'document_campaign_assignment_updated', {
      file_name: assignDoc.file_name,
      document_group_id: assignDoc.document_group_id,
      campaign_id: nextCampaignId,
      campaign_name: selectedCampaignName,
    });

    setAssignLoading(false);
    closeAssignCampaignModal();
    loadDocuments(activeFolderId, showArchived);
  }

  // Drag-and-drop handlers for reorganising folders in the sidebar.
  function handleFolderDragStart(e, folder) {
    setDraggedFolder(folder);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleFolderDragOver(e, folder) {
    if (draggedFolder?.folder_id !== folder.folder_id) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleRootDragOver(e) {
    if (draggedFolder) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverRoot(true);
    }
  }

  // Moves a folder to the top level (no parent folder) when dropped on "All Documents".
  async function handleRootDrop(e) {
    e.preventDefault();
    setDragOverRoot(false);

    if (!draggedFolder || draggedFolder.parent_folder_id === null) {
      setDraggedFolder(null);
      return;
    }

    // Update folder to sit at the top level.
    const { error } = await supabase
      .from('folders')
      .update({ parent_folder_id: null })
      .eq('folder_id', draggedFolder.folder_id);

    if (error) {
      alert('Could not move folder: ' + error.message);
    } else {
      logActivity(personName, 'folder_moved', {
        folder_name: draggedFolder.name,
        old_parent_id: draggedFolder.parent_folder_id || null,
        new_parent_id: null,
      });
      loadFolders();
    }

    setDraggedFolder(null);
  }

  // Moves a folder into another folder when dropped onto it.
  async function handleFolderDrop(e, targetFolder) {
    e.preventDefault();
    if (!draggedFolder || draggedFolder.folder_id === targetFolder.folder_id) {
      setDraggedFolder(null);
      return;
    }

    // Prevent moving a folder into one of its own subfolders, which would break the tree.
    const isMovingIntoChild = (parent, childId) => {
      if (parent.folder_id === childId) return true;
      if (parent.children) {
        return parent.children.some((child) => isMovingIntoChild(child, childId));
      }
      return false;
    };

    if (isMovingIntoChild(draggedFolder, targetFolder.folder_id)) {
      alert('Cannot move a folder into one of its own subfolders.');
      setDraggedFolder(null);
      return;
    }

    // Update the folder's location in the database.
    const { error } = await supabase
      .from('folders')
      .update({ parent_folder_id: targetFolder.folder_id })
      .eq('folder_id', draggedFolder.folder_id);

    if (error) {
      alert('Could not move folder: ' + error.message);
    } else {
      logActivity(personName, 'folder_moved', {
        folder_name: draggedFolder.name,
        old_parent_id: draggedFolder.parent_folder_id || null,
        new_parent_id: targetFolder.folder_id,
      });
      loadFolders();
    }

    setDraggedFolder(null);
  }

  // Opens the delete confirmation for a folder.
  async function handleDeleteFolder(folder) {
    setFolderToDelete(folder);
  }

  // Carries out the folder archival after the user confirms.
  async function confirmDeleteFolder() {
    if (!folderToDelete) return;

    const { error } = await supabase
      .rpc('archive_folder', { p_folder_id: folderToDelete.folder_id });

    if (error) {
      alert('Could not archive folder: ' + error.message);
      return;
    }

    logActivity(personName, 'folder_archived', {
      folder_name: folderToDelete.name,
      parent_folder_id: folderToDelete.parent_folder_id || null,
    });

    // If the archived folder was open, switch back to showing all documents.
    if (activeFolderId === folderToDelete.folder_id) {
      handleAllDocsSelect();
    }

    setFolderToDelete(null);
    loadFolders();
  }

  // Unarchive a folder (admin only)
  async function unarchiveFolder(folder) {
    const { error } = await supabase
      .rpc('unarchive_folder', { p_folder_id: folder.folder_id });

    if (error) {
      alert('Could not unarchive folder: ' + error.message);
      return;
    }

    logActivity(personName, 'folder_unarchived', {
      folder_name: folder.name,
      parent_folder_id: folder.parent_folder_id || null,
    });

    loadFolders();
  }

  // Loads the access settings for a folder and opens the access management panel.
  async function handleManageFolderAccess(folder) {
    if (!canManageFolderAccess) {
      return;
    }

    setFolderToManageAccess(folder);
    setLoadingAccessData(true);
    setAccessError(null);

    // Load which policy applies to this folder.
    const { data: policyData, error: policyErr } = await supabase
      .from('folder_access_policies')
      .select('policy_id, allow_all_roles')
      .eq('folder_id', folder.folder_id)
      .single();

    if (policyErr) {
      setAccessError(policyErr.message);
      setLoadingAccessData(false);
      return;
    }

    // If the folder is restricted, also load which roles are allowed.
    let allowedRoles = [];
    if (!policyData.allow_all_roles) {
      const { data: roleData, error: roleErr } = await supabase
        .from('folder_access_roles')
        .select('role')
        .eq('policy_id', policyData.policy_id);

      if (roleErr) {
        setAccessError(roleErr.message);
        setLoadingAccessData(false);
        return;
      }

      allowedRoles = roleData.map((r) => r.role);
    }

    setFolderAccessData({
      policy_id: policyData.policy_id,
      allow_all_roles: policyData.allow_all_roles,
      allowed_roles: allowedRoles,
    });
    setLoadingAccessData(false);
  }

  // Saves the access settings: open to everyone, or restricted to specific roles.
  async function handleSaveFolderAccess(allowAll, selectedRoles) {
    if (!folderToManageAccess || !folderAccessData) return;
    setSavingAccessData(true);
    setAccessError(null);

    try {
      // Save whether the folder is open to all or restricted.
      const { error: updateErr } = await supabase
        .from('folder_access_policies')
        .update({ allow_all_roles: allowAll })
        .eq('policy_id', folderAccessData.policy_id);

      if (updateErr) throw updateErr;

      // Clear the old role list before writing the new one.
      const { error: deleteErr } = await supabase
        .from('folder_access_roles')
        .delete()
        .eq('policy_id', folderAccessData.policy_id);

      if (deleteErr) throw deleteErr;

      // Write the new allowed roles if the folder is restricted.
      if (!allowAll && selectedRoles.length > 0) {
        const rolesToInsert = selectedRoles.map((role) => ({
          policy_id: folderAccessData.policy_id,
          role,
        }));

        const { error: insertErr } = await supabase
          .from('folder_access_roles')
          .insert(rolesToInsert);

        if (insertErr) throw insertErr;
      }

      logActivity(personName, 'folder_access_updated', {
        folder_name: folderToManageAccess.name,
        allow_all_roles: allowAll,
        allowed_roles: selectedRoles,
      });

      setFolderAccessData({
        ...folderAccessData,
        allow_all_roles: allowAll,
        allowed_roles: selectedRoles,
      });

      // Close modal after successful save.
      closeFolderModals();
    } catch (err) {
      setAccessError(err.message);
    }

    setSavingAccessData(false);
  }

  // Closes all folder-related modals and clears their state.
  function closeFolderModals() {
    setFolderToDelete(null);
    setFolderToManageAccess(null);
    setFolderAccessData(null);
    setAccessError(null);
  }

  // The currently open folder object, used for breadcrumbs and the new-folder label.
  const activeFolder = folders.find((f) => f.folder_id === activeFolderId);
  // What's shown in the version history list (with or without archived versions).
  const visibleVersions = showArchivedVersions
    ? versions
    : versions.filter((v) => !v.archive_status);
  // The version currently shown in the preview pane.
  const activeVersionInModal = previewDoc || visibleVersions[0] || versions[0] || null;

  // Only show the latest version of each document group in the table.
  const latestVersions = documents.reduce((acc, doc) => {
    const existing = acc.find((d) => d.document_group_id === doc.document_group_id);
    if (!existing || doc.document_version > existing.document_version) {
      return [...acc.filter((d) => d.document_group_id !== doc.document_group_id), doc];
    }
    return acc;
  }, []);

  // Render
  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900">Document Management</h2>
        {renameSuccessMessage && (
          <div className="mt-3 inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm text-green-700">
            {renameSuccessMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Left: Folder Tree */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            {canCreateFolders && (
              <button
                onClick={() => setShowNewFolder(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors mb-4 font-medium text-sm"
              >
                <PlusIcon className="h-4 w-4" />
                New Folder
              </button>
            )}

            {userRole === 'admin' && (
              <button
                onClick={() => setShowArchivedFolders(!showArchivedFolders)}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors mb-4 font-medium text-sm ${
                  showArchivedFolders
                    ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {showArchivedFolders ? '✓ ' : ''}
                {showArchivedFolders ? 'Hiding' : 'Show'} Archived
              </button>
            )}

            <button
              onClick={handleAllDocsSelect}
              onDragOver={handleRootDragOver}
              onDragLeave={() => setDragOverRoot(false)}
              onDrop={handleRootDrop}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium mb-1
                ${!activeFolderId ? 'bg-brand-deep text-white' : 'text-gray-700 hover:bg-gray-100'}
                ${dragOverRoot ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}
            >
              <FolderOpenIcon className="h-4 w-4 flex-shrink-0" />
              All Documents
            </button>

            {folderTree.map((node) => (
              <FolderNode
                key={node.folder_id}
                node={node}
                activeFolderId={activeFolderId}
                onSelect={handleFolderSelect}
                onDelete={handleDeleteFolder}
                onManageAccess={handleManageFolderAccess}
                canManageAccess={canManageFolderAccess}
                onUnarchive={unarchiveFolder}
                isAdmin={userRole === 'admin'}
                showingArchived={showArchivedFolders}
                draggedFolder={draggedFolder}
                onDragStart={handleFolderDragStart}
                onDragOver={handleFolderDragOver}
                onDrop={handleFolderDrop}
              />
            ))}

            {folderTree.length === 0 && (
              <p className="text-xs text-gray-400 mt-2 px-3">No folders yet</p>
            )}
          </div>
        </div>

        {/* Right: Documents */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-gray-600 text-sm">
              <button onClick={handleAllDocsSelect} className="text-gray-400 hover:text-gray-600 transition-colors">
                All Documents
              </button>
              {activeFolder && (
                <>
                  <span className="text-gray-400"> / </span>
                  <span>{activeFolder.name}</span>
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canDeleteDocuments && (
                <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
                  <button
                    onClick={() => handleArchiveViewChange(false)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${!showArchived ? 'bg-brand-sage text-brand-deep font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => handleArchiveViewChange(true)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${showArchived ? 'bg-brand-sage text-brand-deep font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Archived
                  </button>
                </div>
              )}
              {canUploadDocuments && !showArchived && (
                <button
                  onClick={() => {
                    setNewVersionGroupId(null);
                    setNameConflictDoc(null);
                    setConflictResolution(null);
                    setUploadName('');
                    setUploadFile(null);
                    setShowUpload(true);
                  }}
                  className="px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                >
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  Upload Document
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-gray-400 text-sm">Loading documents…</div>
            ) : loadError ? (
              <div className="py-16 text-center text-red-500 text-sm">{loadError}</div>
            ) : latestVersions.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">
                No {showArchived ? 'archived documents' : 'documents'}{activeFolderId ? ' in this folder' : ''}.
                {!showArchived && canUploadDocuments && ' Upload one to get started.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Version</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Size</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Uploaded</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">By</th>
                      <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestVersions.map((doc) => (
                      <tr
                        key={doc.document_id}
                        onDoubleClick={() => handleDocumentNameDoubleClick(doc)}
                        className={`border-b border-gray-200 transition-colors last:border-b-0 ${
                          selectedDocId === doc.document_id ? 'bg-brand-cream/50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                          <div className="flex items-start gap-2">
                            <DocumentIcon className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              {doc.document_category === 'campaign_material' && (
                                <span className="inline-block mb-1 text-xs px-1.5 py-0.5 rounded bg-brand-mist/20 text-brand-deep border border-brand-mist/30 font-medium">Campaign Material</span>
                              )}
                              {editingDocId === doc.document_id ? (
                                <div className="min-w-0">
                                  <input
                                    ref={renameInputRef}
                                    value={renameValue}
                                    onChange={(e) => {
                                      setRenameValue(e.target.value);
                                      if (renameError) setRenameError('');
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveRename(doc);
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelRename();
                                      }
                                    }}
                                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                                  />
                                  <div className="mt-1 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => saveRename(doc)}
                                      disabled={renaming}
                                      className="text-xs text-brand-deep hover:underline disabled:opacity-50"
                                    >
                                      {renaming ? 'Saving…' : 'Save'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelRename}
                                      className="text-xs text-gray-500 hover:underline"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  {renameError && (
                                    <p className="mt-1 text-xs text-red-500">{renameError}</p>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleDocumentNameClick(doc)}
                                  className="block w-full truncate text-left"
                                  title="Double-click quickly to preview. Click once, then click again slowly to rename."
                                >
                                  {doc.file_name}
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">v{doc.document_version}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{formatBytes(doc.size_bytes)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{formatDate(doc.uploaded_at)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{doc.uploader_name}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              title="Download"
                              onClick={() => handleDownload(doc)}
                              className="p-1 text-brand-deep hover:bg-brand-cream rounded transition-colors"
                            >
                              <ArrowDownTrayIcon className="h-4 w-4" />
                            </button>
                            <button
                              title="Version history"
                              onClick={() => handleViewVersions(doc)}
                              className="p-1 text-brand-deep hover:bg-brand-cream rounded transition-colors"
                            >
                              <ClockIcon className="h-4 w-4" />
                            </button>
                            {canUploadDocuments && !showArchived && (
                              <button
                                title="Upload new version"
                                onClick={() => {
                                  setNewVersionGroupId(doc.document_group_id);
                                  setNameConflictDoc(null);
                                  setConflictResolution('version');
                                  setUploadName(doc.file_name || '');
                                  setUploadFile(null);
                                  setShowUpload(true);
                                }}
                                className="p-1 text-brand-deep hover:bg-brand-cream rounded transition-colors"
                              >
                                <ArrowUpTrayIcon className="h-4 w-4" />
                              </button>
                            )}
                            {canAssignCampaign && !showArchived && (
                              <button
                                title={doc.document_category === 'campaign_material'
                                  ? 'Add to campaign'
                                  : 'Must be marked as campaign material in preview'}
                                onClick={() => openAssignCampaignModal(doc)}
                                disabled={doc.document_category !== 'campaign_material'}
                                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                              >
                                Add to Campaign
                              </button>
                            )}
                            {canDeleteDocuments && showArchived && (
                              <button
                                title="Restore document"
                                onClick={() => handleRestore(doc)}
                                className="p-1 text-brand-deep hover:bg-brand-cream rounded transition-colors"
                              >
                                <ArrowPathIcon className="h-4 w-4" />
                              </button>
                            )}
                            {canDeleteDocuments && (
                              <button
                                title={showArchived ? 'Permanently delete document' : 'Archive or permanently delete document'}
                                onClick={() => handleDelete(doc)}
                                className="p-1 text-red-400 hover:bg-red-50 rounded transition-colors"
                              >
                                <TrashIcon className="h-4 w-4" />
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
        </div>
      </div>

      {/* New Folder Modal */}
      {showNewFolder && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">New Folder</h3>
              <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Folder name
                  {activeFolder && (
                    <span className="font-normal text-gray-400"> inside {activeFolder.name}</span>
                  )}
                </label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. Q2 Reports"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim() || savingFolder}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                >
                  {savingFolder ? 'Creating…' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* New Folder Access Prompt (for sales/marketing members) */}
      {showNewFolderAccessPrompt && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Folder Access</h3>
              <button
                onClick={() => {
                  setShowNewFolderAccessPrompt(false);
                  setPendingFolderName('');
                  setNewFolderAccessChoice('public');
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Who should be able to access this folder?
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createFolderWithAccess(pendingFolderName, newFolderAccessChoice);
                }}
                className="space-y-4"
              >
                <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="access-choice"
                    value="public"
                    checked={newFolderAccessChoice === 'public'}
                    onChange={(e) => setNewFolderAccessChoice(e.target.value)}
                    className="h-4 w-4 text-brand-mist border-gray-300 focus:ring-brand-mist"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Everyone</p>
                    <p className="text-xs text-gray-500">All roles can access this folder</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="radio"
                    name="access-choice"
                    value="role-limited"
                    checked={newFolderAccessChoice === 'role-limited'}
                    onChange={(e) => setNewFolderAccessChoice(e.target.value)}
                    className="h-4 w-4 text-brand-mist border-gray-300 focus:ring-brand-mist"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Only my side (exclude opposite team)</p>
                    <p className="text-xs text-gray-500">
                      {userRole === 'sales_representative'
                        ? 'Everyone except Marketing Team Members can access'
                        : 'Everyone except Sales Representatives can access'}
                    </p>
                  </div>
                </label>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewFolderAccessPrompt(false);
                      setPendingFolderName('');
                      setNewFolderAccessChoice('public');
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingFolder}
                    className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                  >
                    {savingFolder ? 'Creating…' : 'Create Folder'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* Upload Modal */}
      {showUpload && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {newVersionGroupId ? 'Upload New Version' : 'Upload Document'}
              </h3>
              <button onClick={closeUploadModal} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select file</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleUploadFileSelect}
                    className="w-[122px] text-transparent cursor-default file:cursor-pointer file:mr-0 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-cream file:text-brand-deep hover:file:bg-brand-sage"
                  />
                  <span className="text-sm text-gray-600 cursor-text select-text">
                    {uploadFile ? uploadFile.name : 'No file chosen'}
                  </span>
                </div>
              </div>
                {nameConflictDoc && !newVersionGroupId && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                    <p className="text-xs text-amber-800">
                      A document named <span className="font-semibold">{nameConflictDoc.file_name}</span> already exists.
                      Is this upload a new version of that file?
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenPreview(nameConflictDoc)}
                        className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-brand-deep hover:bg-gray-50"
                      >
                        Preview Existing
                      </button>
                      <button
                        type="button"
                        onClick={chooseConflictAsVersion}
                        className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                          conflictResolution === 'version'
                            ? 'bg-brand-deep text-white'
                            : 'bg-white border border-gray-200 text-brand-deep hover:bg-gray-50'
                        }`}
                      >
                        Yes, New Version
                      </button>
                      <button
                        type="button"
                        onClick={chooseConflictAsRename}
                        className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                          conflictResolution === 'rename'
                            ? 'bg-brand-deep text-white'
                            : 'bg-white border border-gray-200 text-brand-deep hover:bg-gray-50'
                        }`}
                      >
                        No, Rename Upload
                      </button>
                    </div>
                  </div>
                )}
                {conflictResolution === 'rename' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New file name</label>
                    <input
                      type="text"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                      placeholder="Enter a unique file name"
                    />
                  </div>
                )}
              {newVersionGroupId && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  This file will be saved as a new version of the existing document, preserving the full version history.
                </p>
              )}
              {uploadError && (
                <p className="text-xs text-red-500">{uploadError}</p>
              )}
              {!newVersionGroupId && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={uploadCategory === 'campaign_material'}
                    onChange={(e) => setUploadCategory(e.target.checked ? 'campaign_material' : 'general')}
                    className="h-4 w-4 rounded border-gray-300 text-brand-deep focus:ring-brand-mist"
                  />
                  <span className="text-sm text-gray-700">Mark as campaign material</span>
                </label>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={closeUploadModal} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* Assign Campaign Modal */}
      {assignDoc && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Add To Marketing Campaign</h3>
                <p className="text-xs text-gray-500 truncate max-w-xs">{assignDoc.file_name}</p>
              </div>
              <button onClick={closeAssignCampaignModal} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
                <select
                  value={selectedCampaignForAssign}
                  onChange={(e) => setSelectedCampaignForAssign(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not linked to a campaign</option>
                  {campaignOptions.map((campaign) => (
                    <option key={campaign.campaign_id} value={campaign.campaign_id}>
                      {campaign.campaign_name} ({campaign.campaign_status.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                This links the whole file group, and the latest document version is always used for campaign materials.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeAssignCampaignModal}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAssignCampaign}
                  disabled={assignLoading}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                >
                  {assignLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* Archive/Delete Modal */}
      {actionDoc && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {showArchived ? 'Delete Archived Document' : 'Document Actions'}
                </h3>
                <p className="text-sm text-gray-500 mt-1 truncate max-w-xs">{actionDoc.file_name}</p>
              </div>
              <button onClick={closeActionModal} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {confirmPermanentDelete ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  Permanently delete all versions of this document. This cannot be undone.
                </div>
                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmPermanentDelete(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Back
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handlePermanentDeleteFromModal}
                      className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
                    >
                      Permanently Delete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {showArchived
                    ? 'Archived documents can be permanently removed from the system.'
                    : 'Choose whether to archive this document or permanently delete every version.'}
                </p>
                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={closeActionModal}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  {!showArchived && (
                    <button
                      type="button"
                      onClick={handleArchiveFromModal}
                      className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors"
                    >
                      Archive
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setConfirmPermanentDelete(true)}
                      className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
                    >
                      Permanent Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Folder Modal */}
      {folderToDelete && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Archive Folder</h3>
              <button onClick={() => setFolderToDelete(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-800">
                  Archive the folder <span className="font-semibold">"{folderToDelete.name}"</span>?
                </p>
                <p className="mt-2 text-xs text-amber-700">
                  This folder will be hidden from all users except admins. You can unarchive it later.
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setFolderToDelete(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteFolder}
                  className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
                >
                  Archive Folder
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* Manage Folder Access Modal */}
      {folderToManageAccess && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Manage Folder Access</h3>
                <p className="text-sm text-gray-500 mt-1 truncate">{folderToManageAccess.name}</p>
              </div>
              <button onClick={closeFolderModals} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {loadingAccessData ? (
              <div className="py-8 text-center text-gray-400 text-sm">Loading access settings…</div>
            ) : accessError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-4">
                <p className="text-sm text-red-700">{accessError}</p>
              </div>
            ) : folderAccessData ? (
              <FolderAccessForm
                folderAccessData={folderAccessData}
                onSave={handleSaveFolderAccess}
                onCancel={closeFolderModals}
                saving={savingAccessData}
                currentUserRole={userRole}
              />
            ) : null}
          </div>
        </div>,
        document.getElementById('modal-root')
      )}

      {/* Combined Preview + Versions Modal */}
      {versionDoc && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
          onClick={() => {
            setVersionDoc(null);
            setPreviewDoc(null);
            setPreviewUrl(null);
            setPreviewError(null);
            setVersionUploadFile(null);
            setVersionUploadError(null);
          }}
        >
          <div
            className="bg-white w-full max-w-6xl h-[88vh] rounded-xl shadow-xl mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full grid grid-cols-1 lg:grid-cols-3">
              <div className="lg:col-span-2 border-r border-gray-200 flex flex-col">
                <div className="px-5 py-4 border-b border-gray-200">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">{versionDoc.file_name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Current Version: v{activeVersionInModal?.document_version || 1}
                    </p>
                  </div>
                </div>

                <div className="flex-1 bg-gray-50 p-4">
                  <div className="h-full rounded-lg border border-gray-200 bg-white overflow-hidden">
                    {previewLoading || (versionsLoading && !previewUrl) ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading preview…</div>
                    ) : previewError ? (
                      <div className="h-full flex items-center justify-center px-6 text-sm text-red-500 text-center">
                        Could not load preview: {previewError}
                      </div>
                    ) : !previewUrl ? (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400">No preview available.</div>
                    ) : (previewDoc || versionDoc)?.mime_type?.startsWith('image/') ? (
                      <div className="h-full flex items-center justify-center p-4">
                        <img
                          src={previewUrl}
                          alt={(previewDoc || versionDoc)?.file_name}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    ) : (
                      <iframe
                        title={`Preview ${(previewDoc || versionDoc)?.file_name}`}
                        src={previewUrl}
                        className="w-full h-full border-0"
                      />
                    )}
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-gray-200 bg-white flex justify-end">
                  <button
                    onClick={() => activeVersionInModal && handleDownload(activeVersionInModal)}
                    disabled={!activeVersionInModal}
                    className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors"
                  >
                    Download
                  </button>
                </div>
              </div>

              <div className="lg:col-span-1 flex flex-col bg-white">
                <div className="px-5 py-4 border-b border-gray-200">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-xl font-semibold text-gray-900">Version History</h4>
                    <button
                      onClick={() => {
                        setVersionDoc(null);
                        setPreviewDoc(null);
                        setPreviewUrl(null);
                        setPreviewError(null);
                        setVersionUploadFile(null);
                        setVersionUploadError(null);
                      }}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      CLOSE
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 truncate">{versionDoc.file_name}</p>
                  {canAssignCampaign && !showArchived && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleDocumentCategory(versionDoc)}
                        className={`w-full px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                          versionDoc.document_category === 'campaign_material'
                            ? 'border-brand-mist/40 text-brand-deep bg-brand-mist/10 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                            : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                        }`}
                      >
                        {versionDoc.document_category === 'campaign_material'
                          ? 'Campaign Material ✓ (Click to remove)'
                          : 'Mark As Campaign Material'}
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      Showing {visibleVersions.length} of {versions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowArchivedVersions((s) => !s)}
                      className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                        showArchivedVersions
                          ? 'border-brand-mist text-brand-deep bg-brand-cream'
                          : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
                      }`}
                    >
                      {showArchivedVersions ? 'Hide Archived' : 'Show Archived'}
                    </button>
                  </div>
                  {canUploadDocuments && !showArchived && (
                    <div className="mt-3 space-y-2">
                      <input
                        ref={versionUploadInputRef}
                        type="file"
                        onChange={handleVersionWindowFileSelect}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => versionUploadInputRef.current?.click()}
                          className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded bg-white hover:bg-gray-50"
                        >
                          Choose File
                        </button>
                        <button
                          type="button"
                          onClick={handleUploadVersionFromWindow}
                          disabled={!versionUploadFile || versionUploading}
                          className="px-3 py-1.5 text-xs font-medium rounded bg-brand-deep text-white enabled:hover:bg-brand-mist enabled:hover:text-brand-deep disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {versionUploading ? 'Uploading…' : 'Upload'}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {versionUploadFile ? `Selected: ${versionUploadFile.name}` : 'No file selected'}
                      </p>
                      {versionUploadError && (
                        <p className="text-xs text-red-500">{versionUploadError}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  {versionsLoading ? (
                    <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
                  ) : visibleVersions.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm">
                      No versions to display.
                      {!showArchivedVersions && ' Toggle "Show Archived" to view archived versions.'}
                    </div>
                  ) : (
                    visibleVersions.map((v) => {
                      const isCurrent = activeVersionInModal?.document_id === v.document_id;
                      return (
                        <div
                          key={v.document_id}
                          className={`rounded-lg border p-3 ${
                            isCurrent ? 'border-brand-mist bg-brand-cream/60' : 'border-gray-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-2xl font-semibold text-gray-900">v{v.document_version}</span>
                            <div className="flex items-center gap-2">
                              {v.archive_status && (
                                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">Archived</span>
                              )}
                              {v.document_version === versions[0]?.document_version && (
                                <span className="text-xs bg-brand-mist text-white px-2 py-1 rounded-full">Latest</span>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-600">{formatDate(v.uploaded_at)}</p>
                          <p className="text-sm text-gray-600">By: {v.uploader_name}</p>
                          <p className="text-sm text-gray-500 mb-3">{formatBytes(v.size_bytes)}</p>
                          <div className={`grid gap-2 ${canDeleteDocuments ? 'grid-cols-3' : 'grid-cols-2'}`}>
                            <button
                              onClick={() => handleOpenPreview({ ...v, mime_type: versionDoc.mime_type })}
                              className="px-3 py-2 text-sm font-medium border border-gray-300 rounded bg-white hover:bg-gray-50"
                            >
                              View
                            </button>
                            <button
                              onClick={() => handleDownload(v)}
                              className="px-3 py-2 text-sm font-medium border border-gray-300 rounded bg-white hover:bg-gray-50"
                            >
                              Download
                            </button>
                            {canDeleteDocuments && (
                              <button
                                onClick={() => {
                                  if (v.archive_status) {
                                    restoreDocumentVersion(v);
                                  } else {
                                    archiveDocumentVersion(v);
                                  }
                                }}
                                className={`px-3 py-2 text-sm font-medium border rounded transition-colors ${
                                  v.archive_status
                                    ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                    : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
                                }`}
                              >
                                {v.archive_status ? 'Restore' : 'Archive'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')
      )}
    </div>
  );
}

// Form for managing who can access a folder with preset visibility options.
function FolderAccessForm({ folderAccessData, onSave, onCancel, saving, currentUserRole }) {
  const [accessMode, setAccessMode] = useState(
    folderAccessData.allow_all_roles ? 'everyone' : 'preset'
  );
  const [selectedPreset, setSelectedPreset] = useState(() => {
    // Determine which preset is currently applied
    const allowed = new Set(folderAccessData.allowed_roles);
    
    if (folderAccessData.allow_all_roles) {
      return 'everyone';
    } else if (
      allowed.has('admin') &&
      allowed.has('manager') &&
      allowed.has('sales_representative') &&
      allowed.has('compliance_officer') &&
      !allowed.has('marketing_team_member') &&
      allowed.size === 4
    ) {
      return 'sales_only';
    } else if (
      allowed.has('admin') &&
      allowed.has('manager') &&
      allowed.has('marketing_team_member') &&
      allowed.has('compliance_officer') &&
      !allowed.has('sales_representative') &&
      allowed.size === 4
    ) {
      return 'marketing_only';
    } else if (
      allowed.has('manager') &&
      allowed.has('admin') &&
      allowed.has('compliance_officer') &&
      allowed.size === 3
    ) {
      return 'managers';
    } else if (allowed.has('compliance_officer') && allowed.has('admin') && allowed.size === 2) {
      return 'compliance';
    } else {
      return 'custom';
    }
  });
  const [selectedRoles, setSelectedRoles] = useState(folderAccessData.allowed_roles);

  const allRoles = ['admin', 'manager', 'marketing_team_member', 'sales_representative', 'compliance_officer'];
  const roleLabels = {
    admin: 'Admin',
    manager: 'Manager',
    marketing_team_member: 'Marketing Team Member',
    sales_representative: 'Sales Representative',
    compliance_officer: 'Compliance Officer',
  };

  const presetOptions = [
    {
      id: 'everyone',
      label: 'Everyone',
      description: 'All roles can access',
      allowAll: true,
      roles: allRoles,
    },
    {
      id: 'sales_only',
      label: 'Sales Only',
      description: 'Everyone except Marketing Team Members',
      allowAll: false,
      roles: ['admin', 'manager', 'sales_representative', 'compliance_officer'],
    },
    {
      id: 'marketing_only',
      label: 'Marketing Members Only',
      description: 'Everyone except Sales Representatives',
      allowAll: false,
      roles: ['admin', 'manager', 'marketing_team_member', 'compliance_officer'],
    },
    {
      id: 'managers',
      label: 'Managers',
      description: 'Managers, Admins, and Compliance Officers',
      allowAll: false,
      roles: ['manager', 'admin', 'compliance_officer'],
    },
    {
      id: 'compliance',
      label: 'Compliance Officers Only',
      description: 'Only Compliance Officers and Admins',
      allowAll: false,
      roles: ['compliance_officer', 'admin'],
    },
  ];

  const toggleRole = (role) => {
    if (selectedRoles.includes(role)) {
      setSelectedRoles(selectedRoles.filter((r) => r !== role));
    } else {
      setSelectedRoles([...selectedRoles, role]);
    }
  };

  const applyPreset = (presetId) => {
    const preset = presetOptions.find((p) => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);
      setAccessMode(preset.allowAll ? 'everyone' : 'preset');
      setSelectedRoles(preset.roles);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const preset = presetOptions.find((p) => p.id === selectedPreset);
        const allowAll = preset ? preset.allowAll : false;
        onSave(allowAll, selectedRoles);
      }}
      className="space-y-4"
    >
      <div className="space-y-3">
        {presetOptions.map((preset) => (
          <label key={preset.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
            <input
              type="radio"
              name="access-preset"
              checked={selectedPreset === preset.id}
              onChange={() => applyPreset(preset.id)}
              className="h-4 w-4 text-brand-mist border-gray-300 focus:ring-brand-mist"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">{preset.label}</p>
              <p className="text-xs text-gray-500">{preset.description}</p>
            </div>
          </label>
        ))}
      </div>

      {selectedPreset === 'custom' && (
        <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm font-medium text-gray-700 mb-2">Custom roles (admins always have access):</p>
          {allRoles.map((role) => (
            <label key={role} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedRoles.includes(role) || role === 'admin'}
                onChange={() => {
                  if (role === 'admin') return;
                  toggleRole(role);
                }}
                disabled={role === 'admin'}
                className="h-4 w-4 text-brand-mist border-gray-300 rounded focus:ring-brand-mist"
              />
              <span className={`text-sm ${role === 'admin' ? 'text-gray-500' : 'text-gray-700'}`}>
                {roleLabels[role]}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
