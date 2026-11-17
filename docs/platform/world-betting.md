# 世界轨：围观免费，只卖下注

世界商业化唯一正文。游戏轨（加戏 / 喝彩）见 [game-commerce.md](./game-commerce.md)。生成不卖。

一句话：**作者出对白钱，访客只压今晚一题；围观免费；平台 key 池切换，不按句收费。**

## 1. 三种人

| 人 | 付钱买什么 | 不做什么 |
| --- | --- | --- |
| 访客 | 仓位（`course_stake`，12 / 24 / 48 点）；可打赏续灯 | 不买镇时 / 点亮 / 认养 / 付费巷议；不写结局 |
| 作者 | 发布时必须先给这座镇买运行时（点亮今日 / 本周）；成盘吃抽成（`course_rake`）；可打赏续时、可停钟 | 不压自己的镇；不出访客点亮商店 |
| 平台 | 抽成剩余 + 8 倍封顶沉没 | 不把 36/80 底约写进访客 UI；资助有效期内不用 36/80 掐嘴 |

数值以 [`packages/platform-shared/src/courseMarket.ts`](../../packages/platform-shared/src/courseMarket.ts) 的 `COURSE` 为准，不在文档另发明。

## 2. 盘面规则（走向盘）

- 一镇一盘（迁移 `0036`）。发布或访客进页 `ensure` 时自动保底出题：**近对白（≥2 句）→ 是否盘 → 两处以上本镇场所 → 节拍（仅当针已进镇声）→ 真夜市 pack 才丰收 / 失火**。学堂镇带客栈、是否盘找不到居民时，都不得再落到丰收模板。无资助 / 无人围观 / 静音时不强行开盘（`skipReason: unfunded`）；保底链全失败时页上可以没有盘，不 500。
- 锁点档位只有 12 / 24 / 48。一边锁定后不能改边。单人不超过池子两成（空池首注上限 200）。
- 开盘 4 小时封盘，再 4 小时取证，由镇上真对白 / 活证据判，不由作者改判。
- 两边都有仓才成盘：抽 15%，作者拿其中 70%，胜方分剩余，单笔最多 8 倍。一边倒：封盘前可收回，封盘即退，不抽成。
- 静音（窗内无对白）、停钟、下架、打平 / 无胜方：整盘退。
- 作者不能压（`author_forbidden`）。未登录看得见盘，点压才登录。

玩法对外两句：选一边锁点；镇走完看对白结算，没对手或没对白会退。不解释 pari-mutuel、谓词 JSON、15% 公式。

## 3. 对白后台合同

对白由作者出。门闩在 [`societyLease.ts`](../../packages/platform-shared/src/societyLease.ts) + [`societyTalkBudget.ts`](../../packages/platform-shared/src/societyTalkBudget.ts)：

| 门闩 | 含义 |
| --- | --- |
| 资助未过期 | 发布时作者买点亮（今日 / 本周，或「开镇」= 点亮今日）；访客打赏把同一条 `lightUntil` 往后叠 |
| 钟未停 | 作者可暂停；停钟仍整盘退 |
| 页上有人 | 没人围观只走路，不烧模型 |
| 平台 key 池 | 继续多 key 切换；不向访客按句收费 |

**去掉**免费 36 / 80 作为开口开关。没灯（也没有本小时点亮包）只走路。资助有效期内 36/80 不得掐嘴。刹车只剩：资助到期、作者停钟、没人在页、key 池空。作者停钟立刻整盘退。心跳 Redis 读不到或挂了，对白关门，不对白。

- **开口**：资助未过期 + 页上有人 + 钟未停 + 有钥匙。
- **只走路**：资助过期、作者停钟、或没人在页。人继续走，新模型对白停；盘可能退。
- **访客 UI**：不写 36、80、`n/cap`、点亮商店。只允许：镇上在说话 / 作者停了钟 / 资助过期只走路；折起打赏续灯。
- **作者工作室**：只显示还亮多久 +「社区听同一条对白」。点亮加的是这座共用镇的运行时。
- `town_time` / `world_light` / `adopt` API 与表保留。社区访客页不挂点亮套餐。

