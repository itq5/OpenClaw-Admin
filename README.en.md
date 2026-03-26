# OpenClaw Admin - AI Agent Management Platform

<p align="center">
  <strong>Modern AI Agent Gateway Management Console</strong>
</p>

<p align="center">
  <a href="https://github.com/itq5/OpenClaw-Admin">GitHub</a> •
  <a href="#features">Features</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#project-structure">Project Structure</a> •
  <a href="#development-guide">Development Guide</a>
</p>

---

## Introduction

OpenClaw Admin is a modern AI agent management platform built with Vue 3, providing a complete web management interface for OpenClaw Gateway. Through intuitive visual operations, users can easily manage AI agents, sessions, models, channels, skills, and other core functionalities.

### Key Highlights

- 🎯 **All-in-One Management**: Integrated agent management, session monitoring, model configuration, channel management, and more
- 🌐 **Multi-Channel Support**: Supports QQ, Feishu, DingTalk, WeCom, and other messaging channels
- 🤖 **Multi-Agent Collaboration**: Create and manage multiple AI agents for complex task coordination
- 📊 **Real-time Monitoring**: Real-time monitoring of system resources, session status, and token usage
- 🌍 **Internationalization**: Built-in Chinese and English support with seamless switching
- 🎨 **Modern UI**: Responsive design based on Naive UI with light/dark theme support

---

## Features

### Login

![Login](docs/images/登录.png)

- Username/password authentication
- Secure session management

### Dashboard

![Dashboard](docs/images/仪表盘.png)

- Runtime overview and key metrics display
- Token usage trend charts
- Session activity statistics
- Real-time event stream monitoring
- Top model/provider/tool distribution

### Live Chat

![Live Chat](docs/images/在线对话.png)

- Real-time chat interface
- Slash commands support (`/new`, `/skill`, `/model`, `/status`, `/subagents`)
- Message filtering and search
- Quick replies
- Real-time token usage statistics

### Sessions

![Sessions](docs/images/会话管理.png)

- Session list and detail view
- Session creation, reset, and deletion
- Multi-dimensional filtering and sorting
- Message history export

### Memory

![Memory](docs/images/记忆管理.png)

- Agent document management
- Edit core documents like AGENTS, SOUL, IDENTITY, USER
- Markdown editor
- Quick template snippet insertion

### Cron (Scheduler)

![Cron](docs/images/计划任务.png)

- Scheduled task creation and management
- Support for Cron expressions, fixed intervals, and specific times
- Task execution history
- Quick templates (morning report, health check, etc.)

### Models

![Models](docs/images/模型管理.png)

- Multi-model provider configuration
- Secure API key management (masked display)
- Model probing functionality
- Default model settings
- Coding quick setup

### Channels

![Channels](docs/images/频道管理.png)

- QQ, Feishu, DingTalk, WeCom channel configuration
- Channel status monitoring
- Secure credential management
- One-click installation and configuration

### Skills

![Skills](docs/images/技能管理.png)

- Skill plugin listing
- Bundled/user skill categorization
- Skill installation and updates
- Chat visibility control

### Agents

![Agents](docs/images/多智能体.png)

- Agent creation and management
- Identity, model, and tool permission configuration
- Session statistics and token usage
- Workspace file management

### Agent Workshop (Office)

![Agent Workshop 1](docs/images/智能体工坊-1.png)
![Agent Workshop 2](docs/images/智能体工坊-2.png)

- Multi-agent collaborative workspace
- Scenario creation wizard
- Task delegation and execution
- Inter-agent communication
- Team management

### Virtual Company (MyWorld)

![Virtual Company](docs/images/虚拟公司.png)

- Visualized office scene
- Character movement and interaction
- Area interaction features
- Real-time communication

### Remote Terminal

![Remote Terminal](docs/images/远程终端.png)

- SSE protocol remote terminal
- Multi-node support
- Fullscreen mode
- Custom shell and working directory

### Remote Desktop

![Remote Desktop](docs/images/远程桌面.png)

- Linux/Windows remote desktop
- Real-time screen streaming
- Mouse and keyboard operations
- Clipboard synchronization

### File Browser

![File Browser](docs/images/文件浏览器.png)

- Workspace file browsing
- File editing and preview
- File upload and download
- Directory management

### System Monitor

![System Monitor](docs/images/系统监视器.png)

- CPU, memory, disk usage
- Network connection status
- Instance online status
- Uptime statistics

### Settings

![Settings](docs/images/系统设置.png)

