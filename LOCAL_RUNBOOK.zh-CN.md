# OpenClaw-Admin 本机运行手册

这份手册记录了当前这台 Windows 机器上已经真实跑通、验证过的 OpenClaw-Admin 本地使用路径。

目标是：

- 先稳定用起来
- 连接现有 Gateway
- 能登录后台并看到真实数据
- 不要求先进入二次开发模式

这份手册以当前机器、当前仓库状态和已经完成的实机验证为准。

## 1. 当前确认状态

- 仓库目录：`F:\新会话\OpenClaw-Admin`
- 后台访问地址：`http://localhost:3000`
- Gateway 地址：`ws://localhost:18789`
- 预留开发端口：`3002`
- 当前启动方式：本地生产式启动
- 当前验证结果：
  - `npm run build` 通过
  - `npm test` 通过，当前为 `38 files / 321 tests`
  - `http://localhost:3000/` 返回 `200`
  - `/api/health` 返回 `gateway: connected`
  - 后台登录、仪表盘、设置页、系统页、远程桌面页、MyWorld 页均已做过真实验证

## 2. 环境要求

当前机器上已经具备：

- Node.js
- npm
- 可用的 OpenClaw Gateway

本机已验证过的关键条件：

- `node` 可运行
- `npm` 可运行
- `localhost:18789` 有 Gateway 监听
- `3001` 不作为本次默认端口使用

## 3. 目录与隔离约定

建议保持下面这个目录结构，不要把 OpenClaw-Admin 并入别的工作区项目：

```text
F:\新会话\OpenClaw-Admin
```

这样做的好处：

- 避免和其他 Node 项目互相污染 `node_modules`
- 避免误占用已有 `3001`
- 故障定位更直接

## 4. `.env` 约定

本机当前验证通过的配置键如下：

```dotenv
VITE_APP_TITLE=OpenClaw-Admin
OPENCLAW_WS_URL=ws://localhost:18789
OPENCLAW_AUTH_TOKEN=<当前 Gateway token>
OPENCLAW_AUTH_PASSWORD=<若使用 Gateway 密码则填写，否则留空>
PORT=3000
DEV_PORT=3002
AUTH_USERNAME=<后台登录用户名>
AUTH_PASSWORD=<后台登录密码>
LOG_LEVEL=INFO
```

注意：

- 不要把真实 token 或密码写进文档、截图或提交记录
- `OPENCLAW_AUTH_TOKEN` 和 `AUTH_PASSWORD` 目前都已经做过真实清空/恢复演练
- 设置页现在不会回显 secret 明文
- 设置页现在支持：
  - 留空保持原值
  - 勾选后显式清空
  - 输入新值后覆盖原值

## 5. 首次安装与启动

在 PowerShell 中执行：

```powershell
cd F:\新会话\OpenClaw-Admin
npm install
npm run build
npm run start
```

然后访问：

```text
http://localhost:3000
```

说明：

- 这里默认走构建后启动，而不是 `npm run dev`
- 这样可以避开当前机器上已有服务对 `3001` 的占用
- 这也是当前已经完成实机验证的路径

## 6. 日常启动

如果依赖已经装好，日常只需要：

```powershell
cd F:\新会话\OpenClaw-Admin
npm run build
npm run start
```

如果只是重启服务，一般不必重复 `npm install`。

## 7. 验收标准

下面 5 项全部满足，才算本机跑通：

1. 依赖安装成功，没有卡在 `better-sqlite3` 或 `node-pty` 本地编译错误
2. `http://localhost:3000` 能打开登录页
3. 使用 `.env` 中的后台用户名和密码能成功登录
4. `/api/health` 中 `gateway` 为 `connected`
5. 仪表盘、用户页、通知页、文件页或设置页能看到真实数据，而不是空白页或持续断开

## 8. 常用验证命令

### 8.1 服务健康检查

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

期望结果包含：

```json
{"ok":true,"gateway":"connected"}
```

### 8.2 鉴权是否开启

```powershell
Invoke-RestMethod http://localhost:3000/api/auth/config
```

期望结果：

```json
{"enabled":true}
```

### 8.3 全量测试

```powershell
cd F:\新会话\OpenClaw-Admin
npm test
```

当前已验证结果：

```text
31 files / 309 tests passed
```

### 8.4 生产构建

```powershell
cd F:\新会话\OpenClaw-Admin
npm run build
```

