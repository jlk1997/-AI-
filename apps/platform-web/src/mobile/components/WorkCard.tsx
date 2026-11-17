/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayCircleOutlined, TeamOutlined } from '@ant-design/icons';

import { useT } from '../../services/i18n.js';
import { guestTownFace } from '../../components/World/societyTownGating.js';
import { worldAudienceLine } from '../../components/Community/WorldAudienceHint.js';
import { isWorld, type CommunityWorkCard } from '../types.js';
import {
  courseTeaser,
  courseTeaserBadgeKey,
  courseTeaserShowsPrompt,
  coursePlayHref,
} from '../../components/Community/communityCourseLine.js';

export interface WorkCardProps {
  readonly work: CommunityWorkCard;
}

export const WorkCard: React.FC<WorkCardProps> = ({ work }) => {
  const navigate = useNavigate();
  const { t } = useT();
  const world = isWorld(work);

  const face = world
    ? work.world?.clockPaused
      ? 'paused'
      : guestTownFace({
          living: work.world?.living,
          speaking: work.world?.speaking,
        })
    : null;
  const clock =
    world && work.world?.simDays != null
      ? t('mobile.card.simDays', { days: String(work.world.simDays) })
      : world
        ? t('mobile.card.world')
        : t('mobile.card.plays', { count: String(work.playCount ?? 0) });
  const audience = world ? worldAudienceLine(t, work.world) : null;
  const faceLine =
    face === 'paused'
      ? t('community.world.authorPaused')
      : face === 'speaking'
        ? t('community.world.speaking')
        : face === 'walking'
          ? t('community.world.living')
          : null;
  const teaser = world ? courseTeaser(work.course) : null;
  const courseDeep = Boolean(teaser && (teaser.open || teaser.evidence));
  const courseLine = teaser
    ? courseTeaserShowsPrompt(teaser)
      ? t('community.world.coursePrompt', { prompt: teaser.prompt })
      : teaser.prompt
    : null;
  const meta = [courseLine, faceLine, clock, audience].filter(Boolean).join(' · ');
  const playHref = courseDeep
    ? coursePlayHref(work.slug, { course: true })
    : coursePlayHref(work.slug, { course: false });

  return (
    <div
      className={`og-work-card${world ? ' is-world' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => navigate(playHref)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(playHref);
      }}
    >
      <div className="og-work-card__cover">
        {work.thumbnail ? (
          <img src={work.thumbnail} alt="" loading="lazy" />
        ) : (
          <PlayCircleOutlined style={{ fontSize: 28, color: 'var(--color-gold)' }} />
        )}
        <span className="og-work-card__badge">
          {world && teaser
            ? teaser.actKey
              ? t(teaser.actKey)
              : t(courseTeaserBadgeKey(teaser))
            : world
              ? t('mobile.card.badgeWorld')
              : t('mobile.card.badgeGame')}
        </span>
      </div>
      <div className="og-work-card__body">
        <div className="og-work-card__title">{work.title}</div>
        <div className="og-work-card__meta">
          {world ? <TeamOutlined /> : <PlayCircleOutlined />}
          <span>{meta}</span>
        </div>
      </div>
    </div>
  );
};
