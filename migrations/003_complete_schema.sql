-- ============================================================
-- OpenClaw-Admin: Complete Database Schema Migration
-- Version: 003
-- Target: SQLite (better-sqlite3)
-- Author: DBA Agent
-- Created: 2026-04-11
-- ============================================================

-- ============================================================
-- SECTION 1: USERS & AUTH
-- ============================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id            TEXT    PRIMARY KEY,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    display_name  TEXT,
    email         TEXT    UNIQUE,
    phone         TEXT,
    avatar        TEXT,
    status        TEXT    DEFAULT 'active',
    last_login_at INTEGER,
    last_login_ip TEXT,
    created_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    deleted_at    INTEGER
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id          TEXT    PRIMARY KEY,
    name        TEXT    UNIQUE NOT NULL,
    description TEXT,
    is_system   INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id          TEXT    PRIMARY KEY,
    name        TEXT    UNIQUE NOT NULL,
    resource    TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    description TEXT,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- User-Roles junction
CREATE TABLE IF NOT EXISTS user_roles (
    user_id    TEXT    NOT NULL,
    role_id    TEXT    NOT NULL,
    granted_by TEXT,
    granted_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- ============================================================
-- SECTION 2: AUDIT & NOTIFICATIONS
-- ============================================================

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id             TEXT    PRIMARY KEY,
    user_id        TEXT,
    username       TEXT,
    action         TEXT    NOT NULL,
    resource       TEXT,
    resource_id    TEXT,
    details        TEXT    DEFAULT '{}',
    ip_address     TEXT,
    user_agent     TEXT,
    status         TEXT    DEFAULT 'success',
    error_message  TEXT,
    created_at     INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT,
    type        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    message     TEXT,
    data        TEXT    DEFAULT '{}',
    read        INTEGER DEFAULT 0,
    priority    TEXT    DEFAULT 'normal',
    channel     TEXT    DEFAULT 'in_app',
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    read_at     INTEGER,
    expires_at  INTEGER
);

-- ============================================================
-- SECTION 3: OFFICE & MYWORLD
-- ============================================================

-- Agents table (SQLite compatible)
CREATE TABLE IF NOT EXISTS agents (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    description TEXT,
    config      TEXT    DEFAULT '{}',
    status      INTEGER DEFAULT 1,
    created_by  TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Agent templates table
CREATE TABLE IF NOT EXISTS agent_templates (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT,
    config_schema TEXT    DEFAULT '{}',
    icon          TEXT,
    category      TEXT,
    created_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    logo        TEXT,
    settings    TEXT    DEFAULT '{}',
    owner_id    TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Company members table
CREATE TABLE IF NOT EXISTS company_members (
    id          TEXT    PRIMARY KEY,
    company_id  TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    role        TEXT    NOT NULL,
    permissions TEXT    DEFAULT '{}',
    joined_at   INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(company_id, user_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================
-- SECTION 4: INDEXES
-- ============================================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- User-Roles indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_uid ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_rid ON user_roles(role_id);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_logs(status);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);

-- Agents indexes
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by);

-- Companies indexes
CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON company_members(user_id);

-- ============================================================
-- SECTION 5: SEED DATA - PERMISSIONS
-- ============================================================

INSERT OR IGNORE INTO permissions (id, name, resource, action, description) VALUES
    ('perm_dashboard_view',       'dashboard:view',        'dashboard',     'view',     'View dashboard'),
    ('perm_config_read',          'config:read',           'config',        'read',     'Read configuration'),
    ('perm_config_write',         'config:write',          'config',        'write',    'Modify configuration'),
    ('perm_agents_manage',        'agents:manage',         'agents',        'manage',   'Manage agents'),
    ('perm_wizard_manage',        'wizard:manage',         'wizard',        'manage',   'Manage wizard'),
    ('perm_backup_manage',        'backup:manage',         'backup',        'manage',   'Manage backups'),
    ('perm_users_manage',         'users:manage',          'users',         'manage',   'Manage users'),
    ('perm_roles_manage',         'roles:manage',          'roles',         'manage',   'Manage roles'),
    ('perm_audit_view',           'audit:view',            'audit',         'view',     'View audit logs'),
    ('perm_notifications_manage', 'notifications:manage',  'notifications', 'manage',   'Manage notifications'),
    ('perm_terminal_access',      'terminal:access',       'terminal',      'access',   'Access terminal'),
    ('perm_desktop_access',       'desktop:access',        'desktop',       'access',   'Access remote desktop'),
    ('perm_files_manage',         'files:manage',          'files',         'manage',   'Manage files'),
    ('perm_system_admin',         'system:admin',          'system',        'admin',    'Full system administration'),
    ('perm_office_agents_read',   'office:agents:read',    'office',        'agents:read',       'View agents list and details'),
    ('perm_office_agents_write',  'office:agents:write',   'office',        'agents:write',      'Create/edit/delete agents'),
    ('perm_office_templates_read','office:templates:read', 'office',        'templates:read',    'View agent templates'),
    ('perm_office_templates_write','office:templates:write','office',       'templates:write',   'Create/edit/delete templates'),
    ('perm_myworld_companies_read','myworld:companies:read','myworld',      'companies:read',    'View companies and details'),
    ('perm_myworld_companies_write','myworld:companies:write','myworld',    'companies:write',   'Create/edit/delete companies'),
    ('perm_myworld_members_read', 'myworld:members:read',  'myworld',       'members:read',      'View company members'),
    ('perm_myworld_members_write','myworld:members:write', 'myworld',       'members:write',     'Manage company members');

-- ============================================================
-- SECTION 6: SEED DATA - ROLES
-- ============================================================

-- Viewer role (read-only)
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
    ('role_viewer', 'viewer', 'Read-only access to the dashboard', 1);

INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by)
SELECT 'user_admin', 'role_viewer', 'system'
WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = 'user_admin' AND role_id = 'role_viewer');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_by) VALUES
    ('role_viewer', 'perm_dashboard_view', 'system'),
    ('role_viewer', 'perm_config_read', 'system'),
    ('role_viewer', 'perm_office_agents_read', 'system'),
    ('role_viewer', 'perm_office_templates_read', 'system'),
    ('role_viewer', 'perm_myworld_companies_read', 'system'),
    ('role_viewer', 'perm_myworld_members_read', 'system');