公开发布若这座镇还没资助，拦一下并引导买「开镇 / 点亮今日」或「点亮本周」。点亮本小时不够。私密预览仍可先走。发布弹窗里可直接买今日 / 本周（缺 projectId 时从预览接口补），买完可再点发布。已发布过的部署再点公开，同样要灯还亮着。

有人压了且盘未封 / 取证中时，心跳把这座镇排到前面，并跳过对白节流等待，好让证据落地。押注不是开口开关。资助有效期内就算本小时 36/80 计数已经用尽，peek remaining 仍按底约开口，走路预约对白不会被掐死。打赏（含当日喝彩券）叠同一条 `lightUntil`，作品页侧栏 / 手机抽屉打赏会立刻把灯写回舞台。

## 4. 访客信息架构

社区 `/community/game/:slug`（`role=guest`）与手机 `/play/:slug` 同一套主 CTA：

| 区域 | 看见 | 不看见 |
| --- | --- | --- |
| 地图 HUD | 整幅地图 + 镇钟 + 这盘墙钟（开盘中 / 封盘 / 取证，中国今晚 UTC+8）+ 取证命中闪一下 | 观察台侧栏、模板对白、开口许可、作者调试条、点亮商店 |
| 右栏 / 盘面 | **三幕进度条**（选边锁点 → 镇在取证 → 出结果）+ 每幕一条主文案 + 期次徽章 + 大题面 + 仓位条 + 12/24/48；说一句与打赏续灯折起 | 镇时套餐、点亮、认养、`n/cap`、15% 公式、走向盘行话 |
| 手机 `/play` | 顶栏「去压盘」打开今夜盘面抽屉 | 舞台页脚再挂一套盘、镇时套餐 |
| 次入口 | 免费「说一句」；折起打赏续灯 | 付费巷议商品卡 |

组件：访客盘面是 [`SocietyTownCourseDesk`](../../apps/platform-web/src/components/World/SocietyTownCourseDesk.tsx)（含 [`CourseActProgressBar`](../../apps/platform-web/src/components/World/CourseActProgressBar.tsx) / [`CourseSettlementCard`](../../apps/platform-web/src/components/World/CourseSettlementCard.tsx)）。作者出题是 [`SocietyTownCourseAuthorModal`](../../apps/platform-web/src/components/World/SocietyTownCourseAuthorModal.tsx) + 运营条 [`SocietyTownAuthorOpsBar`](../../apps/platform-web/src/components/World/SocietyTownAuthorOpsBar.tsx)。

发现层：世界卡 / 巷口 / 今晚这座镇 / 关注摘要只在**开盘可压**时徽章「今夜可压」+ 题面一句。封盘取证写「取证中」，结算后写历史。状态徽章写「开盘中」，不许写成「开发中」。

## 5. 作者出题入口

没有「下注开关」——发布即开盘，作者只选题面。盘面不在侧栏。

- 舞台地图三颗脉冲：钟停了、灯灭了、今夜还没出题。运营折在侧栏 [`SocietyTownAuthorOpsBar`](../../apps/platform-web/src/components/World/SocietyTownAuthorOpsBar.tsx)（推荐一题 / 高级出题 / 灯 / 钟 / 盘面状态），不和盘面挤在一起。
- 舞台顶栏 / 页脚 **今夜出题**（未出题才脉冲；已开盘显示三幕进度）打开弹窗。
- 作品页作者卡同一套 seed API。
- 弹窗：**第 0 步推荐一题**（一键 `auto`）+ 高级三步（从哪出题 → 题面 → 怎样算赢）。成盘后 `replace` 会被 API 拒绝（`replace_blocked_contested`）。
- 场所题：用 2～4 个具名场所各成一边，证据针就是场所名。只有一处时不出「没提到」假对面。
- 自动保底：**近对白 → 是否盘 → 场所 → 已进镇的节拍 → 夜市 pack**。学堂镇默认不再用丰收 / 失火。
- 压仓只提升对白排程优先级，不直接改结算结果。
- 下盘可从刚才听见的真对白推荐选项。
- 作者打开自己的世界：没有压按钮，有出题；可点亮 / 停钟。

