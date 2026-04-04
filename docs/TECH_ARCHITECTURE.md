# OpenClaw Admin 技术架构

## 1. 文档目的

本文档面向 **长期维护、二开、排障、部署** 场景，沉淀 OpenClaw Admin 当前的技术架构现状，明确：

- 系统整体分层
- 前后端边界
- 关键模块职责
- 数据与通信链路
- 构建产物与部署关系
- 当前已知技术债与风险
- 后续可扩展方向

> 项目根目录：`~/.openclaw/lavain-ai/project/openclaw-admin`
>
> 代码目录：`~/.openclaw/lavain-ai/project/openclaw-admin/OpenClaw-Admin`
>
> 线上地址：`https://admin-openclaw.codingshen.top`
>
> 当前部署方式：`systemd + Node.js + Express + Vite dist`

---

## 2. 整体架构概览

OpenClaw Admin 当前是一个 **前后端同仓、前后端分进程职责、单服务部署** 的 Web 管理台。

### 2.1 架构分层

```text
浏览器
  ↓
Vite 构建后的 Vue 3 前端（dist）
  ↓ HTTP / SSE
Express Backend（server/index.js）
  ├─ 本地文件系统访问
  ├─ SQLite（better-sqlite3）
  ├─ PTY / ffmpeg / x11vnc / Xvfb / shell / openclaw CLI
  └─ OpenClaw Gateway WebSocket Client（server/gateway.js）
        ↓
    OpenClaw Gateway / Operator RPC / system-presence / status / events
```

### 2.2 核心事实

- **前端不是直接连 OpenClaw Gateway**，而是先连本项目后端
- **后端同时承担**：
  - 静态资源服务
  - 认证
  - 文件读写与上传下载
  - 终端 / 远程桌面流服务
  - Backup/Restore 执行器
  - Gateway RPC 代理层
- **本地 SQLite 仅承载 Admin 自己的业务数据**，不是 OpenClaw 主运行数据的唯一来源
- OpenClaw 主运行状态主要通过 **Gateway WebSocket RPC** 获取

---

## 3. 技术栈与运行时组成

## 3.1 前端技术栈

- Vue 3
- TypeScript
- Vite 7
- Vue Router 4
- Pinia 3
- Naive UI
- vue-i18n
- FontAwesome / Ionicons

## 3.2 后端技术栈

- Node.js（ESM）
- Express 5
- ws（WebSocket）
- better-sqlite3
- node-pty
- multer
- ssh2
- check-disk-space
- archiver / unzipper / adm-zip
- ffmpeg / Xvfb / x11vnc / xdotool（Linux 远程桌面依赖）

## 3.3 构建与开发工具

- vite
- vue-tsc
- vitest
- Playwright
- concurrently

---

## 4. 目录结构与模块边界

当前项目主要目录：

```text
openclaw-admin/
├─ PROJECT.md            # 项目总说明（项目级文档）
├─ docs/                 # 项目级文档目录
│  ├─ TECH_ARCHITECTURE.md
│  ├─ async-architecture.md
│  └─ ASYNC-MIGRATION-GUIDE.md
└─ OpenClaw-Admin/       # 代码目录
   ├─ src/               # Vue 前端源码
   ├─ server/            # Express 后端与 Gateway 客户端
   ├─ data/              # SQLite 本地数据（wizard.db）
   ├─ dist/              # 前端构建产物
   ├─ docs/images/       # 代码仓库内保留的图片资源
   ├─ backups/           # 备份产物
   ├─ public/            # 前端静态资源
   ├─ .env               # 运行配置
   ├─ package.json
   └─ vite.config.ts
```

### 4.1 `src/` 前端源码分层

#### `src/api/`
负责浏览器侧通信封装：

- `websocket.ts`：浏览器到本项目后端的 WebSocket/SSE 相关客户端封装
- `rpc-client.ts`：对后端暴露的 RPC 代理做浏览器调用封装
- `http-client.ts`：HTTP 请求封装
- `types/*`：类型定义

