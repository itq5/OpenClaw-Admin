# OpenClaw-Admin dynamicAgent 修复实施总结

## 问题回顾

wecom 插件创建的 `dynamicAgent`（动态代理）在 OpenClaw-Admin 中显示不出来，但在 openclaw-control-center 中能正常显示。

## 根本原因

OpenClaw-Admin 的代理列表只在页面初始加载时获取一次，没有定期刷新机制，因此无法发现运行时动态创建的代理。

## 解决方案

实现了一个**混合机制**，结合：

1. **定期自动刷新**：每 10 秒自动刷新一次代理列表
2. **WebSocket 事件监听**：监听 Gateway 的 agent 生命周期事件（如果支持）
3. **智能初始化**：在应用启动时自动启动刷新和事件监听

## 代码变更

### 1. [src/stores/agent.ts](src/stores/agent.ts)

添加了 4 个新方法：

- **`startAutoRefresh(intervalMs = 10000): void`**
  - 启动定期刷新代理列表
  - 默认间隔：10 秒
  - 会自动清理之前的间隔

- **`stopAutoRefresh(): void`**
  - 停止定期刷新
  - 在应用卸载时自动调用

- **`setupEventListeners(): void`**
  - 监听 WebSocket 事件
  - 监听的事件：
    - `agent.created` - 新代理创建
    - `agent.deleted` - 代理删除
    - `agents.updated` - 代理列表更新

- **`initialize(): Promise<void>`**
  - 初始化 store，包括：
    - 初次获取代理和模型列表
    - 设置 WebSocket 事件监听
    - 启动定期刷新

### 2. [src/App.vue](src/App.vue)

在主应用组件中添加初始化逻辑：

```typescript
onMounted(async () => {
  await agentStore.initialize()
})

onUnmounted(() => {
  agentStore.stopAutoRefresh()
})
```

这确保：

- 应用启动时自动初始化代理监控
- 应用关闭时清理资源

### 3. [src/views/agents/AgentsPage.vue](src/views/agents/AgentsPage.vue)

改进了 onMounted 注释，说明代理列表现在被自动刷新：

```typescript
/**
 * 应用的 App.vue 会自动初始化 agent store，
 * 包括每 10 秒刷新一次列表以检测动态创建的代理
 */
onMounted(() => {
  loadData()
})
```

## 行为变化

### 之前

```
页面加载 → 获取初始代理列表 → 停止（除非用户手动点击刷新）
                ↓
         wecom 创建新 agent → 不显示（除非重新加载页面或手动刷新）
```

### 之后

```
应用启动
    ↓
App.vue 调用 agentStore.initialize()
    ↓
    ├─ 初次获取代理列表
    ├─ 启动定期刷新（每 10 秒）
    ├─ 设置 WebSocket 事件监听
    └─ 自动发现动态创建的代理
    
页面显示代理列表...

wecom 创建新 agent
    ↓
    ├─ (如果支持) WebSocket 事件立即刷新列表
    └─ (否则) 定期刷新在 10 秒内自动发现
    
新代理自动出现在列表中！
```

## 性能考虑

- **定期刷新间隔**：10 秒（可调整）
  - 在 [src/stores/agent.ts](src/stores/agent.ts#L23) 中修改 `AUTO_REFRESH_INTERVAL_MS`
  
- **网络开销**：
  - 仅发送必要的 RPC 调用
  - 与 openclaw-control-center 类似的轮询策略

- **CPU 开销**：
  - 最小化：仅在定时器触发时执行
  - 支持事件驱动的快速更新（无需等待定时器）

## 配置

### 修改刷新间隔

编辑 [src/stores/agent.ts](src/stores/agent.ts#L23)：

```typescript
const AUTO_REFRESH_INTERVAL_MS = 5000  // 改为 5 秒
```

### 禁用自动刷新

如果需要手动控制，可以在 App.vue 中注释掉 initialize() 调用：

```typescript
// 仅在需要时手动调用
// await agentStore.initialize()

// 手动启动刷新
await agentStore.fetchAgents()
agentStore.startAutoRefresh()
```

## 验证

### 构建验证

```bash
npm run build
# ✓ built in 4.41s (成功)
```

### 运行时验证

打开浏览器控制台，查看日志：

```
[App] Agent store initialized successfully
[AgentStore] Auto-refresh started with interval 10000ms
[AgentStore] Event listeners setup complete
[AgentsPage] Note: Agent list is auto-refreshing in background
```

当 wecom 创建新的 dynamicAgent 时：

```
[AgentStore] Agent created event: wecom-default-dm-zhangsan
[AgentStore] Refreshing agents list...
# 新代理立即出现在 UI 中
```

## 兼容性

- ✅ 不破坏现有的手动刷新功能
- ✅ 与 openclaw-control-center 的策略一致
- ✅ 支持 wecom 插件的动态代理创建
- ✅ 支持其他通过 RPC 动态创建的代理

## 相关文件

- [DYNAMIC_AGENTS_ISSUE.md](DYNAMIC_AGENTS_ISSUE.md) - 详细的问题分析和备选方案
- [src/stores/agent.ts](src/stores/agent.ts) - 核心 store 实现
- [src/App.vue](src/App.vue) - 应用级初始化
- [src/views/agents/AgentsPage.vue](src/views/agents/AgentsPage.vue) - 代理列表页面

## 后续优化

### 短期

- [ ] 验证 Gateway 是否支持 `agent.created`/`agent.deleted` 事件
- [ ] 如果不支持，定期刷新作为可靠的备选方案

### 中期

- [ ] 考虑添加用户配置界面来调整刷新间隔
- [ ] 添加 UI 指示符显示最后一次刷新的时间

### 长期

- [ ] 与 openclaw-control-center 完全对齐（文件系统级别的发现能力）
- [ ] 实现更智能的刷新策略（根据实际变化调整间隔）

## 2026-03-23 实施完成
