# OpenClaw-Admin 系统架构设计文档

**版本**: v3.0  
**创建日期**: 2026-04-11  
**负责人**: 系统架构师  
**状态**: 已完成，等待产品经理优先级确认

---

## 1. 项目概述

### 1.1 项目背景
OpenClaw-Admin 是一个自动化开发全流程管理平台，提供从代码开发、测试、部署到监控的完整 DevOps 能力。

### 1.2 系统定位
- **目标用户**: 开发团队、运维团队、安全团队
- **核心价值**: 自动化、安全、可观测
- **技术栈**: Vue 3 + Express + SQLite + Docker

---

## 2. 现有架构分析

### 2.1 技术栈现状

| 层级 | 技术 | 版本 | 状态 |
|-----|------|------|------|
| 前端框架 | Vue 3 | 3.5.x | ✅ 已确认 |
| 构建工具 | Vite | 7.x | ✅ 已确认 |
| 语言 | TypeScript | 5.x | ✅ 已确认 |
| 状态管理 | Pinia | 3.x | ✅ 已确认 |
| UI 框架 | Naive UI | 2.43.x | ✅ 已确认 |
| 图表库 | ECharts | 6.x | ✅ 已确认 |
| 后端框架 | Express | 5.x | ✅ 已确认 |
| 数据库 | SQLite | better-sqlite3 12.x | ✅ 已确认 |
| 日志 | Winston | latest | ✅ 已确认 |
| 实时通信 | WebSocket | ws 8.x | ✅ 已确认 |

### 2.2 已完成模块 (13 个)

| 模块 | 功能 | 状态 | 文件路径 |
|-----|------|------|---------|
| 认证授权 | JWT + 2FA | ✅ 完成 | backend/src/routes/auth.routes.js |
| WAF 安全防护 | SQL 注入/XSS 防护 | ✅ 完成 | backend/src/services/wafService.js |
| CI/CD 安全扫描 | SAST/SCA | ✅ 完成 | backend/src/services/cicdScanService.js |
| 批量操作 API | 批量增删改 | ✅ 完成 | backend/src/routes/batch.routes.js |
| 智能搜索 | 全局搜索/筛选 | ✅ 完成 | backend/src/routes/search.routes.js |
| 统计查询 | 数据统计 | ✅ 完成 | backend/src/routes/stats.routes.js |
| RBAC 权限管理 | 角色/权限 | ✅ 完成 | backend/src/routes/rbac.routes.js |
| 主题切换 | 亮色/暗色 | ✅ 完成 | backend/src/routes/themes.routes.js |
| Cron 任务管理 | 任务调度 | ✅ 完成 | backend/src/routes/cron.routes.js |
| 会话持久化 | 数据库存储 | ✅ 完成 | backend/src/models/sessionModel.js |
| 日志脱敏 | 敏感信息 masking | ✅ 完成 | backend/src/utils/sensitiveData.js |
| 双因素认证 | TOTP/备用码 | ✅ 完成 | backend/src/services/twoFactorService.js |
| 数据导入导出 | 备份/恢复 | ✅ 完成 | backend/src/services/exportService.js |

### 2.3 数据库架构

**核心表**:
- `users` - 用户账户
- `sessions` - 会话管理
- `roles` / `permissions` - RBAC 基础
- `audit_logs` - 审计日志
- `crons` / `cron_runs` - 任务调度

**功能表**:
- `waf_rules` / `waf_logs` - WAF 防护
- `cicd_scans` / `cicd_scan_results` - 安全扫描
- `export_history` / `import_history` - 导入导出

**优化措施**:
- 启用 WAL 模式提升并发性能
- 添加复合索引优化查询
- 实施软删除模式
- 配置外键约束

---

## 3. 剩余 15 个任务架构设计

### 3.1 P1 核心功能 (7 个)