#### `src/stores/`
Pinia 状态层，是前端页面与后端交互的主要胶水层。

高频核心 store：

- `websocket.ts`：连接状态、Gateway 方法能力、版本信息
- `session.ts`：会话列表、会话详情、usage 合并、创建/重置/删除
- `chat.ts`：聊天上下文与消息流
- `agent.ts`：智能体列表、身份、模型、工具权限
- `office.ts`：Office 视图、团队/任务/消息协作状态
- `config.ts`：系统配置与 openclaw.json 相关
- `model.ts`：模型供应商与模型配置
- `channel-management.ts` / `channel.ts`：频道配置
- `cron.ts`：定时任务
- `memory.ts`：文档/记忆管理
- `backup.ts`：备份任务与恢复状态
- `monitor.ts`：运维监控页状态
- `terminal.ts` / `remote-desktop.ts`：终端与远程桌面会话态

#### `src/views/`
按页面划分的顶层视图层。

典型页面：

- Dashboard
- Chat
- Sessions / SessionDetail
- Memory
- Cron
- Models
- Channels
- Skills
- Files
- System
- Terminal
- RemoteDesktop
- Agents
- Office
- MyWorld
- Backup
- Monitor
- Settings

#### `src/components/`
通用组件与业务组件。

- `components/common/`：AsyncSection、ConnectionStatus、StatCard 等基础能力组件
- `components/layout/`：AppHeader、AppSidebar
- `components/office/`：Office / Wizard / Agent 协作相关组件

#### `src/composables/`
跨页面复用逻辑：

- `useRpcSafe.ts`：RPC 超时/重试/安全包装
- `useAsyncModule.ts`：异步模块统一状态管理
- `useEventStream.ts`：SSE 订阅
- `useResizable.ts`：可调整布局宽度
- `useTheme.ts`：主题切换

#### `src/router/`
- `routes.ts`：路由表，页面大部分采用 `import()` 动态分包
- `index.ts`：路由守卫与登录态检查

---

## 4.2 `server/` 后端源码分层

### `server/index.js`
项目后端主入口，承担几乎所有服务端职责：

1. 读取 `.env`
2. 初始化 Express
3. 初始化 Gateway 连接
4. 暴露 HTTP API / SSE / 文件服务
5. 管理终端与远程桌面会话
6. 管理 Wizard/Task/Backup 等本地业务能力
7. 托管 `dist/` 静态资源

这是当前后端的**单体入口文件**，也是当前架构中最明显的“单点复杂度中心”。

### `server/gateway.js`
负责作为 **OpenClaw Gateway 的 operator 客户端**：

- 建立 WebSocket 连接
- 完成 connect 握手
- 支持 token / password 认证
- 管理 pending RPC calls
- 转发 event / stateChange / version
- 构建设备身份签名

### `server/database.js`
负责本地 SQLite 初始化与简单数据访问：

当前主要表：

- `scenarios`
- `tasks`
- `backup_records`

特点：

- 启动时建表
- 通过 `ALTER TABLE` 方式做轻量补列
- 没有独立 migration 框架

---

## 5. 前端架构

## 5.1 前端入口与启动流程

入口：`src/main.ts`

启动顺序大致为：

1. 创建 Vue App
2. 注册 Pinia
3. 注册 vue-i18n
4. 注册 Vue Router
5. 挂载 `App.vue`

`App.vue` 负责：

- Naive UI 全局 ConfigProvider
- 语言切换与页面 title 同步
- Notification / Message / Dialog Provider 注入

## 5.2 页面组织方式

- 登录页独立：`/login`
- 登录后使用 `DefaultLayout.vue`
- 主体页面通过 `RouterView + 动态 import()` 加载

这意味着：

- 首屏与业务页是分离的
- 各业务页面按路由进行 chunk 拆分
- 但公共依赖仍然较大，构建后 chunk 体积仍偏大

