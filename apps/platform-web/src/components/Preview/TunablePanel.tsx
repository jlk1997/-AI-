/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Empty, Slider, Switch, Input, Typography, Space, Button, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface TunableEntry {
  readonly entityId: string;
  readonly key: string;
  readonly type: 'number' | 'string' | 'boolean';
  readonly value: number | string | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
}

interface TunablePanelProps {
  /** Either the game iframe's content window, or `null` to wait. */
  readonly target: Window | null;
}

/**
 * Talks to `@opengame/runtime/dev` inside the running game iframe over
 * `postMessage`. The runtime publishes a list of tunables when the game
 * starts; this panel renders sliders/switches for each and posts updates back.
 *
 * Falls back gracefully when the iframe never responds — useful for older
 * games that predate the dev bridge.
 */
export const TunablePanel: React.FC<TunablePanelProps> = ({ target }) => {
  const [entries, setEntries] = useState<TunableEntry[]>([]);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as
        | { kind: 'opengame:tunables'; entries: TunableEntry[] }
        | undefined;
      if (!data || data.kind !== 'opengame:tunables') return;
      setEntries(data.entries);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!target) return;
    const t = window.setInterval(() => {
      reqIdRef.current += 1;
      target.postMessage({ kind: 'opengame:request-tunables' }, '*');
    }, 1500);
    return () => window.clearInterval(t);
  }, [target]);

  const send = (e: TunableEntry, value: number | string | boolean): void => {
    if (!target) return;
    target.postMessage(
      { kind: 'opengame:tunable-set', entityId: e.entityId, key: e.key, value },
      '*',
    );
    setEntries((prev) =>
      prev.map((p) => (p.entityId === e.entityId && p.key === e.key ? { ...p, value } : p)),
    );
  };

  if (entries.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前游戏尚未声明可调参数（DSL `tunables`）
            </Text>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space>
        <Text strong style={{ fontSize: 12 }}>
          运行时参数
        </Text>
        <Tooltip title="重新请求最新参数">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => target?.postMessage({ kind: 'opengame:request-tunables' }, '*')}
          />
        </Tooltip>
      </Space>
      {entries.map((entry) => (
        <div key={`${entry.entityId}:${entry.key}`}>
          <Text style={{ fontSize: 11, color: '#a1a1aa' }}>
            {entry.label ?? `${entry.entityId}.${entry.key}`}
          </Text>
          {entry.type === 'number' &&
            typeof entry.value === 'number' &&
            entry.min !== undefined &&
            entry.max !== undefined ? (
            <Slider
              min={entry.min}
              max={entry.max}
              step={entry.step ?? 1}
              value={entry.value}
              onChange={(v) => send(entry, v)}
            />
          ) : entry.type === 'boolean' ? (
            <Switch
              checked={Boolean(entry.value)}
              onChange={(v) => send(entry, v)}
            />
          ) : (
            <Input
              size="small"
              value={String(entry.value)}
              onChange={(e) =>
                send(entry, entry.type === 'number' ? Number(e.target.value) : e.target.value)
              }
            />
          )}
        </div>
      ))}
    </div>
  );
};