#### 任务 1: 前端批量操作 UI
**架构设计**:
```
src/components/batch/
├── BatchToolbar.vue      # 批量操作工具栏
├── BatchConfirmDialog.vue # 确认弹窗
└── useBatchSelection.ts  # 选择逻辑 Composable

src/stores/batch.ts       # 批量操作 Store
```

**技术要点**:
- 复选框双向绑定 (v-model)
- 批量操作二次确认
- 操作结果反馈 (成功/失败统计)

#### 任务 2: 前端智能搜索 UI
**架构设计**:
```
src/components/search/
├── SearchBar.vue         # 搜索栏
├── AdvancedFilter.vue    # 高级筛选
├── FilterTags.vue        # 筛选标签
└── useSearch.ts          # 搜索逻辑

src/stores/search.ts      # 搜索 Store
```

**技术要点**:
- 防抖处理 (300ms)
- 筛选条件标签化
- 搜索历史 (localStorage)

#### 任务 3: 前端数据可视化 UI
**架构设计**:
```
src/components/charts/
├── DataCard.vue          # 数据卡片
├── LineChart.vue         # 折线图
├── BarChart.vue          # 柱状图
├── PieChart.vue          # 饼图
└── useChart.ts           # 图表通用逻辑
```

**技术要点**:
- ECharts 组件封装
- 响应式重绘
- 数据卡片趋势箭头

#### 任务 4: 前端权限管理 UI
**架构设计**:
```
src/components/permission/
├── RoleList.vue          # 角色列表
├── PermissionEditor.vue  # 权限编辑
├── UserRoleAssign.vue    # 角色分配
└── usePermission.ts      # 权限逻辑
```

**技术要点**:
- RBAC 模型前端实现
- 权限树形结构
- 批量权限操作

#### 任务 5: 前端主题切换 UI
**架构设计**:
```
src/components/theme/
├── ThemeSwitcher.vue     # 切换器
├── ThemePreview.vue      # 预览
└── useTheme.ts           # 主题逻辑
```

**技术要点**:
- CSS 变量实现
- 暗色/亮色完整覆盖
- 平滑过渡动画

#### 任务 6: 移动端 PWA 适配
**架构设计**:
```
src/components/mobile/
├── MobileNav.vue         # 移动端导航
├── GestureHandler.vue    # 手势处理
└── pwa/
    ├── service-worker.js
    └── manifest.json
```

**技术要点**:
- 响应式断点设计
- Service Worker 离线缓存
- 触摸手势支持

#### 任务 7: 数据导入导出前端
**架构设计**:
```
src/components/import-export/
├── ExportDialog.vue      # 导出对话框
├── ImportDialog.vue      # 导入对话框
├── ExportHistory.vue     # 历史记录
└── useImportExport.ts    # 逻辑
```

**技术要点**:
- 文件上传/下载
- 进度条显示
- 错误报告

### 3.2 P2 增强功能 (8 个)

#### 任务 8: 批量操作日志
- 记录批量操作详情
- 支持操作追溯

#### 任务 9: 搜索历史/保存筛选
- 本地存储搜索历史
- 保存常用筛选条件

#### 任务 10: 图表组件增强
- 雷达图/热力图
- 仪表板自定义布局

#### 任务 11: 权限层级树
- 权限树形展示
- 层级关系可视化

#### 任务 12: 主题同步
- 多设备主题同步
- 云端存储偏好

#### 任务 13: 推送通知
- Service Worker 推送
- 实时消息通知

#### 任务 14: 前端集成测试
- Vitest + Vue Test Utils
- E2E 测试 (Playwright)

#### 任务 15: 性能优化
- 代码分割/懒加载
- 图片/资源优化
- 缓存策略

---

## 4. 技术选型建议

### 4.1 前端技术栈

| 类别 | 推荐 | 理由 |
|-----|------|------|
| 框架 | Vue 3 | 生态成熟，学习成本低 |
| 构建 | Vite | 极速启动，HMR 快 |
| 状态 | Pinia | 轻量，TypeScript 友好 |
| UI | Naive UI | 组件丰富，主题灵活 |
| 图表 | ECharts | 功能强大，文档完善 |
| 路由 | Vue Router | 官方支持，生态好 |