## 6. API 对照

访客钱路（社区，需登录才能写）：

- `GET /v1/community/games/:gameId/course`（`?ensure=1` 保底出题；无资助/无人围观时 `current: null` + `skipReason: unfunded`；盘面含 `evidenceHealth` / `seedSource` / `reachability` / `evidencePreview`）
- `POST /v1/community/games/:gameId/course`（作者出题；body 可带 `replace: true` 换题——**成盘禁止**，未成盘会先 void 旧盘 `author_replace` 再 seed）
- `POST /v1/community/games/:gameId/course/stake`（账本 `course_stake`，迁移 `0037`）
- `POST /v1/community/games/:gameId/course/withdraw`
- `POST /v1/community/games/:gameId/tip`（打赏或当日喝彩券进作者钱包，并 `stack` 该世界 `lightUntil`）
- `GET /v1/community/games/:gameId/residents`（作者出题用：居民 + 场所 + 近 12 句真对白）

工作室：

- `GET /v1/projects/:projectId/world/course`（`?ensure=1` 与社区同门闩；作者 `POST` 出题不受保底链约束）
- `POST /v1/projects/:projectId/world/course`
- `GET /v1/projects/:projectId/world/residents`
- `POST /v1/projects/:projectId/world/light`（作者点亮，不挂访客页）

`POST /v1/community/games/publish`：世界公开发布且 `lightUntil` 已过期 → `403` `publish_unfunded`。

镇时 / 点亮 / 认养 / 付费巷议路由保留给作者工作室。访客写入这些 SKU 会 `403 visitor_sku`；打赏与压盘不受影响。

`VITE_SHOW_COURSE_MARKET` 不再作为世界默认关闸。世界盘面默认开。

## 6.1 P1 发现与分享（已落地）

- **今夜可压聚合**：社区「世界」侧栏 [`CourseStakeTonightFeed`](../../apps/platform-web/src/components/Community/CourseStakeTonightFeed.tsx) 从镇列表筛 `status=open`，按池排序；`CourseReturnHint` 含 `bettingClosesAt` / `settlesAt` / `contested` 以显示三幕标签。
- **分享深链**：`?course=1` → 桌面滚到 `#og-course-desk`，手机打开盘面抽屉。见 [`courseShare.ts`](../../apps/platform-web/src/components/World/courseShare.ts)。
- **镇史分享**：[`CourseSettlementCard`](../../apps/platform-web/src/components/World/CourseSettlementCard.tsx) + 盘面顶部分享按钮。
- **取证参与埋点**：已压仓 + 取证窗时 [`WorldWhispers`](../../apps/platform-web/src/components/Community/WorldWhispers.tsx) 打 `course_whisper_evidence_banner`（每页每镇一次）；横幅带「去说一句」聚焦输入框。分享打 `course_share`。

### P1 UX 强化（已落地）

- **脉冲反馈**：[`coursePulseUx.ts`](../../apps/platform-web/src/components/World/coursePulseUx.ts) — 赢/输/void 用 success/warning toast；后台标签页可选浏览器通知（首压后轻提示授权）。
- **首压引导**：[`CourseOnboardingCoach`](../../apps/platform-web/src/components/World/CourseOnboardingCoach.tsx) 步骤点 + 跳过；第一步高亮首个选项。
- **发现倒计时**：[`CourseStakeTonightFeed`](../../apps/platform-web/src/components/Community/CourseStakeTonightFeed.tsx) 显示封盘剩余、成盘/待对手标签与「去压盘」；无开压镇时社区侧栏空态。
- **结算体验**：[`CourseSettlementCard`](../../apps/platform-web/src/components/World/CourseSettlementCard.tsx) 进入视口自动滚动；作者 ops 条显示池与成盘状态。
- **幕切换**：第一幕→取证窗时，已压仓访客收到 in-app 提示。

