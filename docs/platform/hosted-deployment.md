# 托管与发布：本地与云端编排

本仓库在 **Phase 1+** 提供可选的平台栈（对话、Job、对象存储、预览），用于实现 [commercial-hosting-mvp.md](./commercial-hosting-mvp.md) 中的架构。产品与功能说明见 [product-design.md](./product-design.md)；OpenGame + MiniMax 全模态对齐见 [opengame-minimax-one-stop.md](./opengame-minimax-one-stop.md)。内核仍为 OpenGame CLI/Core；平台代码位于：

- [`apps/platform-api`](../../apps/platform-api) — HTTP BFF
- [`apps/platform-worker`](../../apps/platform-worker) — BullMQ Worker
- [`apps/platform-web`](../../apps/platform-web) — 极简 Web 控制台
- [`packages/platform-db`](../../packages/platform-db) — 数据库 schema 与迁移
- [`packages/platform-shared`](../../packages/platform-shared) — 共享常量

## 快速开始

1. **基础设施**（PostgreSQL、Redis、MinIO）：

   ```bash
   docker compose -f docker-compose.platform.yml up -d postgres redis minio
   ```

2. **配置环境**：复制 [.env.example](../../.env.example) 中的 **「Hosted platform」** 一节到 `.env.platform`（或导出到 shell），填写 `PLATFORM_DATABASE_URL`、`PLATFORM_JWT_SECRET` 等。

3. **编译并迁移数据库**（API / Worker 依赖 `platform-db` 的 `dist/`）：

   ```bash
   npm run build --workspace=@opengame/platform-shared
   npm run build --workspace=@opengame/platform-db
   npm run migrate --workspace=@opengame/platform-db
   ```

4. **启动 API + Worker + Web**：

   ```bash
   npm run platform:dev
   ```

5. 浏览器打开 Web 提示的地址（默认 Vite `http://127.0.0.1:5174`）。用 **登录链接**（`POST /v1/auth/magic/request`）进入；仅当 `PLATFORM_ALLOW_DEV_AUTH=true` 时才有邮箱直登。创建项目并发消息后，在 Job 完成后打开预览。

## 双发进程镜像（仍不填支付密钥）

本地 `npm run platform:dev` 仍是开发默认。仓库现在也有可部署镜像，对应规划里「Compose 不能只起 PG/Redis/MinIO」：

- [`deploy/Dockerfile.platform-api`](../../deploy/Dockerfile.platform-api)
- [`deploy/Dockerfile.platform-worker`](../../deploy/Dockerfile.platform-worker)
- [`deploy/Dockerfile.platform-web`](../../deploy/Dockerfile.platform-web)

叠在基础设施上启动：

```bash
npm run platform:launch
```

即 `docker compose -f docker-compose.platform.yml -f docker-compose.launch.yml up -d --build`。环境变量仍来自你的 `.env`；生产必须过 [`productionGates.ts`](../../apps/platform-api/src/lib/productionGates.ts)，不要把本地 `.env` 直接当产凭。边缘继续用 [`deploy/Caddyfile`](../../deploy/Caddyfile) / [`deploy/nginx.conf`](../../deploy/nginx.conf)。

半成品入口（插件市场、Bench 看板、Research Lab、自定义域名）默认隐藏。需要时设置 `VITE_SHOW_ECOSYSTEM` / `VITE_SHOW_RESEARCH_LAB` / `VITE_SHOW_CUSTOM_DOMAIN`。公开 API 对照见 [public-api-map.md](./public-api-map.md)。产凭微信/微博爬虫把 `/play/:slug` 反代到 `share.html`：见 [share-og-proxy.md](./share-og-proxy.md)。可部署片段：[deploy/Caddyfile](../../deploy/Caddyfile)、[deploy/nginx.conf](../../deploy/nginx.conf)。上线当日：[launch-day-checklist.md](./launch-day-checklist.md)。地平线：[launch-horizon.md](./launch-horizon.md)。

## 与 Worker 环境的关系

生成/构建容器内应遵守 [worker-environment.md](./worker-environment.md) 中的目录与 `OPENGAME_*` 约定；平台栈的 API/Worker 进程负责写 `jobs`、`artifacts`、`deployments` 并驱动队列。

## 长期路线

多租户、配额、域名与计费见根目录规划中的 Phase 2–5；实现进度以各包 README 与 API 路由为准。
