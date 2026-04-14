import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, '../data/wizard.db')

const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft',
    agent_selection_mode TEXT DEFAULT 'existing',
    selected_agents TEXT DEFAULT '[]',
    generated_agents TEXT DEFAULT '[]',
    bindings TEXT DEFAULT '[]',
    tasks TEXT DEFAULT '[]',
    execution_log TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    scenario_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    assigned_agents TEXT DEFAULT '[]',
    priority TEXT DEFAULT 'medium',
    mode TEXT DEFAULT 'default',
    conversation_history TEXT DEFAULT '[]',
    execution_history TEXT DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS backup_records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    filename TEXT,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    message TEXT,
    stage TEXT,
    error TEXT,
    result TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    completed_at INTEGER,
    size INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_scenario_id ON tasks(scenario_id);
  CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_backup_records_created_at ON backup_records(created_at);
`)

try {
  db.exec('ALTER TABLE scenarios ADD COLUMN execution_log TEXT DEFAULT \'[]\'')
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('[Database] Failed to add execution_log column:', e.message)
  }
}

try {
  db.exec('ALTER TABLE tasks ADD COLUMN execution_history TEXT DEFAULT \'[]\'')
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('[Database] Failed to add execution_history column:', e.message)
  }
}

export function createBackupRecord(id, type, filename = null) {
  const stmt = db.prepare(`
    INSERT INTO backup_records (id, type, filename, status, progress, message, created_at)
    VALUES (?, ?, ?, 'pending', 0, 'Task created', ?)
  `)
  stmt.run(id, type, filename, Date.now())
  return id
}

export function updateBackupRecord(id, updates) {
  const fields = []
  const values = []
  
  for (let [key, value] of Object.entries(updates)) {
    if (key === 'completedAt') key = 'completed_at'
    fields.push(`${key} = ?`)
    values.push(typeof value === 'object' ? JSON.stringify(value) : value)
  }
  
  values.push(id)
  
  const stmt = db.prepare(`UPDATE backup_records SET ${fields.join(', ')} WHERE id = ?`)
  stmt.run(...values)
}

export function getBackupRecord(id) {
  const stmt = db.prepare('SELECT * FROM backup_records WHERE id = ?')
  const record = stmt.get(id)
  if (record && record.result) {
    record.result = JSON.parse(record.result)
  }
  return record
}

export function getBackupRecords(limit = 20, offset = 0) {
  const stmt = db.prepare('SELECT * FROM backup_records ORDER BY created_at DESC LIMIT ? OFFSET ?')
  const records = stmt.all(limit, offset)
  return records.map(r => {
    if (r.result) {
      r.result = JSON.parse(r.result)
    }
    return r
  })
}

export function getBackupRecordsCount() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM backup_records')
  return stmt.get().count
}

export function deleteBackupRecord(id) {
  const stmt = db.prepare('DELETE FROM backup_records WHERE id = ?')
  stmt.run(id)
}

console.log('[Database] Initialized at:', dbPath)

export default db

// ============================================================
// P0: Multi-User Auth + RBAC + Audit Log
// ============================================================

// Users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT,
    display_name TEXT,
    role TEXT DEFAULT 'viewer',
    status TEXT DEFAULT 'active',
    email TEXT,
    avatar TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    last_login_at INTEGER
  );
`)

try {
  db.exec('ALTER TABLE users ADD COLUMN salt TEXT')
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('[Database] Failed to add users.salt column:', e.message)
  }
}

// Sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)

// Roles table
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    permissions TEXT DEFAULT '[]',
    is_system INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
`)

// Permissions table
db.exec(`
  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
`)

// User roles junction
db.exec(`
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    granted_by TEXT,
    granted_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  );
`)

// Audit logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resource_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'success',
    error_message TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
`)

// Notifications table
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    data TEXT DEFAULT '{}',
    read INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'normal',
    channel TEXT DEFAULT 'in_app',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    read_at INTEGER,
    expires_at INTEGER
  );