### P1 作者看板与分享深化（已落地）

- **作者指标**：`GET /community/games/:id/course/stats`（作者）与 `GET /projects/:id/world/course/stats`（工作室）返回近 N 局成盘率 / 退盘率；[`CourseAuthorStatsStrip`](../../apps/platform-web/src/components/World/CourseAuthorStatsStrip.tsx) 挂在作者运营条。
- **分享海报**：[`CourseSharePoster`](../../apps/platform-web/src/components/World/CourseSharePoster.tsx) + `CourseShareButton` `withPoster` 弹窗预览后分享。
- **镇史分享**：盘面历史每行「分享这局」复制带 canon 的深链文案。
- **回访提醒**：[`courseOutcomeInbox`](../../apps/platform-web/src/components/World/courseOutcomeInbox.ts) + [`CourseOutcomeBanner`](../../apps/platform-web/src/components/World/CourseOutcomeBanner.tsx) — 用户离开页面后回来看到上次结算（页内已 toast 的不重复打扰）。

### P1 Web Push 与可观测性（已落地）

- **Web Push**：迁移 `0038_course_push_subscriptions`；`PUT/DELETE /me/course-push/subscribe`；结算后 [`notifyCourseSettlePush`](../../apps/platform-api/src/lib/coursePush.ts) 与封盘 [`notifyCourseClosedPush`](../../apps/platform-api/src/lib/coursePush.ts) 向已订阅压仓用户推送（需 `PLATFORM_COURSE_PUSH_VAPID_*`）。首压 [`CourseNotifyPrompt`](../../apps/platform-web/src/components/World/CourseNotifyPrompt.tsx) 授权后自动注册；盘面底部 [`CourseNotifySettings`](../../apps/platform-web/src/components/World/CourseNotifySettings.tsx) 可补开提醒；[`sw.js`](../../apps/platform-web/public/sw.js) 处理 `push` / `notificationclick`。
- **回访横幅**：封盘/结算若用户当时不在页内，[`courseOutcomeInbox`](../../apps/platform-web/src/components/World/courseOutcomeInbox.ts) 记录 `closed` / 赢输退，[`CourseOutcomeBanner`](../../apps/platform-web/src/components/World/CourseOutcomeBanner.tsx) 引导回盘或去吹风。
- **Grafana**：[`docs/platform/ops/course-observability.md`](./ops/course-observability.md) + [`course-grafana-dashboard.json`](./ops/course-grafana-dashboard.json)（Loki 查询 void / contested / seedKind）。
- **发现卡片**：[`WorldCard`](../../apps/platform-web/src/components/Community/WorldCard.tsx)、[`FollowingFeed`](../../apps/platform-web/src/components/Community/FollowingFeed.tsx)、[`TonightFeed`](../../apps/platform-web/src/components/Community/TonightFeed.tsx) 开压中显示封盘倒计时与 `?course=1` 深链。

### P1 回访与我的压盘（已落地）

- **我的压盘**：`GET /me/course-stakes` 返回当前 org 在所有镇上的活跃仓（`open` / `closed`）；Profile / 手机「我的」用 [`CourseTonightHubCard`](../../apps/platform-web/src/components/World/CourseTonightHubCard.tsx)（含观望结果条）；社区用 [`CourseTonightMineStrip`](../../apps/platform-web/src/components/Community/CourseTonightMineStrip.tsx)（pulse 观望优先占槽）。
- **关注列表深化**：[`Profile`](../../apps/platform-web/src/pages/Profile.tsx) 关注镇开压/取证时显示三幕标签、「去压盘」与 `?course=1` 深链。
- **手机发现**：[`WorkCard`](../../apps/platform-web/src/mobile/components/WorkCard.tsx) 开压/取证镇角标显示三幕、点击直达 `/play/:slug?course=1`。
- **作者成盘推送**：双方首次成仓时 [`notifyCourseContestedPush`](../../apps/platform-api/src/lib/coursePush.ts) 向已订阅 Web Push 的作者推送（`[course-push] kind=contested`）。

