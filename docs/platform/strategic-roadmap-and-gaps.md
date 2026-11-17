# AI 自然语言游戏引擎：缺口分析、Mock 清单与长期规划

本文档面向「**托管平台 + OpenGame Core/CLI**」一体化产品：平台负责身份、项目、队列、工作区、构建产物与可观测性；**一切模型与多模态能力（含 MiniMax 图文音视频与音乐）均在 OpenGame Core 内实现**，平台不复制 HTTP 适配器。原则说明见 [opengame-minimax-one-stop.md](./opengame-minimax-one-stop.md)。

---

## 1. 产品定位（跨代际能力的边界）

| 层级 | 职责 | 不应做 |
|------|------|--------|
| **OpenGame Core / CLI** | 对话式改代码、Game Skill、工具链（含 `generate-assets`、MiniMax 等）、沙箱与审批策略 | 组织计费 UI、多租户队列 |
| **托管平台（本仓库 apps + platform-db）** | 多租户、Job、S3、预览 URL、配额、（可选）商业化钩子 | 再实现一套 MiniMax / OpenAI 调用层 |
| **Web 控制台** | 一站式入口：登录、选项目、发消息、看 Job/日志/预览 | 内嵌「小游戏 IDE」替代 CLI 的全部能力（可渐进） |

**一站式**在用户侧的含义：从自然语言到可玩预览，**一条消息链触发 `generate` → `build` → 预览**；中间所有 AI 与资产生成由 **子进程 OpenGame** 完成，用户无需自行拼管道。

---

## 2. 当前已实现（与代码对齐的「真」能力）

- **真实生成 / 构建 / 发布**：Worker 调 `dist/cli.js`；`npm ci` + `npm run build`；`dist/` 上 S3；preview / production deployment。
- **Job SSE**：`GET /v1/projects/:id/events` 经短时 `sse_ticket`（禁止生产把 session JWT 放进 query）。
- **认证**：Magic Link、微信 OAuth、可选手机 OTP（无短信提供商则登录页藏入口）；`dev-token` 仅 `PLATFORM_ALLOW_DEV_AUTH`。生产 Redis 宕则 Magic 429。
- **中国主路计费**：点数账本、微信/支付宝 notify、加戏/巷议分轨。Stripe Checkout 会话 API 已接线（无 key 则 503）；webhook **有 secret 才处理**。
- **社区双环**：发布、未登录游玩、remix、关注、今晚这座镇。见 [product-design.md](./product-design.md)。
- **巷议世界**：Spec + 社会种子 + MemoryStream + 观测台 SSE。
- **质量门禁**：ChangePlan / juice / 真图真音 / requirement 软门（默认仍可关）。清单见 [quality-pipeline-checklist.md](./quality-pipeline-checklist.md)。
- **Bench Job**：仅当配置 `PLATFORM_BENCH_COMMAND`；否则失败。公开评测管线（OpenGame-Bench）**未开源**。
- **配额 + 点数**：并发 / 日 Job 与可选 `PLATFORM_BILLING_ENFORCE_POINTS` 并行。
- **公开 API 两套入口**：见 [public-api-map.md](./public-api-map.md)。

---

## 3. Mock、半实现与「诚实缺口」清单

以下用语：**Mock** = 接口存在但无业务效果；**半实现** = 有部分逻辑但未闭环；**缺口** = 能力未开始或仅停留在 schema/文档。

### 3.1 平台 API

