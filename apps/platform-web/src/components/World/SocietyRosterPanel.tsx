/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observatory roster: pick a resident, pin them, interview, read the day plan.
 */

import React from 'react';
import { Button, Card, Input, Select, Space, Tag, Typography } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';
import { useT } from '../../services/i18n';
import {
  commitmentChips,
  paidTraceKind,
  talkColon,
  talkingWithOf,
} from './societyInspectorCopy';
import {
  currentPlanPlace,
  paidTraceLabelKey,
  placeLabel,
  readableResidentAction,
  regionLabel,
  whyLine,
  type PlanSegment,
} from './societyTownLabels';

const { Text } = Typography;

export type RosterAgent = {
  id: string;
  name: string;
  currentAction: string;
  regionId?: string;
  areaName?: string;
  regionName?: string;
  goalPlace?: string;
  goalReason?: string;
  drive?: string;
  needs?: {
    hunger: number;
    energy: number;
    social: number;
    curiosity: number;
  };
  padded?: boolean;
  identity?: string;
  stance?: string;
  secret?: string;
};

export type RosterObject = {
  id: string;
  name: string;
  areaId?: string;
  areaName?: string;
};

export type RosterRelation = {
  from: string;
  to: string;
  summary: string;
  kind?: string;
};

export type RosterMemory = {
  id?: string;
  text: string;
};

export type RosterInterview = {
  answer?: string;
  cited: string[];
  citedMemoryIds?: string[];
  source?: 'model' | 'memory';
} | null;

export type RosterDayPlan = {
  dayIndex?: number;
  replan?: boolean;
  reason?: string;
  segments: PlanSegment[];
} | null;

export interface SocietyRosterPanelProps {
  readonly agents: readonly RosterAgent[];
  readonly selectedAgent: string | null;
  readonly pinnedAgent: string | null;
  readonly agentCard: RosterAgent | null;
  readonly relations: readonly RosterRelation[];
  readonly objects: readonly RosterObject[];
  readonly dayPlan: RosterDayPlan;
  readonly cursor: number;
  readonly interviewQ: string;
  readonly interviewA: RosterInterview;
  readonly interviewLoading: boolean;
  readonly observatoryDisabled: boolean;
  readonly memories: readonly RosterMemory[];
  readonly locale: string;
  readonly isDark: boolean;
  readonly onSelectAgent: (id: string) => void;
  readonly onFocusRegion: (regionId?: string) => void;
  readonly onTogglePin: () => void;
  readonly onInterviewChange: (value: string) => void;
  readonly onAskInterview: (preset?: string) => void;
  readonly allowInterview?: boolean;
  readonly interviewHint?: string | null;
}

