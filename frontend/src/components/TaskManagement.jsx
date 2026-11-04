import { useState, useEffect, useCallback, useMemo } from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../utils/supabase';
import { logActivity } from '../utils/logActivity';

// The four task statuses shown as columns on the kanban board.
const STATUSES = [
  { id: 'pending',     label: 'To Do',      headerColor: 'text-orange-700', dot: 'bg-orange-400' },
  { id: 'in_progress', label: 'In Progress', headerColor: 'text-blue-700',   dot: 'bg-blue-500'   },
  { id: 'done',        label: 'Done',        headerColor: 'text-green-700',  dot: 'bg-green-500'  },
  { id: 'blocked',     label: 'Blocked',     headerColor: 'text-red-700',    dot: 'bg-red-400'    },
];

// Human-readable labels for each user role, shown in badges, dropdowns, and the assignment display.
const ROLE_LABELS = {
  admin:                'Admin',
  manager:              'Manager',
  marketing_team_member:'Marketing Team Member',
  sales_representative: 'Sales Representative',
  compliance_officer:   'Compliance Officer',
};

// Controls which roles each user type is allowed to assign tasks to.
// An empty array means that role cannot assign tasks to anyone.
const ASSIGNABLE_ROLES = {
  admin:                ['admin', 'manager', 'marketing_team_member', 'sales_representative', 'compliance_officer'],
  manager:              ['admin', 'manager', 'marketing_team_member', 'sales_representative', 'compliance_officer'],
  compliance_officer:   ['compliance_officer'],
  marketing_team_member: ['marketing_team_member'],
  sales_representative: [],
};

// Default empty state for the create task form.
const EMPTY_FORM = {
  task_name:        '',
  task_description: '',
  task_status:      'pending',
  assign_type:      'role',
  assigned_role:    '',
  assigned_user_id: '',
  is_urgent:        false,
};

