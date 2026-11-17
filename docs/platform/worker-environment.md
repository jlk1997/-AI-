# OpenGame 托管 Worker：环境契约

本文档定义 **平台层 Worker**（生成 / 构建 / 发布）在调用 OpenGame 内核时应满足的环境与目录约定，与 [commercial-hosting-mvp.md](./commercial-hosting-mvp.md) 及仓库根目录 [.env.example](../../.env.example) 对齐。

## 1. 职责划分

| 组件 | 环境 | 说明 |
|------|------|------|
| **Generation Worker** | Linux 容器推荐 | 解压游戏模板 → 设置 `cwd` → 注入下文变量 → 调用 `opengame` / `@opengame/sdk` |
| **Build Worker** | 同上 | 仅执行白名单命令（如 `npm ci`、`npm run build`），产出静态 `dist/` |
| **OpenGame 内核** | 与本地 CLI 一致 | 不读取平台数据库；仅通过 env 与文件系统交互 |

## 2. 目录契约（一次生成 Job）

1. **工作区根目录** `WORKSPACE_ROOT`：可写；每个 Job 使用独立子目录，结束后归档或删除。
2. **模板与文档**（与 headless 流程一致）：
   - `GAME_TEMPLATES_DIR`：指向含 archetype 模板的目录（如从 `agent-test/templates/core` 打包的只读层）。
   - `GAME_DOCS_DIR`：指向 `docs` 协议树（`asset_protocol.md`、`gdd/core.md`、`modules/{archetype}/...`）。
3. **产物路径**（由模板与工具约定）：
   - 生成资产：`public/assets/`、`public/assets/asset-pack.json`。
   - 源码与配置：`src/`、`gameConfig.json` 等以模板为准。
   - **构建输出**：`npm run build` 后的 **`dist/`**（或模板文档中写明的目录）；Worker 上传该目录到对象存储。

## 3. Worker 必设 / 常用环境变量

### 3.1 平台基础设施（非 OpenGame 供应商）

| 变量 | 用途 |
|------|------|
| `PLATFORM_WORK_ROOT` | Worker 上项目磁盘根目录（`…/projects/{id}/repo`）；**generate/build/bench 必填** |
| `PLATFORM_OPENGAME_CLI` | 已构建的 OpenGame `dist/cli.js` 绝对路径（**generate 必填**） |
| `PLATFORM_GAME_TEMPLATE_DIR` | 初始模板目录，一般为 `agent-test/templates/core`（**generate 必填**） |
| `PLATFORM_GAME_DOCS_DIR` | 文档树，一般为 `agent-test/docs`（**generate 必填**） |
| `PLATFORM_GAME_TEMPLATES_PARENT_DIR` | 可选；覆盖注入子进程的 `GAME_TEMPLATES_DIR`（默认：模板目录的父级） |
| `PLATFORM_BENCH_COMMAND` | 可选覆盖。未设置时 bench 跑工作区 `npm run test:ci`，再退回 `npm test`；两者都没有则 **失败**（无占位分数） |
| `PLATFORM_OPENGAME_PROVIDER_PREFLIGHT` | 可选：`off`（默认）\|`all`\|`minimax`；在 **generate** 开头调用 Core 的 `resolveProviderConfig`，提前发现缺 Key（与 CLI 一致）。见 [opengame-minimax-one-stop.md](./opengame-minimax-one-stop.md) |
| `PLATFORM_USE_ARCHETYPE_SCAFFOLD` | 默认启用；`legacy-template` 模式下拷贝 `agent-test/templates/modules/{archetype}`。engine 模式用 Scene 桩 + `@opengame/module-*` |
| `PLATFORM_PROJECT_SCAFFOLD_MODE` | **`engine`**（推荐，classify 后注入 module 依赖 + Scene 桩）、`skeleton`（仅 grid/极简 POC）、`legacy-template`；需 `PLATFORM_RUNTIME_SKELETON_DIR` + `PLATFORM_RUNTIME_PACKAGE_SPEC` |
| `PLATFORM_MAX_FIX_ITERATIONS` | generate FSM 自愈轮次（默认 5；RPG/剧情建议 8） |
| `PLATFORM_ENABLE_ASSET_PHASE` | 默认启用；首次生成在 CODE 前跑 ASSET 阶段（`generate_game_assets`） |
| `PLATFORM_GAME_QA_MODE` | `relaxed`（默认）或 `strict`（要求 audio/BMG） |
| `PLATFORM_REQUIRE_WORKSPACE_ARCHIVE` | 设为 `true` 时强制配置 S3 工作区快照前缀（多 Worker 池必填） |
| `PLATFORM_STREAM_CLI_STDOUT` | **默认开**。把 CLI stdout 节流写入 `agent_events`（约 2s / 最多 40 条）。设 `false`/`0` 关闭。完整日志仍上 S3；工作室经 `GET /v1/jobs/:id/log` 读全文 |
| `workspaceArchiveKeyPrefix` | 见 WorkerEnv；与 `PLATFORM_REQUIRE_WORKSPACE_ARCHIVE` 配合。API 用同一前缀读 `manifest.json` 的 `savedAt` |
| `PLATFORM_ALERT_WEBHOOK_URL` | 可选。死信 HTTP POST（无 secret）。作者告警在工作室失败面板 / Quality **默认开**；生产未设此变量会打警告，不会假装已通知运维 |
| `PLATFORM_DATABASE_URL` | PostgreSQL 连接串（Worker 与 API 共用 schema） |
| `PLATFORM_REDIS_URL` | BullMQ / 配额计数 |
| `PLATFORM_S3_ENDPOINT` | S3 兼容端点（如 MinIO `http://minio:9000`） |
| `PLATFORM_S3_REGION` | 区域字符串（MinIO 可用 `us-east-1`） |
| `PLATFORM_S3_BUCKET` | 存储桶名 |
| `PLATFORM_S3_ACCESS_KEY` / `PLATFORM_S3_SECRET_KEY` | 对象存储凭证 |
| `PLATFORM_S3_FORCE_PATH_STYLE` | MinIO 设为 `true` |
| `PLATFORM_PUBLIC_OBJECT_BASE_URL` | 可选；CDN 或对外 MinIO 反代基址。若设置且桶对 `projects/*/artifacts/*/dist/*` 可读，则预览 `index.html` 与 `assets/*` 同源直链；**不设**时由 `platform-api` 的 **`/v1/preview-dist/...` 签名代理** 从私有桶流式输出整个 `dist/`，避免仅 `index.html` 带签、子资源 403 黑屏。 |
| `PLATFORM_PUBLIC_BASE_URL` | 可选；Web 与 API 不同域时，填 API 对外 origin，用于拼绝对预览代理 URL（默认同源相对路径 `/v1/...`）。 |

