import { Fragment, useEffect, useRef, useState } from 'react';
import { Transition } from '@headlessui/react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Layout,
  Dashboard,
  DocumentManagement,
  SalesActivityLogging,
  Campaigns,
  TaskManagement,
  AdminManagement,
  AuditLogs,
} from './components';
import { supabase } from './utils/supabase';
import { logActivity } from './utils/logActivity';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoAccounts';
import './App.css';

function ProtectedRoute({ session, profileLoading, mustChangePassword, children }) {
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-600">Loading profile...</p>
      </div>
    );
  }

  if (mustChangePassword) {
    return <Navigate to="/update-password" replace />;
  }

  return children;
}

function mapAuthError(errorMessage) {
  const lowerMessage = (errorMessage || '').toLowerCase();

  if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('network request failed')) {
    return {
      type: 'error',
      text: 'Unable to log in at this time. Please check your connection and try again.',
      field: null,
    };
  }

  if (lowerMessage.includes('invalid login credentials')) {
    return {
      type: 'error',
      text: 'Username or password incorrect.',
      field: 'both',
    };
  }

  if (lowerMessage.includes('email not confirmed')) {
    return {
      type: 'error',
      text: 'Please confirm your email before logging in.',
      field: 'email',
    };
  }

  return {
    type: 'error',
    text: errorMessage || 'Something went wrong. Please try again.',
    field: null,
  };
}

function calculatePasswordStrength(password) {
  const feedback = [];

  if (!password) {
    return { score: 0, level: 'None', color: 'gray', feedback: [] };
  }

  const hasMinLength = password.length >= 8;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

  if (!hasMinLength) feedback.push('At least 8 characters');
  if (!hasLowercase) feedback.push('Add lowercase letters');
  if (!hasUppercase) feedback.push('Add uppercase letters');
  if (!hasNumber) feedback.push('Add numbers');

  const allRequirementsMet = hasMinLength && hasLowercase && hasUppercase && hasNumber;

  if (!allRequirementsMet) {
    return { score: 1, level: 'Weak', color: 'red', feedback };
  }

  if (!hasSpecial) feedback.push('Add special characters for stronger security');

  let strength = 2;
  if (password.length >= 12) strength = 3;
  if (password.length >= 12 && hasSpecial) strength = 4;

  const levels = [
    { score: 0, level: 'None', color: 'gray' },
    { score: 1, level: 'Weak', color: 'red' },
    { score: 2, level: 'Fair', color: 'yellow' },
    { score: 3, level: 'Good', color: 'blue' },
    { score: 4, level: 'Strong', color: 'green' },
  ];

  const result = levels[strength];
  return { ...result, feedback };
}

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

  if (!normalized) {
    return 'marketing_team_member';
  }

  return normalized;
}

const NAV_LABELS = {
  home: 'Home',
  documents: 'Documents',
  sales: 'Sales',
  campaigns: 'Campaigns',
  tasks: 'Tasks',
  audit: 'Audit Logs',
  admin: 'Admin',
};

const ROLE_ACCESS = {
  admin: {
    nav: ['home', 'documents', 'sales', 'campaigns', 'tasks', 'audit', 'admin'],
    documentPermissions: { canCreateFolders: true, canUploadDocuments: true, canDeleteDocuments: true },
  },
  manager: {
    nav: ['home', 'documents', 'sales', 'campaigns', 'tasks'],
    documentPermissions: { canCreateFolders: true, canUploadDocuments: true, canDeleteDocuments: true },
  },
  sales_representative: {
    nav: ['home', 'documents', 'sales', 'tasks'],
    documentPermissions: { canCreateFolders: true, canUploadDocuments: true, canDeleteDocuments: false },
  },
  compliance_officer: {
    nav: ['home', 'documents', 'audit', 'tasks'],
    documentPermissions: { canCreateFolders: true, canUploadDocuments: true, canDeleteDocuments: false },
  },
  marketing_team_member: {
    nav: ['home', 'documents', 'campaigns', 'tasks'],
    documentPermissions: { canCreateFolders: true, canUploadDocuments: true, canDeleteDocuments: false },
  },
};