| 项 | 类型 | 说明 |
|----|------|------|
| `POST /webhooks/stripe` | **半实现** | 有 secret 则验签并写 `subscriptions`。生产无 secret → **503**。无 Checkout 页（中国主路是微信/支付宝）。 |
| `GET /billing/plans` | **半实现** | 中国价目 + 点数包；Stripe Checkout 未做。 |
| 手机 OTP | **半实现** | 无 `PLATFORM_SMS_PROVIDER` 时生产 503；dev/echo 才回显验证码。 |
| 插件 / 自定义域名 UI | **半实现** | API 在；导航默认隐藏（`VITE_SHOW_*`）。域名是 DNS TXT，不是真 ACME。 |
| 云存档 / 成就 SDK | **已实现（新包）** | runtime bootstrap 接 `SaveStore.remote` + `og:win`；旧包仍可能空。 |
| 入队扣点 | **已实现** | `insertChargedJob` 把 job 行与扣点放进同一事务；扣点失败不入队。 |
| 支付补单 | **已实现** | notify 写入 Redis；`POST /billing/orders/:id/reconcile` 重放，无 notify 则 409。 |
| 加戏核消（Web） | **已实现** | 宿主 `postMessage` 后调用 `jiaxi/consume`，禁止付钱无效果。 |
| 审计日志 | **已实现** | `audit_log`：发布 / 下架 / 恢复 / 域名 / UGC 拦截 / 模板 apply / `org.invite`。 |
| 死信查询 | **已实现** | `GET /projects/:id/dead-letters`；`POST .../dead-letters/:id/requeue` 复制任务入队并删除该死信行（已入队再点 → 409）。失败面板 / Quality 有作者告警条。运营 `GET /admin/dead-letters`。 |
| 邀请协作者 | **已实现** | `POST /projects/:id/members` 写入 `organization_members`（生成/构建才认这张表）；`GET /orgs`；`GET /projects` 无 org 或 `organizationId=all` 列出自己加入的全部组织下的游戏。对方必须先登录过。 |
| 今晚巷口榜 | **已实现** | `GET /v1/community/alley`：最热 / 最多改一句走 `community_day_stats` 中国日；还在过日子走社会时钟。播放只在 play-url / visit 计一次（30 分钟 / 访客，游客登录同 IP 互锁）。`remix_count` SQL 自增。fork 每用户每小时 8 次。邀请深链 `/play/:slug?invite=` 全路由领取。关注镇「又过了几天」可转发海报。 |

### 3.2 平台 Worker

| 项 | 类型 | 说明 |
|----|------|------|
| 死信 | **已实现** | 失败递增 `retry_count`；耗尽重试写入 `job_dead_letters`（每 job 一行）；可选 `PLATFORM_ALERT_WEBHOOK_URL`。生产无 URL 会打警告；作者在失败面板 / Quality 看到告警条。 |
| 单机工作区 | **已接线（产品可见）** | S3 archive **默认开**。`GET /projects/:id/workspace-archive` 读清单 `savedAt` / 文件数。多 Worker PVC 仍后置。 |
| 构建缓存 | **已接线（产品可见）** | 独立 build 命中写 `jobs.result.cacheHit` + usage；Quality 展示命中/重建。 |
| 模板来源 | **已接线** | 钉住 slug@version；空仓或 `rescaffold_requested_at` 时按钉重建源码。重建先快照再替换，**不删** S3 预览。 |
| CLI stdout 流式 | **已实现（节流 + 全文）** | 默认写入 `agent_events`（约 2s / 最多 40 条）。完整日志上 S3；`GET /v1/jobs/:id/log` 由 API 代理正文，工作室 Quality 成功/失败均可打开。 |
| Bench 命令 | **已实现** | 无 `PLATFORM_BENCH_COMMAND` 时跑工作区 `test:ci` / `test`；没有脚本则诚实失败。 |

### 3.3 数据库 schema 中「尚未接线」的潜力

| 字段 / 表 | 说明 |
|-----------|------|
| `deployments.custom_domain`、`*_acme_*` | TXT 挑战可写；证书签发仍 out-of-band。 |
| `world_chunks` | 预留，应用未读写。 |
| `chat_sessions` 父会话 | **已接线** | `fork` 写 `parentId`；工作室会话抽屉按树缩进并标「分叉自」。 |
| `projects.rescaffold_requested_at` | **已接线** | Quality 排队；下次 generate 快照后按钉重建源码，预览保留。 |
| 双 `0004_*.sql` | 历史同号；靠 `IF NOT EXISTS`。新迁移记入 `schema_migrations`。 |

### 3.4 Web 控制台（`platform-web`）

| 项 | 类型 | 说明 |
|----|------|------|
| 工作室 + 社区 | **已实现** | 聊天、Job 时间线、iframe 预览、发布、钱包。Quality 可邀请协作者（写入组织成员）、一键独立 build。 |
| 插件 / Bench / 开发者中心 / Lab | **默认隐藏** | `VITE_SHOW_ECOSYSTEM` / `VITE_SHOW_RESEARCH_LAB` / `VITE_SHOW_CUSTOM_DOMAIN`。工作室 Quality 的官方模板钉选与项目 Bench **默认可见**（不依赖生态旗标）。 |
| Stripe Checkout | **缺口** | 明确后置。 |

### 3.5 与「全模态」相关的认知对齐

