/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Space, Typography } from 'antd';

import { SocietyWhyStrip } from './SocietyWhyStrip';

const { Text } = Typography;

export interface SocietyObservatoryStatsProps {
  readonly clockLabel: string;
  readonly seedHours?: number | null;
  readonly spreadLabel: string;
  readonly realDialogues: number;
  readonly liveTalks: number;
  readonly seedDegraded?: boolean;
  readonly retrievalDegraded?: boolean;
  readonly seedDegradedText: string;
  readonly retrievalDegradedText: string;
  readonly seedHoursText: string;
  readonly spreadText: string;
  readonly realDialoguesText: string;
  readonly liveTalkText: string;
  readonly surprise?: string | null;
  readonly demand?: string | null;
  readonly citedMemoryIds?: readonly string[] | null;
}

export function SocietyObservatoryStats(
  props: SocietyObservatoryStatsProps,
): React.ReactElement {
  return (
    <>
      <Text style={{ fontSize: 16 }}>{props.clockLabel}</Text>
      <Space size={8} wrap>
        {props.seedHours != null ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {props.seedHoursText} {props.seedHours}h
          </Text>
        ) : null}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {props.spreadText} {props.spreadLabel}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {props.realDialoguesText} {props.realDialogues}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {props.liveTalkText} {props.liveTalks}
        </Text>
        {props.seedDegraded ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {props.seedDegradedText}
          </Text>
        ) : null}
        <SocietyWhyStrip
          demand={props.demand}
          surprise={props.surprise}
          citedMemoryIds={props.citedMemoryIds}
          retrievalDegraded={Boolean(props.retrievalDegraded)}
        />
        {props.retrievalDegraded ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {props.retrievalDegradedText}
          </Text>
        ) : null}
      </Space>
    </>
  );
}