-- Operator role (standard operator)
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
    ('role_operator', 'operator', 'Standard operator with file and terminal access', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_by) VALUES
    ('role_operator', 'perm_dashboard_view', 'system'),
    ('role_operator', 'perm_config_read', 'system'),
    ('role_operator', 'perm_config_write', 'system'),
    ('role_operator', 'perm_agents_manage', 'system'),
    ('role_operator', 'perm_wizard_manage', 'system'),
    ('role_operator', 'perm_backup_manage', 'system'),
    ('role_operator', 'perm_terminal_access', 'system'),
    ('role_operator', 'perm_desktop_access', 'system'),
    ('role_operator', 'perm_files_manage', 'system'),
    ('role_operator', 'perm_notifications_manage', 'system'),
    ('role_operator', 'perm_office_agents_read', 'system'),
    ('role_operator', 'perm_office_agents_write', 'system'),
    ('role_operator', 'perm_office_templates_read', 'system'),
    ('role_operator', 'perm_office_templates_write', 'system'),
    ('role_operator', 'perm_myworld_companies_read', 'system'),
    ('role_operator', 'perm_myworld_companies_write', 'system'),
    ('role_operator', 'perm_myworld_members_read', 'system'),
    ('role_operator', 'perm_myworld_members_write', 'system');

-- Admin role (full access)
INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES
    ('role_admin', 'admin', 'Full administrative access', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_by) VALUES
    ('role_admin', 'perm_dashboard_view', 'system'),
    ('role_admin', 'perm_config_read', 'system'),
    ('role_admin', 'perm_config_write', 'system'),
    ('role_admin', 'perm_agents_manage', 'system'),
    ('role_admin', 'perm_wizard_manage', 'system'),
    ('role_admin', 'perm_backup_manage', 'system'),
    ('role_admin', 'perm_users_manage', 'system'),
    ('role_admin', 'perm_roles_manage', 'system'),
    ('role_admin', 'perm_audit_view', 'system'),
    ('role_admin', 'perm_notifications_manage', 'system'),
    ('role_admin', 'perm_terminal_access', 'system'),
    ('role_admin', 'perm_desktop_access', 'system'),
    ('role_admin', 'perm_files_manage', 'system'),
    ('role_admin', 'perm_system_admin', 'system'),
    ('role_admin', 'perm_office_agents_read', 'system'),
    ('role_admin', 'perm_office_agents_write', 'system'),
    ('role_admin', 'perm_office_templates_read', 'system'),
    ('role_admin', 'perm_office_templates_write', 'system'),
    ('role_admin', 'perm_myworld_companies_read', 'system'),
    ('role_admin', 'perm_myworld_companies_write', 'system'),
    ('role_admin', 'perm_myworld_members_read', 'system'),
    ('role_admin', 'perm_myworld_members_write', 'system');

-- ============================================================
-- SECTION 7: SEED DATA - DEFAULT ADMIN USER
-- ============================================================
-- Password: admin123
-- ⚠️  IMPORTANT: Change password immediately after first login!
-- ============================================================

INSERT OR IGNORE INTO users (id, username, password_hash, display_name, email, status) VALUES
    ('user_admin', 'admin', '$2b$10$placeholder_hash_replace_in_production', 'Administrator', 'admin@example.com', 'active');

INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES ('user_admin', 'role_admin', 'system');

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