- **MiniMax 图文音视频与音乐**：能力在 **Core 工具与 provider** 中；平台 **不会** 也 **不应** 按模态拆分微服务。
- **平台侧 `usage_events.modality`**：当前值为 **Job 语义**（`generate` / `build` / …），**不是** Core 内的 `image` / `video` / `audio` token；`meta` 已记 `jobType` / `contentHash` / 耗时。若要做「按模态账单」，需 **Core 在会话结束时可机读导出用量** 或 **平台解析结构化日志**（优先前者，避免 fragile 解析）。`GET /v1/usage` 聚合近 30 天。

---

## 4. 缺失的功能模块（按优先级分层）

### P0 — 一站式体验「闭环」仍缺的部分

1. ~~**流式可观测**~~：Job / 巷议 SSE 已落地；时间线展示「大约还要 N 分钟」。
2. ~~**聊天 UX**~~：会话、重试、恢复建议已落地。
3. ~~**点名玩法门禁默认开**、早预览、云存档接线~~：requirement gate / 骨架预览默认开；runtime 接 SaveStore。
4. ~~**预览诊断**~~：游戏 iframe 与观测台探测 CORS / 404 / 超时 / HTML-as-JS；条带展示失败 URL 与 HTTP 状态。

### P1 — 规模与可靠性

4. **横向扩展**：工作区 S3 清单已默认上/下；工作室可读上次 `savedAt`。独立 build 缺 `package.json` 时恢复。多 Worker 亲和 / PVC 仍后置。
5. ~~**Job 重试与死信**~~：失败递增 `retry_count`；毒消息写入 `job_dead_letters`；可选 `PLATFORM_ALERT_WEBHOOK_URL`。入队指数退避（3 次 / 5s）已开；成功后写 `job.success` + `job.queue` 深度。
6. **OpenTelemetry**：结构化 `og.job.metric` 已有（含 success / queue）；完整 SDK / 仪表盘仍后置。

### P2 — 商业化与治理（可选，与「非商业化优先」文档并存）

7. **Stripe 实装**：Webhook 验签、订阅状态机、`subscriptions` 与 `dailyJobLimit` 按 plan 联动。
8. **用量精细化**：`GET /usage` 按 Job 语义聚合，并返回 `byJobType` + 近 12 条 `recent`（含 `meta.ms`）。钱包用中文任务名。Core 模态 token 账单仍后置。
9. **审计与 RBAC**：`audit_log` 已记发布 / 下架 / 恢复 / 域名 / UGC 拦截 / 邀请。发布 / 自定义域名 / 邀请需组织 `owner` 或 `admin`。邀请写入 `organization_members`（不只是 `project_members`），`GET /projects` 默认列出自己加入的全部组织下的游戏。生成 / 构建仍对任意成员开放。

### P3 — 差异化「游戏引擎」体验

10. ~~**模板与市场**~~：官方 / 社区频道列表；apply 按 version 钉住并写审计；Worker 空仓时按钉执行。官方 `core@1.0.0` / `skeleton@1.0.0` 可重复 seed。工作室 Quality 可钉官方模板并回滚版本。社区模板商店 UI 仍 `VITE_SHOW_ECOSYSTEM`。
11. ~~**Bench 产品化**~~：默认 `test:ci`/`test`；`GET /projects/:id/bench-runs`；工作室 Quality 面板可跑、可看。公开榜仍 `VITE_SHOW_ECOSYSTEM`。
12. **自定义域名 + CDN**：接 Cloudflare / AWS 完成 TLS 与缓存策略。

### 玩法语义产品化（Phase-24/25，与平台基建解耦）

