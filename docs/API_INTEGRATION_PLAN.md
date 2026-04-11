# Cron 可视化编辑器前后端联调方案

**创建时间**: 2026-04-11  
**作者**: 系统架构师 (小系)  
**版本**: v1.0

---

## 1. 现状分析

### 1.1 后端 API 审查结果

#### 已存在的后端 API

**批量操作 API** (`/backend/src/controllers/batch.controller.js`):
- `DELETE /api/batch/:resource` - 批量删除
- `PATCH /api/batch/:resource/status` - 批量更新状态
- `POST /api/batch/:resource/export` - 批量导出
- `PATCH /api/batch/:resource/assign` - 批量分配任务

**搜索 API** (`/backend/src/controllers/search.controller.js`):
- `GET /api/search/global?q=xxx` - 全局搜索
- `POST /api/search/:resource/filter` - 高级筛选
- `GET /api/search/suggest?q=xxx&type=xxx` - 搜索建议

**Cron 相关 API** (通过 WebSocket RPC):
- `listCrons()` - 获取所有定时任务
- `getCronStatus()` - 获取 Cron 服务状态
- `listCronRuns(jobId)` - 获取任务执行历史
- `createCron(params)` - 创建定时任务
- `updateCron(id, params)` - 更新定时任务
- `deleteCron(id)` - 删除定时任务
- `runCron(id, mode)` - 手动触发任务

### 1.2 前端现状

**Cron 编辑器组件**: `/src/views/cron/CronPage.vue`
- 已实现完整的 UI 界面
- 使用 WebSocket RPC 与后端通信
- 支持创建、编辑、删除、执行定时任务
- 支持查看执行历史

**数据存储层**: `/src/stores/cron.ts`
- Pinia Store 管理 Cron 相关状态
- 通过 `useWebSocketStore().rpc` 调用后端 API

---

## 2. 联调方案设计

### 2.1 通信架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Vue 3)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ CronPage.vue │  │  CronStore   │  │ WebSocket    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │              │
│         └─────────────────┴──────────────────┘              │
│                           │                                  │
└───────────────────────────┼─────────────────────────────────┘
                            │ RPC over SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端 (Express)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  RPC Handler │  │ Cron Service │  │   Database   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 API 映射表

| 前端操作 | Store 方法 | RPC 方法 | 后端路由 | 说明 |
|---------|-----------|---------|---------|------|
| 获取任务列表 | `fetchJobs()` | `listCrons()` | `/api/rpc` | 通过 RPC 调用 |
| 获取状态 | `fetchStatus()` | `getCronStatus()` | `/api/rpc` | 通过 RPC 调用 |
| 获取执行历史 | `fetchRuns(id)` | `listCronRuns(id)` | `/api/rpc` | 通过 RPC 调用 |
| 创建任务 | `createJob(params)` | `createCron(params)` | `/api/rpc` | 通过 RPC 调用 |
| 更新任务 | `updateJob(id, params)` | `updateCron(id, params)` | `/api/rpc` | 通过 RPC 调用 |
| 删除任务 | `deleteJob(id)` | `deleteCron(id)` | `/api/rpc` | 通过 RPC 调用 |
| 执行任务 | `runJob(id)` | `runCron(id, mode)` | `/api/rpc` | 通过 RPC 调用 |

### 2.3 数据流

```typescript
// 前端请求流程
1. 用户操作 → CronPage.vue
2. Vue 组件调用 → cronStore.xxx()
3. Store 调用 → wsStore.rpc.xxx()
4. RPC 客户端发送 → POST /api/rpc
5. 后端 RPC Handler 解析 → 调用对应 Service
6. Service 操作数据库/业务逻辑
7. 结果通过 RPC 响应返回前端
8. Store 更新状态 → Vue 自动响应式更新 UI
```

---

## 3. 数据导入导出功能架构设计

### 3.1 功能需求

1. **导出功能**:
   - 导出所有定时任务为 JSON/CSV 格式
   - 支持选择导出字段
   - 支持导出指定任务

2. **导入功能**:
   - 从 JSON/CSV 文件导入定时任务
   - 支持覆盖/跳过/合并策略
   - 导入前数据验证

### 3.2 架构设计

#### 3.2.1 后端 API 设计

```typescript
// 新增：批量导出 Cron 任务
POST /api/cron/export
Request:
{
  "jobIds": string[],      // 可选，不传则导出全部
  "format": "json" | "csv",
  "fields": string[]       // 可选，指定导出字段
}
Response:
{
  "success": true,
  "data": CronJob[],       // JSON 格式
  "csv": string,           // CSV 格式
  "filename": string
}

// 新增：批量导入 Cron 任务
POST /api/cron/import
Request:
{
  "data": CronUpsertParams[],
  "strategy": "override" | "skip" | "merge",  // 覆盖/跳过/合并
  "validateOnly": boolean  // 仅验证，不实际导入
}
Response:
{
  "success": true,
  "imported": number,
  "skipped": number,
  "failed": number,
  "errors": { id: string, error: string }[]
}
```

