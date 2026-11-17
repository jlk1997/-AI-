# 走向盘可观测性（Grafana / Loki）

走向盘结算与换题在 API 侧打结构化日志，便于导入 Grafana/Loki 或 CloudWatch Logs Insights。

## 日志事件

| 前缀 | 含义 |
|------|------|
| `[course-settle]` | 单盘结算完成（JSON 一行） |
| `[course-replace]` | 作者换题 void 旧盘 |
| `[course-push]` | Web Push 投递摘要（`kind`: `closed` / `settle` / `contested`，`subscribers`、`nodeId`） |
| `[course-queue]` | 排队 seed / promote / cancel（`worldId`、`nodeId`） |

`[course-settle]` 字段见 `courseSettlementTelemetry`（`packages/platform-shared/src/courseMarket.ts`）：`voided`、`voidReason`、`contested`、`seedKind`、`pool` 等。

## Loki 查询示例

```logql
{app="platform-api"} |= "[course-settle]" | json
```

按 void 率（需 log pipeline 解析 JSON 后）：

```logql
sum(count_over_time({app="platform-api"} | json | voided="true" [24h]))
/
sum(count_over_time({app="platform-api"} |= "[course-settle]" [24h]))
```

成盘率（`contested=true` 且 `voided=false`）：

```logql
sum(count_over_time({app="platform-api"} | json | contested="true" | voided="false" [24h]))
```

## Grafana 仪表板

导入 [`course-grafana-dashboard.json`](./course-grafana-dashboard.json)。面板包含：

- 24h 结算次数
- void 占比
- contested 占比
- 作者换题次数（`[course-replace]`）
- 排队操作次数（`[course-queue]` seed / promote / cancel）
- 按 `seedKind` 分布

## Web Push 运维

生成 VAPID（一次性）：

```bash
npx web-push generate-vapid-keys
```

环境变量：

- `PLATFORM_COURSE_PUSH_VAPID_PUBLIC_KEY`
- `PLATFORM_COURSE_PUSH_VAPID_PRIVATE_KEY`
- `PLATFORM_COURSE_PUSH_VAPID_SUBJECT`（如 `mailto:ops@example.com`）

未配置时 Push API 与订阅存储仍可用，但服务端不会发送；前端首压授权后仅在配置了公钥时注册 `PushManager`。

数据库迁移：`0038_course_push_subscriptions.sql`。

## 回合时长 A/B

新盘 seed 时读取 `PLATFORM_COURSE_ROUND_PRESET`：

| 值 | 压盘窗 | 取证窗 |
|----|--------|--------|
| `default`（缺省） | 4h | 4h |
| `fast` | 2h | 2h |

仅影响 `bettingClosesAt` / `settlesAt`，不改结算公式。已开盘节点不受影响。
