# API Keys & Provider Configuration

OpenGame is an agentic framework — it talks to several external generative-AI
APIs to actually build a game. **OpenGame does not ship with any default
credentials.** You have to supply your own keys for each capability you want
to use.

There are four configurable modalities, each with an independent provider:

| Modality    | Used by                                                              | Required?                                                                  |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `reasoning` | `classify-game-type`, `generate-gdd`, audio ABC-notation generation. | Required for non-trivial games.                                            |
| `image`     | Backgrounds, sprites, animation base frames, tilesets.               | Required for any asset generation.                                         |
| `video`     | Image-to-video (animation frames) and text-to-video (audio source).  | Optional — without it, animations fall back to I2I and audio to ABC/local. |
| `audio`     | LLM that writes ABC music notation (rendered locally to WAV).        | Optional — without it, audio falls back to procedural placeholders.        |

The main agent LLM (the brain that drives the conversation loop) is _not_
part of this system; it uses the upstream qwen-code OpenAI-compatible flow.
Configure it via `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`, or
the interactive `/auth` command. For **MiniMax** as the main coding model you
can also use the **Anthropic** auth path (`ANTHROPIC_*`) or point `OPENAI_*` at
`https://api.minimaxi.com/v1` — see [MiniMax setup](minimax.md).

---

## Supported provider families

