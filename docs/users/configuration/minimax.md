# MiniMax (全模态) 接入说明

本文档说明如何在 OpenGame 中使用 [MiniMax 开放平台](https://platform.minimaxi.com/docs/guides/models-intro) 的 **reasoning / image / video / audio** 四类能力。实现与官方文档对齐，基线主机为 `https://api.minimaxi.com`（见 [接口概览](https://platform.minimaxi.com/docs/api-reference/api-overview.md)）。

## 1. 主 Agent（写代码、调工具）

主循环 **不属于** `OPENGAME_*` 四模态配置，仍走上游 CLI 的鉴权类型：

| 方式 | 环境变量 / 设置 | 说明 |
|------|-----------------|------|
| OpenAI 兼容 | `OPENAI_API_KEY`，`OPENAI_BASE_URL=https://api.minimaxi.com/v1`，`OPENAI_MODEL=MiniMax-M2.7`（或 `MiniMax-M2.7-highspeed`） | 与 [文本对话（OpenAI API 兼容）](https://platform.minimaxi.com/docs/api-reference/text-chat-openai.md) 一致。 |
| Anthropic 兼容 | `ANTHROPIC_API_KEY`，`ANTHROPIC_BASE_URL`（见官方 Anthropic 兼容文档），`ANTHROPIC_MODEL=MiniMax-M2.7` | 适合已接入 Anthropic SDK 的路径；需在真实环境验证 **tool use / 流式** 与 OpenGame 的完全兼容。 |

**试点建议**：先用小仓库跑通「读文件 → 写文件 → 单次编辑」，记录任何与 OpenAI/Anthropic 请求体差异（例如部分平台对 `max_completion_tokens` 与 `max_tokens` 的命名）。

## 2. OpenGame 四模态（`OPENGAME_*`）

将对应模态的 `PROVIDER` 设为 `minimax` 并配置 API Key；未填的 `BASE_URL` / `MODEL` 会使用内置默认值（见 `packages/core/src/services/providerConfig.ts` 中的 `MINIMAX_DEFAULTS`）。

```bash
export OPENGAME_REASONING_PROVIDER=minimax
export OPENGAME_REASONING_API_KEY=你的密钥
# 可选：OPENGAME_REASONING_BASE_URL 默认为 https://api.minimaxi.com/v1
# 可选：OPENGAME_REASONING_MODEL 默认为 MiniMax-M2.7

export OPENGAME_IMAGE_PROVIDER=minimax
export OPENGAME_IMAGE_API_KEY=你的密钥
# 默认 BASE_URL=https://api.minimaxi.com ，MODEL=image-01

export OPENGAME_VIDEO_PROVIDER=minimax
export OPENGAME_VIDEO_API_KEY=你的密钥
# 默认 MODEL=MiniMax-Hailuo-2.3-Fast（图生视频）
# 文生视频会使用内置的 T2V 默认模型 MiniMax-Hailuo-2.3（不可使用 *-Fast）

export OPENGAME_AUDIO_PROVIDER=minimax
export OPENGAME_AUDIO_API_KEY=你的密钥
# OPENGAME_AUDIO_BASE_URL 默认 https://api.minimaxi.com/v1（chat）；音乐/语音接口会自动去掉尾部 /v1
# OPENGAME_AUDIO_MODEL 默认 MiniMax-M2.7 — 仅在 **回退** 到 ABC 管线时用于 chat
#
# 原生 MP3（默认优先于 ABC）：
# - BGM：`music_generation`，默认模型 music-2.6-free（可用 OPENGAME_AUDIO_MUSIC_MODEL=music-2.6 等覆盖）
# - SFX：`POST /v1/t2a_v2`，默认 speech-2.8-turbo（OPENGAME_AUDIO_SPEECH_MODEL），音色 OPENGAME_AUDIO_VOICE_ID（可选）
```

### 2.1 与官方 API 的对应关系

| 模态 | OpenGame 行为 | MiniMax 文档 |
|------|----------------|-------------|
| reasoning | `POST {base}/chat/completions`，MiniMax 使用 `max_completion_tokens`；并剥离 `<think>…</think>` | [文本对话（OpenAI API 兼容）](https://platform.minimaxi.com/docs/api-reference/text-chat-openai.md) |
| image | `POST /v1/image_generation` | [文生图](https://platform.minimaxi.com/docs/api-reference/image-generation-t2i.md)、[图生图](https://platform.minimaxi.com/docs/api-reference/image-generation-i2i.md) |
| video | `POST /v1/video_generation` → 轮询 `GET /v1/query/video_generation` → `GET /v1/files/retrieve` | [图生视频](https://platform.minimaxi.com/docs/api-reference/video-generation-i2v.md)、[文生视频](https://platform.minimaxi.com/docs/api-reference/video-generation-t2v.md)、[查询任务](https://platform.minimaxi.com/docs/api-reference/video-generation-query.md)、[文件检索](https://platform.minimaxi.com/docs/api-reference/video-generation-download.md) |
| audio | **`generate_game_assets` 默认**：BGM 走 **music_generation**（纯音乐 MP3），SFX 走 **speech T2A**（MP3）；失败后再尝试 T2V 抽音频 → **ABC + symusic WAV** → 程序化 | [音乐生成](https://platform.minimaxi.com/docs/api-reference/music-generation.md)、[同步语音 HTTP](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http.md) |

### 2.2 音乐与语音实现位置

`packages/core/src/services/minimax/minimaxMusicSpeech.ts` 提供 `minimaxGenerateMusic`、`minimaxSpeechT2A`；`MinimaxAudioService.generateMp3Asset` 在资产工具内优先调用它们。`minimaxMultimodalApiHost()` 会把 `.../v1` 规范成多模态 REST 的根主机，避免 `/v1/v1/` 重复。

## 3. 已知限制

- **GDD / classify**：使用 OpenAI 兼容 chat；MiniMax 文档中 `max_completion_tokens` 上限以官方为准，极长 GDD 可能被截断，必要时换用更长上下文的模型或拆分生成步骤。
- **文生视频**：不能使用 `MiniMax-Hailuo-2.3-Fast`；若仅配置了 Fast 模型，请为 T2V 单独设置 `OPENGAME_VIDEO_MODEL`（或通过 settings 覆盖 `modelNameVideoText` 所用默认值）。
- **下载 URL**：`files/retrieve` 返回的 `download_url` 若不含 scheme，运行时会自动补上 `https://`。

更多环境变量总表见 [api-keys.md](api-keys.md) 与仓库根目录 [`.env.example`](../../../.env.example)。
