/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Circular knowledge-graph view of society relations (no d3).
 */

import React, { useMemo, useState } from 'react';
import { Typography } from 'antd';
import { useT } from '../../services/i18n';

const { Text } = Typography;

export type SocietyRelationEdge = {
  readonly from: string;
  readonly to: string;
  readonly summary: string;
  readonly affinity: number;
  readonly kind?: string;
  readonly lastInteractSimTime?: number;
};

export type SocietyRelationNode = {
  readonly id: string;
  readonly name: string;
};

export interface SocietyRelationGraphProps {
  readonly agents: readonly SocietyRelationNode[];
  readonly relations: readonly SocietyRelationEdge[];
  readonly selectedId?: string | null;
  readonly cursor?: number;
  readonly onSelect?: (agentId: string) => void;
  readonly height?: number;
}

function isRumorish(summary: string): boolean {
  return /听同伴说|镇上在传|聚会|传闻|whisper|party|Heard from peer|Word is out|gathering|handoff/i.test(
    summary,
  );
}

function relationKindOf(e: SocietyRelationEdge): string {
  if (e.kind) return e.kind;
  const m = /^【([^】]+)】/u.exec(e.summary);
  return m?.[1] ?? '';
}

function kindStroke(
  kind: string,
  aff: number,
  rumor: boolean,
  fresh: boolean,
): string {
  const a = 0.3 + aff * 0.6;
  const k = kind.replace(/^【|】$/g, '');
  if (k === 'family' || k === '家人') return `rgba(244,114,182,${a})`;
  if (k === 'coworker' || k === '同事') return `rgba(45,212,191,${a})`;
  if (k === 'neighbor' || k === '邻居') return `rgba(74,222,128,${a})`;
  if (k === 'rival' || k === '对头' || k === 'conflict' || k === '闹过别扭') {
    return `rgba(248,113,113,${a})`;
  }
  if (k === 'promise' || k === '有约定') return `rgba(251,191,36,${a})`;
  if (k === 'adopted' || k === '认养') return `rgba(244,114,182,${0.45 + aff * 0.5})`;
  if (k === 'rumor' || k === '巷议') return `rgba(217,119,6,${0.4 + aff * 0.5})`;
  if (rumor) return `rgba(217,119,6,${0.35 + aff * 0.55})`;
  if (fresh) return `rgba(56,189,248,${0.4 + aff * 0.5})`;
  return `rgba(167,139,250,${0.25 + aff * 0.65})`;
}

export function SocietyRelationGraph({
  agents,
  relations,
  selectedId,
  cursor = 0,
  onSelect,
  height = 280,
}: SocietyRelationGraphProps): React.ReactElement {
  const { t } = useT();
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const visitorName = t('product.obs.visitor');
  const graphAgents = useMemo(() => {
    const needsVisitor = relations.some(
      (e) => e.from === 'visitor' || e.to === 'visitor',
    );
    if (!needsVisitor || agents.some((a) => a.id === 'visitor')) return agents;
    return [...agents, { id: 'visitor', name: visitorName }];
  }, [agents, relations, visitorName]);

  const layout = useMemo(() => {
    const n = Math.max(graphAgents.length, 1);
    const cx = 160;
    const cy = height / 2;
    const r = Math.min(120, height / 2 - 28);
    const pos = new Map<string, { x: number; y: number; name: string }>();
    graphAgents.forEach((a, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      pos.set(a.id, {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        name: a.name,
      });
    });
    return { cx, cy, r, pos };
  }, [graphAgents, height]);

  const edges = useMemo(() => {
    const ranked = [...relations]
      .filter((e) => layout.pos.has(e.from) && layout.pos.has(e.to))
      .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
      .slice(0, 40);
    return ranked;
  }, [relations, layout.pos]);

  const tip = useMemo(() => {
    if (hoverEdge) {
      const e = edges.find((x) => `${x.from}-${x.to}` === hoverEdge);
      if (e) {
        const a = layout.pos.get(e.from)?.name ?? e.from;
        const b = layout.pos.get(e.to)?.name ?? e.to;
        return `${a} ↔ ${b} · ${e.summary.slice(0, 72)}${
          e.affinity ? ` (${e.affinity.toFixed(2)})` : ''
        }${relationKindOf(e) ? ` · ${relationKindOf(e)}` : ''}`;
      }
    }
    if (hoverNode) {
      const p = layout.pos.get(hoverNode);
      if (p) return p.name;
    }
    return null;
  }, [hoverEdge, hoverNode, edges, layout.pos]);

  if (!agents.length) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Text>
    );
  }

  return (
    <div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 320 ${height}`}
        style={{
          background: 'var(--ant-color-fill-quaternary, #0f172a18)',
          borderRadius: 8,
          display: 'block',
        }}
      >
        {edges.map((e) => {
          const a = layout.pos.get(e.from)!;
          const b = layout.pos.get(e.to)!;
          const key = `${e.from}-${e.to}`;
          const rumor = isRumorish(e.summary);
          const fresh =
            typeof e.lastInteractSimTime === 'number' &&
            cursor - e.lastInteractSimTime < 2;
          const aff = Math.max(0, Math.min(1, e.affinity ?? 0));
          const active = hoverEdge === key;
          const stroke = kindStroke(relationKindOf(e), aff, rumor, fresh);
          return (
            <line
              key={key}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={(active ? 2.5 : 1) + aff * 3}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoverEdge(key)}
              onMouseLeave={() => setHoverEdge(null)}
            />
          );
        })}
        {graphAgents.map((agent) => {
          const p = layout.pos.get(agent.id)!;
          const selected = selectedId === agent.id;
          const hovered = hoverNode === agent.id;
          return (
            <g
              key={agent.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect?.(agent.id)}
              onMouseEnter={() => setHoverNode(agent.id)}
              onMouseLeave={() => setHoverNode(null)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={selected || hovered ? 16 : 13}
                fill={selected ? '#a78bfa' : hovered ? '#38bdf8' : '#7dd3fc'}
                stroke={selected ? '#7c3aed' : '#0f172a33'}
                strokeWidth={selected ? 2 : 1}
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fontSize="10"
                fontWeight={600}
                fill="#0f172a"
              >
                {agent.name.slice(0, 1)}
              </text>
              <text
                x={p.x}
                y={p.y + 26}
                textAnchor="middle"
                fontSize="9"
                fill="var(--ant-color-text-secondary, #64748b)"
              >
                {agent.name.length > 4 ? `${agent.name.slice(0, 3)}…` : agent.name}
              </text>
            </g>
          );
        })}
      </svg>
      {tip ? (
        <Text style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
          {tip}
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
          {t('product.obs.relationHint')}
        </Text>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {(
          [
            [t('product.obs.relFamily'), 'rgba(244,114,182,0.9)'],
            [t('product.obs.relCoworker'), 'rgba(45,212,191,0.9)'],
            [t('product.obs.relNeighbor'), 'rgba(74,222,128,0.9)'],
            [t('product.obs.relRival'), 'rgba(248,113,113,0.9)'],
            [t('product.obs.relPromise'), 'rgba(251,191,36,0.9)'],
            [t('product.obs.relAdopted'), 'rgba(244,114,182,0.9)'],
            [t('product.obs.relRumor'), 'rgba(217,119,6,0.9)'],
          ] as const
        ).map(([label, color]) => (
          <Text key={label} type="secondary" style={{ fontSize: 10 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 8,
                background: color,
                marginRight: 4,
              }}
            />
            {label}
          </Text>
        ))}
      </div>
    </div>
  );
}
