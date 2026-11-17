/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CodeChange {
  filename: string;
  type: 'added' | 'modified' | 'deleted';
  summary?: string;
  diff?: string;
}

/**
 * 从 OpenGame CLI 的输出中解析代码变更
 * CLI 输出格式可能是:
 * - JSON 格式: {"files": [{"path": "...", "action": "added|modified|deleted"}]}
 * - 或者文本格式，包含 git diff 信息
 */
export function parseCodeChangesFromOutput(stdout: string): CodeChange[] {
  const changes: CodeChange[] = [];

  // 尝试解析 JSON 格式
  try {
    // 查找 JSON 对象
    const jsonMatch = stdout.match(/\{[\s\S]*?"files"[\s\S]*?\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (Array.isArray(data.files)) {
        return data.files.map((f: any) => ({
          filename: f.path || f.filename || f.file,
          type: f.action || f.type || 'modified',
          summary: f.summary || f.description || '',
          diff: f.diff,
        }));
      }
    }
  } catch {
    // JSON 解析失败，继续尝试其他格式
  }

  // 尝试解析 git diff 格式
  const gitDiffPatterns = [
    /^(added|modified|deleted):\s*(.+)/gim,
    /^(A|M|D)\s+(.+)/g,
    /diff\s+--git.*?---\s+a\/(.+)\s*\n.*?---\s+b\/\.+/gm,
  ];

  for (const pattern of gitDiffPatterns) {
    let match;
    while ((match = pattern.exec(stdout)) !== null) {
      if (match[1] === 'A' || match[1] === 'added') {
        changes.push({ filename: match[2], type: 'added' });
      } else if (match[1] === 'M' || match[1] === 'modified') {
        changes.push({ filename: match[2], type: 'modified' });
      } else if (match[1] === 'D' || match[1] === 'deleted') {
        changes.push({ filename: match[2], type: 'deleted' });
      }
    }
    if (changes.length > 0) break;
  }

  // 尝试从文件路径中提取变更
  if (changes.length === 0) {
    const filePatterns = [
      /\/workspace\/(.+)/g,
      /projects\/.+?\/(.+?)(?:\s|$)/g,
      /(?:src|lib|components|pages|hooks)\/.+\.(ts|tsx|js|jsx|css|html)(?:\s|$)/g,
    ];

    const foundFiles = new Set<string>();
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(stdout)) !== null) {
        const file = match[1].trim();
        if (file && !foundFiles.has(file)) {
          foundFiles.add(file);
          // 假设新增的文件
          changes.push({
            filename: file,
            type: stdout.includes(`created`) || stdout.includes(`added`)
              ? 'added'
              : stdout.includes(`deleted`)
                ? 'deleted'
                : 'modified',
          });
        }
      }
    }
  }

  // 去重
  const uniqueChanges = changes.reduce((acc, change) => {
    const existing = acc.find((c) => c.filename === change.filename);
    if (!existing) {
      acc.push(change);
    }
    return acc;
  }, [] as CodeChange[]);

  return uniqueChanges;
}

/**
 * 从构建产物目录分析代码变更
 */
export async function analyzeWorkspaceChanges(
  workspace: string,
  previousFiles?: Set<string>
): Promise<CodeChange[]> {
  const changes: CodeChange[] = [];
  const fs = await import('node:fs');
  const path = await import('node:path');

  if (!fs.existsSync(workspace)) {
    return changes;
  }

  async function walkDir(dir: string, baseDir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 忽略 node_modules, dist, .git 等
        if (!['node_modules', 'dist', '.git', '.cache'].includes(entry.name)) {
          files.push(...(await walkDir(fullPath, baseDir)));
        }
      } else if (entry.isFile()) {
        files.push(path.relative(baseDir, fullPath));
      }
    }
    return files;
  }

  const currentFiles = new Set(await walkDir(workspace, workspace));

  // 检测新增的文件
  if (previousFiles) {
    for (const file of currentFiles) {
      if (!previousFiles.has(file)) {
        changes.push({ filename: file, type: 'added' });
      }
    }
    // 检测删除的文件
    for (const file of previousFiles) {
      if (!currentFiles.has(file)) {
        changes.push({ filename: file, type: 'deleted' });
      }
    }
  } else {
    // 没有 previousFiles，假设所有文件都是新增的
    for (const file of currentFiles) {
      changes.push({ filename: file, type: 'added' });
    }
  }

  return changes;
}
