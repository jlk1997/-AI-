/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

import {
  api,
  ApiError,
  type CourseRecommendQuery,
  type CourseRecommendPreview,
} from '../../services/api';
import { courseRecommendNeedsPost } from './courseAuthorFlow';

export type CourseRecommendPreviewQuery = CourseRecommendQuery & {
  readonly enabled?: boolean;
  readonly gameId?: string | null;
  readonly projectId?: string | null;
  readonly debounceMs?: number;
  readonly reloadKey?: number;
};

export type CourseRecommendPreviewError = 'cannot_preview' | 'network' | null;

function fetchCourseRecommend(
  input: CourseRecommendPreviewQuery,
): Promise<CourseRecommendPreview> | null {
  const query: CourseRecommendQuery = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.agentKey ? { agentKey: input.agentKey } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.options ? { options: input.options } : {}),
  };
  if (input.gameId) {
    return api.community.courseRecommend(input.gameId, query);
  }
  if (input.projectId) {
    return api.community.worldCourseRecommend(input.projectId, query);
  }
  return null;
}

export function useCourseRecommendPreview(
  input: CourseRecommendPreviewQuery,
): {
  readonly preview: CourseRecommendPreview | null;
  readonly loading: boolean;
  readonly error: CourseRecommendPreviewError;
  readonly reload: () => void;
} {
  const enabled = input.enabled !== false;
  const [preview, setPreview] = useState<CourseRecommendPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CourseRecommendPreviewError>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [debounced, setDebounced] = useState(input);
  const debounceMs =
    input.debounceMs ?? (courseRecommendNeedsPost(input) ? 400 : 0);

  useEffect(() => {
    if (debounceMs <= 0) {
      setDebounced(input);
      return;
    }
    const timer = setTimeout(() => setDebounced(input), debounceMs);
    return () => clearTimeout(timer);
  }, [
    debounceMs,
    input.enabled,
    input.gameId,
    input.projectId,
    input.kind,
    input.agentKey,
    input.prompt,
    input.options,
    input.reloadKey,
    reloadNonce,
  ]);

  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      setLoading(false);
      setError(null);
      return;
    }
    const req = fetchCourseRecommend(debounced);
    if (!req) {
      setPreview(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void req
      .then((next) => {
        if (!cancelled) {
          setPreview(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreview(null);
          const msg =
            err instanceof ApiError
              ? err.message
              : err && typeof err === 'object' && 'message' in err
                ? String((err as { message?: string }).message ?? '')
                : '';
          setError(msg === 'cannot_preview' ? 'cannot_preview' : 'network');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    debounced.enabled,
    debounced.gameId,
    debounced.projectId,
    debounced.kind,
    debounced.agentKey,
    debounced.prompt,
    debounced.options,
    debounced.reloadKey,
    reloadNonce,
  ]);

  return {
    preview,
    loading,
    error,
    reload: () => setReloadNonce((value) => value + 1),
  };
}
