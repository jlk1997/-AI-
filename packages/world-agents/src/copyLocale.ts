/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Living-society copy locale. A world compiled from an English prompt speaks
 * English; Chinese prompts keep the existing observatory voice.
 */

export const RUMOR_PREFIX_ZH = '镇上在传';
export const RUMOR_PREFIX_EN = 'Word is out';
export const WHISPER_PREFIX_ZH = '有人悄悄对你说';
export const WHISPER_PREFIX_EN = 'Someone whispered';
export const HEARSAY_PREFIX_ZH = '听同伴说';
export const HEARSAY_PREFIX_EN = 'Heard from peer';

export const MEETING_HINT_RE =
  /今晚|广场|聚会|交班|晚课|碰面|tonight|gathering|handoff|vespers|meet at|plaza|square|bridge|chapel/i;

export const INTERESTING_OBJECT_RE =
  /broken|open|fire|alarm|offline|dark|empty|missing|handoff|vespers|notice|聚会|party|熄|灭了|坏了/i;

export function isAsciiCopy(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters.length) return false;
  return !/[^\x00-\x7F]/.test(letters);
}

export function societyCopyAscii(state: {
  readonly copyAscii?: boolean;
  readonly agents?: ReadonlyArray<{
    readonly name: string;
    readonly identitySummary?: string;
  }>;
}): boolean {
  if (state.copyAscii != null) return state.copyAscii;
  const blob = (state.agents ?? [])
    .map((a) => `${a.name}${a.identitySummary ?? ''}`)
    .join('');
  return isAsciiCopy(blob);
}

export function rumorMemory(text: string, ascii: boolean): string {
  return ascii ? `${RUMOR_PREFIX_EN}: ${text}` : `${RUMOR_PREFIX_ZH}：${text}`;
}

/** Drop the bookkeeping wrapper so a rumor can be spoken about, not recited. */
export function rumorClaim(text: string): string {
  const raw = text.trim();
  const stripped = raw
    .replace(/^镇上在传[:：]\s*/, '')
    .replace(/^Word is out:\s*/i, '')
    .replace(/^有人悄悄对你说[:：]\s*/, '')
    .replace(/^Someone whispered:\s*/i, '')
    .replace(/^听同伴说[:：]\s*/, '')
    .replace(/^Heard from peer:\s*/i, '')
    .trim();
  return stripped || raw;
}

/** What someone does right after news lands — visible on the map, not a rumor. */
export function checkingNewsAction(claim: string, ascii: boolean): string {
  const bit = claim.replace(/\s+/g, ' ').trim().slice(0, 18);
  if (ascii) {
    return bit ? `checking the news: ${bit}` : 'checking what they just heard';
  }
  return bit ? `去核对刚听到的：${bit}` : '去核对刚听到的消息';
}

export function whisperMemory(text: string, ascii: boolean): string {
  return ascii
    ? `${WHISPER_PREFIX_EN}: ${text}`
    : `${WHISPER_PREFIX_ZH}：${text}`;
}

export function hearsayMemory(fact: string, ascii: boolean): string {
  return ascii
    ? `${HEARSAY_PREFIX_EN}: ${fact}`
    : `${HEARSAY_PREFIX_ZH}：${fact}`;
}

export function isWhisperMemoryText(text: string): boolean {
  return (
    text.includes(WHISPER_PREFIX_ZH) ||
    text.includes(WHISPER_PREFIX_EN)
  );
}

export function isRumorMemoryText(text: string): boolean {
  return (
    text.includes(RUMOR_PREFIX_ZH) ||
    text.includes(RUMOR_PREFIX_EN)
  );
}

export function isAdoptMemoryText(text: string): boolean {
  return text.includes('【认养】') || /^Adopted /i.test(text);
}

/** Whisper / 巷议 / 认养 — paid traces the next speak must be able to retrieve. */
export function isPaidTraceMemory(text: string): boolean {
  return (
    isWhisperMemoryText(text) ||
    isRumorMemoryText(text) ||
    isAdoptMemoryText(text)
  );
}

export function isTalkingAction(text: string): boolean {
  return /交谈|talking with|talking to/i.test(text);
}

