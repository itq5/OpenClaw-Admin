# OpenClaw Admin

## 项目定位

- **项目名称：** OpenClaw Admin
- **项目根目录：** `~/.openclaw/lavain-ai/project/openclaw-admin`
- **代码目录：** `~/.openclaw/lavain-ai/project/openclaw-admin/OpenClaw-Admin`
- **线上地址：** `https://admin-openclaw.codingshen.top`
- **代码来源：** https://github.com/Alex-Shen1121/OpenClaw-Admin（fork 自 itq5/OpenClaw-Admin）
- **当前分支：** `my-release`
- **负责人：** Musk（开发）
- **状态：** 已部署运行，处于持续二开与维护阶段

## 项目简介

OpenClaw Admin 是 OpenClaw Gateway 的 Web 管理控制台，用来把原本偏命令行 / 配置文件驱动的能力，转成可视化后台。它覆盖智能体、会话、模型、频道、技能、任务计划、系统监控、远程终端等核心管理能力，是当前 Lavain AI 的基础运维与管理后台。

## 核心目标

- 给 OpenClaw 提供统一的 Web 管理入口
- 降低多智能体系统的配置和运维门槛
- 提供会话、模型、渠道、技能的集中管理能力
- 提供终端、文件、系统状态等远程运维能力
- 为后续虚拟公司 / 智能体工坊等协作场景提供后台支撑

## 主要功能模块

- 登录认证
- 仪表盘 / 运行总览
- 在线对话
- 会话管理
- 记忆文档管理（AGENTS / SOUL / USER / IDENTITY 等）
- Cron 计划任务
- 模型管理
- 频道管理
- 技能管理
- 多智能体管理
- 智能体工坊（Office）
- 虚拟公司（MyWorld）
- 远程终端
- 远程桌面
- 文件浏览器
- 系统监控
- 系统设置

## 技术栈

### 前端
- Vue 3
- TypeScript
- Vite
- Vue Router
- Pinia
- Naive UI
- Font Awesome / Ionicons

### 后端
- Node.js
- Express
- better-sqlite3
- ws（WebSocket）
- SSE
- node-pty
- ssh2
- multer

### 测试与开发
- Vitest
- Vue Test Utils
- Playwright
- concurrently

## 运行方式

### 本地开发
- 前端开发：`npm run dev`
- 后端开发：`npm run dev:server`
- 前后端联调：`npm run dev:all`

### 生产构建
- 构建：`npm run build`
- 启动：`npm run start`

### 部署
- 当前采用 `systemd` 服务 `openclaw-admin` 运行
- 部署时必须保证工作目录、启动路径、静态资源路径与项目实际目录一致

## 当前已知项目事实

- 项目根目录是：`~/.openclaw/lavain-ai/project/openclaw-admin`
- 代码目录是：`~/.openclaw/lavain-ai/project/openclaw-admin/OpenClaw-Admin`
- 项目文档与架构文档应放在项目根目录下，不应继续混放在代码目录
- 文件夹规则：代码统一放在 `OpenClaw-Admin/`；项目总说明放 `PROJECT.md`；架构、迁移、规范类文档统一放项目根目录下的 `docs/`
- 旧路径 `~/.openclaw/lavain-ai/project/OpenClaw-Admin` 已不应再作为部署基准
- 2026-04 出现过一次因目录迁移后 `systemd` 仍指向旧路径而导致的 500 故障
- 后续凡是部署、构建、服务脚本、文档更新，都必须明确区分项目根目录、代码目录与文档目录

## 协作要求

- 开发、修复、重构由 Musk 负责
- 产品需求与功能边界由 Claire 负责
- 设计规范与 UI 还原由 Lily 负责
- 运营、增长、面向用户的使用方案由 Janna 负责
- CEO 负责任务拆解、分派、跟进和验收

## 技术架构文档

- 项目总说明：`PROJECT.md`
- 主架构文档：`docs/TECH_ARCHITECTURE.md`
- 异步架构规范：`docs/async-architecture.md`
- 异步迁移说明：`docs/ASYNC-MIGRATION-GUIDE.md`

当前项目的长期维护应优先参考项目根目录下的文档区，而不是代码目录内的说明文件。`docs/TECH_ARCHITECTURE.md` 目前已覆盖：
- 整体架构概览
- 前端架构
- 后端架构
- 核心模块划分
- 关键数据流 / 通信方式
- 部署架构 / systemd / 构建产物关系
- 当前已知技术债 / 风险点
- 后续扩展建议

## 文档维护要求

当以下信息变化时，必须及时更新本文件：
- 项目路径
- 技术栈
- 部署方式
- 核心模块
- 负责人
- 线上地址
- 已知重要故障与运维注意事项
- 架构设计、部署链路、systemd 配置与构建产物关系
