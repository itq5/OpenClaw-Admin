# OpenClaw-Admin 数据库设计文档

**版本**: 1.0  
**创建时间**: 2026-04-11  
**作者**: 数据库工程师 🗄️  
**状态**: 已完成

---

## 一、设计概述

### 1.1 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| 数据库引擎 | SQLite | 使用 better-sqlite3，零配置、轻量级 |
| 主键类型 | TEXT (UUID) | 分布式友好、支持离线生成 |
| 时间字段 | INTEGER (毫秒时间戳) | 时区无关、排序高效 |
| 事务支持 | WAL 模式 | 提高并发读写性能 |

### 1.2 设计原则

1. **简洁优先**: 优先使用简单结构，避免过度设计
2. **扩展友好**: 预留 JSON 字段支持动态属性
3. **性能优化**: 高频查询字段建立索引
4. **数据完整性**: 使用外键约束保证关联数据一致性

---

## 二、现有表结构

### 2.1 核心业务表

| 表名 | 用途 | 状态 |
|------|------|------|
| `scenarios` | 多 Agent 协作场景 | ✅ 已存在 |
| `tasks` | 场景任务队列 | ✅ 已存在 |
| `backup_records` | 备份记录 | ✅ 已存在 |

### 2.2 现有表结构详情

#### scenarios 表
```sql
CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft',  -- draft | running | completed | failed
    agent_selection_mode TEXT DEFAULT 'existing',  -- existing | generate
    selected_agents TEXT DEFAULT '[]',  -- JSON: 选中的 Agent ID 列表
    generated_agents TEXT DEFAULT '[]',  -- JSON: 生成的 Agent 配置
    bindings TEXT DEFAULT '[]',  -- JSON: Agent-任务绑定关系
    tasks TEXT DEFAULT '[]',  -- JSON: 任务列表
    execution_log TEXT DEFAULT '[]',  -- JSON: 执行日志
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

#### tasks 表
```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    scenario_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',  -- pending | running | completed | failed
    assigned_agents TEXT DEFAULT '[]',  -- JSON: 分配的 Agent ID 列表
    priority TEXT DEFAULT 'medium',  -- low | medium | high | urgent
    mode TEXT DEFAULT 'default',  -- default | parallel | sequential
    conversation_history TEXT DEFAULT '[]',  -- JSON: 对话历史
    execution_history TEXT DEFAULT '[]',  -- JSON: 执行历史
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
```

#### backup_records 表
```sql
CREATE TABLE backup_records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,  -- full | incremental | config
    filename TEXT,
    status TEXT DEFAULT 'pending',  -- pending | running | completed | failed
    progress INTEGER DEFAULT 0,
    message TEXT,
    stage TEXT,
    error TEXT,
    result TEXT,  -- JSON: 执行结果
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    completed_at INTEGER,
    size INTEGER
);
```

---

## 三、新增表结构（P0 需求）

### 3.1 用户与权限系统

#### users 表 - 用户基本信息
```sql
CREATE TABLE users (
    id            TEXT    PRIMARY KEY,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    display_name  TEXT,
    email         TEXT    UNIQUE,
    phone         TEXT,
    avatar        TEXT,
    status        TEXT    DEFAULT 'active',  -- active | inactive | suspended
    last_login_at INTEGER,
    last_login_ip TEXT,
    created_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    deleted_at    INTEGER
);
```

**字段说明**:
- `status`: 用户状态，active=正常，inactive=禁用，suspended=冻结
- `deleted_at`: 软删除时间，NULL 表示未删除

#### sessions 表 - 用户会话
```sql
CREATE TABLE sessions (
    id           TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### roles 表 - 角色定义
```sql
CREATE TABLE roles (
    id          TEXT    PRIMARY KEY,
    name        TEXT    UNIQUE NOT NULL,
    description TEXT,
    is_system   INTEGER DEFAULT 0,  -- 1=系统内置，不可删除
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

#### permissions 表 - 权限定义
```sql
CREATE TABLE permissions (
    id          TEXT    PRIMARY KEY,
    name        TEXT    UNIQUE NOT NULL,  -- e.g. "users:manage"
    resource    TEXT    NOT NULL,          -- e.g. "users"
    action      TEXT    NOT NULL,          -- e.g. "manage", "view", "write"
    description TEXT,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

#### user_roles 表 - 用户 - 角色关联
```sql
CREATE TABLE user_roles (
    user_id    TEXT    NOT NULL,
    role_id    TEXT    NOT NULL,
    granted_by TEXT,
    granted_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
```

#### audit_logs 表 - 审计日志
```sql
CREATE TABLE audit_logs (
    id             TEXT    PRIMARY KEY,
    user_id        TEXT,
    username       TEXT,
    action         TEXT    NOT NULL,  -- e.g. "user.create", "role.assign"
    resource       TEXT,             -- e.g. "users", "roles", "auth"
    resource_id    TEXT,             -- 目标资源主键
    details        TEXT    DEFAULT '{}',  -- JSON: 详细信息
    ip_address     TEXT,
    user_agent     TEXT,
    status         TEXT    DEFAULT 'success',  -- success | failure
    error_message  TEXT,
    created_at     INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

### 3.2 通知中心

#### notifications 表 - 通知消息
```sql
CREATE TABLE notifications (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT,
    type        TEXT    NOT NULL,  -- info | warning | error | success
    title       TEXT    NOT NULL,
    message     TEXT,
    data        TEXT    DEFAULT '{}',  -- JSON: 附加数据
    read        INTEGER DEFAULT 0,
    priority    TEXT    DEFAULT 'normal',  -- low | normal | high | urgent
    channel     TEXT    DEFAULT 'in_app',  -- in_app | email | push | webhook
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    read_at     INTEGER,
    expires_at  INTEGER
);
```

### 3.3 Office 智能体工坊

#### agents 表 - Agent 定义（适配 SQLite）
```sql
CREATE TABLE agents (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,  -- built-in | custom | generated
    description TEXT,
    config      TEXT    DEFAULT '{}',  -- JSON: Agent 配置
    status      INTEGER DEFAULT 1,  -- 1=active, 0=inactive
    created_by  TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (created_by) REFERENCES users(id)
);
```

#### agent_templates 表 - Agent 模板
```sql
CREATE TABLE agent_templates (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT,
    config_schema TEXT    DEFAULT '{}',  -- JSON: 配置 schema
    icon          TEXT,
    category      TEXT,  -- 分类：developer | designer | analyst | etc.
    created_at    INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

### 3.4 MyWorld 虚拟公司

#### companies 表 - 公司信息
```sql
CREATE TABLE companies (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT,
    logo        TEXT,
    settings    TEXT    DEFAULT '{}',  -- JSON: 公司设置
    owner_id    TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);
```

#### company_members 表 - 公司成员
```sql
CREATE TABLE company_members (
    id          TEXT    PRIMARY KEY,
    company_id  TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    role        TEXT    NOT NULL,  -- owner | admin | member
    permissions TEXT    DEFAULT '{}',  -- JSON: 自定义权限
    joined_at   INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    UNIQUE(company_id, user_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 四、索引设计

### 4.1 用户相关索引
```sql
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
```

### 4.2 会话与审计索引
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_logs(status);
```

### 4.3 通知索引
```sql
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
```

### 4.4 业务表索引
```sql
CREATE INDEX IF NOT EXISTS idx_tasks_scenario_id ON tasks(scenario_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_by ON agents(created_by);
CREATE INDEX IF NOT EXISTS idx_companies_owner_id ON companies(owner_id);
```

---

## 五、数据字典

### 5.1 用户状态 (users.status)
| 值 | 说明 |
|----|------|
| active | 正常激活 |
| inactive | 已禁用 |
| suspended | 已冻结 |

### 5.2 通知类型 (notifications.type)
| 值 | 说明 |
|----|------|
| info | 信息通知 |
| warning | 警告 |
| error | 错误 |
| success | 成功 |

### 5.3 通知优先级 (notifications.priority)
| 值 | 说明 |
|----|------|
| low | 低优先级 |
| normal | 普通 |
| high | 高优先级 |
| urgent | 紧急 |

### 5.4 审计日志状态 (audit_logs.status)
| 值 | 说明 |
|----|------|
| success | 成功 |
| failure | 失败 |

### 5.5 Agent 类型 (agents.type)
| 值 | 说明 |
|----|------|
| built-in | 内置 Agent |
| custom | 自定义 Agent |
| generated | 生成的 Agent |

### 5.6 权限命名规范
格式：`{resource}:{action}`

| 权限名 | 说明 |
|--------|------|
| `dashboard:view` | 查看仪表盘 |
| `config:read` | 读取配置 |
| `config:write` | 修改配置 |
| `users:manage` | 用户管理 |
| `roles:manage` | 角色管理 |
| `audit:view` | 查看审计日志 |
| `agents:manage` | Agent 管理 |
| `office:agents:write` | 编辑 Office Agent |
| `myworld:companies:write` | 编辑公司信息 |

---

## 六、迁移步骤

### 6.1 迁移脚本位置
```
/www/wwwroot/ai-work/migrations/
├── 001_rbac_schema.sql      # RBAC 表结构（已存在）
├── 001_rbac_audit.sql       # RBAC + 审计日志（已存在）
├── 002_office_myworld.sql   # Office/MyWorld 表结构（已存在，需转换为 SQLite）
└── 003_complete_schema.sql  # 完整统一迁移脚本（待创建）
```

### 6.2 执行迁移

**方式一：手动执行 SQL**
```bash
# 进入项目目录
cd /www/wwwroot/ai-work

# 使用 sqlite3 工具执行
sqlite3 data/wizard.db < migrations/003_complete_schema.sql
```

**方式二：通过 Node.js 执行**
```javascript
import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('data/wizard.db');
const sql = fs.readFileSync('migrations/003_complete_schema.sql', 'utf8');
db.exec(sql);
```

### 6.3 迁移检查清单

- [ ] 所有表创建成功
- [ ] 所有索引创建成功
- [ ] 默认权限数据已插入
- [ ] 默认角色数据已插入
- [ ] 默认管理员用户已创建
- [ ] 外键约束正常工作

---

## 七、默认数据

### 7.1 默认角色

| ID | 名称 | 说明 |
|----|------|------|
| role_viewer | viewer | 只读用户 |
| role_operator | operator | 普通操作员 |
| role_admin | admin | 超级管理员 |

### 7.2 默认管理员账号

| 字段 | 值 |
|------|-----|
| username | admin |
| password | admin123 ⚠️ 首次登录后请立即修改 |
| role | admin |
| email | admin@example.com |

---

## 八、下一步计划

1. **完成迁移脚本**: 创建 `003_complete_schema.sql` 统一迁移脚本
2. **执行迁移**: 在测试环境验证迁移脚本
3. **DAO 层实现**: 编写各表的 DAO 封装
4. **API 对接**: 实现用户认证、权限校验等 API
5. **单元测试**: 编写数据库操作单元测试

---

**文档更新记录**:
- 2026-04-11: 初始版本，完成完整数据库设计

🗄️ 数据库工程师
