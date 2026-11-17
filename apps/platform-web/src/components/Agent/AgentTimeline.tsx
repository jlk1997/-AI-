/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Typography, Tag, Tooltip } from 'antd';
import {
  BulbOutlined,
  CodeOutlined,
  PictureOutlined,
  ExperimentOutlined,
  ToolOutlined,
  GlobalOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { AgentEventRow, AgentRole, AgentPhase } from '../../types';
import { getActiveJobEvents } from '../../utils/generationProgressText';
import { useT } from '../../services/i18n';

const { Text } = Typography;

interface AgentTimelineProps {
  readonly events: AgentEventRow[];
  readonly maxHeight?: number;
  readonly generationMode?: 'game' | 'world';
  readonly activeJobId?: string | null;
}

const ROLE_LABEL: Record<AgentRole, string> = {
  planner: '策划',
  coder: '程序',
  artist: '美术',
  qa: 'QA',
  fixer: '修复',
  system: '系统',
};

const ROLE_LABEL_WORLD: Record<AgentRole, string> = {
  planner: '世界规划',
  coder: 'Presenter',
  artist: '空间/视觉',
  qa: '校验',
  fixer: '修复',
  system: '系统',
};

const ROLE_COLOR: Record<AgentRole, string> = {
  planner: '#8b5cf6',
  coder: '#6366f1',
  artist: '#ec4899',
  qa: '#f59e0b',
  fixer: '#ef4444',
  system: '#71717a',
};

const PHASE_LABEL: Record<AgentPhase, string> = {
  PLAN: '规划',
  INTENT: '意图',
  WORLD: '世界编译',
  CODE: '编码',
  ITERATE: '迭代',
  ASSET: '资产',
  BUILD: '构建',
  QA: '验证',
  FIX: '修复',
  PREVIEW: '可玩交付',
  CURATE: '整理',
  DONE: '完成',
  FAIL: '失败',
};

function phaseIcon(phase: AgentPhase): React.ReactNode {
  switch (phase) {
    case 'PLAN':
    case 'INTENT':
      return <BulbOutlined />;
    case 'WORLD':
      return <GlobalOutlined />;
    case 'CODE':
    case 'ITERATE':
    case 'FIX':
      return <CodeOutlined />;
    case 'ASSET':
      return <PictureOutlined />;
    case 'BUILD':
      return <ToolOutlined />;
    case 'QA':
      return <ExperimentOutlined />;
    case 'PREVIEW':
    case 'DONE':
      return <CheckCircleOutlined />;
    case 'FAIL':
      return <CloseCircleOutlined />;
    default:
      return <ClockCircleOutlined />;
  }
}

/**
 * Renders the FSM thought-chain (PLAN→CODE→BUILD→QA→FIX→DONE) emitted by the
 * worker via SSE. Stays read-only — clicks on rows expand details in a tooltip
 * to keep the conversation panel uncluttered.
 */
export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  events,
  maxHeight = 280,
  generationMode = 'game',
  activeJobId = null,
}) => {
  const { t } = useT();
  const focused = getActiveJobEvents(events, activeJobId);
  if (focused.length === 0) {
    return null;
  }
  const roles = generationMode === 'world' ? ROLE_LABEL_WORLD : ROLE_LABEL;
  const confirmEvt = [...focused]
    .reverse()
    .find(
      (e) =>
        e.phase === 'PLAN' &&
        e.details &&
        (e.details['confirmBar'] === true ||
          typeof e.details['confirmLabel'] === 'string'),
    );
  const confirmLabel =
    typeof confirmEvt?.details?.['confirmLabel'] === 'string'
      ? (confirmEvt.details['confirmLabel'] as string)
      : confirmEvt?.summary && /^本轮将改：/.test(confirmEvt.summary)
        ? confirmEvt.summary
        : null;

  return (
    <div
      style={{
        padding: '8px 12px',
        background:
          generationMode === 'world'
            ? 'rgba(20, 184, 166, 0.06)'
            : 'rgba(99, 102, 241, 0.06)',
        border:
          generationMode === 'world'
            ? '1px solid rgba(20, 184, 166, 0.2)'
            : '1px solid rgba(99, 102, 241, 0.18)',
        borderRadius: 8,
        maxHeight,
        overflowY: 'auto',
        fontSize: 12,
      }}
    >
      <Text strong style={{ fontSize: 11, color: '#a5b4fc' }}>
        {t('generate.agentTimeline.title', { count: focused.length })}
      </Text>
      {confirmLabel && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.35)',
            color: '#fde68a',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {confirmLabel}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {focused.map((evt) => (
          <Tooltip
            key={evt.id}
            title={
              evt.details ? (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 11,
                    maxWidth: 360,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {JSON.stringify(evt.details, null, 2)}
                </pre>
              ) : (
                evt.summary ?? `${evt.role}:${evt.phase}`
              )
            }
            placement="left"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 4,
                background: evt.phase === 'FAIL' ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
              }}
            >
              <span style={{ color: ROLE_COLOR[evt.role], fontSize: 14, lineHeight: 1 }}>
                {phaseIcon(evt.phase)}
              </span>
              <Tag
                color={ROLE_COLOR[evt.role]}
                style={{ margin: 0, fontSize: 10, lineHeight: '14px' }}
              >
                {roles[evt.role]} · {PHASE_LABEL[evt.phase]}
              </Tag>
              <Text
                style={{ flex: 1, color: '#e4e4e7', fontSize: 11 }}
                ellipsis={{ tooltip: false }}
              >
                {evt.summary ?? (evt.tool ? `tool: ${evt.tool}` : '')}
              </Text>
              {typeof evt.elapsedMs === 'number' && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {evt.elapsedMs}ms
                </Text>
              )}
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};