### P2 回合时长配置（已落地）

- **环境变量**：`PLATFORM_COURSE_ROUND_PRESET=fast` → 2h 压盘 + 2h 取证；默认 `default` 仍为 4h+4h。仅影响新 seed 的 `bettingClosesAt` / `settlesAt`，不改彩池公式。见 [`courseRound.ts`](../../packages/platform-shared/src/courseRound.ts)。

### P1 手机端与作者页内提示（已落地）

- **手机「我的」**：[`MobileMe`](../../apps/platform-web/src/mobile/pages/MobileMe.tsx) 复用 [`CourseTonightHubCard`](../../apps/platform-web/src/components/World/CourseTonightHubCard.tsx) + 回访胶囊。
- **手机发现**：[`MobileCommunity`](../../apps/platform-web/src/mobile/pages/MobileCommunity.tsx) 世界 Tab 显示 [`CourseStakeTonightFeed`](../../apps/platform-web/src/components/Community/CourseStakeTonightFeed.tsx)。
- **作者成盘页内**：`courseBoardPulse` 新增 `author_contested`；作者在盘面在线时 toast「成盘了」。

### P2 跨镇「今夜套餐」（已落地）

- **API**：`GET /community/course-tonight` 聚合全站 `status=open` 盘，按池排序返回摘要（镇数 / 总池 / 成盘数 / 最近封盘）与 Top N 条目。
- **展示层**：[`CourseTonightBundle`](../../apps/platform-web/src/components/Community/CourseTonightBundle.tsx) — 社区侧栏 + 主栏 + 手机社区首页；[`summarizeCourseTonight`](../../apps/platform-web/src/components/Community/communityCourseLine.ts) 客户端 rollup。
- **题材推荐文案**：[`courseAuthorRecommendHintKey`](../../apps/platform-web/src/components/World/courseAuthorFlow.ts) 按 genre / pack 切换作者「推荐一题」提示（Modal + OpsBar）。

### P2 多盘队列（已落地）

- **模型**：`world_course_nodes.status = 'queued'`（与 `open`/`closed` 并存，受 partial unique 约束每镇仅一盘活跃）。
- **API**：`POST course` body `{ queue: true }` 在当前盘存在时排队下一题；`{ cancelQueue: true }` 取消；与 `replace: true` 互斥（`queue_replace_conflict`）。
- **晋升**：当前盘结算 / void 后 [`promoteQueuedCourseNode`](../../apps/platform-api/src/lib/courseBoard.ts) 自动开压；日志 `[course-queue] kind=promote|seed|cancel`。
- **作者 UX**：[`SocietyTownAuthorOpsBar`](../../apps/platform-web/src/components/World/SocietyTownAuthorOpsBar.tsx)「排队下一题」+ 取消；`loadCourseBoard` 返回 `queued` 预览。
- **访客 UX**：[`CourseQueuedPreview`](../../apps/platform-web/src/components/World/CourseQueuedPreview.tsx) 在走向盘桌只读展示下一题题干与选项。

### P2 推荐 dry-run（已落地）

