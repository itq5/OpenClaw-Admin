# wecom dynamicAgent 在 OpenClaw-Admin 中的使用指南

## 概述

从 v0.2.3 开始，OpenClaw-Admin 已经实现了对 wecom 插件动态代理的实时支持。系统会自动检测并显示由 wecom 插件动态创建的代理。

## 快速开始

### 1. 确保 wecom 插件已启用并配置了 dynamicAgents

在 `~/.openclaw/openclaw.json` 中配置：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin"]
      }
    }
  }
}
```

### 2. 启动 OpenClaw-Admin

打开浏览器访问 `http://localhost:3001`

### 3. 查看"多智能体"页面

动态创建的代理会自动出现在 **多智能体 (Agents)** 页面上，不需要任何手动刷新操作。

## 工作原理

### 自动刷新流程

OpenClaw-Admin 使用两层机制来检测动态代理：

```
┌─────────────────────────────────────────┐
│  应用启动 (App.vue)                      │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  agentStore.initialize()                 │
│  ├─ 初次获取代理列表                     │
│  ├─ setupEventListeners()                │
│  │  └─ 监听 WebSocket 事件              │
│  └─ startAutoRefresh(10s)                │
│     └─ 每 10 秒获取一次列表             │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│  wecom 插件创建新 agent                  │
│  (例如: wecom-default-dm-zhangsan)      │
└────────────┬────────────────────────────┘
             │
    ┌────────┴──────┐
    │               │
    ▼               ▼
┌─────────┐   ┌──────────┐
│ WebSocket    │  定期刷新 │
│ 事件        │  (10s)    │
│ (立即)      │           │
└────┬────┘   └────┬─────┘
     │             │
     └─────┬───────┘
           │
           ▼
┌─────────────────────────────────────┐
│ agentStore 更新动态代理列表          │
└─────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ UI 自动刷新，显示新代理             │
└─────────────────────────────────────┘
```

### 两层检测机制的优势

1. **WebSocket 事件**（如果 Gateway 支持）
   - 立即检测到变化
   - 低延迟
   - 最有效率的方式

2. **定期刷新**（每 10 秒）
   - 作为备选方案
   - 确保最多 10 秒内发现任何新代理
   - 与 openclaw-control-center 保持一致

## 常见场景

### 场景 1：wecom 用户初次与机器人交互

```
时间线：
00:00  用户 zhangsan 发送消息到企业微信的 wecom 机器人
       ↓
00:01  wecom 插件创建 dynamicAgent: wecom-default-dm-zhangsan
       ↓
00:02  OpenClaw-Admin 通过 WebSocket 事件立即检测（或最迟在下一个刷新周期）
       ↓
00:03  新代理在"多智能体"页面显示
```

### 场景 2：多人同时使用机器人

```
时间线：
00:00  多个用户同时发送消息
       ↓
00:01  wecom 插件为每个用户创建独立的 dynamicAgent
       └─ wecom-default-dm-user1
       └─ wecom-default-dm-user2
       └─ wecom-default-dm-user3
       ↓
00:02  OpenClaw-Admin 自动发现所有新代理
       ↓
00:03  所有代理都显示在列表中
```

### 场景 3：群聊场景

```
时间线：
00:00  群聊发送消息
       ↓
00:01  wecom 插件创建 groupEnabled 的 dynamicAgent
       └─ wecom-default-group-[groupId]
       ↓
00:02  OpenClaw-Admin 自动发现
       ↓
00:03  群聊代理显示在列表中
```

## 常见问题

### Q: 为什么新代理不是立即显示？

A: 有两个可能的原因：

1. **WebSocket 事件不支持**：Gateway 没有发送 `agent.created` 事件
   - 解决方案：等待定期刷新（最多 10 秒）

2. **刷新间隔太长**：默认是 10 秒
   - 解决方案：手动点击"刷新"按钮，或修改 [src/stores/agent.ts](src/stores/agent.ts) 中的 `AUTO_REFRESH_INTERVAL_MS`

### Q: 可以禁用自动刷新吗？

A: 可以，但不推荐。如果必须禁用，可以：

编辑 [src/App.vue](src/App.vue)，注释掉：

```typescript
// await agentStore.initialize()
```