#### 3.2.2 前端组件设计

```typescript
// 新增组件：ImportExportModal.vue
<template>
  <NModal v-model:show="showModal">
    <NSpace vertical>
      <!-- 导出区域 -->
      <NCard title="导出数据">
        <NForm>
          <NFormItem label="导出格式">
            <NSelect v-model:value="exportFormat" :options="formatOptions" />
          </NFormItem>
          <NFormItem label="选择任务">
            <NSelect v-model:value="selectedJobs" multiple />
          </NFormItem>
          <NButton @click="handleExport">导出</NButton>
        </NForm>
      </NCard>

      <!-- 导入区域 -->
      <NCard title="导入数据">
        <NForm>
          <NFormItem label="导入文件">
            <NInput type="file" @change="handleFileSelect" />
          </NFormItem>
          <NFormItem label="导入策略">
            <NRadioGroup v-model:value="importStrategy">
              <NRadio value="override">覆盖</NRadio>
              <NRadio value="skip">跳过已存在</NRadio>
              <NRadio value="merge">合并</NRadio>
            </NRadioGroup>
          </NFormItem>
          <NButton @click="handleImport">导入</NButton>
        </NForm>
      </NCard>
    </NSpace>
  </NModal>
</template>
```

#### 3.2.3 Store 扩展

```typescript
// 扩展 cron.ts
export const useCronStore = defineStore('cron', () => {
  // ... existing code ...

  // 新增：导出任务
  async function exportJobs(params: {
    jobIds?: string[]
    format: 'json' | 'csv'
    fields?: string[]
  }) {
    loading.value = true
    try {
      const result = await wsStore.rpc.exportCrons(params)
      // 触发文件下载
      downloadFile(result.data, result.filename)
      return result
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  // 新增：导入任务
  async function importJobs(params: {
    data: CronUpsertParams[]
    strategy: 'override' | 'skip' | 'merge'
    validateOnly?: boolean
  }) {
    loading.value = true
    try {
      const result = await wsStore.rpc.importCrons(params)
      await fetchOverview() // 刷新列表
      return result
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  return {
    // ... existing returns ...
    exportJobs,
    importJobs,
  }
})
```

---

## 4. 联调测试计划

### 4.1 测试用例

| 用例 ID | 测试场景 | 前置条件 | 操作步骤 | 预期结果 |
|--------|---------|---------|---------|---------|
| TC001 | 获取任务列表 | 后端服务运行 | 打开 Cron 页面 | 显示所有任务 |
| TC002 | 创建任务 | 无 | 填写表单并提交 | 任务创建成功，列表刷新 |
| TC003 | 更新任务 | 存在任务 | 编辑任务并保存 | 任务更新成功 |
| TC004 | 删除任务 | 存在任务 | 点击删除确认 | 任务删除成功 |
| TC005 | 执行任务 | 存在任务 | 点击立即执行 | 任务触发，日志更新 |
| TC006 | 导出任务 | 存在任务 | 点击导出，选择格式 | 文件下载成功 |
| TC007 | 导入任务 (覆盖) | 存在任务 | 上传文件，选择覆盖 | 任务被覆盖 |
| TC008 | 导入任务 (跳过) | 存在任务 | 上传文件，选择跳过 | 已存在任务跳过 |
| TC009 | 导入验证失败 | 无效数据 | 上传非法文件 | 显示错误信息 |

### 4.2 联调环境准备

```bash
# 1. 启动后端服务
cd /www/wwwroot/ai-work/backend
npm install
npm start

# 2. 启动前端开发服务器
cd /www/wwwroot/ai-work
npm install
npm run dev

# 3. 验证 WebSocket 连接
# 打开浏览器控制台，检查 SSE 连接状态
```

---

## 5. 风险与应对

| 风险项 | 影响 | 应对措施 |
|--------|------|---------|
| WebSocket 连接不稳定 | 实时通信失败 | 实现重连机制，增加连接状态提示 |
| 大数据量导出性能 | 响应慢 | 支持分页导出，添加进度提示 |
| 导入数据冲突 | 数据覆盖错误 | 提供预览功能，支持回滚 |
| 权限控制缺失 | 安全漏洞 | 所有 API 增加权限校验 |

---

## 6. 下一步行动

1. ✅ 后端 API 审查完成
2. ✅ 联调方案设计完成
3. ✅ 数据导入导出架构设计完成
4. ⏭️ 实现导入导出后端 API
5. ⏭️ 实现前端导入导出组件
6. ⏭️ 执行联调测试
7. ⏭️ 更新 HEARTBEAT.md

---

**文档版本**: v1.0  
**最后更新**: 2026-04-11  
**负责人**: 系统架构师 (小系)