## 5.3 状态管理策略

前端以 **Pinia store 为主状态中心**，页面尽量不直接写原始通信逻辑。

典型模式：

```text
View
  ↓
Store
  ↓
api/rpc/http/websocket composable
  ↓
Backend API / SSE / Gateway proxy
```

优点：

- 业务状态集中
- 页面层职责清晰
- 易于做跨页面共享

当前问题：

- store 数量多，但职责边界有时偏“页面驱动”，领域抽象还不够统一
- 部分 store 与具体页面结构耦合偏高（例如 Office / MyWorld）

## 5.4 异步架构约定

项目已有异步架构规范：`docs/async-architecture.md`

核心约定：

- 通过 `useRpcSafe` 包装 RPC 调用
- 通过 `useAsyncModule` 管理异步状态
- 通过 `AsyncSection` 统一 loading/error/empty UI
- 倡导并发加载而非整页阻塞

说明项目已经开始从“页面直连接口”走向“模块化异步视图架构”，这是一个好的演进方向。

---

## 6. 后端架构

## 6.1 后端角色定位

当前后端不是纯 API server，而是一个 **Web Admin BFF（Backend For Frontend）+ 本地系统代理**。

它的职责比普通 API 层更重，主要包括：

- 浏览器认证
- OpenClaw Gateway RPC 代理
- 本地文件系统访问
- 本地进程控制
- 终端/桌面流转发
- 备份/恢复执行
- 静态前端托管

## 6.2 后端 API 模块划分

从 `server/index.js` 可以看出，后端 API 主要分为以下几类：

### 认证与配置

- `/api/auth/*`
- `/api/config`
- `/api/health`
- `/api/status`
- `/api/npm/*`

### 系统与 Gateway 代理

- `/api/rpc`
- `/api/events`
- `/api/system/metrics`

### 多智能体工作区文件

- `/api/agents/workspace`
- `/api/files/list`
- `/api/files/get`
- `/api/files/set`
- `/api/files/mkdir`
- `/api/files/delete`
- `/api/files/rename`
- `/api/files/upload`
- `/api/media`

### 远程终端

- `/api/terminal/stream`
- `/api/terminal/input`
- `/api/terminal/resize`
- `/api/terminal/destroy`
- `/api/terminal/heartbeat`

### 远程桌面

- `/api/desktop/displays`
- `/api/desktop/list`
- `/api/desktop/create`
- `/api/desktop/stream`
- `/api/desktop/input/mouse`
- `/api/desktop/input/keyboard`
- `/api/desktop/input/clipboard`
- `/api/desktop/resize`
- `/api/desktop/destroy`
- `/api/desktop/heartbeat`

### Wizard / Office 本地业务

- `/api/wizard/scenarios*`
- `/api/wizard/tasks*`

### 备份恢复

- `/api/backup/list`
- `/api/backup/tasks`
- `/api/backup/create`
- `/api/backup/download`
- `/api/backup/restore`
- `/api/backup/delete`
- `/api/backup/upload`

## 6.3 认证机制

当前后端认证方式比较简单：

- 是否启用认证由 `.env` 中 `AUTH_USERNAME` / `AUTH_PASSWORD` 决定
- 登录成功后发放一个内存态 session token（`Map` 存储）
- session 默认 24h
- token 来源：
  - `Authorization: Bearer ...`
  - cookie session
  - query token（部分场景）

### 风险

- token 在进程内存里，服务重启后全部失效
- 没有多设备管理、刷新机制、审计日志
- 没有 CSRF / rate limit / login lockout 这类强化措施

---

## 7. 核心模块划分

## 7.1 Gateway 通信模块

核心文件：

- `server/gateway.js`
- `src/stores/websocket.ts`
- `src/api/rpc-client.ts`

职责：

- 管理 Admin → Gateway 的连接状态
- 暴露通用 RPC 调用能力
- 下发系统事件到前端
- 为系统监控、会话、智能体、配置等功能提供数据源

