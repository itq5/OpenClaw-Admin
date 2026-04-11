# 批量操作接口文档

**版本**: v1.0  
**创建日期**: 2026-04-11  
**负责人**: 后端开发工程师  
**状态**: 已完成

---

## 概述

批量操作接口提供对系统资源的高效批量处理能力，支持批量删除、批量状态变更、批量查询、批量导出和批量分配等操作。

**基础路径**: `/api/v1/batch`

**认证方式**: JWT Token (Bearer Auth)

---

## 接口列表

### 1. 批量删除

**接口**: `DELETE /api/v1/batch/:resource`

**描述**: 批量删除指定资源

**路径参数**:
| 参数 | 类型 | 必填 | 描述 | 可选值 |
|------|------|------|------|--------|
| resource | string | 是 | 资源类型 | users, tasks, scenarios, audit-logs |

**请求体**:
```json
{
  "ids": [1, 2, 3]
}
```

**请求参数**:
| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| ids | array | 是 | 要删除的记录 ID 列表，至少 1 个 |

**权限**: `{resource}:delete` (如 `users:delete`, `tasks:delete`)

**响应**:
```json
{
  "success": true,
  "deleted_count": 3,
  "failed_ids": []
}
```

**响应字段**:
| 字段 | 类型 | 描述 |
|------|------|------|
| success | boolean | 是否成功 |
| deleted_count | number | 实际删除的记录数 |
| failed_ids | array | 删除失败的 ID 列表（空表示全部成功） |

**错误响应**:
```json
{
  "success": false,
  "error": "无效的请求参数"
}
```

**示例**:
```bash
DELETE /api/v1/batch/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": [1, 2, 3]
}
```

---

### 2. 批量状态变更

**接口**: `PATCH /api/v1/batch/:resource/status`

**描述**: 批量更新指定资源的状态

**路径参数**:
| 参数 | 类型 | 必填 | 描述 | 可选值 |
|------|------|------|------|--------|
| resource | string | 是 | 资源类型 | users, tasks, scenarios, audit-logs |

**请求体**:
```json
{
  "ids": [1, 2, 3],
  "status": "active"
}
```

**请求参数**:
| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| ids | array | 是 | 要更新的记录 ID 列表，至少 1 个 |
| status | string | 是 | 新的状态值 |

**权限**: `{resource}:update` (如 `users:update`, `tasks:update`)

**响应**:
```json
{
  "success": true,
  "updated_count": 3,
  "failed_ids": []
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "无效的请求参数"
}
```

**示例**:
```bash
PATCH /api/v1/batch/tasks/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": [10, 11, 12],
  "status": "completed"
}
```

---

### 3. 批量查询

**接口**: `POST /api/v1/batch/:resource/batch-get`

**描述**: 批量查询指定资源的详细信息

**路径参数**:
| 参数 | 类型 | 必填 | 描述 | 可选值 |
|------|------|------|------|--------|
| resource | string | 是 | 资源类型 | users, tasks, scenarios, audit-logs |

**请求体**:
```json
{
  "ids": [1, 2, 3],
  "fields": ["id", "name", "email", "status"]
}
```

**请求参数**:
| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| ids | array | 是 | 要查询的记录 ID 列表，至少 1 个 |
| fields | array | 否 | 需要返回的字段列表，不传则返回全部字段 |

**权限**: `{resource}:read` (如 `users:read`, `tasks:read`)

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "张三",
      "email": "zhangsan@example.com",
      "status": "active"
    },
    {
      "id": 2,
      "name": "李四",
      "email": "lisi@example.com",
      "status": "inactive"
    }
  ],
  "count": 2
}
```

**响应字段**:
| 字段 | 类型 | 描述 |
|------|------|------|
| success | boolean | 是否成功 |
| data | array | 查询结果数据 |
| count | number | 返回的记录数 |

**错误响应**:
```json
{
  "success": false,
  "error": "无效的资源类型"
}
```

**示例**:
```bash
POST /api/v1/batch/users/batch-get
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": [1, 2, 3, 4, 5],
  "fields": ["id", "name", "email", "status"]
}
```

---

### 4. 批量导出

**接口**: `POST /api/v1/batch/:resource/export`

**描述**: 批量导出指定资源的数据

**路径参数**:
| 参数 | 类型 | 必填 | 描述 | 可选值 |
|------|------|------|------|--------|
| resource | string | 是 | 资源类型 | users, tasks, scenarios, audit-logs |

**请求体**:
```json
{
  "ids": [1, 2, 3],
  "format": "csv",
  "fields": ["id", "name", "email"]
}
```

**请求参数**:
| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| ids | array | 是 | 要导出的记录 ID 列表，至少 1 个 |
| format | string | 否 | 导出格式，默认 csv，可选 csv/xlsx |
| fields | array | 否 | 需要导出的字段列表 |

**权限**: `{resource}:read`

**响应**:
- CSV 格式：直接返回文件流
- JSON 格式（未实现 xlsx 时）:
```json
{
  "success": true,
  "data": [...],
  "count": 3
}
```

**示例**:
```bash
POST /api/v1/batch/tasks/export
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": [10, 11, 12],
  "format": "csv"
}
```

---

### 5. 批量分配

**接口**: `PATCH /api/v1/batch/:resource/assign`

**描述**: 批量分配任务给指定用户（仅支持 tasks 资源）

**路径参数**:
| 参数 | 类型 | 必填 | 描述 | 可选值 |
|------|------|------|------|--------|
| resource | string | 是 | 资源类型 | 仅支持 tasks |

**请求体**:
```json
{
  "ids": [1, 2, 3],
  "assigneeId": "ou_xxx"
}
```

**请求参数**:
| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| ids | array | 是 | 要分配的任务 ID 列表，至少 1 个 |
| assigneeId | string | 是 | 被分配用户的 OpenID |

**权限**: `tasks:update`

**响应**:
```json
{
  "success": true,
  "assigned_count": 3,
  "failed_ids": []
}
```

**示例**:
```bash
PATCH /api/v1/batch/tasks/assign
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": [100, 101, 102],
  "assigneeId": "ou_xxx"
}
```

---

## 错误码说明

| HTTP 状态码 | 错误信息 | 说明 |
|------------|---------|------|
| 400 | 无效的请求参数 | 请求参数校验失败 |
| 400 | 无效的资源类型 | resource 参数不在允许范围内 |
| 401 | 未授权 | 缺少或无效的 JWT Token |
| 403 | 权限不足 | 用户没有执行该操作的权限 |
| 500 | 操作失败 | 服务器内部错误 |

---

## 安全说明

1. **SQL 注入防护**: 所有接口使用参数化查询，防止 SQL 注入
2. **XSS 防护**: 输入数据经过 WAF 过滤
3. **权限验证**: 每个接口都需要 JWT 认证和权限验证
4. **字段白名单**: 批量查询接口使用字段白名单机制，防止敏感信息泄露
5. **操作审计**: 所有批量操作都会记录到审计日志

---

## 性能优化

1. **批量操作**: 一次请求处理多条记录，减少网络往返
2. **字段选择**: 支持指定返回字段，减少数据传输量
3. **索引优化**: 数据库已为常用查询字段添加索引

---

## 变更记录

| 版本 | 日期 | 变更内容 | 负责人 |
|------|------|---------|--------|
| v1.0 | 2026-04-11 | 初始版本，实现 5 个批量操作接口 | 后端开发工程师 |

---

**文档状态**: 已完成  
**最后更新**: 2026-04-11 21:25  
**更新人**: 后端开发工程师
