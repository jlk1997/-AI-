/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Session-scoped wrapping for `game.json`.
 *
 * The compiled JavaScript is still readable — a browser has to run it — but
 * the design document that would make a remix trivial (scene graph, entity
 * list, dialogue) is ciphertext unless the page also has the play ticket.
 * Losing the ticket, or copying the JSON off a mirrored host, leaves a blob.
 */

export const PLAY_ENC_MARKER = 1;

export interface EncryptedDsl {
  readonly ogEnc: typeof PLAY_ENC_MARKER;
  readonly iv: string;
  readonly ct: string;
  readonly tag: string;
}

export function derivePlayDslKey(secret: string, token: string): Buffer {
  return createHmac('sha256', secret).update(`play-dsl:${token}`).digest();
}

export function encryptDslJson(plain: string, key: Buffer): EncryptedDsl {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ogEnc: PLAY_ENC_MARKER,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptDslJson(payload: EncryptedDsl, key: Buffer): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function isEncryptedDsl(value: unknown): value is EncryptedDsl {
  if (!value || typeof value !== 'object') return false;
  const rec = value as EncryptedDsl;
  return rec.ogEnc === PLAY_ENC_MARKER && typeof rec.iv === 'string' && typeof rec.ct === 'string';
}

export function playTicketScript(keyB64: string): string {
  return `<script>window.__OG_PLAY_KEY=${JSON.stringify(keyB64)}</script>`;
}

export function injectPlayTicket(html: string, keyB64: string): string {
  const snippet = playTicketScript(keyB64);
  const head = html.indexOf('</head>');
  if (head !== -1) return `${html.slice(0, head)}${snippet}${html.slice(head)}`;
  return snippet + html;
}