## 7.2 会话与聊天模块

核心文件：

- `src/stores/session.ts`
- `src/stores/chat.ts`
- `src/views/chat/ChatPage.vue`
- `src/views/sessions/*`

职责：

- 列出会话
- 拉取会话详情/消息
- 新建、重置、删除会话
- usage 合并统计
- 聊天输入与消息渲染

## 7.3 智能体管理模块

核心文件：

- `src/stores/agent.ts`
- `src/views/agents/AgentsPage.vue`

职责：

- 创建智能体
- 编辑 identity/model/tools
- 展示多智能体统计
- 作为 Office / MyWorld / Session 的基础数据源

## 7.4 Office / Wizard 协作模块

核心文件：

- `src/stores/office.ts`
- `src/stores/wizard.ts`
- `src/components/office/*`
- `server/database.js`
- `server/index.js` 中 `/api/wizard/*`

职责：

- 场景管理
- 任务委派
- 团队/角色协作
- 本地持久化 scenarios/tasks

说明：

- 这是当前项目中最强业务态模块
- 同时具备“管理后台”与“可视化协作产品原型”双重属性

## 7.5 文件与记忆管理模块

核心文件：

- `src/stores/memory.ts`
- `src/views/memory/MemoryPage.vue`
- `src/views/files/FilesPage.vue`
- `server/index.js` 文件 API

职责：

- 浏览工作区文件
- 维护 AGENTS / SOUL / USER / MEMORY 等文档
- 文件上传、编辑、删除、重命名
- 图片/PDF 等媒体访问

## 7.6 远程终端与远程桌面模块

核心文件：

- `src/views/terminal/TerminalPage.vue`
- `src/views/remote-desktop/*`
- `server/index.js` 中 `/api/terminal/*`、`/api/desktop/*`

职责：

- 终端 PTY 创建与输入输出
- Linux 虚拟桌面创建
- FFmpeg/X11 截图流输出
- 鼠标键盘事件注入

这个模块使 Admin 从“管理台”扩展成了“运维控制台”。

## 7.7 备份恢复模块

核心文件：

- `src/stores/backup.ts`
- `src/views/backup/BackupPage.vue`
- `server/index.js` 备份恢复逻辑

职责：

- 执行 OpenClaw backup
- 备份本项目 SQLite 与 `.env`
- 生成 zip 包
- 恢复 OpenClaw 数据与本项目配置

说明：

- 这是一个强运维特征模块
- 同时操作本项目数据与 OpenClaw 主数据目录

---

## 8. 关键数据流 / 通信方式

## 8.1 浏览器到后端

### HTTP

用于：

- 登录认证
- 文件读写
- 配置读写
- backup/restore
- wizard/task CRUD
- terminal/desktop 控制指令

### SSE

用于：

- `/api/events`：全局事件流
- `/api/terminal/stream`：终端输出流
- `/api/desktop/stream`：桌面帧流

说明：

- 当前项目大量实时能力选择 SSE，而不是浏览器端直接 WebSocket
- 这降低了浏览器实现复杂度，但会让后端承担更多长连接管理责任

## 8.2 后端到 Gateway

### WebSocket RPC

由 `server/gateway.js` 建立到 OpenClaw Gateway 的长连接。

承担：

- `connect` 握手
- `status`
- `system-presence`
- 各类 operator.read / operator.write / operator.admin 调用
- event 广播

这是整个系统最关键的“上游控制面”链路。

## 8.3 本地系统调用

后端还直接与主机系统交互：

- `node-pty`：shell 终端
- `spawn/execSync`：系统命令
- `ffmpeg` / `Xvfb` / `x11vnc` / `xdotool`
- `openclaw backup create`
- 文件系统读写

说明：

- 这部分不是纯业务 API，而是“系统代理层”
- 能力强，但也意味着更高的安全与稳定性要求

---

## 9. 部署架构 / 构建产物 / systemd 关系

## 9.1 构建链路

