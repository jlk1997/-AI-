/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vertical share poster. WeChat users who cannot use the JS-SDK still
 * forward a game by saving a picture; this draws that picture on a canvas
 * so the title, author and "改一句变成我的" hook travel with it.
 */

export interface PosterInput {
  readonly title: string;
  readonly authorName?: string | null;
  readonly description?: string | null;
  readonly thumbnail?: string | null;
  readonly slug: string;
  readonly kind?: 'work' | 'town-days';
  readonly days?: number;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderSharePoster(input: PosterInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const w = 720;
  const h = 1280;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#3a2418');
  grad.addColorStop(1, '#14121a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (input.thumbnail) {
    const cover = await loadImage(input.thumbnail);
    if (cover) {
      const scale = Math.max(w / cover.width, 720 / cover.height);
      const dw = cover.width * scale;
      const dh = cover.height * scale;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cover, (w - dw) / 2, 80, dw, Math.min(dh, 640));
      ctx.globalAlpha = 1;
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(40, 760, w - 80, 420);

  if (input.kind === 'town-days' && (input.days ?? 0) > 0) {
    ctx.fillStyle = '#e0b25a';
    ctx.font = '700 132px system-ui, "PingFang SC", sans-serif';
    const dayText = String(input.days);
    ctx.fillText(dayText, 64, 700);
    const dayWidth = ctx.measureText(dayText).width;
    ctx.font = '600 36px system-ui, "PingFang SC", sans-serif';
    ctx.fillText('天', 64 + dayWidth + 16, 700);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  wrap(ctx, input.title.slice(0, 32), 64, 830, w - 128, 52);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '400 26px system-ui, "PingFang SC", sans-serif';
  const by = input.authorName ? `@${input.authorName}` : '隔壁';
  ctx.fillText(by, 64, 980);

  const hook = (input.description ?? '点开就能玩，改一句就变成你的').slice(0, 36);
  ctx.fillText(hook, 64, 1030);

  ctx.fillStyle = '#e0b25a';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText('AI隔壁世界引擎  ·  改一句变成我的', 64, 1110);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '400 18px ui-monospace, monospace';
  ctx.fillText(`/play/${input.slug}`, 64, 1150);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 0.92);
  });
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  let line = '';
  let yy = y;
  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

export async function downloadPoster(input: PosterInput): Promise<boolean> {
  const blob = await renderSharePoster(input);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${input.slug}-share.png`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