### 3.2 OpenGame 多模态与主 Agent

Worker 应注入与 [.env.example](../../.env.example) 相同的 **`OPENGAME_*`**、**`OPENAI_*`**（或 Anthropic 兼容）变量，**不在容器内保存用户明文 Key**；由平台从 KMS 在任务启动时注入。

最小推理 / 资产能力集：

- `OPENGAME_REASONING_PROVIDER`、`OPENGAME_REASONING_API_KEY`、…（`generate_gdd`、`classify_game_type`）
- 图像 / 视频 / 音频 provider 与 Key（与 `generate_game_assets` 一致）
- 主循环：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`（或等价）

### 3.3 权限与沙箱

- 使用 `permissionMode: 'auto-edit'`（SDK）或 CLI 等价策略；**禁止**默认 `yolo` 与无限制 shell。
- 出站网络：仅允许模型 API、对象存储、（可选）npm registry；由 VPC / 防火墙策略保证。

### 3.4 可观测性

- 每个 Job 携带 **`trace_id`**（W3C trace 或 UUID），写入结构化日志与 DB `jobs.trace_id`。
- 构建 / 生成 stdout/stderr 上传对象存储或日志系统，DB 存 `log_key` 或短摘要。
- Worker 启动后应看到 `[worker] active <jobId>`；若 UI 长期「排队中」，检查 Redis、Worker 并发=1、以及 DB 中卡死的 `running` job。
- **Dev 恢复**：`POST /v1/projects/:projectId/jobs/stale-recover`（需 `PLATFORM_ALLOW_DEV_AUTH=true`）将超过 N 分钟未更新的 `running` job 标为 `failed`，释放队列。

### 3.5 Engine scaffold 与模块包

当 `PLATFORM_PROJECT_SCAFFOLD_MODE=engine`（默认，在配置了 skeleton env 时）：

1. **classify + GDD → Agent 上下文（RAG 按 archetype 检索）→ engine scaffold** — 不再 skeleton-first 或 classify 前 RAG
2. GDD 解析出的 **Scene key 清单** 写入 `.opengame-pipeline.json`（`gddSceneKeys`），驱动 Scene 桩与质量门禁（非固定 Title/Battle 文件名）
3. `skeleton` 模式若 archetype 为 RPG/动作等复杂类型，Worker **自动升级为 engine** 并注入 module 依赖
4. 构建通过后：**Playwright 冒烟** + **archetype/GDD 完成度门禁**
5. 可选：`PLATFORM_RAG_USE_DB=true` + `npm run platform:ingest-module-docs` 将 `agent-test/docs/modules` 入库

本地样例：`examples/platform-rpg-starter`。

## 4. CI 与本地对齐

- **生产 Worker**：仅 **Linux**；不在 Windows 上跑生产构建链。
- **本地**：可仅启动 `docker-compose.platform.yml` 中的 Postgres + Redis + MinIO，在宿主机运行 `npm run platform:dev`（见 [hosted-deployment.md](./hosted-deployment.md)）。

## 5. 版本钉扎

Worker 镜像应钉扎 **OpenGame 包版本**（`@opengame/opengame-core`、`@opengame/sdk`、CLI bundle），与集成测试通过的组合一致，升级走发布说明与回归。