`)

// Seed default roles and permissions
const seedRolesAndPermissions = () => {
  const defaultPermissions = [
    { id: 'perm_dashboard_view', name: 'dashboard:view', resource: 'dashboard', action: 'view', description: 'View dashboard' },
    { id: 'perm_config_read', name: 'config:read', resource: 'config', action: 'read', description: 'Read configuration' },
    { id: 'perm_config_write', name: 'config:write', resource: 'config', action: 'write', description: 'Modify configuration' },
    { id: 'perm_agents_manage', name: 'agents:manage', resource: 'agents', action: 'manage', description: 'Manage agents' },
    { id: 'perm_wizard_manage', name: 'wizard:manage', resource: 'wizard', action: 'manage', description: 'Manage wizard' },
    { id: 'perm_backup_manage', name: 'backup:manage', resource: 'backup', action: 'manage', description: 'Manage backups' },
    { id: 'perm_users_manage', name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage users' },
    { id: 'perm_roles_manage', name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles' },
    { id: 'perm_audit_view', name: 'audit:view', resource: 'audit', action: 'view', description: 'View audit logs' },
    { id: 'perm_notifications_manage', name: 'notifications:manage', resource: 'notifications', action: 'manage', description: 'Manage notifications' },
    { id: 'perm_terminal_access', name: 'terminal:access', resource: 'terminal', action: 'access', description: 'Access terminal' },
    { id: 'perm_desktop_access', name: 'desktop:access', resource: 'desktop', action: 'access', description: 'Access remote desktop' },
    { id: 'perm_files_manage', name: 'files:manage', resource: 'files', action: 'manage', description: 'Manage files' },
    { id: 'perm_system_admin', name: 'system:admin', resource: 'system', action: 'admin', description: 'Full system administration' },
    { id: 'perm_office_agents_read', name: 'office:agents:read', resource: 'office', action: 'agents:read', description: 'View agents list and details' },
    { id: 'perm_office_agents_write', name: 'office:agents:write', resource: 'office', action: 'agents:write', description: 'Create/edit/delete agents' },
    { id: 'perm_office_templates_read', name: 'office:templates:read', resource: 'office', action: 'templates:read', description: 'View agent templates' },
    { id: 'perm_office_templates_write', name: 'office:templates:write', resource: 'office', action: 'templates:write', description: 'Create/edit/delete templates' },
    { id: 'perm_myworld_companies_read', name: 'myworld:companies:read', resource: 'myworld', action: 'companies:read', description: 'View companies and details' },
    { id: 'perm_myworld_companies_write', name: 'myworld:companies:write', resource: 'myworld', action: 'companies:write', description: 'Create/edit/delete companies' },
    { id: 'perm_myworld_members_read', name: 'myworld:members:read', resource: 'myworld', action: 'members:read', description: 'View company members' },
    { id: 'perm_myworld_members_write', name: 'myworld:members:write', resource: 'myworld', action: 'members:write', description: 'Manage company members' },
  ]

  const defaultRoles = [
    {
      id: 'role_viewer',
      name: 'viewer',
      description: 'Read-only access to the dashboard',
      permissions: ['perm_dashboard_view', 'perm_config_read', 'perm_agents_manage', 'perm_notifications_manage',
        'perm_office_agents_read', 'perm_office_agents_write', 'perm_office_templates_read',
        'perm_myworld_companies_read', 'perm_myworld_companies_write', 'perm_myworld_members_read', 'perm_myworld_members_write'],
      is_system: 1
    },
    {
      id: 'role_operator',
      name: 'operator',
      description: 'Standard operator with file and terminal access',
      permissions: ['perm_dashboard_view', 'perm_config_read', 'perm_config_write', 'perm_agents_manage', 'perm_wizard_manage', 'perm_backup_manage', 'perm_terminal_access', 'perm_desktop_access', 'perm_files_manage', 'perm_notifications_manage',
        'perm_office_agents_read', 'perm_office_agents_write', 'perm_office_templates_read', 'perm_office_templates_write',
        'perm_myworld_companies_read', 'perm_myworld_companies_write', 'perm_myworld_members_read', 'perm_myworld_members_write'],
      is_system: 1
    },
    {
      id: 'role_admin',
      name: 'admin',
      description: 'Full administrative access',
      permissions: defaultPermissions.map(p => p.id),
      is_system: 1
    },
  ]

  const insertPerm = db.prepare(`
    INSERT OR IGNORE INTO permissions (id, name, resource, action, description)
    VALUES (?, ?, ?, ?, ?)
  `)

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const p of defaultPermissions) {
    insertPerm.run(p.id, p.name, p.resource, p.action, p.description)
  }

  for (const r of defaultRoles) {
    insertRole.run(r.id, r.name, r.description, JSON.stringify(r.permissions), r.is_system)
  }
}

seedRolesAndPermissions()

// Create indexes for new tables
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)') } catch (e) {}
try { db.exec('CREATE INDEX IF EXISTS idx_notifications_user_id ON notifications(user_id)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)') } catch (e) {}

