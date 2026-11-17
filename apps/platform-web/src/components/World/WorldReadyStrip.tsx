/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact Spec / quest metadata strip — no competing CTAs on the primary stage.
 */

import React from 'react';
import { Space, Tag, Tooltip, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { societySeedUsedFallback } from '@opengame/world-spec';
import { useT } from '../../services/i18n';
import { plannerSourceLabelKey } from './societyInspectorCopy';

const { Text } = Typography;

export type WorldReadySummary = {
  readonly title: string;
  readonly tipRevision: number;
  readonly summary?: string;
  readonly gameplay?: {
    regions: number;
    npcs: number;
    enemies: number;
    quests: number;
    hasCombat: boolean;
    winCondition: string;
    controls: string[];
  };
  readonly l3?: {
    backend: string | null;
    lingbotMode: 'mock' | 'real' | null;
    cinematicEnabled: boolean;
    clipCount: number;
  };
  readonly l2?: {
    opsApplied: number;
    regionsDelta: number;
    questsDelta: number;
    /** True when agenticDiff was stamped (even if opsApplied=0). */
    ran?: boolean;
  };
  readonly quests?: Array<{ title: string; status: string }>;
  readonly plannerSource?: string | null;
  readonly authoredNpcs?: number;
  readonly paddedNpcs?: number;
  readonly authoredNames?: readonly string[];
  readonly paddedNames?: readonly string[];
  readonly worldBrief?: {
    readonly packId?: string;
    readonly useCase?: string;
    readonly venues?: readonly string[];
    readonly note?: string;
  } | null;
  readonly societySeed?: {
    readonly hours?: number;
    readonly dialogues: number;
    readonly spread: number;
    readonly degraded: boolean;
    readonly gateFailed: boolean;
    readonly retrievalDegraded: boolean;
  } | null;
};

export interface WorldReadyStripProps {
  readonly world: WorldReadySummary;
  readonly onOpenPanel?: () => void;
  /** Jump to World panel L3 / cinematic controls. */
  readonly onOpenL3?: () => void;
  /** Focus Society Observatory in the right pane. */
  readonly onOpenObservatory?: () => void;
  /** When true, skip the Observatory CTA (already on that pane). */
  readonly observatoryActive?: boolean;
}

export const WorldReadyStrip: React.FC<WorldReadyStripProps> = ({
  world,
  observatoryActive,
}) => {
  const { t } = useT();
  const g = world.gameplay;
  const plannerKey = plannerSourceLabelKey(world.plannerSource);

  return (
    <div
      style={{
        flexShrink: 0,
        padding: '6px 14px',
        background: 'color-mix(in srgb, var(--color-teal) 12%, var(--bg-card))',
        borderBottom: '1px solid color-mix(in srgb, var(--color-teal) 32%, var(--border-color))',
      }}
    >
      <Space size={8} wrap align="center">
        <GlobalOutlined style={{ color: 'var(--color-teal)' }} />
        <Text strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>
          {world.title}
        </Text>
        <Tag style={{ margin: 0 }}>r{world.tipRevision}</Tag>
        {g ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {observatoryActive
              ? `${g.npcs} ${t('product.obs.agents')} · ${g.regions} ${t('world.gameplay.regions')}`
              : `${g.npcs} NPC · ${g.regions} ${t('world.gameplay.regions')} · ${g.quests} ${t('world.gameplay.quests')}`}
          </Text>
        ) : null}
        {plannerKey ? (
          <Tooltip
            title={t(
              world.plannerSource === 'llm'
                ? 'world.lineage.source.llm'
                : world.plannerSource === 'heuristic'
                  ? 'world.lineage.source.heuristic'
                  : world.plannerSource === 'heuristic_merged'
                    ? 'world.lineage.source.heuristic_merged'
                    : '',
            )}
          >
            <Tag
              color={world.plannerSource === 'llm' ? 'cyan' : 'orange'}
              style={{ margin: 0 }}
            >
              {t(plannerKey)}
            </Tag>
          </Tooltip>
        ) : null}
        {world.worldBrief?.useCase || world.worldBrief?.venues?.length ? (
          <Tag style={{ margin: 0 }} color="geekblue">
            {world.worldBrief?.useCase
              ? t(`world.create.useCase.${world.worldBrief.useCase}`)
              : t('world.create.useCase')}
            {world.worldBrief?.venues?.length
              ? ` · ${world.worldBrief.venues.slice(0, 3).join('+')}`
              : ''}
            {world.worldBrief?.note
              ? ` · ${world.worldBrief.note.slice(0, 18)}${
                  world.worldBrief.note.length > 18 ? '…' : ''
                }`
              : ''}
          </Tag>
        ) : null}
        {world.paddedNpcs && world.paddedNpcs > 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.rosterPad', {
              authored: String(world.authoredNpcs ?? 0),
              padded: String(world.paddedNpcs),
            })}
            {world.authoredNames?.length
              ? ` · ${world.authoredNames.slice(0, 4).join('、')}`
              : ''}
            {world.paddedNames?.length
              ? ` · ${t('product.obs.paddedResident')} ${world.paddedNames.slice(0, 3).join('、')}`
              : ''}
          </Text>
        ) : null}
        {world.societySeed ? (
          <Tag
            color={world.societySeed.gateFailed ? 'error' : 'cyan'}
            style={{ margin: 0 }}
          >
            {world.societySeed.gateFailed
              ? t('product.obs.seedFailed')
              : t('product.obs.seedContract')}
            {world.societySeed.hours != null
              ? ` · ${world.societySeed.hours}h`
              : ''}
            {` · ${t('product.obs.realDialogues')} ${world.societySeed.dialogues}`}
            {` · ${t('product.obs.spread')} ${Math.round(world.societySeed.spread * 100)}%`}
          </Tag>
        ) : null}
        {world.societySeed &&
        (world.societySeed.retrievalDegraded ||
          societySeedUsedFallback(world.societySeed)) ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {world.societySeed.retrievalDegraded
              ? t('product.obs.retrievalDegraded')
              : t('product.obs.seedDegraded')}
          </Text>
        ) : null}
      </Space>
    </div>
  );
};
