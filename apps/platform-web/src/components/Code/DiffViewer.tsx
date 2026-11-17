/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useMemo } from 'react';
import { Spin, Typography } from 'antd';

const { Text } = Typography;

interface DiffViewerProps {
  readonly filename: string;
  readonly diff?: string;
  readonly summary?: string;
}

/**
 * Heuristic: when the worker is configured with full diff payloads (P2+), we
 * render via Monaco's `DiffEditor`. For P1 the worker only ships unified
 * `diff` strings, so we render those ourselves with line coloring — Monaco
 * stays code-split so projects without diffs never load the editor bundle.
 */
const MonacoDiffEditor = lazy(async () => {
  try {
    const mod = (await import('@monaco-editor/react')) as {
      DiffEditor: React.ComponentType<any>;
    };
    return { default: mod.DiffEditor };
  } catch {
    return {
      default: function MonacoUnavailable() {
        return (
          <Text type="secondary" style={{ fontSize: 12 }}>
            未安装 @monaco-editor/react，回退为文本 diff
          </Text>
        );
      } as React.ComponentType<any>,
    };
  }
});

interface UnifiedDiffLine {
  readonly type: 'add' | 'remove' | 'context' | 'meta';
  readonly text: string;
}

function parseUnifiedDiff(diff: string): UnifiedDiffLine[] {
  const out: UnifiedDiffLine[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) {
      out.push({ type: 'meta', text: raw });
    } else if (raw.startsWith('+')) {
      out.push({ type: 'add', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      out.push({ type: 'remove', text: raw.slice(1) });
    } else {
      out.push({ type: 'context', text: raw });
    }
  }
  return out;
}

function languageForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'md':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

function looksLikeUnified(diff: string): boolean {
  return /^(---|\+\+\+|@@)/m.test(diff);
}

function splitDualPanel(diff: string): { before: string; after: string } | null {
  const sep = '\n---END---\n';
  if (!diff.includes(sep)) return null;
  const [before, after] = diff.split(sep);
  return { before: before ?? '', after: after ?? '' };
}

/**
 * Three rendering modes — picked from cheapest → richest:
 *   1. No diff at all → just show the change summary.
 *   2. Unified-diff text  → inline red/green pre block (P1 worker output).
 *   3. Dual-panel diff (P2+) → Monaco DiffEditor.
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({ filename, diff, summary }) => {
  const language = useMemo(() => languageForFilename(filename), [filename]);

  if (!diff || diff.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <Text strong style={{ fontSize: 13 }}>
          {filename}
        </Text>
        {summary && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {summary}
            </Text>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            （尚未获取该文件的 diff 内容）
          </Text>
        </div>
      </div>
    );
  }

  const dual = splitDualPanel(diff);
  if (dual) {
    return (
      <Suspense fallback={<Spin size="small" style={{ margin: 16 }} />}>
        <MonacoDiffEditor
          height="100%"
          language={language}
          original={dual.before}
          modified={dual.after}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            fontSize: 12,
          }}
        />
      </Suspense>
    );
  }

  if (looksLikeUnified(diff)) {
    const lines = parseUnifiedDiff(diff);
    return (
      <div
        style={{
          background: '#0f172a',
          color: '#e4e4e7',
          fontFamily: "'Fira Code', monospace",
          fontSize: 12,
          maxHeight: 480,
          overflow: 'auto',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid #1e293b',
            background: 'rgba(99,102,241,0.06)',
          }}
        >
          <Text strong style={{ fontSize: 12, color: '#a5b4fc' }}>
            {filename}
          </Text>
        </div>
        <pre style={{ margin: 0, padding: '8px 0' }}>
          {lines.map((ln, i) => (
            <div
              key={i}
              style={{
                padding: '0 12px',
                background:
                  ln.type === 'add'
                    ? 'rgba(34, 197, 94, 0.12)'
                    : ln.type === 'remove'
                      ? 'rgba(239, 68, 68, 0.12)'
                      : ln.type === 'meta'
                        ? 'rgba(99,102,241,0.08)'
                        : 'transparent',
                color:
                  ln.type === 'meta'
                    ? '#a5b4fc'
                    : ln.type === 'add'
                      ? '#86efac'
                      : ln.type === 'remove'
                        ? '#fca5a5'
                        : '#e4e4e7',
                whiteSpace: 'pre',
              }}
            >
              {ln.type === 'add' ? '+ ' : ln.type === 'remove' ? '- ' : '  '}
              {ln.text}
            </div>
          ))}
        </pre>
      </div>
    );
  }

  return (
    <pre
      style={{
        background: '#0f172a',
        color: '#e4e4e7',
        padding: 12,
        fontFamily: "'Fira Code', monospace",
        fontSize: 12,
        borderRadius: 6,
        overflow: 'auto',
        maxHeight: 480,
        margin: 0,
      }}
    >
      {diff}
    </pre>
  );
};