- Connection configuration management
- Appearance and theme settings
- Environment variable configuration

---

## Tech Stack

### Frontend Framework

| Technology | Version | Description |
|------------|---------|-------------|
| Vue | 3.5.x | Progressive JavaScript Framework |
| Vue Router | 4.x | Official Router |
| Pinia | 3.x | State Management |
| TypeScript | 5.x | Type-safe JavaScript Superset |
| Vite | 7.x | Next-generation Frontend Build Tool |

### UI Component Library

| Technology | Version | Description |
|------------|---------|-------------|
| Naive UI | 2.43.x | Vue 3 Component Library |
| @vicons/ionicons5 | 0.13.x | Icon Library |
| @fortawesome | 7.x | Font Awesome Icons |

### Communication & Data

| Technology | Version | Description |
|------------|---------|-------------|
| WebSocket | - | Real-time Bidirectional Communication |
| SSE | - | Server-Sent Events |
| markdown-it | 14.x | Markdown Parser |

### Backend Service

| Technology | Version | Description |
|------------|---------|-------------|
| Express | 5.x | Node.js Web Framework |
| ws | 8.x | WebSocket Implementation |
| better-sqlite3 | 12.x | SQLite Database |
| node-pty | 1.x | Pseudo Terminal Support |
| ssh2 | 1.x | SSH Client |

### Terminal Related

| Technology | Version | Description |
|------------|---------|-------------|
| @xterm/xterm | 6.x | Terminal Emulator |
| @xterm/addon-fit | 0.11.x | Terminal Auto-fit |
| @xterm/addon-web-links | 0.12.x | Link Support |

---

## Quick Start

### Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0

### Install Dependencies

```bash
npm install
```

### Development Mode

Start frontend development server:

```bash
npm run dev
```

Start backend server:

```bash
npm run dev:server
```

Start both frontend and backend:

```bash
npm run dev:all
```

Visit `http://localhost:3000` to access the management interface.

### Production Build

```bash
npm run build
```

### Preview Build Result

```bash
npm run preview
```

---

## Project Structure

```
openclaw-admin/
├── src/
│   ├── api/                    # API Layer
│   │   ├── types/              # TypeScript Type Definitions
│   │   ├── connect.ts          # Connection Management
│   │   ├── rpc-client.ts       # RPC Client
│   │   └── websocket.ts        # WebSocket Wrapper
│   │
│   ├── assets/                 # Static Assets
│   │   └── styles/
│   │       └── main.css        # Global Styles
│   │
│   ├── components/             # Components
│   │   ├── common/             # Common Components
│   │   ├── layout/             # Layout Components
│   │   └── office/             # Office Scene Components
│   │
│   ├── composables/            # Composables
│   │   ├── useEventStream.ts   # Event Stream
│   │   ├── useResizable.ts     # Resize Handling
│   │   └── useTheme.ts         # Theme Management
│   │
│   ├── i18n/                   # Internationalization
│   │   ├── messages/
│   │   │   ├── zh-CN.ts        # Chinese
│   │   │   └── en-US.ts        # English
│   │   └── index.ts
│   │
│   ├── layouts/                # Layouts
│   │   └── DefaultLayout.vue
│   │
│   ├── router/                 # Router
│   │   ├── index.ts
│   │   └── routes.ts
│   │
│   ├── stores/                 # Pinia State Management
│   │   ├── agent.ts            # Agent
│   │   ├── auth.ts             # Authentication
│   │   ├── channel.ts          # Channel
│   │   ├── chat.ts             # Chat
│   │   ├── config.ts           # Configuration
│   │   ├── cron.ts             # Scheduled Tasks
│   │   ├── memory.ts           # Memory
│   │   ├── model.ts            # Model
│   │   ├── session.ts          # Session
│   │   ├── skill.ts            # Skill
│   │   ├── terminal.ts         # Terminal
│   │   ├── theme.ts            # Theme
│   │   ├── websocket.ts        # WebSocket
│   │   └── ...
│   │
│   ├── utils/                  # Utilities
│   │   ├── channel-config.ts
│   │   ├── format.ts
│   │   ├── markdown.ts
│   │   └── secret-mask.ts
│   │
│   ├── views/                  # Page Views
│   │   ├── agents/             # Multi-Agent
│   │   ├── channels/           # Channel Management
│   │   ├── chat/               # Live Chat
│   │   ├── cron/               # Scheduler
│   │   ├── memory/             # Memory Management
│   │   ├── models/             # Model Management
│   │   ├── sessions/           # Session Management
│   │   ├── skills/             # Skill Management
│   │   ├── system/             # System Monitor
│   │   ├── terminal/           # Remote Terminal
│   │   ├── remote-desktop/     # Remote Desktop
│   │   ├── files/              # File Browser
│   │   ├── office/             # Agent Workshop
│   │   ├── myworld/            # Virtual Company
│   │   ├── monitor/            # Operations Center
│   │   ├── settings/           # Settings
│   │   ├── Dashboard.vue       # Dashboard
│   │   └── Login.vue           # Login Page
│   │
│   ├── App.vue                 # Root Component
│   ├── main.ts                 # Entry Point
│   └── env.d.ts                # Environment Type Declarations
│
├── server/                     # Backend Service
│   ├── index.js                # Server Entry
│   ├── gateway.js              # Gateway Connection
│   └── database.js             # Database Operations
│
├── public/                     # Public Static Assets
├── dist/                       # Build Output
├── data/                       # Data Storage
│
├── vite.config.ts              # Vite Configuration
├── tsconfig.json               # TypeScript Configuration
├── package.json                # Project Configuration
├── .env.example                # Environment variable template
└── .env                        # Local environment variables copied from .env.example
```

