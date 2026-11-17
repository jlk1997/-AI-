# 双发上线当日勾选（不含支付商户密钥填写）

对照代码硬闸：[`productionGates.ts`](../../apps/platform-api/src/lib/productionGates.ts)。带着本地 `.env` 上云应当**起不来**。

## 启动前

- [ ] `PLATFORM_RUNTIME=production`（或 `NODE_ENV=production`）
- [ ] `PLATFORM_ALLOW_DEV_AUTH=false`
- [ ] `PLATFORM_MAGIC_LINK_ECHO=false`
- [ ] `PLATFORM_ALLOW_MOCK_PAYMENTS` 未开
- [ ] `PLATFORM_BILLING_ENFORCE_POINTS=true`
- [ ] `PLATFORM_JWT_SECRET` 长随机串，不是 `change-me`
- [ ] `PLATFORM_WEB_BASE_URL` / `PLATFORM_PUBLIC_BASE_URL` 已填
- [ ] `PLATFORM_ALLOW_PUBLIC_PLAY_URLS=false`
- [ ] 邮件：`PLATFORM_MAIL_PROVIDER` + from + key（海外主登录）
- [ ] 或仅国内：`PLATFORM_AUTH_WECHAT_ONLY=true` 且微信 App 已配（双发不要走这条）
- [ ] `PLATFORM_ALERT_WEBHOOK_URL` 已配（API / Worker 生产必填）
- [ ] `PLATFORM_ADMIN_EMAILS` 有值班人
- [ ] Web 半成品旗标全关：`VITE_SHOW_ECOSYSTEM` / `RESEARCH_LAB` / `CUSTOM_DOMAIN` 未开。世界走向盘默认开（不要靠关 `VITE_SHOW_COURSE_MARKET` 藏盘；关掉等于世界轨停售）
- [ ] 跑过 `packages/platform-db` 迁移（含 `0034_launch_privacy`、`0035_world_course`、`0036_course_one_active`）
- [ ] 运营项（不写进代码）：ICP / 域名 / 公司主体 / 投诉邮箱已填进条款与隐私页预留位

## 边缘

- [ ] API / Worker / Web 用仓库镜像：[`deploy/Dockerfile.platform-api`](../../deploy/Dockerfile.platform-api)、[`deploy/Dockerfile.platform-worker`](../../deploy/Dockerfile.platform-worker)、[`deploy/Dockerfile.platform-web`](../../deploy/Dockerfile.platform-web)（或 `npm run platform:launch` 叠在 infra compose 上）
- [ ] 使用 [`deploy/Caddyfile`](../../deploy/Caddyfile) 或 [`deploy/nginx.conf`](../../deploy/nginx.conf)
- [ ] `/readyz` 探到 PG + Redis + 队列（`checks.queue=ok`）
- [ ] 爬虫 UA 打开 `/play/:slug` 有 OG 卡，不是空 SPA；海外 UA/`lang=en` 的兜底说明是 Gebi，不是 OpenGame

## 备份（L2 演练也用这份）

- [ ] Postgres 逻辑备份已落到第二个磁盘 / 对象存储（日备，可用 [`deploy/backup-postgres.sh`](../../deploy/backup-postgres.sh)）
- [ ] S3 / MinIO 桶可列、可恢复一个预览前缀（版本或跨桶，可用 [`deploy/backup-s3.sh`](../../deploy/backup-s3.sh)）
- [ ] 恢复演练：新库跑 migrate + [`deploy/restore-postgres.sh`](../../deploy/restore-postgres.sh)，抽一条社区作品能打开
- [ ] 每月至少一次恢复演练，记下耗时与缺文件

## 冒烟

中文一条、英文一条：登录 → 玩一局 → 进别人的镇看见今夜题并压一档 → 空钱包进钱包不假成功 → 违禁词发布被挡 → 举报下架后 play-url 停发。

世界访客页不卖镇时 / 点亮 / 认养；底约 `36/80` 只在后台限流，不进访客 DOM。作者工作室仍可点亮本镇。支付商户进件不在本清单。世界轨验收见 [world-betting.md](./world-betting.md)。