### 8.5 检查端口监听

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,18789
```

期望看到：

- `3000` 被 OpenClaw-Admin 占用
- `18789` 被 Gateway 占用

## 9. 当前已完成的关键修复

这台机器上的当前仓库，已经包含并验证过下面这些关键修复：

- 文件 API 中异步 `safePath()` 已全部改为 `await`，避免运行时路径错误
- `/api/auth/config` 不再泄露 secret 值
- 登录态与前端 RBAC 已同步，管理员页面不再被误拦截
- `RoleTag` 已修复错误的 i18n key
- 设置页 secret 管理已收口：
  - 不回显明文
  - 留空保持原值
  - 支持显式清空
  - 支持输入后覆盖
- `OPENCLAW_AUTH_TOKEN` 已做过真实清空/恢复演练，确认会触发 Gateway 断开并可恢复重连
- `AUTH_PASSWORD` 已做过真实清空/恢复演练，确认会短时关闭登录保护并可恢复

## 10. 设置页的安全语义

设置页现在的行为如下：

- 已配置的 secret 不再显示原值
- 如果输入框留空且不勾选清空：
  - 保存后保持原值不变
- 如果输入新值：
  - 保存后覆盖原值
- 如果勾选“保存时清空当前值”：
  - 保存后清空该 secret

这套行为已经做过：

- 单元测试验证
- 浏览器 UI 实测
- 真实接口验证
- 真实运行态清空/恢复演练

## 11. 开发模式说明

当前优先路径不是开发模式。

如果确实要切到开发模式，建议使用：

```dotenv
PORT=3000
DEV_PORT=3002
```

然后访问：

```text
http://localhost:3002
```

如果开发模式下出现跨域问题，再考虑补充：

```dotenv
DEV_FRONTEND_URL=http://localhost:3002
ALLOWED_ORIGINS=http://localhost:3002,http://localhost:10001
```

## 12. 常见故障处理

### 12.1 `3000` 被占用

做法：

- 只改 `.env` 中的 `PORT`
- 然后重新执行 `npm run start`

不要为了换端口去改源码。

### 12.2 `3001` 被别的服务占用

这是当前机器上的已知现状，不影响本手册路径。

处理方式：

- 不使用 README 里的默认开发端口设定
- 继续使用 `PORT=3000`
- 开发模式统一改走 `DEV_PORT=3002`

### 12.3 `npm install` 在 Node 24 下失败

如果卡在本地编译依赖上，不要长时间硬耗。

建议：

1. 先记录报错点
2. 切换到 Node 20 LTS
3. 重新执行 `npm install`

### 12.4 Gateway 显示断开

优先检查：

1. `localhost:18789` 是否仍在监听
2. `.env` 中的 `OPENCLAW_WS_URL` 是否正确
3. `.env` 中的 `OPENCLAW_AUTH_TOKEN` 是否正确
4. `/api/health` 中 `gateway` 是否为 `disconnected`

如果是 token 错误，后端会保持启动，但 Gateway 会连不上。

### 12.5 设置页保存后表现异常

优先确认：

- 是否只是留空导致“保持原值”
- 是否误勾选了“保存时清空当前值”
- 是否真的输入了新 secret

## 13. Windows 机器上的特殊注意事项

这台机器有一个实际踩过的坑：

- 某些 Node 进程在处理带中文的绝对路径时，可能把 `F:\新会话\...` 误识别成 `F:\???\...`

因此建议：

- Node 脚本里优先使用相对路径或 `process.cwd()`
- 临时文件尽量写到 ASCII 路径
- 浏览器自动化状态文件如果必须落盘，优先放到允许目录下并在验证后清空

## 14. 运行日志位置

当前本机排障时常用的日志位置：

```text
C:\Windows\Temp\openclaw-admin-stdout-secure-2.log
C:\Windows\Temp\openclaw-admin-stderr-secure-2.log
```

如果重启过服务，日志文件名可能变化，但通常都在这个目录下。

## 15. 本次收尾后的结论

截至当前状态，可以把 OpenClaw-Admin 在这台机器上的结论视为：

- 已经可以本机稳定启动
- 已经可以连接当前 Gateway
- 已经可以后台登录并看到真实数据
- 关键权限页已经可正常进入
- 设置页 secret 管理已经完成安全收口
- 关键运行链路已经做过 live 演练，不再只是“理论上可行”

如果下一步继续推进，优先级建议如下：

1. 把这份本地运行手册继续和团队文档同步
2. 继续扩大真实页面 smoke 覆盖范围
3. 如果要进入开发模式，再单独整理前后端分离调试说明
