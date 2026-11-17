/**
 * ReflectionGate — MultiSourceContradictionGate (real logic, not empty stub).
 * Insert: maybeReflect, after evidence selection, before LLM reflection write.
 * NOT merged into packages/world-agents/src/reflect.ts.
 */

import type {
  GateContext,
  GateResult,
  MemoryEntryLike,
  ReflectionGate,
} from './types';
import { entryPointers } from './types';

export const DEFAULT_GATE_RULE_VERSION = 'mscg-text-v1-2026-09-26';

const HEARSAY_HINT =
  /听同伴说|从同行听说|镇上在传|听说|有人说|据说|rumour|rumor|hearsay|heard from peer/i;

/** Lexical negation / denial cues used for contradiction on evidence texts. */
const NEGATION_CUES =
  /并不?是|没有|并非|假的|不实|否认|澄清|纠正|不属实|并非如此|不是真的|false|not true|denied|debunk|incorrect|no evidence/i;

const AFFIRM_CUES =
  /确实|真的|就是|有毒|偷了|证实|肯定|confirmed|definitely|is true|really/i;

function entryLooksHearsay(e: MemoryEntryLike): boolean {
  return HEARSAY_HINT.test(e.text);
}

function normalizeKeyFragment(s: string): string {
  return s.toLowerCase().trim();
}

function collectFactKeys(entries: readonly MemoryEntryLike[]): string[] {
  const keys = new Set<string>();
  for (const e of entries) {
    for (const k of e.factKeys ?? []) keys.add(k);
  }
  return [...keys];
}

function entryTouchesKey(e: MemoryEntryLike, key: string): boolean {
  if ((e.factKeys ?? []).includes(key)) return true;
  const needle = normalizeKeyFragment(key);
  if (!needle) return false;
  return e.text.toLowerCase().includes(needle);
}

/**
 * Independent sources: distinct non-hearsay observation agentIds (or entry ids
 * when agentId is shared / self). Pure hearsay bucket counts as 1 weak source.
 */
export function countIndependentSources(
  evidence: readonly MemoryEntryLike[],
): number {
  const groundedIds = new Set<string>();
  let hearsayBucket = false;
  for (const e of evidence) {
    if (e.kind === 'reflection') continue;
    if (entryLooksHearsay(e) || e.kind === 'belief') {
      hearsayBucket = true;
      continue;
    }
    // Prefer pointer chain roots as identity when present.
    const ptr = entryPointers(e);
    if (ptr.length === 1) {
      groundedIds.add(`ptr:${ptr[0]}`);
    } else {
      groundedIds.add(`obs:${e.id}`);
    }
  }
  if (groundedIds.size > 0) return groundedIds.size;
  return hearsayBucket ? 1 : 0;
}

/**
 * Text-level contradiction: same tracked key appears in evidence with affirm
 * cues while an anchor (or another evidence item) carries negation, or an
 * explicit contradictionPairs mapping fires.
 */
function findTextContradictions(ctx: GateContext): {
  conflictingIds: string[];
  suspectFactKeys: string[];
  reasons: string[];
} {
  const reasons: string[] = [];
  const conflictingIds = new Set<string>();
  const suspectFactKeys = new Set<string>();
  const tracked = ctx.trackedFactKeys ?? [];
  const anchors = ctx.trustedAnchors ?? [];
  const evidence = ctx.candidateEvidence;

  for (const pair of ctx.contradictionPairs ?? []) {
    const rumorInEv = evidence.some((e) => entryTouchesKey(e, pair.rumorKey));
    const corrInAnchor = anchors.some((e) =>
      entryTouchesKey(e, pair.correctionKey),
    );
    const corrInEv = evidence.some((e) =>
      entryTouchesKey(e, pair.correctionKey),
    );
    if (rumorInEv && (corrInAnchor || corrInEv)) {
      suspectFactKeys.add(pair.rumorKey);
      for (const e of [...evidence, ...anchors]) {
        if (
          entryTouchesKey(e, pair.rumorKey) ||
          entryTouchesKey(e, pair.correctionKey)
        ) {
          conflictingIds.add(e.id);
        }
      }
      reasons.push(
        `contradiction_pair:${pair.rumorKey}<->${pair.correctionKey}`,
      );
    }
  }

  for (const key of tracked) {
    const affirming = evidence.filter(
      (e) => entryTouchesKey(e, key) && AFFIRM_CUES.test(e.text),
    );
    const denyingAnchors = anchors.filter(
      (e) =>
        (entryTouchesKey(e, key) || NEGATION_CUES.test(e.text)) &&
        NEGATION_CUES.test(e.text),
    );
    const denyingEvidence = evidence.filter(
      (e) => entryTouchesKey(e, key) && NEGATION_CUES.test(e.text),
    );

    // Anchor denies while evidence affirms the tracked rumor key.
    if (affirming.length > 0 && denyingAnchors.length > 0) {
      suspectFactKeys.add(key);
      for (const e of [...affirming, ...denyingAnchors]) conflictingIds.add(e.id);
      reasons.push(`anchor_denies_tracked:${key}`);
    }

    // Mixed affirm/deny inside the candidate evidence set itself.
    if (affirming.length > 0 && denyingEvidence.length > 0) {
      suspectFactKeys.add(key);
      for (const e of [...affirming, ...denyingEvidence]) conflictingIds.add(e.id);
      reasons.push(`mixed_polarity_in_evidence:${key}`);
    }
  }

  // Heuristic: any evidence text that both mentions a tracked key and carries
  // strong negation while another evidence affirms — covered above. Also catch
  // anchors whose factKeys include a non-tracked "correction*" while evidence
  // holds the rumor key (legacy stub behavior, kept as soft signal).
  const anchorKeys = new Set(collectFactKeys(anchors));
  const evidenceKeys = collectFactKeys(evidence);
  for (const ek of evidenceKeys) {
    if (!tracked.includes(ek)) continue;
    for (const ak of anchorKeys) {
      if (ak === ek) continue;
      if (
        tracked.includes(ak) ||
        /correct|truth|deny|false|澄清|纠正/i.test(ak)
      ) {
        suspectFactKeys.add(ek);
        for (const a of anchors) {
          if ((a.factKeys ?? []).includes(ak)) conflictingIds.add(a.id);
        }
        for (const e of evidence) {
          if ((e.factKeys ?? []).includes(ek)) conflictingIds.add(e.id);
        }
        reasons.push(`anchor_key_vs_rumor_key:${ek}<->${ak}`);
      }
    }
  }

  return {
    conflictingIds: [...conflictingIds],
    suspectFactKeys: [...suspectFactKeys],
    reasons,
  };
}

