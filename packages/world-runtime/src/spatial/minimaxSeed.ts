/**
 * Optional MiniMax image seed for LingBot region cinematic (WORLD_MINIMAX_SEED=true).
 * Keeps world-runtime free of @opengame/core; worker/API call this helper.
 */

export async function maybeMinimaxRegionSeed(options: {
  readonly prompt: string;
  readonly styleHint?: string;
}): Promise<{ url?: string; message: string }> {
  if (process.env['WORLD_MINIMAX_SEED'] !== 'true') {
    return { message: 'WORLD_MINIMAX_SEED off' };
  }
  const apiKey =
    process.env['OPENGAME_IMAGE_API_KEY'] ||
    process.env['MINIMAX_API_KEY'] ||
    process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return { message: 'No MiniMax image API key — skip seed' };
  }
  const baseRaw =
    process.env['OPENGAME_IMAGE_BASE_URL'] ||
    process.env['OPENAI_BASE_URL'] ||
    'https://api.minimaxi.com';
  const base = baseRaw.replace(/\/+$/g, '').replace(/\/v1\/?$/i, '');
  const model = process.env['OPENGAME_IMAGE_MODEL'] || 'image-01';
  const prompt = [
    options.prompt,
    options.styleHint ? `art style: ${options.styleHint}` : '',
    'cinematic establishing shot, game world region, high detail',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 1200);

  try {
    const res = await fetch(`${base}/v1/image_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: '9:16',
        response_format: 'url',
        n: 1,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        message: `MiniMax seed HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    const data = (await res.json()) as {
      data?: { image_urls?: string[]; image_base64?: string[] };
      base_resp?: { status_code?: number };
    };
    if (
      data.base_resp?.status_code !== undefined &&
      data.base_resp.status_code !== 0
    ) {
      return { message: `MiniMax seed status ${data.base_resp.status_code}` };
    }
    const url = data.data?.image_urls?.[0];
    if (url) return { url, message: 'MiniMax region seed ready' };
    const b64 = data.data?.image_base64?.[0];
    if (b64) {
      return {
        url: `data:image/png;base64,${b64}`,
        message: 'MiniMax region seed (base64)',
      };
    }
    return { message: 'MiniMax seed returned no image' };
  } catch (err) {
    return {
      message: `MiniMax seed failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