### 开发模式

- 前端：`npm run dev`
- 后端：`npm run dev:server`
- 联调：`npm run dev:all`

开发时：

- Vite dev server 使用 `DEV_PORT`
- 后端使用 `PORT`
- Vite 对 `/api` 代理到后端

### 生产模式

- `npm run build`
- `vue-tsc -b && vite build`
- 构建产物输出到 `dist/`
- `npm run start` 启动 `server/index.js`

## 9.2 运行链路

生产部署当前为：

```text
systemd(openclaw-admin.service)
  → node server/index.js
    → Express
      ├─ /api/*
      └─ dist/* 静态资源与 SPA fallback
```

### 当前 systemd 配置

```ini
[Service]
WorkingDirectory=/root/.openclaw/lavain-ai/project/openclaw-admin/OpenClaw-Admin
ExecStart=/usr/bin/node /root/.openclaw/lavain-ai/project/openclaw-admin/OpenClaw-Admin/server/index.js
Restart=always
User=root
Environment=NODE_ENV=production
```

## 9.3 线上静态资源与动态分包关系

- 路由页面大量使用 `import()` 动态加载
- 产物位于 `dist/assets/*`
- Express 通过 `express.static(distPath)` 暴露
- 非 `/api` 路径统一 fallback 到 `dist/index.html`

### 关键运维事实

2026-04 发生过一次实际故障：

- 项目目录迁移到新路径后
- `systemd` 仍指向旧路径
- 运行进程尝试读取旧目录下的 `dist/index.html`
- 导致首页访问 500
- 同时也影响路由切换与动态分包加载稳定性

因此：

> **部署的真实可用性不只取决于代码本身，也取决于 systemd / WorkingDirectory / ExecStart / dist 路径是否同步更新。**

---

## 10. 核心依赖关系总结

## 10.1 前端依赖后端的方式

前端基本不直接接外部系统，绝大多数能力都依赖本项目后端：

- 配置读取：后端 API
- 会话与智能体：通过后端转 Gateway RPC
- 文件访问：后端 API
- 终端桌面：后端流接口
- backup/restore：后端执行

## 10.2 后端依赖上游的方式

后端依赖三类外部资源：

1. **OpenClaw Gateway**
   - 控制面能力来源
2. **本机系统环境**
   - 终端、远程桌面、备份命令
3. **本地文件系统与 SQLite**
   - 场景任务、配置、静态产物、备份文件

这三类任一异常，都会影响 Admin 的一部分能力。

---

## 11. 当前已知技术债 / 风险点

## 11.1 `server/index.js` 单文件过大

当前后端主入口承载：

- auth
- config
- rpc proxy
- files
- terminal
- desktop
- wizard
- backup
- static hosting

这会带来：

- 修改风险高
- 测试粒度差
- 代码可读性下降
- 局部问题容易波及全局

建议：逐步拆为 `routes/`, `services/`, `infrastructure/`。

## 11.2 SQLite 没有正式 migration 体系

当前是：

- 启动时建表
- try/catch 补列

风险：

- 版本升级不可追踪
- 结构演进不可审计
- 多环境一致性差

## 11.3 前端 chunk 仍然偏大

实际构建已经出现 Vite 警告：

- 构建产物中有 chunk 超过 500 kB
- 总产物体积较大（此前构建日志显示约 2.5MB，gzip 后仍较大）

影响：

- 首屏与弱网体验受影响
- 动态分包失败时定位成本高

## 11.4 认证机制偏轻量

风险点：

- session 存内存
- 服务重启后登录态失效
- 缺少用户/角色/审计体系
- root 进程 + 管理台操作权限较高

## 11.5 root 用户运行 systemd 服务

当前 `User=root`，使后端天然拥有较高主机权限。

优点：

- 便于调用系统命令、文件、终端、远程桌面

风险：

- 任意代码路径 bug 的影响面更大
- 文件/命令类 API 安全边界压力更大