// The task management page. Admins and managers see a full kanban board.
// Other roles see their own task queue and a shared pool of unclaimed tasks.
export default function TaskManagement({
  canManage  = false,
  userRole   = 'marketing_team_member',
  userId     = null,
  personName = 'Unknown',
}) {
  // Which roles this user can assign tasks to, based on their own role.
  const assignableRoles = ASSIGNABLE_ROLES[userRole] || [];
  // Non-managers can still create tasks for their own role queue.
  const canCreate = canManage || ['marketing_team_member', 'compliance_officer'].includes(userRole);
  const isAdmin = userRole === 'admin';
  // Only admins, managers, and compliance officers can archive (close) completed tasks.
  const canCloseGroupDone = canManage || userRole === 'compliance_officer';

  // The active task list and a separate list for tasks that have been archived.
  const [tasks,             setTasks]             = useState([]);
  const [archivedTasks,     setArchivedTasks]     = useState([]);
  // All active staff profiles — used to build the name/role lookup tables below.
  const [profiles,          setProfiles]          = useState([]);
  const [assigneeNames,     setAssigneeNames]     = useState({});
  const [assigneeRoles,     setAssigneeRoles]     = useState({});
  const [loading,           setLoading]           = useState(true);
  const [message,           setMessage]           = useState(null);

  // Create task modal and its form values.
  const [showCreate,        setShowCreate]        = useState(false);
  const [newTask,           setNewTask]           = useState(EMPTY_FORM);
  const [saving,            setSaving]            = useState(false);
  // Admins can filter the kanban board to show only one role group at a time.
  const [adminGroupFilter,  setAdminGroupFilter]  = useState('all');

  // Which task is being dragged across the full admin kanban, and which column it's hovering over.
  const [kanbanDragTaskId,  setKanbanDragTaskId]  = useState(null);
  const [kanbanDragOverCol, setKanbanDragOverCol] = useState(null);

  // Drag state for claiming a pool task by dropping it into the My Tasks section.
  const [poolDragTaskId,    setPoolDragTaskId]    = useState(null);
  const [myTasksDropActive, setMyTasksDropActive] = useState(false);

  // Which task is being dragged within the My Tasks mini-kanban, and which column it's hovering over.
  const [myDragTaskId,      setMyDragTaskId]      = useState(null);
  const [myDragOverCol,     setMyDragOverCol]     = useState(null);

  // Tracks which task is currently being claimed or having its blocker resolved, to show loading state.
  const [takingTaskId,      setTakingTaskId]      = useState(null);
  const [markingBlockerId,  setMarkingBlockerId]  = useState(null);
  const [pendingTaskAction, setPendingTaskAction] = useState(null);
  const [taskActionLoading, setTaskActionLoading] = useState(false);

  // Task details slide-over and its notes list.
  const [selectedTask,      setSelectedTask]      = useState(null);
  const [taskNotes,         setTaskNotes]         = useState([]);
  const [taskNotesLoading,  setTaskNotesLoading]  = useState(false);
  const [taskNoteInput,     setTaskNoteInput]     = useState('');
  const [taskNoteSaving,    setTaskNoteSaving]    = useState(false);

  // Loads all active (non-archived) tasks. The database restricts what each role can see.
  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select([
        'task_id', 'task_name', 'task_description', 'task_status',
        'assigned_role', 'assigned_user_id', 'taken_by', 'is_urgent',
        'blocker_resolved_by', 'blocker_resolved_at',
        'created_by', 'created_at',
        'task_assignees ( user_id )',
      ].join(', '))
      .eq('archive_status', false)
      .order('created_at', { ascending: false });

    if (error) { setLoading(false); return; }
    setTasks(data || []);
    setLoading(false);
  }, []);

  // Loads tasks that have been archived (closed). Only visible to users who can close tasks.
  const loadArchivedTasks = useCallback(async () => {
    if (!canCloseGroupDone) {
      setArchivedTasks([]);
      return;
    }

    const { data } = await supabase
      .from('tasks')
      .select([
        'task_id', 'task_name', 'task_description', 'task_status',
        'assigned_role', 'assigned_user_id', 'taken_by', 'is_urgent',
        'created_by', 'created_at',
      ].join(', '))
      .eq('archive_status', true)
      .order('updated_at', { ascending: false });

    setArchivedTasks(data || []);
  }, [canCloseGroupDone]);

  // Fetches all active staff profiles and builds name/role lookup tables used across the board.
  const loadProfiles = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, full_name, company_role')
      .eq('is_active', true)
      .order('full_name');
    const profs = data || [];
    setProfiles(profs);
    setAssigneeNames(Object.fromEntries(profs.map((p) => [p.user_id, p.full_name])));
    setAssigneeRoles(Object.fromEntries(profs.map((p) => [p.user_id, p.company_role])));
  }, []);

  useEffect(() => {
    // Load tasks, profiles, and archived tasks together when the page first opens.
    let mounted = true;
    async function init() {
      if (!mounted) return;
      await Promise.all([loadTasks(), loadProfiles(), loadArchivedTasks()]);
    }
    init();
    return () => { mounted = false; };
  }, [loadTasks, loadProfiles, loadArchivedTasks]);

  // Returns true if the given user ID belongs to the currently logged-in user.
  const isCurrentUser = (value) => Boolean(userId) && value === userId;

  // Returns true if the current user owns or has claimed this task.
  const isTaskHolder = (task) =>
    isCurrentUser(task.taken_by) || isCurrentUser(task.assigned_user_id);

  // Returns true if the current user is allowed to change this task (e.g. add notes, change status).
  const canEditTask = (task) => canManage || isTaskHolder(task);

  function getPersonDisplay(userIdValue) {
    const name = assigneeNames[userIdValue] || 'Unknown';
    const role = assigneeRoles[userIdValue];
    const roleLabel = role ? (ROLE_LABELS[role] || role) : null;
    return roleLabel ? `${name} (${roleLabel})` : name;
  }

  function getAssignmentDisplay(task) {
    // compact assignment label shown on each task card
    if (task.assigned_user_id) {
      return { text: `→ ${getPersonDisplay(task.assigned_user_id)}`, color: 'text-brand-mist' };
    }
    if (task.assigned_role) {
      const roleLabel = ROLE_LABELS[task.assigned_role] || task.assigned_role;
      if (task.taken_by) {
        return { text: `${roleLabel} · ${getPersonDisplay(task.taken_by)}`, color: 'text-blue-600' };
      }
      return { text: `${roleLabel} Pool`, color: 'text-orange-600' };
    }
    const legacy = (task.task_assignees || [])
      .map((a) => assigneeNames[a.user_id]).filter(Boolean);
    if (legacy.length > 0) return { text: legacy.join(', '), color: 'text-brand-mist' };
    return null;
  }

  function detailsAssignmentText(task) {
    // verbose assignment text shown in the task details modal
    if (task.assigned_user_id) {
      return `Assigned to ${getPersonDisplay(task.assigned_user_id)}`;
    }
    if (task.assigned_role) {
      const label = ROLE_LABELS[task.assigned_role] || task.assigned_role;
      if (task.taken_by) {
        return `${label} pool · Taken by ${getPersonDisplay(task.taken_by)}`;
      }
      return `${label} pool (awaiting)`;
    }
    const legacy = (task.task_assignees || [])
      .map((a) => assigneeNames[a.user_id]).filter(Boolean);
    return legacy.length > 0 ? legacy.join(', ') : 'Unassigned';
  }

  // Saves a new task. Assignment is either to a role pool (anyone with that role can claim it)
  // or directly to a specific person.
  async function handleCreate(e) {
    e.preventDefault();
    if (!newTask.task_name.trim()) return;
    setSaving(true);
    setMessage(null);

    const { data: { user } } = await supabase.auth.getUser();

    const insertData = {
      task_name:        newTask.task_name.trim(),
      task_description: newTask.task_description.trim() || null,
      task_status:      newTask.task_status,
      created_by:       user.id,
      is_urgent:        newTask.is_urgent,
    };

    if (newTask.assign_type === 'role') {
      const role = canManage ? newTask.assigned_role : userRole;
      if (role) insertData.assigned_role = role;
    } else {
      if (newTask.assigned_user_id) {
        insertData.assigned_user_id = newTask.assigned_user_id;
        const target = profiles.find((p) => p.user_id === newTask.assigned_user_id);
        if (target) insertData.assigned_role = target.company_role;
      }
    }

    const { error } = await supabase.from('tasks').insert(insertData);
    if (error) { setSaving(false); setMessage({ type: 'error', text: error.message }); return; }

    setSaving(false);
    logActivity(personName, 'task_created', { task: newTask.task_name.trim() });
    setShowCreate(false);
    setNewTask(EMPTY_FORM);
    setMessage({ type: 'success', text: 'Task created.' });
    loadTasks();
  }

  // Claims a pool task so it appears in the user's own My Tasks section.
  // Uses a database function to safely check the user has the right role.
  async function handleTakeTask(taskId, taskName) {
    setTakingTaskId(taskId);
    const { error } = await supabase.rpc('take_task', { p_task_id: taskId });
    setTakingTaskId(null);
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    logActivity(personName, 'task_taken', { task: taskName });
    setMessage({ type: 'success', text: `You've taken "${taskName}".` });
    loadTasks();
  }

  // Marks a blocked task as having its blocker cleared, without changing the task status.
  // Colleagues can do this to signal the block is resolved so the assignee can continue.
  async function handleMarkBlockerResolved(taskId) {
    setMarkingBlockerId(taskId);
    const { error } = await supabase.rpc('mark_blocker_resolved', { p_task_id: taskId });
    setMarkingBlockerId(null);
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    const patch = { blocker_resolved_by: userId, blocker_resolved_at: new Date().toISOString() };
    setTasks((prev) => prev.map((t) => t.task_id === taskId ? { ...t, ...patch } : t));
    setSelectedTask((prev) => prev?.task_id === taskId ? { ...prev, ...patch } : prev);
  }

  // Moves a task to a new status column. Updates the board instantly without waiting for a reload.
  async function handleStatusChange(taskId, newStatus, taskName) {
    const { error } = await supabase
      .from('tasks').update({ task_status: newStatus }).eq('task_id', taskId);
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    logActivity(personName, 'task_status_changed', { task: taskName, status: newStatus });
    // update local state immediately so drag-and-drop feels instant
    setTasks((prev) => prev.map((t) => t.task_id === taskId ? { ...t, task_status: newStatus } : t));
    // Reflect in open details modal
    setSelectedTask((prev) => prev?.task_id === taskId ? { ...prev, task_status: newStatus } : prev);
  }

  function handleArchive(task) {
    if (!task || task.task_status !== 'done' || !canCloseGroupDone) return;
    setPendingTaskAction({ type: 'archive', task });
  }

  // Opens the confirmation modal for permanently deleting a task.
  function handleDeleteTask(task) {
    if (!isAdmin || !task) return;
    setPendingTaskAction({ type: 'delete', task });
  }

  async function confirmTaskAction() {
    if (!pendingTaskAction || taskActionLoading) return;

    const { type, task } = pendingTaskAction;
    setTaskActionLoading(true);

    if (type === 'archive') {
      const { error } = await supabase
        .from('tasks')
        .update({ archive_status: true })
        .eq('task_id', task.task_id);

      if (error) {
        setMessage({ type: 'error', text: error.message });
        setTaskActionLoading(false);
        return;
      }

      logActivity(personName, 'task_closed', { task: task.task_name });
      setTasks((prev) => prev.filter((t) => t.task_id !== task.task_id));
      setArchivedTasks((prev) => [{ ...task, archive_status: true }, ...prev]);
      setSelectedTask((prev) => (prev?.task_id === task.task_id ? null : prev));
      setPendingTaskAction(null);
      setTaskActionLoading(false);
      return;
    }

    if (type === 'delete') {
      if (!isAdmin) {
        setTaskActionLoading(false);
        return;
      }

      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('task_id', task.task_id);

      if (error) {
        setMessage({ type: 'error', text: error.message });
        setTaskActionLoading(false);
        return;
      }

      logActivity(personName, 'task_deleted', { task: task.task_name });
      setTasks((prev) => prev.filter((t) => t.task_id !== task.task_id));
      setArchivedTasks((prev) => prev.filter((t) => t.task_id !== task.task_id));
      setSelectedTask((prev) => (prev?.task_id === task.task_id ? null : prev));
      setMessage({ type: 'success', text: `Task "${task.task_name}" deleted.` });
      setPendingTaskAction(null);
      setTaskActionLoading(false);
    }
  }

  // Drag handlers for the full admin/manager kanban board.
  function handleKanbanDragStart(e, taskId) {
    setKanbanDragTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }
  function handleKanbanDragEnd() { setKanbanDragTaskId(null); setKanbanDragOverCol(null); }

  function handleKanbanColDragOver(e, statusId) {
    if (!kanbanDragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (kanbanDragOverCol !== statusId) setKanbanDragOverCol(statusId);
  }
  function handleKanbanColDragLeave(statusId) {
    if (kanbanDragOverCol === statusId) setKanbanDragOverCol(null);
  }
  async function handleKanbanColDrop(e, statusId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    const task = tasks.find((t) => String(t.task_id) === taskId);
    setKanbanDragOverCol(null); setKanbanDragTaskId(null);
    if (!task || task.task_status === statusId) return;

    // If this is an unclaimed group task dragged from Open Group Tasks,
    // claim it first so it becomes assigned to the current user.
    if (task.assigned_role && !task.assigned_user_id && !task.taken_by) {
      await handleTakeTask(task.task_id, task.task_name);
      if (statusId !== 'in_progress') {
        await handleStatusChange(task.task_id, statusId, task.task_name);
      }
      return;
    }

    await handleStatusChange(task.task_id, statusId, task.task_name);
  }

  // Drag handlers for claiming a pool task by dropping it into the My Tasks section.
  function handlePoolDragStart(e, taskId) {
    setPoolDragTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }
  function handlePoolDragEnd() { setPoolDragTaskId(null); setMyTasksDropActive(false); }

  function handleMyZoneDragOver(e) {
    if (!poolDragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setMyTasksDropActive(true);
  }
  function handleMyZoneDragLeave(e) {
    // Only deactivate if leaving the section entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) setMyTasksDropActive(false);
  }
  async function handleMyZoneDrop(e) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    setMyTasksDropActive(false); setPoolDragTaskId(null);
    if (!taskId) return;
    const task = tasks.find((t) => t.task_id === taskId);
    if (task) await handleTakeTask(taskId, task.task_name);
  }

  // Drag handlers for moving tasks between status columns in the My Tasks mini-kanban.
  function handleMyDragStart(e, taskId) {
    setMyDragTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  }
  function handleMyDragEnd() { setMyDragTaskId(null); setMyDragOverCol(null); }

  function handleMyColDragOver(e, statusId) {
    if (!myDragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (myDragOverCol !== statusId) setMyDragOverCol(statusId);
  }
  function handleMyColDragLeave(statusId) {
    if (myDragOverCol === statusId) setMyDragOverCol(null);
  }
  async function handleMyColDrop(e, statusId) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    const task = tasks.find((t) => t.task_id === taskId);
    setMyDragOverCol(null); setMyDragTaskId(null);
    if (!task || task.task_status === statusId) return;
    // Only the assignee can drag a blocked task
    if (task.task_status === 'blocked' && !isTaskHolder(task)) return;
    await handleStatusChange(task.task_id, statusId, task.task_name);
  }

  // Loads the notes for a task and shows them in the details slide-over.
  async function loadTaskNotes(taskId) {
    if (!taskId) { setTaskNotes([]); return; }
    setTaskNotesLoading(true);
    const { data, error } = await supabase
      .from('task_notes')
      .select('note_id, task_id, note_text, created_by, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) { setTaskNotes([]); setTaskNotesLoading(false); return; }
    setTaskNotes(data || []);
    setTaskNotesLoading(false);
  }

  // Opens the task details slide-over and loads that task's notes.
  async function handleOpenTaskDetails(task) {
    setSelectedTask(task);
    setTaskNoteInput('');
    setTaskNotes([]);
    await loadTaskNotes(task.task_id);
  }

  // Closes the task details slide-over and resets all note state.
  function handleCloseTaskDetails() {
    setSelectedTask(null);
    setTaskNotes([]);
    setTaskNoteInput('');
    setTaskNotesLoading(false);
    setTaskNoteSaving(false);
  }

  // Saves a new note on the currently open task.
  async function handleAddTaskNote() {
    const trimmed = taskNoteInput.trim();
    if (!selectedTask?.task_id || !trimmed) return;
    setTaskNoteSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_notes').insert({
      task_id: selectedTask.task_id, note_text: trimmed, created_by: user.id,
    });
    if (error) { setTaskNoteSaving(false); setMessage({ type: 'error', text: `Could not save note: ${error.message}` }); return; }
    logActivity(personName, 'task_note_added', { task: selectedTask.task_name });
    setTaskNoteInput('');
    await loadTaskNotes(selectedTask.task_id);
    setTaskNoteSaving(false);
  }

  // When an admin has a role filter active, this narrows the task list to just that group.
  // Otherwise it returns all tasks.
  const adminVisibleTasks = useMemo(() => {
    if (!isAdmin || adminGroupFilter === 'all') {
      return tasks;
    }
    return tasks.filter((t) => t.assigned_role === adminGroupFilter);
  }, [tasks, isAdmin, adminGroupFilter]);

  // Groups assigned/claimed tasks into their status columns for the admin kanban. Urgent tasks float to the top.
  const byStatus = useMemo(() =>
    STATUSES.reduce((acc, s) => ({
      ...acc,
      [s.id]: adminVisibleTasks
        .filter((t) => t.assigned_user_id != null || t.taken_by != null)
        .filter((t) => t.task_status === s.id)
        .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0)),
    }), {}),
  [adminVisibleTasks]);

  // Unclaimed pool tasks shown to admins and managers in the Open Group Tasks section.
  const managerOpenPoolTasks = useMemo(() =>
    adminVisibleTasks
      .filter((t) => t.assigned_user_id == null && t.taken_by == null && t.assigned_role)
      .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0)),
  [adminVisibleTasks]);

  // Unclaimed tasks assigned to the current user's role — shown in the Open Tasks section.
  const openPoolTasks = useMemo(() =>
    tasks
      .filter((t) => t.assigned_user_id == null && t.taken_by == null &&
                     t.assigned_role === userRole)
      .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0)),
  [tasks, userRole]);

  // Tasks the current user has claimed or been directly assigned.
  const myTasks = useMemo(() =>
    (!userId ? [] : tasks)
      .filter((t) => t.taken_by === userId || t.assigned_user_id === userId)
      .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0)),
  [tasks, userId]);

  // Splits My Tasks into status columns for the mini-kanban.
  const myTasksByStatus = useMemo(() =>
    STATUSES.reduce((acc, s) => ({
      ...acc,
      [s.id]: myTasks.filter((t) => t.task_status === s.id),
    }), {}),
  [myTasks]);

  // Blocked tasks belonging to colleagues in the same role group.
  // Shown so team members can mark the blocker as resolved.
  const teamBlockedTasks = useMemo(() =>
    tasks.filter((t) =>
      t.task_status === 'blocked' &&
      !isTaskHolder(t) &&
      (t.taken_by != null || t.assigned_user_id != null),
    ).sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0)),
  [tasks, userId]);

  // Completed tasks for the compliance officer role that are awaiting a formal close/archive.
  const groupDoneTasks = useMemo(() => {
    if (canManage) return [];
    if (userRole !== 'compliance_officer') return [];
    return tasks
      .filter((t) => t.task_status === 'done' && t.assigned_role === userRole)
      .sort((a, b) => (b.is_urgent ? 1 : 0) - (a.is_urgent ? 1 : 0));
  }, [tasks, canManage, userRole]);

  // Archived tasks the current user is allowed to see (admins see all, compliance officers see their group).
  const visibleArchivedTasks = useMemo(() => {
    if (canManage) return archivedTasks;
    if (userRole === 'compliance_officer') {
      return archivedTasks.filter((t) => t.assigned_role === userRole);
    }
    return [];
  }, [archivedTasks, canManage, userRole]);

  // Filters the profiles list to just the people in the selected role, for the Specific Person dropdown.
  const targetRoleProfiles = useMemo(() => {
    const role = canManage
      ? (newTask.assign_type === 'user' ? newTask.assigned_role : null)
      : userRole;
    if (!role) return [];
    return profiles.filter((p) => p.company_role === role);
  }, [profiles, newTask.assign_type, newTask.assigned_role, canManage, userRole]);

  // Renders a single task card. Used in all sections of the page.
  // The opts object controls which action buttons and drag behaviour to show.
  function renderCard(task, opts = {}) {
    const {
      showKanbanDrag = false,
      showPoolDrag   = false,
      showMyDrag     = false,
      showTakeBtn    = false,
      showArchive    = false,
      showDelete     = false,
    } = opts;

    const assignment     = getAssignmentDisplay(task);
    const isBeingDragged = kanbanDragTaskId === task.task_id || myDragTaskId === task.task_id;
    const isTaking       = takingTaskId === task.task_id;
    const isMarkingThis  = markingBlockerId === task.task_id;
    const isBlocked      = task.task_status === 'blocked';
    const holderIsMe     = isTaskHolder(task);
    // Show the "Mark Blocker Resolved" button only to colleagues (not the task owner, not managers).
    const showMarkResolved = isBlocked && !task.blocker_resolved_by && !holderIsMe && !canManage;
    // Show the mobile status dropdown only if the user can edit, and not to non-owners of blocked tasks.
    const showMobileDropdown = (canEditTask(task)) && (!isBlocked || holderIsMe);

    const draggable = showKanbanDrag || showPoolDrag || showMyDrag;

    function onDragStart(e) {
      if (showKanbanDrag) handleKanbanDragStart(e, task.task_id);
      else if (showPoolDrag) handlePoolDragStart(e, task.task_id);
      else if (showMyDrag) handleMyDragStart(e, task.task_id);
    }
    function onDragEnd() {
      if (showKanbanDrag) handleKanbanDragEnd();
      else if (showPoolDrag) handlePoolDragEnd();
      else if (showMyDrag) handleMyDragEnd();
    }

    return (
      <div
        key={task.task_id}
        draggable={draggable}
        onDragStart={draggable ? onDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onClick={() => handleOpenTaskDetails(task)}
        className={`bg-white rounded-lg border p-3 transition-shadow ${
          isBeingDragged
            ? 'border-brand-mist shadow-sm opacity-80'
            : 'border-gray-200 hover:shadow-sm'
        } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      >
        {/* Urgent + title */}
        <div className="mb-1 flex items-start gap-1.5 flex-wrap">
          {task.is_urgent && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase tracking-wide">
              Urgent
            </span>
          )}
          <p className="text-sm font-medium text-gray-900 flex-1 min-w-0">{task.task_name}</p>
        </div>

        {task.task_description && (
          <p className="text-xs text-gray-500 mb-2 line-clamp-2">{task.task_description}</p>
        )}

        {assignment && (
          <p className={`text-xs font-medium mb-2 ${assignment.color}`}>{assignment.text}</p>
        )}

        {/* Blocker resolved badge */}
        {isBlocked && task.blocker_resolved_by && (
          <div className="mb-2 px-2 py-1 rounded bg-green-50 border border-green-200 text-[11px] text-green-700 font-medium">
            Blocker cleared by {getPersonDisplay(task.blocker_resolved_by)}
          </div>
        )}

        {(showTakeBtn || showMarkResolved || showMobileDropdown || showArchive || showDelete) && (
          <div
            className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {showTakeBtn && (
              <button
                disabled={isTaking}
                onClick={() => handleTakeTask(task.task_id, task.task_name)}
                className="text-xs text-center py-1.5 rounded-lg border border-brand-deep text-brand-deep hover:bg-brand-deep hover:text-white transition-colors disabled:opacity-50 font-medium"
              >
                {isTaking ? 'Taking…' : 'Take Task'}
              </button>
            )}

            {showMarkResolved && (
              <button
                disabled={isMarkingThis}
                onClick={() => handleMarkBlockerResolved(task.task_id)}
                className="text-xs text-center py-1.5 rounded-lg border border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50 font-medium"
              >
                {isMarkingThis ? 'Saving…' : 'Mark Blocker Resolved'}
              </button>
            )}

            {showMobileDropdown && (
              <select
                value={task.task_status}
                onChange={(e) => handleStatusChange(task.task_id, e.target.value, task.task_name)}
                className="lg:hidden text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-mist bg-white w-full cursor-pointer"
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}

            {showArchive && task.task_status === 'done' && canCloseGroupDone && (
              <button
                onClick={() => handleArchive(task)}
                className="text-xs text-center py-1 rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                Close
              </button>
            )}

            {showDelete && isAdmin && (
              <button
                onClick={() => handleDeleteTask(task)}
                className="text-xs text-center py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Main render
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Task Management</h2>
          <p className="text-gray-500 mt-1 text-sm">Track and manage team work items.</p>
        </div>
        {canCreate && (
          <button
            onClick={() => {
              setNewTask({ ...EMPTY_FORM, assigned_role: !canManage ? userRole : '' });
              setShowCreate(true);
            }}
            className="px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors flex items-center gap-2 font-medium text-sm"
          >
            <PlusIcon className="h-4 w-4" />
            Add Task
          </button>
        )}
      </div>

      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm border ${message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
          {message.text}
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading tasks…</div>

      ) : canManage ? (

        /* ══ Admin / Manager: full kanban ══ */
        <div className="space-y-6">
          <section className="rounded-xl border p-4 bg-orange-50/40 border-orange-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              <h3 className="font-semibold text-gray-800">Open Group Tasks</h3>
              <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                {managerOpenPoolTasks.length}
              </span>
              {isAdmin && (
                <select
                  value={adminGroupFilter}
                  onChange={(e) => setAdminGroupFilter(e.target.value)}
                  className="ml-3 text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-mist bg-white"
                  aria-label="Filter tasks by group"
                >
                  <option value="all">All Groups</option>
                  {Object.entries(ROLE_LABELS).map(([roleValue, roleLabel]) => (
                    <option key={roleValue} value={roleValue}>{roleLabel}</option>
                  ))}
                </select>
              )}
            </div>

            {managerOpenPoolTasks.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No open group tasks right now.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {managerOpenPoolTasks.map((task) => renderCard(task, { showTakeBtn: true, showDelete: true }))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {STATUSES.map((status) => {
              const col = byStatus[status.id] || [];
              return (
                <div
                  key={status.id}
                  onDragOver={(e) => handleKanbanColDragOver(e, status.id)}
                  onDragLeave={() => handleKanbanColDragLeave(status.id)}
                  onDrop={(e) => handleKanbanColDrop(e, status.id)}
                  className={`flex flex-col rounded-xl border p-4 min-h-64 transition-colors ${
                    kanbanDragOverCol === status.id
                      ? 'bg-brand-cream border-brand-mist'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                      <h3 className={`font-semibold text-sm ${status.headerColor}`}>{status.label}</h3>
                    </div>
                    <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                      {col.length}
                    </span>
                  </div>
                  <div className="space-y-3 flex-1">
                    {col.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-6">No tasks here</p>
                    )}
                    {col.map((task) => renderCard(task, { showKanbanDrag: true, showArchive: true, showDelete: true }))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Archived Tasks (read-only list) */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              <h3 className="font-semibold text-gray-800">Archived Tasks</h3>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {visibleArchivedTasks.length}
              </span>
            </div>

            {visibleArchivedTasks.length === 0 ? (
              <p className="text-sm text-gray-400 py-3 border border-dashed border-gray-200 rounded-lg text-center">
                No archived tasks yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Task</th>
                      <th className="text-left px-3 py-2 font-medium">Group</th>
                      <th className="text-left px-3 py-2 font-medium">Assignee</th>
                      <th className="text-left px-3 py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleArchivedTasks.map((task) => (
                      <tr
                        key={task.task_id}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleOpenTaskDetails(task)}
                      >
                        <td className="px-3 py-2 text-gray-800">{task.task_name}</td>
                        <td className="px-3 py-2 text-gray-600">{ROLE_LABELS[task.assigned_role] || task.assigned_role || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{assigneeNames[task.assigned_user_id] || assigneeNames[task.taken_by] || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {task.created_at ? new Date(task.created_at).toLocaleDateString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

      ) : (

        /* ══ Non-manager: Pool + My Tasks + Team Blocked ══ */
        <div className="space-y-10">

          {/* Open Pool */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              <h3 className="font-semibold text-gray-800">
                Open Tasks — {ROLE_LABELS[userRole] || userRole}
              </h3>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {openPoolTasks.length}
              </span>
            </div>
            {openPoolTasks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 border border-dashed border-gray-200 rounded-lg text-center">
                No open tasks available for your role right now.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {openPoolTasks.map((task) => renderCard(task, { showTakeBtn: true }))}
              </div>
            )}
          </section>

          {/* My Tasks */}
          <section
            onDragOver={handleMyZoneDragOver}
            onDragLeave={handleMyZoneDragLeave}
            onDrop={handleMyZoneDrop}
            className={`rounded-xl transition-all ${
              myTasksDropActive
                ? 'ring-2 ring-brand-mist bg-brand-cream/30 p-3'
                : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <h3 className="font-semibold text-gray-800">My Tasks</h3>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                {myTasks.length}
              </span>
              {myTasksDropActive && (
                <span className="ml-auto text-xs text-brand-mist font-medium animate-pulse">
                  Drop to claim →
                </span>
              )}
            </div>

            {myTasks.length === 0 && !myTasksDropActive ? (
              <p className="text-sm text-gray-400 py-4 border border-dashed border-gray-200 rounded-lg text-center">
                {poolDragTaskId ? 'Drop here to claim this task.' : 'You have no tasks assigned to you yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {STATUSES.map((status) => {
                  const col = myTasksByStatus[status.id] || [];
                  return (
                    <div
                      key={status.id}
                      onDragOver={(e) => { handleMyColDragOver(e, status.id); }}
                      onDragLeave={() => handleMyColDragLeave(status.id)}
                      onDrop={(e) => handleMyColDrop(e, status.id)}
                      className={`flex flex-col rounded-xl border p-4 min-h-40 transition-colors ${
                        myDragOverCol === status.id
                          ? 'bg-brand-cream border-brand-mist'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                          <h4 className={`font-semibold text-xs ${status.headerColor}`}>{status.label}</h4>
                        </div>
                        <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
                          {col.length}
                        </span>
                      </div>
                      <div className="space-y-2 flex-1">
                        {col.length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-4">Nothing here</p>
                        )}
                        {col.map((task) => renderCard(task, { showMyDrag: true }))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Team Blocked */}
          {teamBlockedTasks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <h3 className="font-semibold text-gray-800">Team Blocked</h3>
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {teamBlockedTasks.length}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Colleagues in your team are blocked. Click a card to see why, or confirm the issue is resolved.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {teamBlockedTasks.map((task) => renderCard(task, {}))}
              </div>
            </section>
          )}

          {/* Group Done Awaiting Close */}
          {groupDoneTasks.length > 0 && canCloseGroupDone && (
            <section>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <h3 className="font-semibold text-gray-800">Done Tasks Awaiting Close</h3>
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {groupDoneTasks.length}
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Review completed tasks and close them when confirmed. Closed tasks are archived.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {groupDoneTasks.map((task) => renderCard(task, { showArchive: true }))}
              </div>
            </section>
          )}

          {/* Archived Tasks (read-only list) */}
          {canCloseGroupDone && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <h3 className="font-semibold text-gray-800">Archived Tasks</h3>
                <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {visibleArchivedTasks.length}
                </span>
              </div>

              {visibleArchivedTasks.length === 0 ? (
                <p className="text-sm text-gray-400 py-3 border border-dashed border-gray-200 rounded-lg text-center">
                  No archived tasks yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Task</th>
                        <th className="text-left px-3 py-2 font-medium">Group</th>
                        <th className="text-left px-3 py-2 font-medium">Assignee</th>
                        <th className="text-left px-3 py-2 font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleArchivedTasks.map((task) => (
                        <tr
                          key={task.task_id}
                          className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                          onClick={() => handleOpenTaskDetails(task)}
                        >
                          <td className="px-3 py-2 text-gray-800">{task.task_name}</td>
                          <td className="px-3 py-2 text-gray-600">{ROLE_LABELS[task.assigned_role] || task.assigned_role || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{assigneeNames[task.assigned_user_id] || assigneeNames[task.taken_by] || '—'}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {task.created_at ? new Date(task.created_at).toLocaleDateString('en-GB', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

        </div>
      )}

      {pendingTaskAction && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {pendingTaskAction.type === 'archive' ? 'Close Task' : 'Delete Task'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {pendingTaskAction.type === 'archive'
                  ? 'Closing a task archives it from active boards.'
                  : 'Deleting a task permanently removes it from the system.'}
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700">
                Task: <span className="font-semibold text-gray-900">{pendingTaskAction.task.task_name}</span>
              </p>
              <div
                className={`rounded-lg border p-3 text-sm ${
                  pendingTaskAction.type === 'archive'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {pendingTaskAction.type === 'archive'
                  ? 'This task will be moved to Archived Tasks.'
                  : 'This action cannot be undone.'}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !taskActionLoading && setPendingTaskAction(null)}
                disabled={taskActionLoading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmTaskAction}
                disabled={taskActionLoading}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-60 ${
                  pendingTaskAction.type === 'archive'
                    ? 'bg-brand-deep hover:bg-brand-mist hover:text-brand-deep'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {taskActionLoading ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                    {pendingTaskAction.type === 'archive' ? 'Closing…' : 'Deleting…'}
                  </>
                ) : (
                  pendingTaskAction.type === 'archive' ? 'Close Task' : 'Delete Task'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Details Modal */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={handleCloseTaskDetails}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Task Details</h3>
              <button onClick={handleCloseTaskDetails} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm overflow-y-auto pr-1 flex-1">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Task</p>
                <div className="flex items-start gap-2 mt-1 flex-wrap">
                  {selectedTask.is_urgent && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase tracking-wide">
                      Urgent
                    </span>
                  )}
                  <p className="text-gray-900 font-medium">{selectedTask.task_name}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Description</p>
                <p className="text-gray-700 mt-1">{selectedTask.task_description || 'No description provided.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</p>
                  <p className="text-gray-700 mt-1">
                    {STATUSES.find((s) => s.id === selectedTask.task_status)?.label || selectedTask.task_status}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</p>
                  <p className="text-gray-700 mt-1">
                    {selectedTask.created_at
                      ? new Date(selectedTask.created_at).toLocaleDateString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })
                      : '—'}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Assignment</p>
                <p className="text-gray-700 mt-1">{detailsAssignmentText(selectedTask)}</p>
              </div>

              {/* Blocker status panel */}
              {selectedTask.task_status === 'blocked' && (
                <div>
                  {selectedTask.blocker_resolved_by ? (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                      <span className="text-green-600 mt-0.5">✓</span>
                      <p className="text-xs text-green-700">
                        <span className="font-medium">Blocker cleared</span> by{' '}
                        {getPersonDisplay(selectedTask.blocker_resolved_by)}
                        {selectedTask.blocker_resolved_at && (
                          <span className="text-green-600">
                            {' · '}
                            {new Date(selectedTask.blocker_resolved_at).toLocaleDateString('en-GB', {
                              day: '2-digit', month: 'short',
                            })}
                          </span>
                        )}
                      </p>
                    </div>
                  ) : (
                    !isTaskHolder(selectedTask) && (
                      <button
                        disabled={markingBlockerId === selectedTask.task_id}
                        onClick={() => handleMarkBlockerResolved(selectedTask.task_id)}
                        className="w-full py-2 rounded-lg border border-amber-400 text-amber-700 text-xs font-medium hover:bg-amber-50 transition-colors disabled:opacity-50"
                      >
                        {markingBlockerId === selectedTask.task_id
                          ? 'Saving…'
                          : 'Mark Blocker Resolved'}
                      </button>
                    )
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Task ID</p>
                <p className="text-gray-500 mt-1 text-xs font-mono">#{selectedTask.task_id}</p>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Notes</p>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {taskNotesLoading ? (
                    <p className="text-xs text-gray-400">Loading notes…</p>
                  ) : taskNotes.length === 0 ? (
                    <p className="text-xs text-gray-400">No notes yet.</p>
                  ) : (
                    taskNotes.map((note) => (
                      <div key={note.note_id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <p className="text-xs text-gray-700 whitespace-pre-wrap">{note.note_text}</p>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {assigneeNames[note.created_by] || 'Unknown'} &middot;{' '}
                          {new Date(note.created_at).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {canEditTask(selectedTask) && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={taskNoteInput}
                      onChange={(e) => setTaskNoteInput(e.target.value)}
                      rows={2}
                      placeholder="Add an update…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddTaskNote}
                        disabled={!taskNoteInput.trim() || taskNoteSaving}
                        className="px-3 py-1.5 text-xs bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                      >
                        {taskNoteSaving ? 'Saving…' : 'Add Note'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-5">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleDeleteTask(selectedTask)}
                  className="px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                >
                  Delete Task
                </button>
              )}
              <button
                type="button"
                onClick={handleCloseTaskDetails}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add Task</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task Name *</label>
                <input
                  value={newTask.task_name}
                  onChange={(e) => setNewTask((p) => ({ ...p, task_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newTask.task_description}
                  onChange={(e) => setNewTask((p) => ({ ...p, task_description: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assignment</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'role', label: 'Role Pool',       desc: 'Anyone with the role can take it' },
                    { value: 'user', label: 'Specific Person', desc: 'Sent directly to one person' },
                  ].map(({ value, label, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNewTask((p) => ({
                        ...p,
                        assign_type:      value,
                        assigned_role:    !canManage ? userRole : '',
                        assigned_user_id: '',
                      }))}
                      className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                        newTask.assign_type === value
                          ? 'border-brand-deep bg-brand-deep/5 text-brand-deep'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {newTask.assign_type === 'role' && (
                canManage ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Role</label>
                    <select
                      value={newTask.assigned_role}
                      onChange={(e) => setNewTask((p) => ({ ...p, assigned_role: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                    >
                      <option value="">Select role…</option>
                      {assignableRoles.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-600">
                    Task will be open to all{' '}
                    <span className="font-medium">{ROLE_LABELS[userRole]}</span> members.
                  </div>
                )
              )}

              {newTask.assign_type === 'user' && (
                <div className="space-y-3">
                  {canManage && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                      <select
                        value={newTask.assigned_role}
                        onChange={(e) => setNewTask((p) => ({
                          ...p, assigned_role: e.target.value, assigned_user_id: '',
                        }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                      >
                        <option value="">Select role first…</option>
                        {assignableRoles.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Person{canManage && !newTask.assigned_role ? ' — select a role first' : ''}
                    </label>
                    <select
                      value={newTask.assigned_user_id}
                      onChange={(e) => setNewTask((p) => ({ ...p, assigned_user_id: e.target.value }))}
                      disabled={canManage && !newTask.assigned_role}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white disabled:opacity-50"
                    >
                      <option value="">Select person…</option>
                      {targetRoleProfiles.map((p) => (
                        <option key={p.user_id} value={p.user_id}>{p.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Status</label>
                <select
                  value={newTask.task_status}
                  onChange={(e) => setNewTask((p) => ({ ...p, task_status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist bg-white"
                >
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {canManage && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_urgent"
                    checked={newTask.is_urgent}
                    onChange={(e) => setNewTask((p) => ({ ...p, is_urgent: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <label htmlFor="is_urgent" className="text-sm font-medium text-gray-700 cursor-pointer">
                    Mark as Urgent
                  </label>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTask.task_name.trim() || saving}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
