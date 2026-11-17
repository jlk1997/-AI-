/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shareable tonight board: hottest, most remixed, towns still living.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type TownLamp } from '../../services/api';
import { useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import { coursePlayHref } from './communityCourseLine';
import { worldAudienceLine } from './WorldAudienceHint';

type AlleyCard = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly thumbnail: string | null;
  readonly category: string;
  readonly playCount: number;
  readonly remixCount: number;
  readonly watcherCount?: number;
  readonly lamp?: TownLamp | null;
  readonly living?: boolean;
  readonly speaking?: boolean;
  readonly clockPaused?: boolean;
};

export function showAlleyCourseLane(
  courseMarket: boolean,
  boards: readonly unknown[] | undefined,
): boolean {
  return courseMarket && (boards?.length ?? 0) > 0;
}

type Board = {
  readonly chinaDay: string;
  readonly hottest: AlleyCard[];
  readonly remixed: AlleyCard[];
  readonly living: AlleyCard[];
  readonly boards?: Array<AlleyCard & { prompt: string; pool: number }>;
};

const Lane: React.FC<{
  readonly title: string;
  readonly hint: string;
  readonly items: AlleyCard[];
  readonly metric: 'play' | 'remix' | 'watch';
  readonly courseDeep?: boolean;
}> = ({ title, hint, items, metric, courseDeep = false }) => {
  const navigate = useNavigate();
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <section className="og-alley-chart">
      <div className="og-alley-chart__head">
        <div className="og-alley-chart__title">{title}</div>
        <div className="og-alley-chart__hint">{hint}</div>
      </div>
      <ol className="og-alley-chart__list">
        {items.slice(0, 6).map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              className="og-alley-chart__row"
              onClick={() =>
                navigate(
                  courseDeep
                    ? coursePlayHref(item.slug, { course: true })
                    : coursePlayHref(item.slug, { course: false }),
                )
              }
            >
              <span className="og-alley-chart__rank">{i + 1}</span>
              <span className="og-alley-chart__name">{item.title}</span>
              <span className="og-alley-chart__n">
                {metric === 'remix'
                  ? t('community.alley.remixN', { n: item.remixCount })
                  : metric === 'watch'
                    ? worldAudienceLine(t, {
                        simTime: null,
                        simDays: null,
                        residents: 0,
                        living: Boolean(item.living),
                        speaking: item.speaking,
                        clockPaused: item.clockPaused,
                        lastAdvancedAt: null,
                        watcherCount: item.watcherCount,
                        lamp: item.lamp,
                      }) || t('product.obs.nobodyWatchingYet')
                    : t('community.alley.playN', { n: item.playCount })}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const AlleyCharts: React.FC = () => {
  const { t } = useT();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = (): void => {
      void api.community
        .alley()
        .then((res) => {
          if (!cancelled) setBoard(res);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(
      pull,
      featureFlags.courseMarket ? 15_000 : 60_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!board) return null;
  const showBoards = showAlleyCourseLane(featureFlags.courseMarket, board.boards);
  const boards = showBoards ? board.boards ?? [] : [];
  if (
    board.hottest.length +
      board.remixed.length +
      board.living.length +
      boards.length ===
    0
  ) {
    return null;
  }

  return (
    <div className="og-alley-charts">
      <div className="og-alley-charts__kicker">
        {t('community.alley.kicker', { day: board.chinaDay })}
      </div>
      <div className="og-alley-charts__grid">
        <Lane
          title={t('community.alley.hottest')}
          hint={t('community.alley.hottestHint')}
          items={board.hottest}
          metric="play"
        />
        <Lane
          title={t('community.alley.remixed')}
          hint={t('community.alley.remixedHint')}
          items={board.remixed}
          metric="remix"
        />
        <Lane
          title={t('community.alley.living')}
          hint={t('community.alley.livingHint')}
          items={board.living}
          metric="watch"
        />
        {boards.length > 0 ? (
          <section className="og-alley-chart">
            <div className="og-alley-chart__head">
              <div className="og-alley-chart__title">{t('community.alley.boards')}</div>
              <div className="og-alley-chart__hint">{t('community.alley.boardsHint')}</div>
            </div>
            <ol className="og-alley-chart__list">
              {boards.slice(0, 6).map((item, i) => (
                <li key={`${item.id}-board`}>
                  <button
                    type="button"
                    className="og-alley-chart__row"
                    onClick={() => navigate(coursePlayHref(item.slug, { course: true }))}
                  >
                    <span className="og-alley-chart__rank">{i + 1}</span>
                    <span className="og-alley-chart__name">
                      <span>{item.title}</span>
                      {item.prompt ? (
                        <span className="og-alley-chart__ask">{item.prompt}</span>
                      ) : null}
                    </span>
                    <span className="og-alley-chart__n">
                      {t('community.alley.boardPool', { n: item.pool })}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
};