- **API**：`GET`（`kind` / `agentKey`）与 `POST`（`prompt` + `options`，自定义题）均调用 [`previewCourseRecommend`](../../apps/platform-api/src/lib/courseBoard.ts)，按与 `seedWorldBoundCourse` 相同优先级返回题干 / 选项 / `reachability`，不写库。
- **作者 UX**：[`SocietyTownCourseAuthorModal`](../../apps/platform-web/src/components/World/SocietyTownCourseAuthorModal.tsx) 步骤 0 用 [`CourseRecommendPreviewCard`](../../apps/platform-web/src/components/World/CourseRecommendPreviewCard.tsx) 展示后再点「使用此题」；高级出题步骤 2/3 按题型调用 `?kind=` 实时预览；places/talks 编辑 prompt/labels 后走 `POST` 与实 seed 一致；步骤 3 支持「排队下一题」；[`SocietyTownAuthorOpsBar`](../../apps/platform-web/src/components/World/SocietyTownAuthorOpsBar.tsx) 推荐/排队前同样展示紧凑预览（含网络重试）。共享 hook：[`useCourseRecommendPreview`](../../apps/platform-web/src/components/World/useCourseRecommendPreview.ts)。手机 [`MobilePlay`](../../apps/platform-web/src/mobile/pages/MobilePlay.tsx) 作者盘面抽屉顶部嵌入 OpsBar；[`GameDetail`](../../apps/platform-web/src/pages/GameDetail.tsx) 与舞台 parity（灯/钟/hint）。

### 体验领先化（已落地）

