/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { fetchEmbedInfo, type FetchEmbedOptions, type OpenGameEmbedInfo } from './index.js';

export interface OpenGameEmbedProps extends FetchEmbedOptions {
  readonly slug: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly fallback?: React.ReactNode;
  readonly onError?: (err: Error) => void;
}

/**
 * React wrapper around the OpenGame public embed endpoint.
 *
 * ```tsx
 * <OpenGameEmbed slug="flappy-2026" width={800} height={600} />
 * ```
 *
 * The component holds no app-level state: it just resolves the iframe URL
 * once per slug and renders an iframe with strict sandboxing. Multiple
 * instances on the same page each fetch independently — the public endpoint
 * is heavily CDN-cacheable, so this is the right trade-off.
 */
export function OpenGameEmbed(props: OpenGameEmbedProps): JSX.Element {
  const [info, setInfo] = useState<OpenGameEmbedInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEmbedInfo(props.slug, { apiBase: props.apiBase, fetch: props.fetch })
      .then((res) => {
        if (alive) setInfo(res);
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (alive) setError(e);
        props.onError?.(e);
      });
    return () => {
      alive = false;
    };
  }, [props.slug, props.apiBase, props.fetch, props.onError]);

  if (error) {
    return <>{props.fallback ?? <div role="alert">OpenGame embed failed: {error.message}</div>}</>;
  }
  if (!info) {
    return <>{props.fallback ?? <div aria-busy>Loading OpenGame…</div>}</>;
  }
  return (
    <iframe
      src={info.iframeUrl}
      title={info.title}
      width={props.width ?? info.width}
      height={props.height ?? info.height}
      loading="lazy"
      allow="autoplay; fullscreen; gamepad; pointer-lock"
      sandbox={info.iframeSandbox}
      style={{ border: 0, maxWidth: '100%', ...props.style }}
      className={props.className}
    />
  );
}
