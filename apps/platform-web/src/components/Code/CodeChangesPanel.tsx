/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';

import { FileTree, type FileTreeChange } from './FileTree.js';
import { DiffViewer } from './DiffViewer.js';

interface CodeChangesPanelProps {
  readonly changes: ReadonlyArray<FileTreeChange>;
}

/**
 * Master/detail combiner for the FileTree (left) and DiffViewer (right). Used
 * inside the IDE side panel — the panel manages its own selection state so it
 * stays out of the global generation hook.
 */
export const CodeChangesPanel: React.FC<CodeChangesPanelProps> = ({ changes }) => {
  const [selected, setSelected] = useState<FileTreeChange | null>(null);

  useEffect(() => {
    if (changes.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !changes.some((c) => c.filename === selected.filename)) {
      setSelected(changes[0] ?? null);
    }
  }, [changes, selected]);

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%', minHeight: 320 }}>
      <div style={{ width: 240, overflow: 'auto' }}>
        <FileTree
          changes={changes}
          selectedPath={selected?.filename ?? null}
          onSelect={setSelected}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {selected ? (
          <DiffViewer
            filename={selected.filename}
            diff={selected.diff}
            summary={selected.summary}
          />
        ) : null}
      </div>
    </div>
  );
};
