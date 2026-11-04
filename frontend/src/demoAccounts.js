// Public demo logins shown on the login page.
// The demo reset script (backend/scripts/demo/reset-demo.mjs) reads this same
// file to create these accounts and set their passwords, so keep it plain JS.
export const DEMO_PASSWORD = 'AlderwellDemo1!';

export const DEMO_ACCOUNTS = [
  {
    key: 'manager',
    label: 'Manager',
    email: 'manager.demo@example.com',
    username: 'demo_manager',
    full_name: 'Morgan Hale',
    company_role: 'manager',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    email: 'marketing.demo@example.com',
    username: 'demo_marketing',
    full_name: 'Priya Shah',
    company_role: 'marketing_team_member',
  },
  {
    key: 'sales',
    label: 'Sales Rep',
    email: 'sales.demo@example.com',
    username: 'demo_sales',
    full_name: 'Dan Okafor',
    company_role: 'sales_representative',
  },
];