export function talkingAction(other: string, ascii: boolean): string {
  return ascii ? `talking with ${other}` : `与${other}交谈`;
}

export function witnessObservation(input: {
  readonly name: string;
  readonly place?: string;
  readonly doing: string;
  readonly ascii: boolean;
}): string {
  if (input.ascii) {
    return input.place
      ? `${input.name} is at ${input.place}, ${input.doing}`
      : `${input.name} is ${input.doing}`;
  }
  return input.place
    ? `${input.name}在${input.place}，正在${input.doing}`
    : `${input.name}正在${input.doing}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Place named in a witness line written by {@link witnessObservation}. */
export function placeFromWitnessText(
  text: string,
  otherName: string,
): string | undefined {
  if (!otherName.trim()) return undefined;
  const name = escapeRegExp(otherName);
  const zh = new RegExp(`^${name}在([^，,]{1,16})，正在`);
  const zhHit = zh.exec(text);
  if (zhHit?.[1]) return zhHit[1];
  const en = new RegExp(`^${name} is at ([^,.]{1,40}),`, 'i');
  const enHit = en.exec(text);
  return enHit?.[1]?.trim() || undefined;
}

export function objectUsedMemory(
  name: string,
  nextState: string,
  ascii: boolean,
): string {
  return ascii ? `used ${name}: ${nextState}` : `用了${name}：${nextState}`;
}

export function investigateAction(reason: string, ascii: boolean): string {
  return ascii ? `checking: ${reason}` : `查看：${reason}`;
}

export function lookedAtMemory(
  name: string,
  state: string,
  ascii: boolean,
): string {
  return ascii ? `looked at ${name}: ${state}` : `查看了 ${name}：${state}`;
}

export function seekTalkAction(
  why: 'see-crowd' | 'seek-last-seen' | 'seek-talk' | 'keep-promise',
  ascii: boolean,
): string {
  if (ascii) {
    if (why === 'see-crowd') return 'heading toward the crowd';
    if (why === 'seek-last-seen') return 'looking for someone I saw';
    if (why === 'keep-promise') return 'heading to a promised meeting';
    return 'going to talk';
  }
  if (why === 'see-crowd') return '去看热闹';
  if (why === 'seek-last-seen') return '去找上次见到的人';
  if (why === 'keep-promise') return '去赴约';
  return '去找人说话';
}

export function brokenObjectReason(name: string, ascii: boolean): string {
  return ascii ? `${name} is out, going elsewhere` : `${name}熄了，改去别处`;
}

export function interviewMemory(
  question: string,
  answer: string,
  ascii: boolean,
): string {
  return ascii
    ? `Someone interviewed me, asked: "${question}". I said: "${answer}"`
    : `有人采访我，问：「${question}」。我答：「${answer}」`;
}

export function isInterviewEcho(text: string): boolean {
  return /^有人采访我|^Someone interviewed me/i.test(text);
}

export function portalCrossingAction(
  label: string | undefined,
  ascii: boolean,
): string {
  if (ascii) return label ? `passing ${label}` : 'crossing through';
  return label ? `经过${label}` : '穿过路口';
}

export function portalHeadingAction(
  label: string | undefined,
  ascii: boolean,
): string {
  if (ascii) return label ? `heading to ${label}` : 'heading to the crossing';
  return label ? `前往${label}` : '去路口';
}

/** Intra-region walk toward a named place (not a portal hop). */
export function headingToPlaceAction(
  place: string | undefined,
  ascii: boolean,
): string {
  const p = place?.trim();
  if (ascii) return p ? `heading to ${p}` : 'on the way';
  return p ? `往${p}走` : '路上';
}

/** Town-wide rumor speaker shown in the talk feed (not a resident name). */
export function townWideSpeaker(input: {
  readonly ascii: boolean;
  readonly packId?: string;
}): string {
  const pack = input.packId ?? '';
  if (pack === 'society.crew') return input.ascii ? 'Whole crew' : '全舰';
  if (pack === 'society.cloister') return input.ascii ? 'House' : '全院';
  return input.ascii ? 'Town' : '全镇';
}

export function isTownWideSpeaker(name: string): boolean {
  return /^(全镇|全舰|全院|Town|Whole crew|House)$/i.test(name.trim());
}
