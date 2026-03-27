# dynamicAgent 在 OpenClaw-Admin 读取不到的问题分析

## 问题描述

wecom 插件创建的 `dynamicAgent`（动态代理）在 OpenClaw-Admin 中显示不出来，但在 openclaw-control-center 中能正常显示。

## 根本原因分析

### 1. OpenClaw-Admin 的实现方式

**当前流程：**

- [src/stores/agent.ts - fetchAgents()](src/stores/agent.ts#L54-L66)
  - 仅通过 RPC 调用 `wsStore.rpc.listAgents()` 获取代理列表
  - 获取的结果存储在 `agents.value` 中
  - 只在页面挂载时（onMounted）调用一次，或用户手动点击刷新按钮

- [src/views/agents/AgentsPage.vue - onMounted()](src/views/agents/AgentsPage.vue#L554-L556)
  - 仅在页面初始化时调用 `loadData()`
  - 之后不会自动刷新代理列表

**问题：**

- dynamicAgent 是在运行时动态创建的，不在初始的 `listAgents()` 响应中
- OpenClaw-Admin 没有定期刷新列表的机制
- 没有监听 WebSocket 事件来响应新 agent 的创建

### 2. openclaw-control-center 的实现方式

**当前流程：**

- [src/runtime/agent-roster.ts - loadBestEffortAgentRoster()](https://github.com/TianyiDataScience/openclaw-control-center/blob/main/src/runtime/agent-roster.ts#L23-L42)
  - 优先从 `openclaw.json` 中的 `agents.list` 读取代理列表
  - 如果配置为空，则扫描 `~/.openclaw/agents/*` 目录来发现所有代理

- [src/clients/openclaw-live-client.ts - loadSessionsFromStores()](https://github.com/TianyiDataScience/openclaw-control-center/blob/main/src/clients/openclaw-live-client.ts#L243-L259)
  - 实时扫描运行时目录 `~/.openclaw/agents` 获取最新的 agent 列表
  - 支持过滤已配置的代理，但同时能发现动态创建的代理

- [src/runtime/current-agent-catalog.ts - loadCurrentAgentCatalog()](https://github.com/TianyiDataScience/openclaw-control-center/blob/main/src/runtime/current-agent-catalog.ts#L19-L43)
  - 定期加载配置文件，既能读取静态配置的 agent，也能兼容动态 agent

**优势：**

- 通过文件系统扫描动态发现 agent
- 定期刷新（通过轮询机制）
- 既支持配置驱动，也支持运行时发现

## 解决方案

### 方案 A：添加定期刷新机制（推荐）

在 agent store 中添加一个定期刷新的机制：

```typescript
// src/stores/agent.ts
let refreshInterval: ReturnType<typeof setInterval> | null = null

function startAutoRefresh(intervalMs = 10000) {
  if (refreshInterval) clearInterval(refreshInterval)
  refreshInterval = setInterval(() => {
    fetchAgents().catch(e => console.error('[AgentStore] Auto-refresh failed:', e))
  }, intervalMs)
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

// 在应用初始化时启动
function initialize() {
  fetchAgents()
  startAutoRefresh(10000) // 每 10 秒刷新一次
}

return {
  // ... 现有的返回值
  startAutoRefresh,
  stopAutoRefresh,
  initialize
}
```

### 方案 B：添加 WebSocket 事件监听

监听 Gateway 的事件通知（如果支持）：

```typescript
// src/stores/agent.ts
import { watch } from 'vue'

function setupEventListeners() {
  // 监听可能的 agent.created 或相似事件
  wsStore.subscribe('agent.created', async () => {
    console.log('[AgentStore] New agent detected, refreshing list')
    await fetchAgents()
  })
  
  wsStore.subscribe('agent.deleted', async () => {
    console.log('[AgentStore] Agent deleted, refreshing list')
    await fetchAgents()
  })
}
```

### 方案 C：混合方案（最佳）

结合定期刷新 + 事件监听：

```typescript
// src/stores/agent.ts
export const useAgentStore = defineStore('agent', () => {
  // ... 现有代码
  
  let refreshInterval: ReturnType<typeof setInterval> | null = null
  
  // 事件监听
  function setupEventListeners() {
    wsStore.subscribe('agent.created', async () => {
      await fetchAgents()
    })
    wsStore.subscribe('agent.deleted', async () => {
      await fetchAgents()
    })
  }
  
  // 定期刷新（作为备用方案）
  function startAutoRefresh(intervalMs = 10000) {
    if (refreshInterval) clearInterval(refreshInterval)
    refreshInterval = setInterval(() => {
      fetchAgents().catch(e => {
        console.warn('[AgentStore] Auto-refresh failed:', e)
      })
    }, intervalMs)
  }
  
  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval)
      refreshInterval = null
    }
  }
  
  function initialize() {
    fetchAgents()
    setupEventListeners()
    startAutoRefresh(10000)
  }
  
  return {
    agents,
    defaultAgentId,
    mainKey,
    loading,
    error,
    lastUpdatedAt,
    models,
    methodUnknown,
    supportsAgents,
    agentStats,
    fetchAgents,
    fetchModels,
    addAgent,
    deleteAgent,
    setAgentIdentity,
    // ... 其他现有方法
    initialize,
    startAutoRefresh,
    stopAutoRefresh
  }
})
```

### 方案 D：实现文件系统扫描（与 openclaw-control-center 对齐）

如果后端支持，可以实现类似 openclaw-control-center 的发现机制：

```typescript
// src/api/rpc-client.ts
async function listAgentsWithRuntime() {
  // 1. 先获取配置的 agent
  const configAgents = await listAgents()
  
  // 2. 如果支持，也获取运行时发现的 agent
  const runtimeAgents = await rpc.call('agents.runtime.list')
  
  // 3. 合并（去重）
  const merged = new Map()
  configAgents.agents.forEach(a => merged.set(a.id, a))
  runtimeAgents.agents.forEach(a => merged.set(a.id, a))
  
  return { agents: Array.from(merged.values()) }
}
```

## 实施建议

### 短期修复（1-2 天）

使用方案 C（定期刷新 + 事件监听）：

1. 在 `src/stores/agent.ts` 中添加定期刷新逻辑
2. 在app初始化时调用 `agentStore.initialize()`
3. 在需要的地方调用 `stopAutoRefresh()` 清理

### 中期改进（1-2 周）

1. 检查 Gateway 是否支持 agent 相关事件
2. 如果支持，优先使用事件监听（比定期刷新效率高）
3. 如果不支持，保留定期刷新作为备选

### 长期优化（1-2 月）

考虑与 openclaw-control-center 对齐，实现文件系统级别的 agent 发现能力

## 相关文件

- [src/stores/agent.ts](src/stores/agent.ts) - Agent 状态管理
- [src/views/agents/AgentsPage.vue](src/views/agents/AgentsPage.vue) - 代理列表页面
- [src/stores/websocket.ts](src/stores/websocket.ts) - WebSocket 连接管理
- [AGENTS.md](AGENTS.md) - 项目架构指南

## 参考

- wecom 插件文档：<https://github.com/YanHaidao/wecom#14-dynamicagents-详细说明为什么生产环境建议开启>
- openclaw-control-center 实现：<https://github.com/TianyiDataScience/openclaw-control-center/blob/main/src/runtime/agent-roster.ts>