function touchesTrackedEvidence(
  evidence: readonly MemoryEntryLike[],
  tracked: readonly string[],
): { touches: boolean; suspectFactKeys: string[] } {
  const suspectFactKeys: string[] = [];
  const trackedSet = new Set(tracked);
  for (const e of evidence) {
    for (const k of e.factKeys ?? []) {
      if (trackedSet.has(k) && !suspectFactKeys.includes(k)) {
        suspectFactKeys.push(k);
      }
    }
    for (const k of tracked) {
      if (entryTouchesKey(e, k) && !suspectFactKeys.includes(k)) {
        suspectFactKeys.push(k);
      }
    }
  }
  const hearsayTouch =
    tracked.length === 0
      ? evidence.some((e) => entryLooksHearsay(e))
      : evidence.some(
          (e) =>
            entryLooksHearsay(e) &&
            tracked.some((k) => entryTouchesKey(e, k)),
        );
  return {
    touches: suspectFactKeys.length > 0 || hearsayTouch,
    suspectFactKeys,
  };
}

/**
 * Default gate: block upgrade on contradiction with trusted anchors / mixed
 * polarity, or when tracked rumor evidence lacks independent sources.
 */
export class MultiSourceContradictionGate implements ReflectionGate {
  readonly ruleVersion: string;

  constructor(ruleVersion: string = DEFAULT_GATE_RULE_VERSION) {
    this.ruleVersion = ruleVersion;
  }

  async evaluate(ctx: GateContext): Promise<GateResult> {
    const minSources = ctx.minIndependentSources ?? 2;
    const tracked = ctx.trackedFactKeys ?? [];
    const reasons: string[] = [];
    const evidenceKeys = collectFactKeys(ctx.candidateEvidence);

    const contradiction = findTextContradictions(ctx);
    reasons.push(...contradiction.reasons);

    if (contradiction.conflictingIds.length > 0) {
      return {
        decision: 'block',
        allowUpgrade: false,
        reason: contradiction.reasons[0] ?? 'contradicts_trusted_anchor',
        reasons,
        conflictingIds: contradiction.conflictingIds,
        suspectFactKeys: contradiction.suspectFactKeys,
        diagnostics: {
          gateRuleVersion: ctx.gateRuleVersion ?? this.ruleVersion,
          minSources,
          evidenceKeys,
          independent: countIndependentSources(ctx.candidateEvidence),
        },
      };
    }

    const { touches, suspectFactKeys } = touchesTrackedEvidence(
      ctx.candidateEvidence,
      tracked,
    );
    const independent = countIndependentSources(ctx.candidateEvidence);

    if (touches && independent < minSources) {
      reasons.push(
        `insufficient_independent_sources:${independent}<${minSources}`,
      );
      return {
        decision: 'block',
        allowUpgrade: false,
        reason: 'insufficient_independent_sources',
        reasons,
        suspectFactKeys,
        diagnostics: {
          gateRuleVersion: ctx.gateRuleVersion ?? this.ruleVersion,
          independent,
          minSources,
          evidenceKeys,
          hearsayHeavy: ctx.candidateEvidence.every(
            (e) => entryLooksHearsay(e) || e.kind === 'reflection',
          ),
        },
      };
    }

    if (!touches) {
      reasons.push('no_tracked_rumor_in_evidence');
    } else {
      reasons.push(`independent_sources_ok:${independent}>=${minSources}`);
    }

    return {
      decision: 'pass',
      allowUpgrade: true,
      reason: 'ok',
      reasons,
      suspectFactKeys,
      diagnostics: {
        gateRuleVersion: ctx.gateRuleVersion ?? this.ruleVersion,
        independent,
        minSources,
        evidenceKeys,
      },
    };
  }
}

/** No-op gate for A1 / tests. */
export class PassThroughGate implements ReflectionGate {
  async evaluate(_ctx: GateContext): Promise<GateResult> {
    return {
      decision: 'pass',
      allowUpgrade: true,
      reason: 'pass_through',
      reasons: ['pass_through'],
    };
  }
}

export function createDefaultGate(
  ruleVersion?: string,
): ReflectionGate {
  return new MultiSourceContradictionGate(ruleVersion);
}