- **发现深链统一**：[`coursePlayHref`](../../apps/platform-web/src/components/Community/communityCourseLine.ts) — 桌面 `/community/game/:slug?course=1`，手机 `/play/:slug?course=1`；[`CourseStakeTonightFeed`](../../apps/platform-web/src/components/Community/CourseStakeTonightFeed.tsx) / [`AlleyCharts`](../../apps/platform-web/src/components/Community/AlleyCharts.tsx) / [`WorldCard`](../../apps/platform-web/src/components/Community/WorldCard.tsx) 等统一入口；空 feed 用 [`CourseStakeTonightEmpty`](../../apps/platform-web/src/components/Community/CourseStakeTonightEmpty.tsx) 链到最热开压镇。
- **访客零门槛**：[`GuestCourseCoach`](../../apps/platform-web/src/components/World/GuestCourseCoach.tsx) 三步引导（不要求登录）；分享深链 `?course=1` 落地时自动弹出第一步（`shareLanding`，埋点 `course_share_land`）；压盘前收益预览 + `needOpponentInvite` 正向文案；本镇无盘 [`CourseTonightNearby`](../../apps/platform-web/src/components/World/CourseTonightNearby.tsx) 导流邻镇。
- **回访胶囊**：[`CourseReturnCapsule`](../../apps/platform-web/src/components/World/CourseReturnCapsule.tsx) 挂社区顶栏、[`Profile`](../../apps/platform-web/src/pages/Profile.tsx) 与 [`MobileMe`](../../apps/platform-web/src/mobile/pages/MobileMe.tsx) — 聚合压盘 + 开压/封盘中的观望镇 + 未读结算；文案与跳转优先「观望出结果」再「观望开压」；[`CourseTonightHubCard`](../../apps/platform-web/src/components/World/CourseTonightHubCard.tsx) 顶部「观望结果到了」条 + 观望列表按 pulse 排序（结算 > 开压）。
- **登录回盘压边**：未登录点压 / 关注落地 coach /「有盘时提醒我」会 [`rememberPendingCourse`](../../apps/platform-web/src/utils/loginIntent.ts)（`stake` | `follow_open` | `watch`）+ [`courseDeskReturnPath`](../../apps/platform-web/src/utils/loginIntent.ts)（保留 `course=1`，清掉一次性 `follow`/`watch`）；登录后盘面 [`SocietyTownCourseDesk`](../../apps/platform-web/src/components/World/SocietyTownCourseDesk.tsx) 消费 pending：`stake`/`follow_open` 滚到盘并高亮选边，`follow_open` 再强制打开 [`CourseFollowOpenCoach`](../../apps/platform-web/src/components/World/CourseFollowOpenCoach.tsx)（dismiss 清 `forceOpen`），`watch` 直接开观望订阅不抢高亮。Coach 互斥：关注落地压制 Guest/Onboarding；纯分享才弹 Guest share coach。
- **压仓不断观望**：[`mergeCourseBoardKeepExtras`](../../apps/platform-web/src/components/World/courseBoardMerge.ts) 在 stake/withdraw 后保留 `watching`/`queued`；after-stake 观望失败只 toast 不烧 seen；分享 Guest coach 跳过会清 `shareLanding`；结算横幅区分 `watch_settled` / `voided` 配色。
- **并发与性能**：盘面 `pullBoard` 用世代号忽略过期 GET，busy/hidden/单飞合并；社区胶囊+MineStrip 共用 [`useMyCourseTonight`](../../apps/platform-web/src/components/World/myCourseTonightStore.ts) 单轮询；`pushCourseOutcome` 幂等保留 seen，打断 outcome→refetch 风暴；观望 pulse 读缓存。
- **分享**：[`buildCourseShareText`](../../apps/platform-web/src/components/World/courseShare.ts) 区分观战 vs 已压边；海报含 act 标签 + 封盘倒计时 + 已压边文案。
- **观望订阅（D3）**：`GET /me/course-watches` + `PUT/DELETE /me/course-watch/:gameId` + [`CourseWatchButton`](../../apps/platform-web/src/components/World/CourseWatchButton.tsx) — 访客/未压盘用户可订阅开压/封盘/结果 Web Push（复用 `course_push_subscriptions`）；推送深链 [`courseWatchPushPath`](../../apps/platform-api/src/lib/courseWatch.ts) → `/play/:slug?course=1&watch=1`；社区观望 chip / 回访胶囊用 [`courseWatchPlayHref`](../../apps/platform-web/src/components/Community/communityCourseLine.ts) 对齐落地消 pulse；[`CourseReturnCapsule.pickReturnTarget`](../../apps/platform-web/src/components/World/CourseReturnCapsule.tsx) 点击优先跳转「正在 pulse 的观望镇」（与胶囊文案一致）；[`syncWatchMilestoneOutcomes`](../../apps/platform-web/src/components/World/courseWatchOutcomeSync.ts) 在社区条/胶囊轮询时把观望结算写入 [`courseOutcomeInbox`](../../apps/platform-web/src/components/World/courseOutcomeInbox.ts)；[`hydrateCourseWatchLanding`](../../apps/platform-web/src/components/World/courseWatchLand.ts) / [`applyCourseWatchRows`](../../apps/platform-web/src/components/World/courseWatchOutcomeSync.ts) 在 `?watch=1` 镇页落地时**先**写 inbox **再**消 pulse，让 [`CourseOutcomeBanner`](../../apps/platform-web/src/components/World/CourseOutcomeBanner.tsx) 马上可「看完了，取消观望」；[`CourseTonightMineStrip`](../../apps/platform-web/src/components/Community/CourseTonightMineStrip.tsx) 社区横滑可取消观望；[`courseWatchSignals`](../../apps/platform-web/src/components/World/courseWatchSignals.ts) 驱动社区 pulse；结算后 [`CourseOutcomeBanner`](../../apps/platform-web/src/components/World/CourseOutcomeBanner.tsx) 提供「看完了，取消观望」；[`notifyCourseWatchPush`](../../apps/platform-api/src/lib/courseWatch.ts) 在 seed / promote / close / settle 时触发；首压后 [`CourseWatchAfterStakePrompt`](../../apps/platform-web/src/components/World/CourseWatchAfterStakePrompt.tsx) 引导下一局观望（每镇一次）；开压时 [`notifyCourseFollowOpenPush`](../../apps/platform-api/src/lib/courseWatch.ts) 向关注该 deployment 的用户推送（`courseFollowOpenPushPath` → `?course=1&follow=1`；[`CourseFollowOpenCoach`](../../apps/platform-web/src/components/World/CourseFollowOpenCoach.tsx) 落地引导选边；[`stripCourseLandingParams`](../../apps/platform-web/src/components/World/courseShare.ts) 消费后清掉 `follow`/`watch` 避免刷新重弹；自动去重观望订阅者与当前盘已压用户）。
- **SSE 实时盘面**：`SocietyTownStage` `onCourseContextChange` 将 `liveNudge` 桥接到 `GameDetail` / `MobilePlay` 侧栏与抽屉盘面（不再只靠 4–8s 轮询）；作者 OpsBar「恢复钟」经 `resumeClockNonce` 与舞台同步。
- **手机发现 parity**：[`MobileCommunity`](../../apps/platform-web/src/mobile/pages/MobileCommunity.tsx) 顶栏回访胶囊、我的压盘/观望横滑、空 feed 导流、今夜动态 `coursePlayHref`；[`WorkCard`](../../apps/platform-web/src/mobile/components/WorkCard.tsx) 统一深链。
- **作者页外 parity**：[`useCourseAuthorTownContext`](../../apps/platform-web/src/components/World/useCourseAuthorTownContext.ts) 预取 `/community/games/:id/residents`（含 `genreId` / `packId` / `places`）；[`GameDetail`](../../apps/platform-web/src/pages/GameDetail.tsx) / [`MobilePlay`](../../apps/platform-web/src/mobile/pages/MobilePlay.tsx) OpsBar 题材推荐与 [`SocietyTownCourseAuthorModal`](../../apps/platform-web/src/components/World/SocietyTownCourseAuthorModal.tsx) 场所/对白与舞台一致；观望订阅变更后 [`CourseTonightMineStrip`](../../apps/platform-web/src/components/Community/CourseTonightMineStrip.tsx) / [`CourseTonightHubCard`](../../apps/platform-web/src/components/World/CourseTonightHubCard.tsx) 经 `onCourseWatchChanged` 自动刷新。

