/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A visitor can play and watch without an account. The moment they try to
 * remix / follow / comment we send them to /login — and this module is what
 * keeps the sentence they typed (and where they were) across that detour, so
 * signing in lands them back on the same line instead of an empty studio.
 */

const RETURN_KEY = 'opengame_login_return_v1';
const REMIX_KEY = 'opengame_pending_remix_v1';
const SOCIAL_KEY = 'opengame_pending_social_v1';

export interface PendingRemix {
  /** Community slug (or id) of the work being remixed. */
  readonly slugOrId: string;
  readonly line: string;
  readonly kind: 'game' | 'world';
  /**
   * What the sentence was for. A whisper goes into the town as it stands; a
   * remix forks it. Sending someone back to the wrong box loses their intent
   * even though the words survived.
   */
  readonly intent?: 'remix' | 'whisper';
}

export function rememberLoginReturnTo(path: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    /* ignore quota */
  }
}

/** Reads and clears the pending return path (one shot, avoids sticky redirects). */
export function readLoginReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return value && value.startsWith('/') ? value : null;
  } catch {
    return null;
  }
}

export function rememberPendingRemix(pending: PendingRemix): void {
  try {
    sessionStorage.setItem(REMIX_KEY, JSON.stringify(pending));
  } catch {
    /* ignore quota */
  }
}

function parsePendingRemix(raw: string | null): PendingRemix | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRemix>;
    if (!parsed || typeof parsed.slugOrId !== 'string' || typeof parsed.line !== 'string') {
      return null;
    }
    return {
      slugOrId: parsed.slugOrId,
      line: parsed.line,
      kind: parsed.kind === 'world' ? 'world' : 'game',
      intent: parsed.intent === 'whisper' ? 'whisper' : 'remix',
    };
  } catch {
    return null;
  }
}

/** Reads and clears the remembered remix line. */
export function takePendingRemix(): PendingRemix | null {
  try {
    const pending = parsePendingRemix(sessionStorage.getItem(REMIX_KEY));
    sessionStorage.removeItem(REMIX_KEY);
    return pending;
  } catch {
    return null;
  }
}

/** Non-destructive peek, used to prefill the right box after coming back. */
export function peekPendingRemix(): PendingRemix | null {
  try {
    return parsePendingRemix(sessionStorage.getItem(REMIX_KEY));
  } catch {
    return null;
  }
}

/**
 * Comment / rating / score the visitor was about to send when we sent them
 * to sign in. Separate from remix: a score must not open the fork box.
 */
export type PendingSocial =
  | { readonly kind: 'comment'; readonly gameId: string; readonly content: string }
  | { readonly kind: 'rating'; readonly gameId: string; readonly rating: number }
  | {
      readonly kind: 'score';
      readonly gameId: string;
      readonly score: number;
      readonly playerName: string;
    };

export function rememberPendingSocial(pending: PendingSocial): void {
  try {
    sessionStorage.setItem(SOCIAL_KEY, JSON.stringify(pending));
  } catch {
    /* ignore quota */
  }
}

function parsePendingSocial(raw: string | null): PendingSocial | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSocial> & { kind?: string };
    if (!parsed || typeof parsed.gameId !== 'string') return null;
    if (parsed.kind === 'comment' && typeof parsed.content === 'string') {
      return { kind: 'comment', gameId: parsed.gameId, content: parsed.content };
    }
    if (parsed.kind === 'rating' && typeof parsed.rating === 'number') {
      return { kind: 'rating', gameId: parsed.gameId, rating: parsed.rating };
    }
    if (
      parsed.kind === 'score' &&
      typeof parsed.score === 'number' &&
      typeof (parsed as { playerName?: unknown }).playerName === 'string'
    ) {
      return {
        kind: 'score',
        gameId: parsed.gameId,
        score: parsed.score,
        playerName: (parsed as { playerName: string }).playerName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function peekPendingSocial(): PendingSocial | null {
  try {
    return parsePendingSocial(sessionStorage.getItem(SOCIAL_KEY));
  } catch {
    return null;
  }
}

export function takePendingSocial(): PendingSocial | null {
  try {
    const pending = parsePendingSocial(sessionStorage.getItem(SOCIAL_KEY));
    sessionStorage.removeItem(SOCIAL_KEY);
    return pending;
  } catch {
    return null;
  }
}

const COURSE_KEY = 'opengame_pending_course_v1';

export type PendingCourseIntent = {
  readonly gameId: string;
  readonly kind: 'stake' | 'follow_open' | 'watch';
};

function parsePendingCourse(raw: string | null): PendingCourseIntent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCourseIntent>;
    if (!parsed || typeof parsed.gameId !== 'string' || !parsed.gameId.trim()) {
      return null;
    }
    return {
      gameId: parsed.gameId.trim(),
      kind:
        parsed.kind === 'follow_open'
          ? 'follow_open'
          : parsed.kind === 'watch'
            ? 'watch'
            : 'stake',
    };
  } catch {
    return null;
  }
}

export function rememberPendingCourse(intent: PendingCourseIntent): void {
  try {
    sessionStorage.setItem(
      COURSE_KEY,
      JSON.stringify({
        gameId: intent.gameId.trim(),
        kind: intent.kind,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

export function peekPendingCourse(): PendingCourseIntent | null {
  try {
    return parsePendingCourse(sessionStorage.getItem(COURSE_KEY));
  } catch {
    return null;
  }
}

export function takePendingCourse(): PendingCourseIntent | null {
  try {
    const pending = parsePendingCourse(sessionStorage.getItem(COURSE_KEY));
    sessionStorage.removeItem(COURSE_KEY);
    return pending;
  } catch {
    return null;
  }
}

/**
 * After login, land back on the town desk with `course=1`.
 * One-shot landing flags (`follow` / `watch`) are dropped — resume via pending course.
 */
export function courseDeskReturnPath(pathWithOptionalQuery: string): string {
  const trimmed = pathWithOptionalQuery.trim();
  if (!trimmed.startsWith('/')) return '/';
  const qIndex = trimmed.indexOf('?');
  const path = qIndex >= 0 ? trimmed.slice(0, qIndex) : trimmed;
  const query = qIndex >= 0 ? trimmed.slice(qIndex + 1) : '';
  const params = new URLSearchParams(query);
  params.set('course', '1');
  params.delete('follow');
  params.delete('watch');
  const q = params.toString();
  return `${path}?${q}`;
}
