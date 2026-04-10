# OpenClaw-Admin 部署文档

**版本**: 1.0.0  
**最后更新**: 2026-04-11  
**负责人**: 运维工程师

---

## 📋 目录

1. [概述](#概述)
2. [部署架构](#部署架构)
3. [前置要求](#前置要求)
4. [快速部署](#快速部署)
5. [CI/CD 流水线](#cicd-流水线)
6. [监控配置](#监控配置)
7. [故障排查](#故障排查)
8. [附录](#附录)

---

## 概述

本文档描述 OpenClaw-Admin 项目的完整部署方案，支持以下部署方式：

- **传统部署**: 直接部署到服务器
- **Docker 部署**: 容器化部署
- **CI/CD 自动化部署**: GitHub Actions 自动部署

### 系统组件

| 组件 | 端口 | 说明 |
|------|------|------|
| OpenClaw-Admin | 10001 | 主应用服务 |
| Prometheus | 9090 | 监控数据采集 |
| Grafana | 3002 | 可视化监控面板 |
| Alertmanager | 9093 | 告警管理 |
| Node Exporter | 9100 | 主机指标采集 |

---

## 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Repository                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  .github/workflows/ci-cd.yml                          │  │
│  │  - lint → test → build → deploy → health-check        │  │
│  └───────────────────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    生产服务器 (Ubuntu 22.04)                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Docker Containers                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ openclaw-app │  │  prometheus  │  │   grafana   │ │  │
│  │  │   :10001     │  │    :9090     │  │   :3002     │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  │  ┌──────────────┐  ┌──────────────┐                  │  │
│  │  │ node-exp     │  │  cadvisor    │                  │  │
│  │  │   :9100      │  │   :8080      │                  │  │
│  │  └──────────────┘  └──────────────┘                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Data Volumes                                         │  │
│  │  - /www/wwwroot/ai-work/logs                          │  │
│  │  - /www/wwwroot/ai-work/data                          │  │
│  │  - /www/wwwroot/ai-work/backups                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    监控告警通知                              │
│  - 飞书机器人 Webhook                                        │
│  - 邮件通知                                                 │
│  - Webhook 集成                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 前置要求

### 服务器要求

| 资源 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核 |
| 内存 | 4GB | 8GB |
| 磁盘 | 50GB SSD | 100GB SSD |
| 操作系统 | Ubuntu 20.04+ | Ubuntu 22.04 LTS |

### 软件依赖

```bash
# 必需软件
- Node.js 20+
- npm 10+
- Docker 24+
- Docker Compose 2.0+
- Git
- SQLite3

# 可选软件
- PM2 (进程管理)
- Nginx (反向代理)
```

### 环境配置

创建 `.env` 文件（基于 `.env.example`）：

```bash
cp .env.example .env
```

需要配置的环境变量：

```env
# 应用配置
NODE_ENV=production
PORT=10001
HOST=0.0.0.0

# 数据库配置
DB_PATH=/www/wwwroot/ai-work/data/wizard.db

# 日志配置
LOG_LEVEL=info
LOG_DIR=/www/wwwroot/ai-work/logs

# 安全配置
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# 监控配置
PROMETHEUS_ENABLED=true
METRICS_PATH=/metrics
```

---

## 快速部署

### 方式一：Docker 部署（推荐）

#### 1. 安装 Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo systemctl enable docker
sudo systemctl start docker

# 安装 Docker Compose
sudo apt install docker-compose-plugin
```

#### 2. 部署应用

```bash
cd /www/wwwroot/ai-work

# 启动所有服务（应用 + 监控）
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

#### 3. 验证部署

```bash
# 检查应用健康
curl http://localhost:10001/health

# 检查监控服务
curl http://localhost:9090/-/healthy
curl http://localhost:3002/api/health
```

### 方式二：传统部署

#### 1. 安装依赖

```bash
cd /www/wwwroot/ai-work

# 安装 Node.js 依赖
npm install --production

# 初始化数据库
sqlite3 data/wizard.db < migrations/003_complete_schema.sql
```

#### 2. 启动服务

```bash
# 使用 PM2 启动（推荐）
npm install -g pm2
pm2 start server.js --name openclaw-admin
pm2 save
pm2 startup

# 或使用系统服务
sudo systemctl start openclaw-admin
```

#### 3. 配置系统服务

创建 `/etc/systemd/system/openclaw-admin.service`:

```ini
[Unit]
Description=OpenClaw-Admin Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/www/wwwroot/ai-work
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
sudo systemctl daemon-reload
sudo systemctl enable openclaw-admin
sudo systemctl start openclaw-admin
```

---

## CI/CD 流水线

### 流水线结构

```
push/PR → lint → test → build → deploy → health-check
```

### 工作流文件

- **CI 流水线**: `.github/workflows/ci-cd.yml`
- **部署流水线**: `.github/workflows/deploy.yml`

### 需要配置的 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `DEPLOY_SSH_KEY` | SSH 私钥（用于部署） | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_USER` | 部署用户名 | `deploy` |
| `DEPLOY_HOST` | 服务器地址 | `192.168.1.100` |
| `DEPLOY_PATH` | 部署目标路径 | `/www/wwwroot/ai-work` |
| `FEISHU_WEBHOOK_URL` | 飞书机器人 Webhook | `https://open.feishu.cn/open-apis/bot/v2/hook/xxx` |
| `PRODUCTION_URL` | 生产环境 URL | `https://ai-work.example.com` |

### 生成 SSH 密钥

```bash
# 生成部署专用密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key

# 将公钥添加到服务器
cat deploy_key.pub | ssh deploy@192.168.1.100 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# 复制私钥内容添加到 GitHub Secrets
cat deploy_key | pbcopy
```

### 触发部署

```bash
# 推送到 main 分支自动触发
git checkout main
git merge your-branch
git push origin main

# 或手动触发
# 访问：https://github.com/your-org/ai-work/actions/workflows/deploy.yml
```

### 查看流水线状态

- GitHub Actions: https://github.com/itq5/OpenClaw-Admin/actions
- 实时日志：点击具体 workflow run 查看

---

## 监控配置

### Prometheus 配置

编辑 `monitoring/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # Prometheus 自身
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # 主机指标
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  # OpenClaw 应用指标
  - job_name: 'openclaw-web'
    metrics_path: /metrics
    static_configs:
      - targets: ['openclaw-web:3000']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+):.*'
        replacement: '${1}'
```

### 告警规则

编辑 `monitoring/prometheus/alerts-rules.yml`:

```yaml
groups:
  - name: openclaw-alerts
    rules:
      # CPU 使用率告警
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 使用率过高"
          description: "实例 {{ $labels.instance }} CPU 使用率超过 80%"

      # 内存使用率告警
      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "内存使用率过高"
          description: "实例 {{ $labels.instance }} 内存使用率超过 80%"

      # 磁盘空间告警
      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 < 20
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足"
          description: "实例 {{ $labels.instance }} 磁盘可用空间低于 20%"

      # 服务健康告警
      - alert: ServiceDown
        expr: up{job="openclaw-web"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "服务不可用"
          description: "服务 {{ $labels.instance }} 已停止响应"
```

### Grafana 仪表板

访问 Grafana: `http://your-server:3002`

默认账号：
- 用户名：`admin`
- 密码：`admin123`

#### 推荐仪表板

1. **Node Exporter 全貌** (ID: 1860)
   - 系统资源概览
   - CPU/内存/磁盘/网络

2. **Docker 容器监控** (ID: 179)
   - 容器资源使用
   - 容器健康状态

3. **自定义 OpenClaw 仪表板**
   - 应用性能指标
   - 请求响应时间
   - 错误率统计

---

## 故障排查

### 应用无法启动

```bash
# 检查日志
docker-compose logs app
# 或
journalctl -u openclaw-admin -f

# 检查端口占用
netstat -tlnp | grep 10001

# 检查数据库连接
sqlite3 data/wizard.db "SELECT 1"
```

### 监控服务异常

```bash
# 检查 Prometheus 配置
promtool check config monitoring/prometheus/prometheus.yml

# 检查 Prometheus 日志
docker-compose logs prometheus

# 验证数据源连接
curl http://localhost:9090/api/v1/query?query=up
```

### 部署失败

```bash
# 检查 SSH 连接
ssh -i deploy_key deploy@192.168.1.100

# 检查服务器磁盘空间
df -h

# 检查 Docker 状态
docker-compose ps
docker-compose logs
```

### 回滚操作

```bash
# 使用回滚脚本
./scripts/rollback.sh

# 或手动回滚
docker-compose stop
docker-compose up -d openclaw-admin:previous
```

---

## 附录

### 常用命令

```bash
# 部署相关
./scripts/deploy.sh           # 传统部署
./scripts/deploy-docker.sh    # Docker 部署
./scripts/rollback.sh         # 回滚

# 监控相关
./scripts/health-check.sh     # 健康检查
./scripts/performance-monitor.sh  # 性能监控
./scripts/log-collector.sh    # 日志收集

# Docker 管理
docker-compose up -d          # 启动所有服务
docker-compose down           # 停止所有服务
docker-compose restart        # 重启所有服务
docker-compose logs -f        # 查看日志
docker-compose ps             # 查看状态
```

### 端口清单

| 服务 | 端口 | 访问权限 | 说明 |
|------|------|---------|------|
| OpenClaw-Admin | 10001 | 公网 | 主应用 |
| Prometheus | 9090 | 内网 | 监控数据 |
| Grafana | 3002 | 内网 | 可视化面板 |
| Alertmanager | 9093 | 内网 | 告警管理 |
| Node Exporter | 9100 | 内网 | 主机指标 |
| cAdvisor | 8080 | 内网 | 容器指标 |

### 文件目录结构

```
/www/wwwroot/ai-work/
├── .github/
│   ├── workflows/
│   │   ├── ci-cd.yml          # CI 流水线
│   │   └── deploy.yml         # 部署流水线
│   └── CI_CD_CONFIG.md        # CI/CD配置说明
├── monitoring/
│   ├── docker-compose.yml     # 监控服务编排
│   ├── prometheus/
│   │   ├── prometheus.yml     # Prometheus 配置
│   │   └── alerts-rules.yml   # 告警规则
│   └── grafana/
│       └── provisioning/      # Grafana 配置
├── scripts/
│   ├── deploy.sh              # 部署脚本
│   ├── deploy-docker.sh       # Docker 部署
│   ├── rollback.sh            # 回滚脚本
│   ├── health-check.sh        # 健康检查
│   └── ...
├── data/                      # 数据目录
├── logs/                      # 日志目录
├── backups/                   # 备份目录
└── ...
```

### 安全建议

1. **网络隔离**: 监控端口仅允许内网访问
2. **密钥管理**: 定期轮换 SSH 密钥和 JWT Secret
3. **权限控制**: 最小权限原则配置部署用户
4. **数据备份**: 定期备份数据库和配置文件
5. **日志审计**: 开启所有操作审计日志

### 参考文档

- [GitHub Actions 文档](https://docs.github.com/actions)
- [Docker 官方文档](https://docs.docker.com)
- [Prometheus 官方文档](https://prometheus.io/docs)
- [Grafana 官方文档](https://grafana.com/docs)

---

**文档版本**: 1.0.0  
**最后更新**: 2026-04-11  
**维护者**: 运维工程师 🚀
