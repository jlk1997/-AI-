/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { desc, eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { projectBriefs } from '@opengame/platform-db';

import type { ProjectBrief } from './types.js';

export function emptyBrief(): ProjectBrief {
  return { version: 1, constraints: [], avoid: [] };
}

export async function loadLatestBrief(
  db: DrizzleDb,
  projectId: string,
): Promise<ProjectBrief | null> {
  const [row] = await db
    .select()
    .from(projectBriefs)
    .where(eq(projectBriefs.projectId, projectId))
    .orderBy(desc(projectBriefs.version))
    .limit(1);
  if (!row) return null;
  return row.briefJson as ProjectBrief;
}

export async function saveBrief(
  db: DrizzleDb,
  projectId: string,
  brief: Omit<ProjectBrief, 'version'>,
): Promise<ProjectBrief> {
  const latest = await loadLatestBrief(db, projectId);
  const nextVersion = (latest?.version ?? 0) + 1;
  const toSave: ProjectBrief = { ...brief, version: nextVersion };
  await db.insert(projectBriefs).values({
    projectId,
    version: nextVersion,
    briefJson: toSave,
  });
  return toSave;
}

export async function patchBriefFromPrompt(
  db: DrizzleDb,
  projectId: string,
  userPrompt: string,
  gameParams?: Record<string, unknown>,
): Promise<ProjectBrief> {
  const current = (await loadLatestBrief(db, projectId)) ?? emptyBrief();
  const patched: Omit<ProjectBrief, 'version'> = {
    title: current.title ?? extractTitle(userPrompt),
    genre: current.genre,
    archetype: current.archetype,
    gameplay: mergeText(current.gameplay, userPrompt),
    story: current.story,
    artStyle: gameParams?.['theme']
      ? String(gameParams['theme'])
      : current.artStyle,
    audioStyle: gameParams?.['musicStyle']
      ? String(gameParams['musicStyle'])
      : current.audioStyle,
    constraints: current.constraints,
    avoid: current.avoid,
  };
  const saved = await saveBrief(db, projectId, patched);
  return saved;
}

export async function syncBriefToWorkspace(
  workspace: string,
  brief: ProjectBrief,
): Promise<void> {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(
    path.join(workspace, 'GAME_BRIEF.json'),
    JSON.stringify(brief, null, 2),
    'utf8',
  );
}

export async function loadBriefFromWorkspace(
  workspace: string,
): Promise<ProjectBrief | null> {
  try {
    const raw = await fs.readFile(
      path.join(workspace, 'GAME_BRIEF.json'),
      'utf8',
    );
    return JSON.parse(raw) as ProjectBrief;
  } catch {
    return null;
  }
}

function extractTitle(prompt: string): string {
  const m = prompt.match(/(?:做|制作|生成|创建)(?:一个|一款)?(.{2,30}?)(?:游戏|$)/);
  return m?.[1]?.trim() ?? prompt.slice(0, 40);
}

function mergeText(existing: string | undefined, addition: string): string {
  if (!existing) return addition.slice(0, 500);
  if (existing.includes(addition.slice(0, 40))) return existing;
  return `${existing}\n- ${addition.slice(0, 200)}`.slice(0, 2000);
}

export function formatBriefForPrompt(brief: ProjectBrief | null): string {
  if (!brief) return '';
  const lines = [
    '【项目需求简报 / Project Brief】',
    brief.title ? `- 标题: ${brief.title}` : null,
    brief.genre ? `- 类型: ${brief.genre}` : null,
    brief.archetype ? `- Archetype: ${brief.archetype}` : null,
    brief.gameplay ? `- 玩法: ${brief.gameplay}` : null,
    brief.story ? `- 剧情: ${brief.story}` : null,
    brief.artStyle ? `- 美术: ${brief.artStyle}` : null,
    brief.audioStyle ? `- 音频: ${brief.audioStyle}` : null,
    brief.constraints?.length
      ? `- 必须: ${brief.constraints.join('；')}`
      : null,
    brief.avoid?.length ? `- 避免: ${brief.avoid.join('；')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}