export const SocietyRosterPanel: React.FC<SocietyRosterPanelProps> = ({
  agents,
  selectedAgent,
  pinnedAgent,
  agentCard,
  relations,
  objects,
  dayPlan,
  cursor,
  interviewQ,
  interviewA,
  interviewLoading,
  observatoryDisabled,
  memories,
  locale,
  isDark,
  onSelectAgent,
  onFocusRegion,
  onTogglePin,
  onInterviewChange,
  onAskInterview,
  allowInterview = true,
  interviewHint,
}) => {
  const { t } = useT();
  const doingOf = (a: {
    currentAction: string;
    goalPlace?: string;
    goalReason?: string;
  }) =>
    readableResidentAction({
      currentAction: a.currentAction,
      goalPlace: a.goalPlace,
      goalReason: a.goalReason,
      t,
    });

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {agents.length ? (
        <Space wrap size={4}>
          {agents.map((a) => (
            <Button
              key={a.id}
              size="small"
              type={selectedAgent === a.id ? 'primary' : 'default'}
              onClick={() => {
                onFocusRegion(a.regionId);
                onSelectAgent(a.id);
              }}
            >
              {a.name}
              {a.padded ? ` · ${t('product.obs.paddedResident')}` : ''}
            </Button>
          ))}
        </Space>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('product.obs.noPoses')}
        </Text>
      )}
      <Select
        style={{ width: '100%' }}
        placeholder={t('product.obs.selectAgent')}
        value={selectedAgent ?? undefined}
        options={agents.map((a) => ({
          value: a.id,
          label: `${a.name} · ${regionLabel(a.regionId, a.regionName)}${a.areaName ? `/${a.areaName}` : ''} · ${doingOf(a).slice(0, 16)}`,
        }))}
        onChange={(v) => onSelectAgent(v)}
      />
      <Button
        size="small"
        icon={<PushpinOutlined />}
        type={pinnedAgent && pinnedAgent === selectedAgent ? 'primary' : 'default'}
        disabled={!selectedAgent}
        onClick={() => onTogglePin()}
      >
        {pinnedAgent && pinnedAgent === selectedAgent
          ? t('product.obs.unpin')
          : t('product.obs.pin')}
      </Button>
      {selectedAgent && agentCard ? (
        <Card size="small">
          <Text strong>{agentCard.name}</Text>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('product.obs.where')}
            </Text>
            <Text style={{ fontSize: 12, display: 'block' }}>
              {regionLabel(agentCard.regionId, agentCard.regionName)}
              {agentCard.areaName ? ` / ${agentCard.areaName}` : ''}
              {agentCard.goalPlace
                ? ` · ${t('product.obs.headingTo', { place: agentCard.goalPlace })}`
                : ''}
              {currentPlanPlace(dayPlan, cursor, objects)
                ? ` · ${t('product.obs.plannedAt', {
                    place: currentPlanPlace(dayPlan, cursor, objects),
                  })}`
                : ''}
            </Text>
          </div>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('product.obs.doing')}
            </Text>
            <Text style={{ fontSize: 12, display: 'block' }}>
              {doingOf(agentCard)}
              {talkingWithOf(agentCard.currentAction)
                ? ` · ${t('product.obs.talkingWith', {
                    who: talkingWithOf(agentCard.currentAction)!,
                  })}`
                : ''}
            </Text>
          </div>
          {whyLine({
            goalPlace: agentCard.goalPlace,
            goalReason: agentCard.goalReason,
            drive: agentCard.drive,
            currentAction: agentCard.currentAction,
            t,
          }) ? (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.why')}
              </Text>
              <Text style={{ fontSize: 12, display: 'block' }}>
                {whyLine({
                  goalPlace: agentCard.goalPlace,
                  goalReason: agentCard.goalReason,
                  drive: agentCard.drive,
                  currentAction: agentCard.currentAction,
                  t,
                })}
              </Text>
            </div>
          ) : null}
          {commitmentChips(
            relations,
            selectedAgent,
            (id) =>
              id === 'visitor'
                ? t('product.obs.visitor')
                : agents.find((a) => a.id === id)?.name ?? id,
          ).length ? (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.commitments')}
              </Text>
              <div>
                {commitmentChips(
                  relations,
                  selectedAgent,
                  (id) =>
                    id === 'visitor'
                      ? t('product.obs.visitor')
                      : agents.find((a) => a.id === id)?.name ?? id,
                ).map((chip) => (
                  <Tag
                    key={`${chip.kind}-${chip.who}`}
                    color={
                      chip.kind === 'conflict'
                        ? 'red'
                        : chip.kind === 'adopt'
                          ? 'magenta'
                          : chip.kind === 'rumor'
                            ? 'orange'
                            : 'gold'
                    }
                    style={{ marginTop: 4 }}
                  >
                    {chip.kind === 'plaza'
                      ? t('product.obs.owedGather', { who: chip.who })
                      : chip.kind === 'reply'
                        ? t('product.obs.owedReply', { who: chip.who })
                        : chip.kind === 'conflict'
                          ? t('product.obs.owedConflict', { who: chip.who })
                          : chip.kind === 'adopt'
                            ? t('product.obs.owedAdopt', { who: chip.who })
                            : chip.kind === 'rumor'
                              ? t('product.obs.owedRumor', { who: chip.who })
                              : t('product.obs.owedPromise', {
                                  who: chip.who,
                                  detail: chip.detail || '',
                                })}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
          {agentCard.identity ? (
            <Text style={{ fontSize: 12 }}>{agentCard.identity}</Text>
          ) : null}
          {agentCard.stance ? (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.stance')}
              </Text>
              <Text style={{ fontSize: 12, display: 'block' }}>
                {agentCard.stance}
              </Text>
            </div>
          ) : null}
          {agentCard.secret ? (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.secret')}
              </Text>
              <Text style={{ fontSize: 12, display: 'block' }}>
                {agentCard.secret}
              </Text>
            </div>
          ) : null}
          {agentCard.needs ? (
            <Space
              orientation="vertical"
              size={2}
              style={{ width: '100%', marginTop: 6 }}
            >
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.needs')}
              </Text>
              {(
                [
                  ['hunger', t('product.obs.needHunger')],
                  ['energy', t('product.obs.needEnergy')],
                  ['social', t('product.obs.needSocial')],
                  ['curiosity', t('product.obs.needCuriosity')],
                ] as const
              ).map(([key, label]) => {
                const v = agentCard.needs![key];
                return (
                  <div key={key} style={{ width: '100%' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {label} {Math.round(v * 100)}%
                    </Text>
                    <div
                      style={{
                        height: 4,
                        borderRadius: 2,
                        background: isDark ? '#1e293b' : '#e2e8f0',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(v * 100)}%`,
                          height: 4,
                          borderRadius: 2,
                          background: v >= 0.72 ? '#f97316' : '#38bdf8',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </Space>
          ) : null}
        </Card>
      ) : null}
      {selectedAgent && allowInterview ? (
        <Space orientation="vertical" size={6} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('product.obs.interview')}
          </Text>
          {interviewHint ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {interviewHint}
            </Text>
          ) : null}
          <Input.TextArea
            rows={2}
            value={interviewQ}
            onChange={(e) => onInterviewChange(e.target.value)}
            placeholder={t('product.obs.interviewPlaceholder')}
            disabled={observatoryDisabled}
          />
          <Space wrap size={4}>
            {(
              [
                t('product.obs.interviewChipDoing'),
                t('product.obs.interviewChipMet'),
                t('product.obs.interviewChipFriend'),
                ...(agents.find((a) => a.id !== selectedAgent)
                  ? [
                      t('product.obs.interviewChipWhere', {
                        name: agents.find((a) => a.id !== selectedAgent)!.name,
                      }),
                    ]
                  : []),
              ] as string[]
            ).map((q) => (
              <Button
                key={q}
                size="small"
                disabled={observatoryDisabled || interviewLoading}
                onClick={() => void onAskInterview(q)}
              >
                {q}
              </Button>
            ))}
          </Space>
          <Button
            size="small"
            loading={interviewLoading}
            disabled={observatoryDisabled || !interviewQ.trim() || interviewLoading}
            onClick={() => void onAskInterview()}
          >
            {t('product.obs.interviewAsk')}
          </Button>
          {interviewA?.answer ? (
            <Text style={{ fontSize: 12 }}>{interviewA.answer}</Text>
          ) : null}
          {interviewA?.cited.length ? (
            <Space orientation="vertical" size={2} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.cited')}
                {talkColon(locale)}
              </Text>
              {interviewA.cited.slice(0, 4).map((c, i) => {
                const id = interviewA.citedMemoryIds?.[i];
                const mem =
                  (id ? memories.find((m) => m.id === id) : undefined) ??
                  memories.find((m) => m.text === c);
                const paid = paidTraceKind(mem?.text ?? c);
                const labelKey = paidTraceLabelKey(paid);
                return (
                  <Text
                    key={`${id ?? i}-${c.slice(0, 12)}`}
                    style={{
                      fontSize: 11,
                      color: paid ? '#c026d3' : undefined,
                    }}
                  >
                    {labelKey ? `${t(labelKey)} · ` : ''}
                    {(mem?.text ?? c).slice(0, 48)}
                  </Text>
                );
              })}
            </Space>
          ) : null}
        </Space>
      ) : null}
      {dayPlan?.segments.length ? (
        <Space orientation="vertical" size={2} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('product.obs.plan')}
          </Text>
          {dayPlan.replan || dayPlan.reason ? (
            <Text style={{ fontSize: 12, color: '#d97706' }}>
              {t('product.obs.planReplan', {
                reason: dayPlan.reason?.trim() || t('product.obs.objectOff'),
              })}
            </Text>
          ) : null}
          {dayPlan.segments.slice(0, 8).map((s, i) => {
            const hourNow = Math.floor(((cursor % 24) + 24) % 24);
            const on =
              typeof s.startHour === 'number' &&
              typeof s.endHour === 'number' &&
              hourNow >= s.startHour &&
              hourNow < s.endHour;
            return (
              <Text
                key={`${dayPlan.dayIndex}-${i}`}
                style={{
                  fontSize: 12,
                  fontWeight: on ? 600 : 400,
                  color: on ? '#d97706' : undefined,
                }}
              >
                {typeof s.startHour === 'number'
                  ? `${s.startHour}–${s.endHour ?? ''} `
                  : ''}
                {s.activity ?? ''}
                {s.locationId || s.locationName
                  ? ` @ ${placeLabel(s.locationId, s.locationName, objects)}`
                  : ''}
              </Text>
            );
          })}
        </Space>
      ) : null}
    </Space>
  );
};