## 7. 验收

- 未登录打开任意已发布世界：地图 + 今夜题 + 压点按钮同时在；DOM 不出现 36/36、开口许可、镇时套餐、点亮商店、认养。
- 登录后可压 12/24/48，账本不再 23514；作者打开自己的世界没有压按钮，有今夜出题弹窗（本镇场所 / 真对白可出题）。
- 有仓且盘未封 / 取证中：心跳优先排这座镇，走路预约对白也不再被节流挡住。
- 没灯（也没有本小时点亮包）：只走路，免费 36/80 不再开口。
- 资助有效期内：36/80 计数用尽也不会把 remaining 掐成 0，对白继续走。
- 作者停钟：立刻整盘退，恢复钟后需要再出题。
- 资助中且页上有人：真对白会出，盘能取证。
- 资助过期：只走路，并提示盘可能退；不推销点亮商店。
- 关掉页面只走路、不说话；作者停钟仍整盘退。
- 地图同时看见镇钟和这盘墙钟（中国今晚 UTC+8）。取证期命中一边会在底条闪一下；命中以 API `evidencePreview` 为准、SSE 对白实时补充。
- 手机 `/play/:slug` 与桌面同一套主 CTA。
- 有仓且盘未封 / 取证中的镇，心跳优先排对白槽，并跳过节流等待。
- 结算时 API 打 `[course-settle]` JSON（`seedKind` / `voidReason` / `muted` / `unclear`），换题 void 打 `[course-replace]`，便于统计 void 率与题源分布。
- 前端埋点（dev 控制台 `[course-event]`）：`course_act_view`、`course_first_stake`、`author_recommend_seed`、`author_replace_blocked`、`course_share`、`course_share_land`、`course_watch_enable`、`course_watch_disable`、`course_watch_settle_unwatch`、`course_watch_after_stake_nudge`、`course_follow_open_land`、`course_follow_open_coach`、`course_login_resume`、`course_whisper_evidence_banner`、`course_notify_permission`、`course_browser_notify`、`course_outcome_banner`。