## 11.6 文件系统能力与系统能力耦合较重

当前同一后端进程同时承担：

- UI API
- 系统命令
- 文件操作
- 终端桌面流
- Backup/Restore

这意味着：

- 一个高负载模块可能拖慢整体
- 长连接与重 IO 场景更难隔离故障

## 11.7 部署路径变更敏感

此次实际故障已证明：

- 代码目录迁移
- `systemd` 路径未同步
- 线上就会直接故障

说明部署目前**强依赖绝对路径一致性**，缺少发布抽象层。

---

## 12. 后续扩展建议

## 12.1 后端按领域拆模块

建议把 `server/index.js` 拆成：

```text
server/
├─ app.js                 # express app 装配
├─ routes/
│  ├─ auth.js
│  ├─ config.js
│  ├─ files.js
│  ├─ terminal.js
│  ├─ desktop.js
│  ├─ wizard.js
│  ├─ backup.js
│  └─ rpc.js
├─ services/
│  ├─ gateway-service.js
│  ├─ file-service.js
│  ├─ terminal-service.js
│  ├─ desktop-service.js
│  ├─ backup-service.js
│  └─ wizard-service.js
└─ infrastructure/
   ├─ db/
   ├─ env/
   └─ system/
```

## 12.2 建立数据库 migration 机制

建议引入：

- drizzle / knex / umzug / 自定义 migration runner

目标：

- 结构变更可追踪
- 升级可回放
- 便于多环境维护

## 12.3 拆分高风险系统能力

可考虑把以下能力独立成服务或 worker：

- terminal
- remote-desktop
- backup/restore

这样可降低主管理 API 被重任务拖慢的风险。

## 12.4 增加部署抽象层

建议：

- 固定 `current -> releases/<timestamp>` 软链发布
- systemd 永远指向 `current`

这样目录迁移不会直接打爆服务。

## 12.5 增强观测性

建议补充：

- 结构化日志
- request id / task id
- systemd journal 与应用日志统一检索方式
- backup / desktop / terminal 独立日志分类

## 12.6 前端继续做按领域拆包

优先处理：

- Office
- MyWorld
- Models
- Chat

并继续降低主入口聚合依赖。

## 12.7 补测试分层

当前已有 Vitest / Playwright 依赖，但从现状看仍应补：

- store 层单测
- route 级 smoke test
- 关键 API 的后端集成测试
- deploy smoke checklist

---

## 13. 当前架构结论

OpenClaw Admin 当前已经不是“单纯的 Web 前端”，而是一个：

> **以 Express 为核心、向上连接 OpenClaw Gateway、向下连接本机系统能力、前端以 Vue + Pinia 组织的单体运维控制台 / 管理后台。**

它的优势是：

- 功能集中
- 运维能力强
- 适合快速迭代
- 能覆盖 OpenClaw 日常管理、可视化协作、远程运维等多种场景

它的主要问题是：

- 服务端入口过于集中
- 系统能力与业务能力耦合偏重
- 部署对路径和环境一致性非常敏感
- 需要更正式的迁移、测试、发布与观测机制

因此，当前阶段最合理的演进方向不是“推翻重做”，而是：

1. **先保持单体可用**
2. **逐步按领域拆模块**
3. **先补可维护性，再补复杂能力**

---

## 14. 关联文档

- `PROJECT.md`：项目定位与基础信息
- `README.md`：功能说明与使用介绍
- `docs/async-architecture.md`：前端异步架构规范
- `docs/ASYNC-MIGRATION-GUIDE.md`：异步架构迁移说明
- `/etc/systemd/system/openclaw-admin.service`：当前生产部署服务配置

---

## 15. 最近一次架构确认

- **确认时间：** 2026-04-04
- **确认背景：** 目录迁移后线上 500 故障、systemd 路径修复、补充长期维护架构文档
- **确认结论：** 当前线上架构仍为单体部署，systemd 已切换到新路径，文档与部署路径需要持续保持一致