const NAV_PATHS = {
  home: '/dashboard',
  documents: '/documents',
  sales: '/sales',
  campaigns: '/campaigns',
  tasks: '/tasks',
  audit: '/audit',
  admin: '/admin',
};

function getNavIdFromPath(pathname) {
  const matched = Object.entries(NAV_PATHS).find(([, path]) => path === pathname);
  return matched ? matched[0] : null;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNav, setActiveNav] = useState(() => getNavIdFromPath(location.pathname) || 'home');
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profile, setProfile] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: '', username: '' });
  const [profileSettingsSaving, setProfileSettingsSaving] = useState(false);
  const [profileSettingsMessage, setProfileSettingsMessage] = useState(null);
  const [avatarColor, setAvatarColor] = useState(() => localStorage.getItem('avatarColor') || '#5b9486');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' });
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordUpdateLoading, setPasswordUpdateLoading] = useState(false);
  const [passwordUpdateMessage, setPasswordUpdateMessage] = useState(null);
  const [passwordUpdateErrors, setPasswordUpdateErrors] = useState({
    newPassword: '',
    confirmNewPassword: '',
  });
  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    level: 'None',
    color: 'gray',
    feedback: [],
  });

  const shouldLogLogin = useRef(false);
  const hadSessionRef = useRef(false);

  const normalizedRole = normalizeRole(profile?.company_role);
  const roleAccess = ROLE_ACCESS[normalizedRole] || ROLE_ACCESS.marketing_team_member;
  const allowedNav = roleAccess.nav;
  const navItems = allowedNav.map((id) => ({ id, label: NAV_LABELS[id] || id }));
  const isAdmin = normalizedRole === 'admin';
  const canViewAuditLogs = ['admin', 'compliance_officer'].includes(normalizedRole);
  const canManageCampaigns = ['admin', 'manager', 'marketing_team_member'].includes(normalizedRole);
  const canManageTasks = ['admin', 'manager'].includes(normalizedRole);

  const resetAuthForm = () => {
    setEmail('');
    setPassword('');
    setFieldErrors({ email: '', password: '' });
  };

  const resetPasswordUpdateForm = () => {
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordUpdateErrors({ newPassword: '', confirmNewPassword: '' });
    setPasswordStrength({ score: 0, level: 'None', color: 'gray', feedback: [] });
  };

  useEffect(() => {
    async function loadSession() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      hadSessionRef.current = Boolean(currentSession?.user?.id);
      setSession(currentSession);
      setSessionLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      const hadSession = hadSessionRef.current;
      hadSessionRef.current = Boolean(currentSession?.user?.id);

      if (event === 'SIGNED_IN' && !hadSession) {
        shouldLogLogin.current = true;
      }
      setSession(currentSession);
      if (!currentSession) {
        setProfile(null);
        setProfileError('');
        setMustChangePassword(false);
        setShowProfileSettings(false);
        setProfileSettingsMessage(null);
        setAuthMessage(null);
        setPasswordUpdateMessage(null);
        resetAuthForm();
        resetPasswordUpdateForm();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!session?.user?.id) {
        setProfile(null);
        setProfileError('');
        setMustChangePassword(false);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      setProfileError('');

      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, username, full_name, company_role, must_change_password')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error) {
        setProfile(null);
        setProfileError('Could not load your profile. Please contact your admin.');
        setMustChangePassword(false);
        setProfileLoading(false);
        return;
      }

      if (!data) {
        setProfile(null);
        setProfileError('Your account is missing profile details. Please contact your admin.');
        setMustChangePassword(false);
        setProfileLoading(false);
        return;
      }

      setProfile(data);
      setMustChangePassword(Boolean(data.must_change_password));
      setProfileLoading(false);

      if (shouldLogLogin.current) {
        shouldLogLogin.current = false;
        logActivity(data.full_name, 'user_login', { email: session.user.email });
      }
    }

    loadProfile();
  }, [session]);

  useEffect(() => {
    if (!session || profileLoading) {
      return;
    }

    const inAuthRoute = location.pathname === '/' || location.pathname === '/login' || location.pathname === '/signup';

    if (inAuthRoute) {
      navigate(mustChangePassword ? '/update-password' : '/dashboard', { replace: true });
    }
  }, [session, mustChangePassword, profileLoading, location.pathname, navigate]);

  // Refill the profile form whenever a new profile loads.
  // Done during render rather than in an effect to avoid an extra re-render.
  const [formSourceProfile, setFormSourceProfile] = useState(profile);
  if (profile !== formSourceProfile) {
    setFormSourceProfile(profile);
    if (profile) {
      setProfileForm({
        full_name: profile.full_name || '',
        username: profile.username || '',
      });
    }
  }

  // Keep the highlighted nav item in step with the URL, falling back to the
  // first item the user's role can see if the current one isn't allowed.
  let desiredNav = getNavIdFromPath(location.pathname) || activeNav;
  if (session && !profileLoading && profile && !allowedNav.includes(desiredNav)) {
    desiredNav = allowedNav[0] || 'home';
  }
  if (desiredNav !== activeNav) {
    setActiveNav(desiredNav);
  }

  useEffect(() => {
    if (!session?.user?.id || profileLoading || !profile) {
      return;
    }

    const navFromPath = getNavIdFromPath(location.pathname);
    if (navFromPath && !allowedNav.includes(navFromPath)) {
      navigate(NAV_PATHS[allowedNav[0] || 'home'] || '/dashboard', { replace: true });
    }
  }, [session?.user?.id, profileLoading, profile, allowedNav, location.pathname, navigate]);



  const validateLoginForm = () => {
    const nextErrors = { email: '', password: '' };

    if (!email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Password is required.';
    }

    setFieldErrors(nextErrors);
    return !nextErrors.email && !nextErrors.password;
  };

  const handleForgotPassword = () => {
    setShowForgotPasswordModal(true);
  };

  const handleAuth = async (event) => {
    event.preventDefault();

    if (!validateLoginForm()) {
      setAuthMessage({ type: 'error', text: 'Please check the highlighted fields below and try again.' });
      return;
    }

    setAuthLoading(true);
    setAuthMessage(null);
    setFieldErrors({ email: '', password: '' });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      const parsedError = mapAuthError(error.message);
      setAuthMessage({ type: parsedError.type, text: parsedError.text });
      if (parsedError.field === 'both') {
        setFieldErrors({ email: parsedError.text, password: parsedError.text });
      } else if (parsedError.field) {
        setFieldErrors((prev) => ({
          ...prev,
          [parsedError.field]: parsedError.text,
        }));
      }
      setAuthLoading(false);
      return;
    }

    if (data.session) {
      setAuthMessage({ type: 'success', text: 'Login successful. Loading your account...' });
    }

    setAuthLoading(false);
  };

  const validatePasswordUpdateForm = () => {
    const nextErrors = { newPassword: '', confirmNewPassword: '' };

    if (!newPassword) {
      nextErrors.newPassword = 'New password is required.';
    } else if (newPassword.length < 8) {
      nextErrors.newPassword = 'Password must be at least 8 characters.';
    } else if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      nextErrors.newPassword = 'Password must include uppercase, lowercase, and numbers.';
    }

    if (!confirmNewPassword) {
      nextErrors.confirmNewPassword = 'Please confirm your new password.';
    } else if (newPassword !== confirmNewPassword) {
      nextErrors.confirmNewPassword = 'Passwords do not match.';
    }

    setPasswordUpdateErrors(nextErrors);
    return !nextErrors.newPassword && !nextErrors.confirmNewPassword;
  };

  const handleFirstLoginPasswordUpdate = async (event) => {
    event.preventDefault();

    if (!session?.user?.id) {
      return;
    }

    if (!validatePasswordUpdateForm()) {
      setPasswordUpdateMessage({ type: 'error', text: 'Please fix the highlighted fields.' });
      return;
    }

    setPasswordUpdateLoading(true);
    setPasswordUpdateMessage(null);

    const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });

    if (passwordError) {
      setPasswordUpdateMessage({ type: 'error', text: passwordError.message });
      setPasswordUpdateLoading(false);
      return;
    }

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('user_id', session.user.id);

    if (profileUpdateError) {
      setPasswordUpdateMessage({
        type: 'error',
        text: 'Password changed, but profile update failed. Please contact your admin.',
      });
      setPasswordUpdateLoading(false);
      return;
    }

    setMustChangePassword(false);
    setProfile((prev) => (prev ? { ...prev, must_change_password: false } : prev));
    setPasswordUpdateMessage({ type: 'success', text: 'Password updated successfully. Redirecting...' });
    logActivity(profile?.full_name || session.user.email, 'password_changed', { reason: 'first_login' });
    resetPasswordUpdateForm();
    navigate('/dashboard', { replace: true });
    setPasswordUpdateLoading(false);
  };

  const handleOpenProfileSettings = () => {
    setProfileSettingsMessage(null);
    setProfileForm({
      full_name: profile?.full_name || '',
      username: profile?.username || '',
    });
    setShowProfileSettings(true);
  };

  const handleSaveProfileSettings = async (event) => {
    event.preventDefault();
    if (!session?.user?.id) return;

    const trimmedName = profileForm.full_name.trim();
    const trimmedUsername = profileForm.username.trim();

    if (trimmedUsername.length < 3) {
      setProfileSettingsMessage({ type: 'error', text: 'Username must be at least 3 characters.' });
      return;
    }

    setProfileSettingsSaving(true);
    setProfileSettingsMessage(null);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: trimmedName || null,
        username: trimmedUsername,
      })
      .eq('user_id', session.user.id);

    setProfileSettingsSaving(false);

    if (error) {
      setProfileSettingsMessage({ type: 'error', text: error.message });
      return;
    }

    setProfile((prev) => (prev ? {
      ...prev,
      full_name: trimmedName || null,
      username: trimmedUsername,
    } : prev));

    setProfileSettingsMessage({ type: 'success', text: 'Profile updated successfully.' });
  };

  const handleLogout = async () => {
    if (profile?.full_name) {
      await logActivity(profile.full_name, 'user_logout', {});
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthMessage({ type: 'error', text: error.message });
      return;
    }

    navigate('/login', { replace: true });
  };

  const resolvedActiveNav = allowedNav.includes(activeNav) ? activeNav : (allowedNav[0] || 'home');

  // Access tracking — log when user visits sensitive screens
  useEffect(() => {
    if (!profile) return;
    const accessedRole = normalizeRole(profile.company_role);
    const access = ROLE_ACCESS[accessedRole] || ROLE_ACCESS.marketing_team_member;
    const resolved = access.nav.includes(activeNav) ? activeNav : (access.nav[0] || 'home');
    if (['documents', 'audit', 'admin'].includes(resolved)) {
      logActivity(profile.full_name, 'screen_accessed', { screen: resolved });
    }
  }, [activeNav, profile]);

  const renderActiveScreen = () => {
    switch (resolvedActiveNav) {
      case 'home':
        return <Dashboard allowedNav={allowedNav} userId={session?.user?.id ?? null} />;
      case 'documents':
        return (
          <DocumentManagement
            canCreateFolders={roleAccess.documentPermissions.canCreateFolders}
            canUploadDocuments={roleAccess.documentPermissions.canUploadDocuments}
            canDeleteDocuments={roleAccess.documentPermissions.canDeleteDocuments}
            userRole={normalizedRole}
            personName={profile?.full_name || session?.user?.email || 'Unknown'}
          />
        );
      case 'sales':
        return (
          <SalesActivityLogging
            personName={profile?.full_name || session?.user?.email || 'Unknown'}
          />
        );
      case 'campaigns':
        return (
          <Campaigns
            canManage={canManageCampaigns}
            userRole={normalizedRole}
            userId={session?.user?.id ?? null}
            personName={profile?.full_name || session?.user?.email || 'Unknown'}
          />
        );
      case 'tasks':
        return (
          <TaskManagement
            canManage={canManageTasks}
            userRole={normalizedRole}
            userId={session?.user?.id ?? null}
            personName={profile?.full_name || session?.user?.email || 'Unknown'}
          />
        );
      case 'audit':
        return canViewAuditLogs ? <AuditLogs /> : <Dashboard />;
      case 'admin':
        return isAdmin ? <AdminManagement currentUserId={session?.user?.id} personName={profile?.full_name || session?.user?.email || 'Unknown'} /> : <Dashboard />;
      default:
        return <Dashboard />;
    }
  };

  const authCard = (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Alderwell</h1>
          <p className="text-sm text-gray-600">Staff login</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Accounts are created by admins. Enter your work email and password to continue.
          </p>

          {authMessage ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                authMessage.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-700'
              }`}
            >
              {authMessage.text}
            </div>
          ) : null}

          <Transition
            as={Fragment}
            appear
            show
            enter="transition ease-out duration-250"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <form onSubmit={handleAuth} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="auth-email">
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: '' }));
                    }
                  }}
                  className={`w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 ${
                    fieldErrors.email
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-gray-300 focus:ring-brand-mist'
                  }`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700" htmlFor="auth-password">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-brand-deep hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="auth-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: '' }));
                    }
                  }}
                  className={`w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 ${
                    fieldErrors.password
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-gray-300 focus:ring-brand-mist'
                  }`}
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-brand-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-60"
              >
                {authLoading ? 'Please wait...' : 'Log In'}
              </button>
            </form>
          </Transition>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-sm font-medium text-gray-800">Try the demo</p>
            <p className="text-xs text-gray-600">
              Pick a role to fill in its login. Each role sees different parts of the system.
              Demo data resets every few hours, so feel free to make changes.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.key}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                    setFieldErrors({ email: '', password: '' });
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 hover:border-brand-deep hover:text-brand-deep transition-colors"
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showForgotPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Password Reset</h2>
            <p className="text-sm text-gray-700 mb-6">
              To reset your password, please contact your administrator. They can help you regain access to your account.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowForgotPasswordModal(false)}
                className="px-4 py-2 bg-brand-deep text-white rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const forcePasswordCard = (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Update Password</h1>
          <p className="text-sm text-gray-600">
            First login detected. Set a new password before continuing.
          </p>
        </div>

        {passwordUpdateMessage ? (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              passwordUpdateMessage.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-green-200 bg-green-50 text-green-700'
            }`}
          >
            {passwordUpdateMessage.text}
          </div>
        ) : null}

        <form onSubmit={handleFirstLoginPasswordUpdate} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="new-password">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Create a new password"
              value={newPassword}
              onChange={(event) => {
                const nextValue = event.target.value;
                setNewPassword(nextValue);
                setPasswordStrength(calculatePasswordStrength(nextValue));
                if (passwordUpdateErrors.newPassword) {
                  setPasswordUpdateErrors((prev) => ({ ...prev, newPassword: '' }));
                }
              }}
              className={`w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 ${
                passwordUpdateErrors.newPassword
                  ? 'border-red-300 focus:ring-red-200'
                  : 'border-gray-300 focus:ring-brand-mist'
              }`}
            />
            {passwordUpdateErrors.newPassword ? (
              <p className="text-xs text-red-600 mt-1">{passwordUpdateErrors.newPassword}</p>
            ) : null}
          </div>

          {newPassword ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">Password Strength:</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      passwordStrength.color === 'red' ? 'bg-red-500' :
                      passwordStrength.color === 'yellow' ? 'bg-yellow-500' :
                      passwordStrength.color === 'blue' ? 'bg-blue-500' :
                      passwordStrength.color === 'green' ? 'bg-green-500' :
                      'bg-gray-300'
                    }`}
                    style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                  />
                </div>
                <span
                  className={`text-xs font-medium ${
                    passwordStrength.color === 'red' ? 'text-red-600' :
                    passwordStrength.color === 'yellow' ? 'text-yellow-600' :
                    passwordStrength.color === 'blue' ? 'text-blue-600' :
                    passwordStrength.color === 'green' ? 'text-green-600' :
                    'text-gray-600'
                  }`}
                >
                  {passwordStrength.level}
                </span>
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="confirm-new-password">
              Confirm New Password
            </label>
            <input
              id="confirm-new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              value={confirmNewPassword}
              onChange={(event) => {
                setConfirmNewPassword(event.target.value);
                if (passwordUpdateErrors.confirmNewPassword) {
                  setPasswordUpdateErrors((prev) => ({ ...prev, confirmNewPassword: '' }));
                }
              }}
              className={`w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 ${
                passwordUpdateErrors.confirmNewPassword
                  ? 'border-red-300 focus:ring-red-200'
                  : 'border-gray-300 focus:ring-brand-mist'
              }`}
            />
            {passwordUpdateErrors.confirmNewPassword ? (
              <p className="text-xs text-red-600 mt-1">{passwordUpdateErrors.confirmNewPassword}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={passwordUpdateLoading}
            className="w-full bg-brand-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-60"
          >
            {passwordUpdateLoading ? 'Updating password...' : 'Save New Password'}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-sm text-brand-deep hover:underline"
          >
            Log out
          </button>
        </form>
      </div>
    </div>
  );

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-600">Loading...</p>
      </div>
    );
  }

  const appRoutePaths = Object.values(NAV_PATHS);

  const appShell = (
    <ProtectedRoute
      session={session}
      profileLoading={profileLoading}
      mustChangePassword={mustChangePassword}
    >
      <Layout
        activeNav={resolvedActiveNav}
        onNavChange={(nextNav) => {
          if (allowedNav.includes(nextNav)) {
            navigate(NAV_PATHS[nextNav] || '/dashboard');
          }
        }}
        userEmail={session?.user?.email}
        userFullName={profile?.full_name}
        userRole={profile?.company_role}
        navItems={navItems}
        onOpenProfileSettings={handleOpenProfileSettings}
        onLogout={handleLogout}
        avatarColor={avatarColor}
      >
        {profileError ? (
          <div className="bg-white border border-red-200 text-red-700 rounded-lg p-4">
            {profileError}
          </div>
        ) : (
          <>
            {renderActiveScreen()}
          </>
        )}
      </Layout>
    </ProtectedRoute>
  );

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={session ? <Navigate to={mustChangePassword ? '/update-password' : '/dashboard'} replace /> : authCard}
        />
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        <Route
          path="/update-password"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : profileLoading ? (
              <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading profile...</p>
              </div>
            ) : (
              forcePasswordCard
            )
          }
        />
        {appRoutePaths.map((path) => (
          <Route key={path} path={path} element={appShell} />
        ))}
        <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
      </Routes>

      {showProfileSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowProfileSettings(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Settings</h3>

            {profileSettingsMessage && (
              <div className={`mb-4 px-3 py-2 rounded-lg text-sm border ${
                profileSettingsMessage.type === 'error'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {profileSettingsMessage.text}
              </div>
            )}

            <form onSubmit={handleSaveProfileSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  placeholder="Your full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  value={profileForm.username}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, username: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-mist"
                  placeholder="Username"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Avatar Colour</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { color: '#5b9486', label: 'Teal' },
                    { color: '#6366f1', label: 'Indigo' },
                    { color: '#8b5cf6', label: 'Purple' },
                    { color: '#ec4899', label: 'Pink' },
                    { color: '#ef4444', label: 'Red' },
                    { color: '#f97316', label: 'Orange' },
                    { color: '#eab308', label: 'Yellow' },
                    { color: '#22c55e', label: 'Green' },
                    { color: '#0ea5e9', label: 'Sky' },
                    { color: '#64748b', label: 'Slate' },
                  ].map(({ color, label }) => (
                    <button
                      key={color}
                      type="button"
                      title={label}
                      onClick={() => {
                        setAvatarColor(color);
                        localStorage.setItem('avatarColor', color);
                      }}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus:outline-none"
                      style={{
                        backgroundColor: color,
                        ring: avatarColor === color ? '2px' : undefined,
                        outline: avatarColor === color ? `3px solid ${color}` : '3px solid transparent',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowProfileSettings(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={profileSettingsSaving}
                  className="px-4 py-2 bg-brand-deep text-white text-sm rounded-lg hover:bg-brand-mist hover:text-brand-deep transition-colors disabled:opacity-60"
                >
                  {profileSettingsSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </>
  );
}

export default App;