- **多轮改口**：`ChangePlan` SSOT + 意图门禁 + 画风 force 重生；聊天带 `gameParams`；摘要降权 Job 文案。
- **世界编辑视觉同步**：`world_edit` 对 dirty 区域跑空间/MiniMax 刷新；`planWorldOps`；重生二次确认与修订回滚 tip。
- **LingBot 预期诚实**：`/step` 标 `presentationMock`/`recordingOnly`；产品主路径 = 离线 clip → `spatialAssets`；Marble stub 仍不可点出假成功。
- **Phase-26 加固**：reset 清空可玩产物后首轮重生；Boss/harder 冒烟探针；FIX 策略机（asset-only / scene-patch / abort）；eval-smoke 多轮断言；聊天 GameConfigBar 参数并入。
- **Phase-27**：ChangePlan 直接播种 DSL Boss/难度 + `og_intent` 注册表；juice 防冲核加硬；街机 skill 音效；世界编辑 depth pad；`quality:multiturn-smoke` 三连离线验收。
- **Phase-28**：Snake/Flappy/2048 专属 juice 内核；`JUICE_BASELINE` 硬锁防 CODE 抽空；addScene 播种；`quality:blind-scorecard` 人工盲测记分板。
- **Phase-29**：街机接 MiniMax 真图/音槽；参考图 URL 进资产 prompt；盲测/多轮进 `platform.yml` CI；冒烟在 beyond/街机/ChangePlan 下默认要 progress。
- **Phase-30**：横版 Level 按 `bossPresent`/`enemyCount` 真生成 Boss+加敌；`preloadGameArt` 别名 `og_*` + `spriteOrRect`；聊天参考图落盘 `public/refs`（禁 base64 塞 prompt）；depth pad/缺海报区域刷新；eval/盲测契约对齐 `presentationMock` + Boss 生成路径。
- **Phase-31**：`ASSET_FINGERPRINT` 画风哈希门禁（禁仅改 GDD）；MiniMax `subject_reference` 真多模态；top-down/Battle/TD 也读 Boss/harder；L3 小世界全区域海报门禁。
- **Phase-32**：CODE 后重放 ChangePlan + `ensureChangePlanSceneContracts`；FIX 区分 artStyle/juice/scene；Lab 出片步骤仅 `videoUrl` 算完成（mock frame 不算）。
- **Phase-33**：ChangePlan abort → `RECOVERY.json` + 可读「建议下一句」；失败任务面板展示恢复文案；世界增量编辑二次确认；编辑后时间线提示新区海报已刷。
- **Phase-34**：失败恢复「建议下一句」一键填入聊天；FAIL 事件附带 suggestedPrompts；修订历史展示 dirtyRegions 海报 diff；`opJson` 持久化 dirtyRegions。
- **Phase-35**：恢复建议一键**发送**；错误气泡可点建议 chips；`diffWorldSpecs` + `GET .../revisions/:rev/diff`；修订历史展示 Spec 摘要并可对比 tip。
- **Phase-36**：FIX/CODE 后按 `JUICE_BASELINE` **确定性恢复** juice（禁无声色块）；`diffWorldSpecs` 补 entity/rule ID 列表并在 WorldPanel 展示。
- **Phase-37**：MiniMax→火山 Ark 图 failover 产品可见；音频配额软跳过保 prior；时间线 `failoverEvents` / `mixed-failover`。
- **仍后置**：自训空间大模型、商用 NC 默认、Stripe/多 Worker（见上文 P0–P2）。

### 长期 — OpenGame 本体（非平台仓库内，但路线依赖）

- **更强 Game Skill**：关卡数据 DSL、运行时热更、与 Phaser 模板深度绑定。
- **多 Agent 编排**：策划 / 程序 / 美术角色分工（仍在 Core 内，平台只传 `prompt` 与策略）。

---

## 5. 长期路线图（与 18 个月落地规划对齐）

顺序：**真相/安全 → 拆神文件 → 玩改发闭环 → 中国商业化 → 巷议加厚 → 规模与 Bench**。禁止再堆无契约的 Phase-38。