---

## Development Guide

### Code Style

- Use Vue 3 Composition API + `<script setup lang="ts">`
- Follow 2-space indentation, single quotes, trailing commas, no semicolons
- Use `@/` alias for `src` path imports

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase.vue | `ConnectionStatus.vue` |
| Route Pages | *Page.vue | `SessionsPage.vue` |
| Store | camelCase.ts | `session.ts` |
| Composable | use*.ts | `useTheme.ts` |

### Build Verification

Before committing, ensure:

```bash
npm run build
```

Build passes without type errors.

### Environment Variables

Copy the template first, then fill in your local values:

```bash
cp .env.example .env
```

Then configure your `.env` file:

```env
VITE_APP_TITLE=OpenClaw Admin
VITE_APP_VERSION=0.2.3
OPENCLAW_WS_URL=ws://localhost:18789
OPENCLAW_AUTH_TOKEN=
OPENCLAW_AUTH_PASSWORD=
PORT=3001
DEV_PORT=3000
DEV_FRONTEND_URL=http://localhost:3000
AUTH_USERNAME=
AUTH_PASSWORD=
MEDIA_DIR=
# OPENCLAW_HOME=/path/to/.openclaw

```

---

## API Reference

### WebSocket RPC Methods

The project communicates with OpenClaw Gateway via WebSocket, supporting the following RPC methods:

#### Configuration Management

- `config.get` - Get configuration
- `config.patch` - Update configuration
- `config.set` - Set configuration
- `config.apply` - Apply configuration

#### Session Management

- `sessions.list` - List sessions
- `sessions.get` - Get session details
- `sessions.reset` - Reset session
- `sessions.delete` - Delete session
- `sessions.spawn` - Create session
- `sessions.history` - Get history
- `sessions.usage` - Get usage statistics

#### Channel Management

- `channels.status` - Get channel status
- `channel.auth` - Channel authentication
- `channel.pair` - Channel pairing

#### Agent Management

- `agents.list` - List agents
- `agents.create` - Create agent
- `agents.update` - Update agent
- `agents.delete` - Delete agent
- `agents.files.list` - List files
- `agents.files.get` - Get file
- `agents.files.set` - Set file

#### Model Management

- `models.list` - List models

#### Scheduled Tasks

- `cron.list` - List jobs
- `cron.add` - Add job
- `cron.update` - Update job
- `cron.delete` - Delete job
- `cron.run` - Run job

#### System Monitoring

- `health` - Health check
- `status` - Status query
- `system-presence` - Instance presence
- `logs.tail` - Log tailing

---

## Security Notes

- ⚠️ **Never commit** real Gateway tokens, credentials, or other sensitive information
- Credential fields are masked and do not reveal plaintext
- API keys are only submitted when a new value is entered; otherwise, the original value is preserved

---

## License

[MIT License](LICENSE)

---

## Contributing

Issues and Pull Requests are welcome!

**GitHub Repository**: [https://github.com/itq5/OpenClaw-Admin](https://github.com/itq5/OpenClaw-Admin)

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

---

## Contact

### Author Email

📧 [root@itq5.com](mailto:root@itq5.com)

### WeChat Group

Join our WeChat group for the latest updates and technical support:

![WeChat Group](docs/images/微信群.png)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/itq5/OpenClaw-Admin">OpenClaw Admin</a> Team
</p>