但这样就无法自动检测动态代理。

### Q: 自动刷新会影响性能吗？

A: 不会。

- 每 10 秒仅发送一个网络请求
- 仅在应用运行时执行（不会持续消耗资源）
- 与 openclaw-control-center 的策略相同

### Q: 如何修改刷新间隔？

A: 编辑 [src/stores/agent.ts](src/stores/agent.ts)，修改第 23 行：

```typescript
const AUTO_REFRESH_INTERVAL_MS = 5000  // 改为 5 秒，或其他值
```

然后重新编译：

```bash
npm run build
npm run dev
```

### Q: 新代理会自动与会话关联吗？

A: 是的。

wecom 插件创建的 dynamicAgent 已经包含了必要的配置。当会话通过该代理处理时，会自动关联。

## 故障排除

### 问题：即使启用了 dynamicAgents，新代理仍不显示

**检查清单：**

1. ✅ 确保 wecom 插件已启用

   ```bash
   openclaw plugins list
   # 应该显示 wecom 已启用
   ```

2. ✅ 检查 openclaw.json 中的 dynamicAgents 配置

   ```bash
   cat ~/.openclaw/openclaw.json | grep -A 5 dynamicAgents
   ```

3. ✅ 查看浏览器控制台，检查错误信息
   - 打开 DevTools (F12)
   - 查看 **Console** 标签
   - 搜索 `[AgentStore]` 或 `[App]`

4. ✅ 检查 Gateway 日志

   ```bash
   openclaw channels logs --channel wecom --lines 50
   ```

### 问题：浏览器控制台显示 `Auto-refresh started` 但列表没有更新

**可能原因：**

- Gateway 连接不稳定
- 代理创建失败（检查 wecom 日志）
- 权限问题

**解决方案：**

```bash
# 检查 Gateway 状态
openclaw status

# 查看 wecom 详细日志
openclaw channels logs --channel wecom --probe

# 检查是否有权限创建代理
openclaw agents list
```

### 问题：刷新间隔太频繁，导致网络请求过多

**解决方案：**

增加刷新间隔，编辑 [src/stores/agent.ts](src/stores/agent.ts)：

```typescript
const AUTO_REFRESH_INTERVAL_MS = 30000  // 改为 30 秒
```

## 最佳实践

### 1. 监控日志

在生产环境中，监控浏览器控制台和 Gateway 日志：

```bash
# 监控 Gateway wecom 日志
openclaw channels logs --channel wecom --follow

# 监控代理列表变化
openclaw agents list --watch
```

### 2. 调整刷新间隔以平衡延迟和负载

| 场景 | 推荐间隔 | 说明 |
|-----|---------|------|
| 高频用户交互 | 5-10 秒 | 快速检测，避免延迟 |
| 一般生产环境 | 10-15 秒 | 平衡延迟和负载 |
| 低频交互 | 30-60 秒 | 降低网络开销 |

### 3. 与管理员协调

如果禁用了 WebSocket 事件支持，提前告知用户可能需要等待最多 10 秒来看到新代理。

## 技术细节

### 实现位置

- **核心逻辑**：[src/stores/agent.ts](src/stores/agent.ts)
  - `startAutoRefresh()`
  - `setupEventListeners()`
  - `initialize()`

- **应用初始化**：[src/App.vue](src/App.vue)
  - onMounted → agentStore.initialize()
  - onUnmounted → agentStore.stopAutoRefresh()

- **页面逻辑**：[src/views/agents/AgentsPage.vue](src/views/agents/AgentsPage.vue)
  - 保持现有的手动刷新功能

### 监听的事件

```typescript
wsStore.subscribe('agent.created', ...)      // 新代理创建
wsStore.subscribe('agent.deleted', ...)      // 代理删除
wsStore.subscribe('agents.updated', ...)     // 通用更新事件
```

## 反馈和报告

如果遇到问题，请提供：

1. 浏览器控制台日志（包含 `[AgentStore]` 消息）
2. Gateway 日志（`openclaw channels logs --channel wecom`）
3. wecom 插件配置
4. 期望的行为 vs 实际行为

---

**最后更新**：2026-03-23 | **版本**：0.2.3+