- **第 0 波（已落地）**：文档 SSOT、生产 CORS / Stripe 503 / SSE ticket、半成品入口默认藏。
- **第 1 波（已落地）**：`v1.ts` 按域拆路由；`processJob` FSM 分文件；workspace 场景内核；`.opengame` 双读；增量 `platform:dev:prepare`。
- **第 2–4 波（契约已接线）**：requirement gate 默认开、SaveStore/成就、三轨钱包、加戏核消（Web `postMessage` + consume）、观测台为什么条与花名册拆分、heartbeat 租约默认。
- **第 5 波（已落地）**：工作区 S3 默认开、入队扣点同事务、支付 notify 补单、`audit_log` / 死信落库、生成提示 UGC、时间线 ETA、OpenGame-Bench MVP 目录。
- **第 6 波（已落地）**：预览 CORS/404/超时诊断、组织 owner/admin 门禁、`GET /usage` + usage meta、独立 build 的 `content_hash` 缓存与 S3 恢复、`job.success` / 队列深度指标。
- **第 7 波（已落地）**：Bench 默认 `test:ci` + 工作室结果条、`template_packages` 驱动空仓脚手架 / 官方频道 / 按版本回滚、项目死信 API 接到失败面板。
- **第 8 波（已落地）**：CLI stdout 节流默认开、官方模板可重复 seed（迁移 0027 + list 幂等补种）、会话 `parentId` 树状抽屉。
- **第 9 波（已落地）**：工作室 Quality 钉官方模板 / 回滚版本（不打开社区市场旗标）。
- **第 10 波（已落地）**：`GET /jobs/:id/log` API 代理全文、Quality 日志条、按钉重建源码（预览保留）、钱包按任务类型 + 耗时。
- **第 11 波（已落地）**：独立 build 缓存命中可见、死信一键重入队（并摘标）、工作区 S3 快照时间诚实展示。
- **第 12 波（已落地）**：邀请写入组织成员 + `GET /orgs` + 跨组织项目列表；工作室 Quality 协作者条与一键独立 build；失败重试 / 项目 toast 走 i18n。
- **第 13 波（已落地）**：今晚巷口榜（最热 / 最多改一句 / 还在过日子）；`play_count` / `remix_count` 原子自增；详情 GET 不再刷榜；play-url / visit 每访客 30 分钟计一次；fork 每小时 8 次。
- **第 14 波（已落地）**：`?invite=` 全路由捕获、登录必领、play/share 带短名；喝彩/加戏/评论/评分/play-session 小时闸；入队事务内重查配额；挑战赛先占座再扣点；首次套餐 claim；项目级 fork 接 license；visit 与 play-url 共用 `playVisitorKey`。
- **第 15 波（已落地）**：`community_day_stats` 中国日热力，巷口最热/最多改一句按今日排；邀请落地条；桌面/发布复用海报与微信分享；加戏 consume / 镇时 / 课题结算 / 世界 restore 竞态；`remix-credit` 可见署名。
- **第 16 波（已落地）**：关注镇「又过了几天」可转发海报；游客/登录播放双键互锁；死信与失败重试占座幂等；产凭爬虫反代片段。
- **第 17 波（已落地）**：死信每 job 一行；工作室失败面板 / Quality 作者告警默认开；生产无 `PLATFORM_ALERT_WEBHOOK_URL` 打警告；关注镇海报走 i18n。
- **第 18 波（已落地）**：插件/模板先占座再扣点；每日登录与任务奖条件领取；邀请人日帽进锁；认养 `GREATEST`；加戏先验效；巷议/夜市/镇时失败退点；报价与首购折扣同事务加锁；钱包余额与流水同事务。
- **第 19 波（已落地）**：支付入账与点数同事务（失败可重放 notify）；首充/见面礼/任务奖/邀请领取/月度发放 claim+credit 同事务；喝彩券核销与作者入账同事务；残局续写付了却建不成项目则退点；认养扣点与占座同事务；沙盘落档失败退点；周课题奖池领取与入账同事务；Job 扣点按 `jobId` 行锁幂等；世界 restore/补丁乐观锁 tip，冲突 409 且不扣点；重入队在事务内重查配额；插件 `installCount` 仅在新安装时 SQL 自增。
- **双发 L0（已落地）**：生产自毁闸、`GET /readyz`（PG+Redis+队列+耗时）、Magic/IP fail-closed、产日志只打 hash+delivery、`/privacy`、导出/删号、发布勾选条款、UGC 拒绝类别、喝彩/加戏/play-session Redis 崩 fail-closed、心跳 persist 失败先入重试队列再退槽、API tick 先锁后占座、可部署 Caddy/nginx、API/Worker/Web 镜像与 `docker-compose.launch.yml`。
- **双发 L1（已落地）**：`POST|GET /v1/billing/checkout/stripe` + `/wallet?cs=` 回跳核对入账、`PLATFORM_BILLING_STRIPE_STOREFRONT`、巷口英文标明中国今晚 UTC+8、分享卡/海报/关注镇按语言出中英兜底、落地页/PWA title/OG 带 Gebi 与「玩改发」、空巷不再说 IDE、控制台 README 称隔壁 / Gebi。
- **双发 L2（已落地）**：生产告警 URL 与值班邮箱必配、`/v1` 用户+IP 限流、未登录 `/v1`（分享卡/登录）按 IP 限流且不误伤 play-session 资源、钱路/隐私/生成入队 Redis 崩 fail-closed、删号先吊销会话再关户、导出/删号失败有明确提示、取消任务只对仍 queued 的行退点、`/api/public/.../embed` 与 `/v1` 同源策略+play-session、手机 OTP 申请/校验双限流、举报小时帽 fail-closed、社区详情预注册微信卡、作者申诉（含 `/play` 手机页、资料页/「我」下列出下架标记）、`societyLlm` 归一（路由旧桩已删）、图/音备钥仅付费 generate / world_generate、zh/en key 对齐断言、镇舞台拆出模型/地图面/观察提示、日备/S3/恢复脚本进 `deploy/`、爬虫 UA 含 Discord/Telegram/LinkedIn/WhatsApp、launch compose 等 PG/Redis 健康且 `/readyz` 后再起 Worker。
- **走向盘强度环（已落地）**：镇 SSE `og:course` + Desk 4s GET 兜底；对手/封盘/赢输退 toast；结算写 observation 正史（题面语种）；访客/作者下一题跟世界走（节拍 → 村子夜市 / 否则是否盘）；有仓时后台优先排对白槽（不催访客买镇时）；项目 `/world/residents`；结盘读 `regionId`/move 镇外；夜市字条只进镇不配针；窗内取证；挂盘节点锁去重；Worker 与 API 同 60s 结盘。盘面不重置筹码、结盘正史条留几秒、玩法可收起。世界盘面默认开，访客页不卖镇时/点亮/认养。
- **走向盘（已落地，世界默认开）**：`world_course_*` 出题/锁点分彩/谓词结算；开盘起窗，付费巷议/夜市 `intervene` 与窗内记忆/关系可作证据（记忆只破平，不盖过现货）；夜市按选项 key 挂盘；回档事件与垫词对白不判盘；静音/停钟/下架/一边倒整盘退（停钟结算一律退，下架也退未绑 gameId 的孤儿盘；只有一边有仓不算对手盘，不抽成；封盘前可收回，封盘无对手立刻退；续命只在真有对手时催）；成盘抽 15%（作者七成），8 倍封顶余数入平台沉没并记账；小池第二人仍能坐下最少一注，API 只收 12/24/48；锁点按节点串行；一镇一盘（`0036`）。世界盘面默认开，进页 `ensure` 保底出题；`VITE_SHOW_COURSE_MARKET=false` 才整轨停售。访客页只卖仓位，不卖镇时/点亮/认养/付费巷议；对白门闩改为 presence + 额度，数字不进访客 DOM。盘面公开谁在吹风，并写清「还要有人对着压」；空对白出题标明会退；作者可出夜市/是否/节拍/自定义题（作品页作者卡与观测台同一套）；盘面两句玩法 +「压 n 点 · 此刻若赢约 n」；未登录写清围观免费；作品页右栏即盘面；巷口列出题面；盘面显示封盘/结算剩余时间（中国今晚 UTC+8）；退盘原因中英可读；API 每分钟结盘；手机 `/play` 与桌面同一套主 CTA；钱包流水能看锁点/分彩/退回；分享卡带正史一句。结盘先锁节点再读仓；关盘只改状态，开盘/GET 只关本镇；锁点顺序固定为节点→组织；一镇一盘撞唯一键则收回已有盘。是否盘按点名居民最后一次活证据判还在或离开。正文：[world-betting.md](./world-betting.md)。
- **仍后置（L3）**：真 ACME、联网对战、L3 商用默认、第 6 个 archetype 桶、完整 OpenTelemetry、多 Worker PVC 亲和。无密钥则 Stripe 503。清单：[launch-day-checklist.md](./launch-day-checklist.md)；地平线：[launch-horizon.md](./launch-horizon.md)。

---

## 6. 设计原则（防止偏离 OpenGame）

1. **模型与模态**：只通过 **OpenGame CLI/Core** 暴露；平台新增能力时先问「是否属于 Core 的 Tool/Provider」。
2. **平台新增 API**：应服务 **租户、资产、队列、观测、计费**，不服务「再包一层 ChatCompletion」。
3. **MiniMax 全模态**：用户配置路径统一指向 `docs/users/configuration/minimax.md`；平台文档只写 **编排与预检**，不写各 API 字段表。
4. **诚实失败**：延续「无 `PLATFORM_BENCH_COMMAND` 则 bench 失败」哲学，避免虚假成功损害信任。

---

## 7. 与现有文档的关系

- 用户旅程与功能矩阵：[product-design.md](./product-design.md)
- OpenGame + MiniMax 架构边界：[opengame-minimax-one-stop.md](./opengame-minimax-one-stop.md)
- Worker 环境变量：[worker-environment.md](./worker-environment.md)

本文档应随每个大版本 **更新 §3–§5** 中与实现对齐的行，避免规划与代码脱节。