### 4.2 后端技术栈

| 类别 | 推荐 | 理由 |
|-----|------|------|
| 框架 | Express | 轻量，生态丰富 |
| 数据库 | SQLite | 零配置，适合中小规模 |
| 日志 | Winston | 灵活，支持多传输 |
| 安全 | Helmet + WAF | 多层防护 |
| 认证 | JWT + 2FA | 行业标准 |

### 4.3 运维技术栈

| 类别 | 推荐 | 理由 |
|-----|------|------|
| 容器 | Docker | 标准化部署 |
| CI/CD | GitHub Actions | 免费，集成好 |
| 监控 | Prometheus + Grafana | 开源，功能强 |
| 日志 | Loki + Promtail | 轻量，与 Prometheus 集成 |

---

## 5. 架构设计原则

### 5.1 分层架构
```
Controller → Service → Model
    ↓          ↓         ↓
   API      业务逻辑    数据访问
```

### 5.2 前后端分离
- REST API 为主，WebSocket 为辅
- 独立部署，独立扩展

### 5.3 组件化设计
- 高内聚低耦合
- 可复用组件库

### 5.4 安全性优先
- 多层防护 (网络/应用/数据)
- 审计追踪
- 最小权限原则

### 5.5 可观测性
- 日志 (Winston)
- 监控 (Prometheus)
- 告警 (Alertmanager)

### 5.6 可扩展性
- 模块化设计
- 插件机制预留

---

## 6. 部署架构

### 6.1 开发环境
```
Docker Compose 本地部署
- app: 应用服务
- db: SQLite 数据
- redis: 缓存 (可选)
```

### 6.2 生产环境
```
GitHub Actions 自动部署
- 代码提交 → CI/CD → Docker 镜像 → 自动部署 → 健康检查
```

### 6.3 高可用方案 (可选)
```
Kubernetes 集群
- Deployment + Service
- HPA 自动扩缩容
- Ingress 负载均衡
```

---

## 7. 待办事项

| 优先级 | 任务 | 负责人 | 状态 |
|-------|------|--------|------|
| P0 | 产品经理确认优先级方案 | 产品经理 | ⏳ 待确认 |
| P1 | 启动前端批量操作 UI 开发 | 前端开发 | ⏳ 等待 |
| P1 | 启动前端智能搜索 UI 开发 | 前端开发 | ⏳ 等待 |
| P1 | 启动数据导入导出功能开发 | 后端开发 | ⏳ 等待 |
| P2 | 前端集成测试框架搭建 | 测试工程师 | ⏳ 等待 |

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|-----|------|---------|
| 后端接口延迟 | 中高 | 前端先使用 Mock 数据并行开发 |
| 图表性能问题 | 中 | 提前进行大数据量性能测试 |
| 移动端兼容性 | 中 | 使用主流浏览器测试，必要时降级 |
| 主题切换闪烁 | 低 | 优化主题加载时机，添加过渡动画 |

---

## 9. 附录

### 9.1 术语表
- **RBAC**: 基于角色的访问控制
- **WAF**: Web 应用防火墙
- **SAST**: 静态应用安全测试
- **SCA**: 软件成分分析
- **PWA**: 渐进式 Web 应用

### 9.2 相关文档
- [需求文档](./REQUIREMENTS.md)
- [数据库设计](./DBA_DATABASE_DESIGN_REPORT.md)
- [前端需求](./FRONTEND_REQUIREMENTS.md)
- [部署文档](./DEPLOYMENT.md)
- [心跳文档](./HEARTBEAT.md)

---

**文档状态**: 已完成  
**下一步**: 等待产品经理确认优先级后启动开发

**最后更新**: 2026-04-11 15:30  
**更新人**: 系统架构师  
**文档版本**: v3.0
