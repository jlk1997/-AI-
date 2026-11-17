# MiniMax API 验证摘要（实施依据）

以下为实施 OpenGame `minimax` provider 时对照的官方文档要点（2026 年自 [llms.txt](https://platform.minimaxi.com/docs/llms.txt) 与各页 OpenAPI 片段整理）。

| 能力 | Server | 路径 / 方法 | 鉴权 |
|------|--------|-------------|------|
| Chat（OpenAI 兼容） | `https://api.minimaxi.com` | `POST /v1/chat/completions` | `Authorization: Bearer <API Key>` |
| 文生图 | 同上 | `POST /v1/image_generation` | Bearer |
| 图生视频 | 同上 | `POST /v1/video_generation`（`first_frame_image` + `model`） | Bearer |
| 文生视频 | 同上 | `POST /v1/video_generation`（`prompt` + `model`，无 `first_frame_image`） | Bearer |
| 查询视频任务 | 同上 | `GET /v1/query/video_generation?task_id=` | Bearer |
| 取回文件 | 同上 | `GET /v1/files/retrieve?file_id=` → `download_url` | Bearer |
| 音乐 | 同上 | `POST /v1/music_generation` | Bearer |
| 语音 T2A | 同上 | `POST /v1/t2a_v2` | Bearer |

索引与交叉链接：[模型概览](https://platform.minimaxi.com/docs/guides/models-intro)、[接口概览](https://platform.minimaxi.com/docs/api-reference/api-overview.md)。
