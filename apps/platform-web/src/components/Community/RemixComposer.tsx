/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The product loop on a work page: pick a line or write one, then fork.
 * Desktop detail and phone play share this so the gesture stays the same.
 */

import React from 'react';
import { Alert, Button, Input } from 'antd';
import { ForkOutlined } from '@ant-design/icons';

export const RemixComposer: React.FC<{
  readonly lane: 'game' | 'world';
  readonly chips: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit: () => void;
  readonly loading?: boolean;
  readonly locked?: boolean;
  readonly lockedMessage?: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly requireLine?: boolean;
  readonly extra?: React.ReactNode;
}> = ({
  lane,
  chips,
  value,
  onChange,
  onSubmit,
  loading = false,
  locked = false,
  lockedMessage,
  hint,
  placeholder,
  submitLabel,
  requireLine = false,
  extra,
}) => (
  <div className={`og-remix ${lane === 'world' ? 'is-world' : 'is-game'}`}>
    <p className="og-remix__hint">{hint}</p>
    {locked && lockedMessage ? (
      <Alert type="info" showIcon style={{ marginBottom: 12 }} title={lockedMessage} />
    ) : null}
    <div className="og-suggest-row" role="list">
      {chips.map((chip) => {
        const on = value === chip;
        return (
          <button
            key={chip}
            type="button"
            role="listitem"
            className={`og-suggest ${on ? 'is-on' : ''} ${lane === 'world' ? 'is-world' : 'is-game'}`}
            disabled={locked}
            onClick={() => onChange(on ? '' : chip)}
          >
            {chip}
          </button>
        );
      })}
    </div>
    <Input.TextArea
      className="og-remix__field"
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={200}
      showCount
      disabled={locked}
      placeholder={placeholder}
      onPressEnter={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        if (locked || loading) return;
        if (requireLine && !value.trim()) return;
        onSubmit();
      }}
    />
    <Button
      type="primary"
      block
      icon={<ForkOutlined />}
      loading={loading}
      disabled={locked || (requireLine && !value.trim())}
      onClick={onSubmit}
    >
      {submitLabel}
    </Button>
    {extra}
  </div>
);
