import React, { useState } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { Bars3Icon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import alderwellLogo from '../assets/alderwell-logo.svg';

// Turns a role key like 'marketing_team_member' into a readable label like 'Marketing Team Member'.
function formatRoleLabel(role) {
  if (!role) {
    return 'General Staff';
  }

  const normalized = String(role).trim().toLowerCase().replace(/\s+/g, '_');
  const map = {
    admin: 'Admin',
    manager: 'Manager',
    marketing_team_member: 'Marketing Team Member',
    sales_representative: 'Sales Representative',
    compliance_officer: 'Compliance Officer',
    staff: 'Marketing Team Member',
  };

  return map[normalized] || role;
}

// The main page shell — sidebar, top bar, and the content area.
// All pages are rendered inside this as {children}.
export default function Layout({ children, activeNav, onNavChange, userEmail, userFullName, userRole, navItems, onLogout, onOpenProfileSettings, avatarColor }) {
  // Controls whether the mobile slide-in menu is visible.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Build 1–2 letter initials from the user's name, falling back to their email.
  const initials = userFullName
    ? userFullName
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token[0]?.toUpperCase())
        .slice(0, 2)
        .join('')
    : userEmail
      ? userEmail
          .split('@')[0]
          .split(/[._-]/)
          .filter(Boolean)
          .map((token) => token[0]?.toUpperCase())
          .slice(0, 2)
          .join('')
      : 'U';

  const resolvedUserName = userFullName || userEmail || 'User';
  // Human-readable role shown in the sidebar and profile menu.
  const resolvedUserRole = formatRoleLabel(userRole);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — shown on large screens. Hidden on mobile. */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:bg-white lg:border-r lg:border-gray-200">
        <div className="flex flex-col flex-1 overflow-y-auto">
          <button
            onClick={() => onNavChange('home')}
            className="px-6 py-4 hover:opacity-80 transition-opacity text-left"
          >
            <div className="flex items-center gap-2">
              <img src={alderwellLogo} alt="Alderwell logo" className="h-10 w-auto" />
              <div>
                <h1 className="text-[2rem] leading-none font-bold text-gray-900">Alderwell</h1>
                <p className="text-sm text-gray-500 leading-none mt-0.5">Pharmaceuticals</p>
              </div>
            </div>
          </button>

          <nav className="flex-1 space-y-1 px-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavChange(item.id)}
                className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeNav === item.id
                    ? 'bg-brand-deep text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Mobile sidebar — slides in from the left when the hamburger button is tapped. */}
      <Transition
        show={mobileMenuOpen}
        as={Fragment}
        enter="transition ease-in-out duration-300"
        enterFrom="transform opacity-0 -translate-x-full"
        enterTo="transform opacity-100 translate-x-0"
        leave="transition ease-in-out duration-300"
        leaveFrom="transform opacity-100 translate-x-0"
        leaveTo="transform opacity-0 -translate-x-full"
      >
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="w-64 bg-white overflow-y-auto border-r border-gray-200">
            <button
              onClick={() => {
                onNavChange('home');
                setMobileMenuOpen(false);
              }}
              className="w-full px-6 py-4 hover:opacity-80 transition-opacity text-left"
            >
              <div className="flex items-center gap-2">
                <img src={alderwellLogo} alt="Alderwell logo" className="h-10 w-auto" />
                <div>
                  <h1 className="text-[2rem] leading-none font-bold text-gray-900">Alderwell</h1>
                  <p className="text-sm text-gray-500 leading-none mt-0.5">Pharmaceuticals</p>
                </div>
              </div>
            </button>

            <nav className="space-y-1 px-4">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavChange(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeNav === item.id
                      ? 'bg-brand-deep text-white'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Dark overlay behind the mobile sidebar — tapping it closes the menu. */}
          <div
            className="flex-1 bg-black bg-opacity-50"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      </Transition>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-brand-deep hover:bg-gray-100 focus:outline-none"
          >
            {mobileMenuOpen ? (
              <XMarkIcon className="h-6 w-6" />
            ) : (
              <Bars3Icon className="h-6 w-6" />
            )}
          </button>

          <div className="ml-auto flex items-center gap-4">
            {/* User Profile Menu */}
            <Menu as="div" className="relative">
              <MenuButton className="flex items-center gap-3 hover:bg-gray-100 rounded-lg px-3 py-2 transition-colors">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                  style={{ backgroundColor: avatarColor || '#5b9486' }}
                >
                  {initials}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="font-semibold text-gray-900 text-sm">{resolvedUserName}</p>
                  <p className="text-xs text-brand-deep">{resolvedUserRole}</p>
                </div>
                <ChevronDownIcon className="h-4 w-4 text-brand-deep hidden sm:block" />
              </MenuButton>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <MenuItems className="absolute right-0 mt-2 w-56 origin-top-right rounded-lg bg-white shadow-lg ring-1 ring-gray-200 z-50">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <p className="font-semibold text-gray-900">{resolvedUserName}</p>
                    <p className="text-sm text-brand-deep">{resolvedUserRole}</p>
                  </div>

                  <MenuItem>
                    {({ active }) => (
                      <button
                        onClick={onOpenProfileSettings}
                        className={`w-full text-left px-4 py-2 text-sm ${
                          active
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-gray-700'
                        }`}
                      >
                        Profile Settings
                      </button>
                    )}
                  </MenuItem>

                  <div className="border-t border-gray-200 my-1" />

                  <MenuItem>
                    {({ active }) => (
                      <button
                        onClick={onLogout}
                        className={`w-full text-left px-4 py-2 text-sm font-medium ${
                          active
                            ? 'bg-brand-sage text-brand-deep'
                            : 'text-brand-deep'
                        }`}
                      >
                        Logout
                      </button>
                    )}
                  </MenuItem>
                </MenuItems>
              </Transition>
            </Menu>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
