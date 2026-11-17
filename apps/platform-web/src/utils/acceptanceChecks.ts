/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEventRow } from '../types';
import type { JobLifecycleStatus } from '../hooks/useGeneration';

export type AcceptanceCheckStatus = 'pass' | 'fail' | 'pending';

export type AcceptanceCheckItem = {
  id: string;
  label: string;
  status: AcceptanceCheckStatus;
};

function lastEvent(
  events: AgentEventRow[],
  pred: (e: AgentEventRow) => boolean,
): AgentEventRow | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (pred(events[i]!)) return events[i];
  }
  return undefined;
}

function detailsBlob(events: AgentEventRow[]): string {
  return events
    .map((e) => JSON.stringify(e.details ?? {}))
    .join('\n')
    .toLowerCase();
}

function summaryBlob(events: AgentEventRow[]): string {
  return events
    .map((e) => `${e.summary ?? ''} ${e.tool ?? ''} ${e.phase ?? ''}`)
    .join('\n')
    .toLowerCase();
}

/** Prefer structured gate/smoke/asset details over log heuristics. */
export function deriveAcceptanceChecks(
  events: AgentEventRow[],
  mode: 'game' | 'world',
  lifecycle: JobLifecycleStatus,
): AcceptanceCheckItem[] {
  const text = `${summaryBlob(events)}\n${detailsBlob(events)}`;
  const details = detailsBlob(events);

  const lastQualityGate = lastEvent(
    events,
    (e) => e.tool === 'game-quality-gate' || e.tool === 'world-quality-gate',
  );
  const lastGateFailed = Boolean(
    lastQualityGate &&
      (lastQualityGate.details?.['ok'] === false ||
        /未通过|gate failed/i.test(lastQualityGate.summary ?? '')),
  );
  const lastGatePassed = Boolean(
    lastQualityGate &&
      (lastQualityGate.details?.['ok'] === true ||
        /门禁通过|gate passed/i.test(lastQualityGate.summary ?? '')),
  );
  // A FIX loop emits "gate failed" then "gate passed". The strip must follow
  // the latest verdict, or a recovered world stays "质检: 需修复" forever.
  const hasQaFail = lastQualityGate
    ? lastGateFailed && !lastGatePassed
    : events.some(
        (e) =>
          (e.phase === 'QA' ||
            e.tool?.includes('quality') ||
            e.tool?.includes('smoke')) &&
          /未通过|fail|failed|missing/i.test(`${e.summary ?? ''}`) &&
          !/passed|通过/i.test(`${e.summary ?? ''}`),
      );

  const smokeStructuredOk = events.some(
    (e) =>
      (e.tool === 'playability-smoke' || /smoke/i.test(e.tool ?? '')) &&
      (e.details?.['smokeOk'] === true ||
        e.details?.['ok'] === true ||
        /运行时冒烟通过/i.test(e.summary ?? '')),
  );
  const smokeStructuredFail = events.some(
    (e) =>
      (e.tool === 'playability-smoke' || /smoke|playability/i.test(e.tool ?? '')) &&
      (e.details?.['smokeOk'] === false ||
        e.details?.['ok'] === false ||
        /冒烟.*失败|未找到 canvas/i.test(e.summary ?? '')),
  );

  const qualityStructuredOk = lastGatePassed;
  const qualityStructuredFail = lastGateFailed && !lastGatePassed;

  const minimaxAssetOk = events.some(
    (e) =>
      (e.tool === 'minimax-game-asset-phase' ||
        e.tool === 'minimax-world-asset-phase' ||
        /minimax/i.test(e.tool ?? '')) &&
      (/完成|minimax/i.test(e.summary ?? '') ||
        (Array.isArray(e.details?.['files']) &&
          (e.details?.['files'] as unknown[]).length > 0) ||
        e.details?.['quality'] === 'minimax'),
  );
  const assetAuthenticityFail =
    /authenticity|near-solid|too small|procedural|禁止占位|missing minimax pack|shape\/color without assetid/i.test(
      text,
    );
  const juiceEvidence =
    /sfx_coin|preloadgameaudio|startfollow|gameplaysignal.:true|pointerframes/i.test(
      text,
    );

  const smokePass =
    smokeStructuredOk || /运行时冒烟通过|smokeok.:true/.test(text);
  const smokeFail =
    smokeStructuredFail ||
    (/冒烟|playability/.test(text) && /失败|fail|未找到 canvas/.test(text));
  const qualityPass =
    qualityStructuredOk || /内容质量门禁通过/.test(text);
  const worldQualityPass =
    qualityStructuredOk ||
    /world quality gate passed|世界内容门禁通过/.test(text);
  const buildPass = /基础 qa 通过|vite build|npm install \+ vite/.test(text);
  const failed = lifecycle === 'failed';

  /** Evidence-first: never paint green from lifecycle=done alone. */
  const mark = (ok: boolean | null): AcceptanceCheckStatus => {
    if (ok === true) return 'pass';
    if (ok === false || failed) return 'fail';
    return 'pending';
  };


  const visionPass = events.some(
    (e) =>
      e.tool === 'vision-qa' &&
      (/通过/i.test(e.summary ?? '') ||
        (typeof e.details?.['average'] === 'number' &&
          Number(e.details['average']) >= 4)),
  );
  const visionFail = events.some(
    (e) =>
      e.tool === 'vision-qa' &&
      (/未过|fail/i.test(e.summary ?? '') ||
        (typeof e.details?.['ok'] === 'boolean' && e.details['ok'] === false)),
  );
  const playtestPass = events.some(
    (e) =>
      e.tool === 'playtest-agent' &&
      (e.details?.['ok'] === true ||
        (/ending=true/i.test(e.summary ?? '') && /~2[0-9]m|~[3-9][0-9]m/i.test(e.summary ?? ''))),
  );
  const playtestFail = events.some(
    (e) =>
      e.tool === 'playtest-agent' &&
      (e.details?.['ok'] === false ||
        e.details?.['softFail'] === true ||
        /未达标|ending=false|soft-fail/i.test(e.summary ?? '')),
  );
  const emergenceEvents = events.filter(
    (e) =>
      e.tool === 'society-emergence' ||
      /emergence gate failed|涌现门禁/i.test(e.summary ?? ''),
  );
  const latestEmergence = emergenceEvents[emergenceEvents.length - 1];
  const emergenceFail = latestEmergence
    ? (() => {
        const e = latestEmergence;
        const details = (e.details ?? {}) as {
          gateFailed?: boolean;
          spreadOk?: boolean;
          hours?: number;
          windowHours?: number;
          dialogues?: number;
          report?: { informationSpread?: { rate?: number } };
        };
        if (details.gateFailed === true) return true;
        if (details.dialogues === 0) return true;
        const windowHours = details.windowHours ?? 24;
        if (details.spreadOk === false && (details.hours ?? 0) >= windowHours) return true;
        const rate = details.report?.informationSpread?.rate;
        if (typeof rate === 'number' && rate < 0.3 && (details.hours ?? 0) >= windowHours) {
          return true;
        }
        return /emergence gate failed|扩散.*< ?30|spread.*< ?30/i.test(e.summary ?? '');
      })()
    : false;
  const emergencePass =
    !emergenceFail &&
    events.some((e) => {
      if (e.tool === 'society-emergence') {
        const details = (e.details ?? {}) as {
          spreadOk?: boolean;
          gateFailed?: boolean;
          report?: { informationSpread?: { rate?: number } };
        };
        if (details.gateFailed) return false;
        if (details.spreadOk === true) return true;
        const rate = details.report?.informationSpread?.rate;
        return typeof rate === 'number' && rate >= 0.3;
      }
      const rate = (
        e.details as { report?: { informationSpread?: { rate?: number } } } | null
      )?.report?.informationSpread?.rate;
      return (
        /society|emergence|社会/i.test(`${e.tool ?? ''} ${e.summary ?? ''}`) &&
        typeof rate === 'number' &&
        rate >= 0.3
      );
    });

  const reqEvent = events.find((e) => e.tool === 'requirement-gate');
  const reqSatisfied = Array.isArray(reqEvent?.details?.['satisfied'])
    ? (reqEvent!.details!['satisfied'] as unknown[]).length
    : 0;
  const reqMissing = Array.isArray(reqEvent?.details?.['missing'])
    ? (reqEvent!.details!['missing'] as unknown[]).length
    : 0;
  const reqTotal = reqSatisfied + reqMissing;
  const reqSummary = /需求贴合\s+(\d+)\/(\d+)/.exec(reqEvent?.summary ?? '');
  const reqDone = reqSummary ? Number(reqSummary[1]) : reqSatisfied;
  const reqAll = reqSummary ? Number(reqSummary[2]) : reqTotal;
  const requirementCheck: AcceptanceCheckItem | null =
    reqEvent && reqAll > 0
      ? {
          id: 'requirements',
          label: `Named mechanics ${reqDone}/${reqAll}`,
          status: reqMissing > 0 || (reqAll > 0 && reqDone < reqAll) ? 'fail' : 'pass',
        }
      : null;

  if (mode === 'world') {
    const regionsEvidence =
      /ensureworlddepth|world quality|regions.?[:=]\s*[3-9]|\"regions\":\s*[3-9]/.test(
        text,
      ) || worldQualityPass;
    const l2Evidence =
      /agenticdiff|agentic pre-pass|opsapplied|playability probe|questsstartedinprobe/.test(
        text,
      );
    const l3Evidence =
      /l3 playable|spatialassets|cinematic|assertworldl3|clip.*playable|videourl|asseturl|minimax.*poster/.test(
        text,
      );
    const l3Fail = /l3.*unplayable|禁止仅 json|slot not playable|无 videourl|1×1|1x1/.test(
      text,
    );
    const realArt =
      minimaxAssetOk ||
      /assetquality.:.minimax|world asset.*minimax|minimax 真资产/.test(text);

    return [
      ...(requirementCheck ? [requirementCheck] : []),
      {
        id: 'regions',
        label: '≥3 regions / ≥2 NPCs',
        status: mark(
          regionsEvidence ? !hasQaFail && !qualityStructuredFail : hasQaFail ? false : null,
        ),
      },
      {
        id: 'l2',
        label: 'Society expanded (agentic)',
        status: mark(l2Evidence ? !hasQaFail : null),
      },
      {
        id: 'l3',
        label: 'Region art playable',
        status: mark(l3Fail ? false : l3Evidence ? !hasQaFail : null),
      },
      {
        id: 'assets',
        label: 'MiniMax real art/audio',
        status: mark(
          assetAuthenticityFail
            ? false
            : realArt
              ? true
              : hasQaFail
                ? false
                : null,
        ),
      },
      {
        id: 'build',
        label: 'Presenter build',
        status: mark(
          buildPass || worldQualityPass
            ? !failed && !hasQaFail
            : hasQaFail
              ? false
              : null,
        ),
      },
      {
        id: 'emergence',
        label: (() => {
          const rate = (
            latestEmergence?.details as
              | { report?: { informationSpread?: { rate?: number } } }
              | undefined
          )?.report?.informationSpread?.rate;
          return typeof rate === 'number'
            ? `Society emergence ${Math.round(rate * 100)}%`
            : 'Society emergence ≥30%';
        })(),
        status: mark(
          emergenceFail ? false : emergencePass ? true : null,
        ),
      },
    ];
  }

  return [
    ...(requirementCheck ? [requirementCheck] : []),
    {
      id: 'loop',
      label: 'Playable loop / win path',
      status: mark(
        qualityPass
          ? !hasQaFail && !qualityStructuredFail
          : qualityStructuredFail
            ? false
            : null,
      ),
    },
    {
      id: 'assets',
      label: 'MiniMax art (not placeholders)',
      status: mark(
        assetAuthenticityFail
          ? false
          : minimaxAssetOk || /patchedgamejson.:true|quality.:.minimax/.test(details)
            ? true
            : /artdirector|generate_game_assets|assets\//.test(text)
              ? !/missing on disk/.test(text) && !hasQaFail
              : null,
      ),
    },
    {
      id: 'smoke',
      label: 'Playability smoke (real progress)',
      status: smokeFail ? 'fail' : smokePass ? 'pass' : 'pending',
    },
    {
      id: 'juice',
      label: 'Audio / camera juice signals',
      status: mark(
        juiceEvidence
          ? !hasQaFail
          : smokePass || minimaxAssetOk
            ? null
            : hasQaFail
              ? false
              : null,
      ),
    },
    {
      id: 'build',
      label: 'Build + quality gate',
      status: mark(
        qualityPass || buildPass
          ? !hasQaFail && !failed && !qualityStructuredFail
          : hasQaFail || qualityStructuredFail
            ? false
            : null,
      ),
    },
    {
      id: 'vision',
      label: 'Vision QA ≥4.0',
      status: mark(visionFail ? false : visionPass ? true : null),
    },
    {
      id: 'playtest',
      label: 'Playtest clear ≥20m content',
      status: mark(playtestFail ? false : playtestPass ? true : null),
    },
    ...(/auto-rpg-world-seed|createemptytownworld/.test(text)
      ? [
          {
            id: 'autoTownSeed',
            label: 'Auto town layout (not your Society World)',
            status: 'pending' as const,
          },
        ]
      : []),
  ];
}
