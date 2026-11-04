# Alderwell Sales

A system for managing sales, tasks, campaigns, and documents. Only staff members can log in (admins create accounts).

## What can you do with this?

- Track and assign tasks to team members
- Manage sales activities and results
- Create and run marketing campaigns
- Upload and organize documents with folder access control
- View activity logs (audit trail)

## How the system is built

- Website: React (the app interface)
- Database: Supabase (stores all data)
- Hosting: Supabase (also hosts the backend)

## Before you start

1. Have Node.js 18+ and npm installed
2. Create a Supabase project
3. Install Supabase CLI on your computer

## Getting started (5 steps)

### 1. Download code dependencies
```bash
cd frontend
npm install
```

### 2. Connect to Supabase
Create a file called `frontend/.env` (or `frontend/.env.local`) and add:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=YOUR_SUPABASE_ANON_KEY
```

### 3. Start the website
```bash
npm run dev
```
The app will open at `http://localhost:5173`

### 4. Set up the database
Use the file `backend/sql/schema.sql`.

In Supabase:

1. Open `SQL Editor`
2. Create a new query
3. Open `backend/sql/schema.sql`
4. Copy the contents into the SQL Editor
5. Run the query

Then go to Supabase Auth Settings and turn off "Enable email confirmations" so admins can create accounts directly.

### 5. Create the first admin account
From the `frontend/` folder, run:
```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
ADMIN_EMAIL="admin@your-company.com" \
ADMIN_PASSWORD="TempPassword123!" \
ADMIN_USERNAME="admin" \
ADMIN_FULL_NAME="System Administrator" \
node ../backend/scripts/bootstrap-admin.mjs
```

After this, the admin can log in and create other staff accounts.

## Team roles

Different people see different parts of the system based on their role:

- **Admin**: Full access to everything
- **Manager**: Tasks, sales, campaigns, documents
- **Marketing Team Member**: Campaigns, documents, tasks
- **Sales Representative**: Sales, campaigns, tasks
- **Compliance Officer**: Documents, audit logs, tasks
- **General Staff**: Documents and tasks

## Common tasks

From `frontend/` folder:

- Start development: `npm run dev`
- Build for production: `npm run build`
- Check code for errors: `npm run lint`

## Important notes

- Passwords are secure and not stored directly in the system
- Only admins can create staff accounts (no public sign-ups)
- To delete files from storage, use Supabase console
- The database structure for this project is included in `backend/sql/schema.sql`