| Provider name   | Description                                                                                              | Modalities supported           |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `tongyi`        | Aliyun DashScope (Wan/Qwen family).                                                                      | reasoning, image, video, audio |
| `doubao`        | Volcengine ARK (Doubao Seedream/Seedance family).                                                        | reasoning, image, video, audio |
| `minimax`       | [MiniMax](https://platform.minimaxi.com/docs/guides/models-intro) native HTTP APIs (`api.minimaxi.com`). | reasoning, image, video, audio |
| `openai-compat` | Any endpoint speaking the OpenAI REST shape (OpenAI, OpenRouter, Together, fal, Stability proxies, ...). | reasoning, image, audio        |

> **Note.** `openai-compat` is intentionally **not** wired up for video,
> because there is no stable OpenAI-shaped public video API today
> (Sora and Veo are not part of that surface). If you select it for
> `OPENGAME_VIDEO_PROVIDER` you'll get a clear error.

---

## Configuring with environment variables (recommended)

Each modality reads four environment variables:

```bash
OPENGAME_<MODALITY>_PROVIDER   # tongyi | doubao | openai-compat | minimax
OPENGAME_<MODALITY>_API_KEY    # Bearer token sent to the provider
OPENGAME_<MODALITY>_BASE_URL   # required for openai-compat; optional override otherwise
OPENGAME_<MODALITY>_MODEL      # required for openai-compat; optional override otherwise
```

Where `<MODALITY>` is one of `REASONING`, `IMAGE`, `VIDEO`, `AUDIO`.

### Example: everything on Aliyun DashScope

```bash
export OPENGAME_REASONING_PROVIDER=tongyi
export OPENGAME_REASONING_API_KEY=sk-aliyun-key
export OPENGAME_REASONING_MODEL=deepseek-v3.2

export OPENGAME_IMAGE_PROVIDER=tongyi
export OPENGAME_IMAGE_API_KEY=sk-aliyun-key
export OPENGAME_IMAGE_MODEL=wan2.5-t2i-preview

export OPENGAME_VIDEO_PROVIDER=tongyi
export OPENGAME_VIDEO_API_KEY=sk-aliyun-key
export OPENGAME_VIDEO_MODEL=wan2.5-i2v-preview

export OPENGAME_AUDIO_PROVIDER=tongyi
export OPENGAME_AUDIO_API_KEY=sk-aliyun-key
export OPENGAME_AUDIO_MODEL=qwen-plus
```

### Example: mix-and-match (OpenAI for reasoning, Doubao for image+video)

```bash
export OPENGAME_REASONING_PROVIDER=openai-compat
export OPENGAME_REASONING_API_KEY=sk-openai-key
export OPENGAME_REASONING_BASE_URL=https://api.openai.com/v1
export OPENGAME_REASONING_MODEL=gpt-4o-mini

export OPENGAME_IMAGE_PROVIDER=doubao
export OPENGAME_IMAGE_API_KEY=volc-key
export OPENGAME_IMAGE_MODEL=doubao-seedream-4-0-250828

export OPENGAME_VIDEO_PROVIDER=doubao
export OPENGAME_VIDEO_API_KEY=volc-key
export OPENGAME_VIDEO_MODEL=doubao-seedance-1-0-pro-250528

# Reuse OpenAI for ABC generation
export OPENGAME_AUDIO_PROVIDER=openai-compat
export OPENGAME_AUDIO_API_KEY=sk-openai-key
export OPENGAME_AUDIO_BASE_URL=https://api.openai.com/v1
export OPENGAME_AUDIO_MODEL=gpt-4o-mini
```

### Primary + Fallback (MiniMax → Volcengine Ark)

Keep MiniMax as the primary providers, and configure Ark (`doubao`) as a
**one-shot failover** when the primary hits 429 / Token Plan / status `2056` /
「用量上限」:

```bash
# Primaries stay as minimax / OPENAI_* pointing at MiniMax…

export OPENGAME_FALLBACK_PROVIDER=doubao
export OPENGAME_FALLBACK_API_KEY=ark-...
export OPENGAME_FALLBACK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
export OPENGAME_IMAGE_FALLBACK_MODEL=doubao-seedream-4-0-250828
export OPENGAME_REASONING_FALLBACK_MODEL=doubao-seed-2-1-pro-260628
export OPENGAME_VIDEO_FALLBACK_MODEL=doubao-seedance-1-0-pro-250528
export OPENGAME_AUDIO_FALLBACK_MODEL=doubao-seed-2-0-lite-260215

# Main coding agent (OPENAI_*) — Worker retries CLI once with these on quota:
export OPENAI_FALLBACK_API_KEY=ark-...
export OPENAI_FALLBACK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
export OPENAI_FALLBACK_MODEL=doubao-seed-2-1-pro-260628
```

Notes:

- Activate **Seedream** (vision) in the Ark console before relying on image failover.
  Official docs: [火山方舟 Seedream 图像生成](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1099455?lang=zh).
- **Seedream 4.x** (`doubao-seedream-4-0-…`): JPEG only — do **not** send `output_format`
  (Ark returns `InvalidParameter`). Worker re-encodes JPEG→PNG via `sharp`.
- **Seedream 5.x**: may accept `output_format: png|jpeg`; Worker still normalizes to PNG.
- Model IDs must match what Ark shows after开通 (copy from 开通管理; or use `ep-xxxx`).
- **Do not** use `doubao-seed-1-6-251015` unless that exact model is activated in your console.
- Recommended failover mapping when MiniMax quota hits:
  - **CLI / coding** → `OPENAI_FALLBACK_MODEL=doubao-seed-2-1-pro-260628`
    (prefer 2.1-pro if `Doubao-Seed-2.0-Code` free quota is exhausted; else `doubao-seed-2-0-code-preview-260215`)
  - **GDD / reasoning / world plan** → `OPENGAME_REASONING_FALLBACK_MODEL=doubao-seed-2-1-pro-260628`
  - **Images** → `OPENGAME_IMAGE_FALLBACK_MODEL=doubao-seedream-4-0-250828`
  - **Audio chat ABC** → `OPENGAME_AUDIO_FALLBACK_MODEL=doubao-seed-2-0-lite-260215`
- Modality/CLI audio chat failover uses Doubao chat → ABC, not Ark TTS speech models.
- Worker MiniMax **music/speech ASSET** has no Ark equivalent: on quota it **soft-skips**
  and keeps prior `mp3` / juice; ASSET timeline shows `failoverEvents` and
  `quality: mixed-failover` when image failover or audio soft-skip occurred.
- Logs show `[provider-failover] image minimax→doubao/ark (Seedream)` when a switch happens.
- Restart `platform:dev` / worker after editing these env vars.

### Example: an OpenAI-compatible image proxy (e.g. fal.ai)

```bash
export OPENGAME_IMAGE_PROVIDER=openai-compat
export OPENGAME_IMAGE_API_KEY=$FAL_KEY
export OPENGAME_IMAGE_BASE_URL=https://fal.run/openai/v1
export OPENGAME_IMAGE_MODEL=fal-ai/flux/dev
```

A copy-paste template for all variables lives at the repository root in
[`.env.example`](../../../.env.example).

---

## Configuring via `~/.qwen/settings.json`

The same fields can be persisted to your settings file. Environment variables
take precedence, so settings.json is the right place for "default" choices
that you can override on a per-shell basis.

```json
{
  "openGame": {
    "providers": {
      "reasoning": {
        "provider": "openai-compat",
        "apiKey": "sk-openai-key",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini"
      },
      "image": {
        "provider": "tongyi",
        "apiKey": "sk-aliyun-key",
        "model": "wan2.5-t2i-preview"
      },
      "video": {
        "provider": "doubao",
        "apiKey": "volc-key",
        "model": "doubao-seedance-1-0-pro-250528"
      },
      "audio": {
        "provider": "openai-compat",
        "apiKey": "sk-openai-key",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini"
      }
    }
  }
}
```

When both an env var and a settings.json field are set for the same modality,
the env var wins.

---

## Resolution rules in detail

For each modality, OpenGame walks this list and uses the first non-empty value
it finds:

1. **`OPENGAME_<MOD>_PROVIDER`** env var.
2. `openGame.providers.<mod>.provider` from settings.json.
3. If a _legacy_ DashScope-style key is set (`DASHSCOPE_API_KEY`,
   `IMAGE_MODEL_API_KEY`, `REASONING_MODEL_API_KEY`, ...), the provider is
   inferred to be `tongyi` so existing demos keep working.
4. Otherwise, OpenGame raises `MissingProviderConfigError` with a message
   that names the exact env var or settings field you should set.

The same precedence chain applies independently to `_API_KEY`, `_BASE_URL`,
and `_MODEL`.

---

## What if I haven't configured anything?

The CLI will start fine and the agent will respond as usual. You'll only see
an error when the agent actually invokes one of the asset / GDD / classifier
tools. The error is human-readable and tells you exactly which env var or
settings field to set, e.g.:

```
OpenGame is missing API configuration for the "image" modality.

Set OPENGAME_IMAGE_PROVIDER to one of "tongyi", "doubao", or "openai-compat",
or add an "openGame.providers.image.provider" entry to your settings.json.

See docs/users/configuration/api-keys.md for the full list of supported variables.
```

---

## Legacy environment variables

For backward compatibility with pre-OpenGame setups, the following older
variables are still read as fallbacks. New configurations should prefer the
`OPENGAME_*` names above.

| Modality    | Legacy fallbacks (in order)                                         |
| ----------- | ------------------------------------------------------------------- |
| `reasoning` | `REASONING_MODEL_API_KEY` → `DASHSCOPE_API_KEY` → `OPENAI_API_KEY`  |
| `image`     | `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY`                         |
| `video`     | `VIDEO_MODEL_API_KEY` → `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY` |
| `audio`     | `AUDIO_MODEL_API_KEY` → `IMAGE_MODEL_API_KEY` → `DASHSCOPE_API_KEY` |

These may be removed in a future major version.
