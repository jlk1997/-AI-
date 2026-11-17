/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prefetch town genre / places for author OpsBar + seed modal outside SocietyTownStage.
 */

import { useEffect, useState } from 'react';

import { api } from '../../services/api';
import {
  courseAuthorRecommendHintKey,
  minimalWorldSpecFromProfile,
} from './courseAuthorFlow';
import type { CourseAuthorPlace } from './SocietyTownCourseAuthorModal';

export type CourseAuthorTownContext = {
  readonly recommendHintKey: string;
  readonly places: readonly CourseAuthorPlace[];
  readonly villagePack: boolean;
  readonly worldSpecPreview: unknown;
};

const DEFAULT_HINT_KEY = courseAuthorRecommendHintKey({ villagePack: false });

export function useCourseAuthorTownContext(
  gameId: string | null | undefined,
  enabled = true,
): CourseAuthorTownContext {
  const [ctx, setCtx] = useState<CourseAuthorTownContext>({
    recommendHintKey: DEFAULT_HINT_KEY,
    places: [],
    villagePack: false,
    worldSpecPreview: undefined,
  });

  useEffect(() => {
    if (!enabled || !gameId) {
      setCtx({
        recommendHintKey: DEFAULT_HINT_KEY,
        places: [],
        villagePack: false,
        worldSpecPreview: undefined,
      });
      return;
    }
    let cancelled = false;
    void api.community
      .residents(gameId)
      .then((res) => {
        if (cancelled) return;
        const villagePack = Boolean(res.villagePack);
        setCtx({
          recommendHintKey: courseAuthorRecommendHintKey({
            genreId: res.genreId,
            packId: res.packId,
            villagePack,
          }),
          places: res.places ?? [],
          villagePack,
          worldSpecPreview: minimalWorldSpecFromProfile({
            genreId: res.genreId,
            packId: res.packId,
          }),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCtx({
            recommendHintKey: DEFAULT_HINT_KEY,
            places: [],
            villagePack: false,
            worldSpecPreview: undefined,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, gameId]);

  return ctx;
}
