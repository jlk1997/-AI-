/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author 今夜出题. Plain language. Options bind to this town.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Space, Typography, message } from 'antd';

import {
  buildCustomCourseSeed,
  courseWinLine,
  courseCanAuthorQueue,
  placesFromWorldSpec,
  suggestCourseFromPlaces,
  suggestCourseFromTalks,
  validateCourseSeedReachability,
  worldCoursePrefersNightMarket,
} from '@opengame/platform-shared';

import {
  api,
  ApiError,
  type CourseBoard,
  type CourseSeedBody,
} from '../../services/api';
import { translateApiError, useT } from '../../services/i18n';
import { mergeCourseBoardPoll } from './courseBoardMerge';
import {
  availableCourseSeedPicks,
  authorSeedTownMeta,
  authorReplacePreviewPrompt,
  courseReachabilityTagForPick,
  courseReachabilityTagKey,
  courseSeedPickLabelKey,
  courseSeedPickNeedsForm,
  courseCanAuthorReplace,
  courseAuthorRecommendHintKey,
  courseSeedPickRecommendKind,
  courseRecommendNeedsPost,
  courseRecommendEmptyHintKey,
  formatAuthorSeedTownMeta,
  genreProfileFromWorldSpec,
  type CourseSeedPick,
} from './courseAuthorFlow';
import { CourseRecommendPreviewCard } from './CourseRecommendPreviewCard';
import { useCourseRecommendPreview } from './useCourseRecommendPreview';
import type { TalkLine } from './societyTownStageModel';

const { Text } = Typography;

export type CourseAuthorPlace = {
  readonly id: string;
  readonly name: string;
};

function courseErrorCopy(
  t: (k: string) => string,
  err: unknown,
): string {
  const raw =
    err instanceof ApiError
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message ?? '')
        : '';
  if (/23514|ledger_entries_kind/i.test(raw)) {
    return t('product.obs.course.err.ledger');
  }
  const key = `product.obs.course.err.${raw}`;
  const localized = t(key);
  return localized !== key ? localized : translateApiError(err);
}

export const SocietyTownCourseAuthorModal: React.FC<{
  readonly open: boolean;
  readonly onClose: () => void;
  readonly gameId?: string | null;
  readonly projectId?: string | null;
  readonly talks?: readonly TalkLine[];
  readonly places?: readonly CourseAuthorPlace[];
  readonly worldSpec?: unknown;
  readonly seedEmpty?: boolean;
  readonly locale?: 'zh-CN' | 'en';
  readonly onSeeded?: (board: CourseBoard) => void;
}> = ({
  open,
  onClose,
  gameId,
  projectId,
  talks = [],
  places,
  worldSpec,
  seedEmpty = false,
  locale = 'zh-CN',
  onSeeded,
}) => {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [residents, setResidents] = useState<Array<{ key: string; name: string }>>(
    [],
  );
  const [agentKey, setAgentKey] = useState<string | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [labels, setLabels] = useState(['', '', '', '']);
  const [board, setBoard] = useState<CourseBoard | null>(null);
  const [hintPlaces, setHintPlaces] = useState<CourseAuthorPlace[]>([]);
  const [hintTalks, setHintTalks] = useState<TalkLine[]>([]);
  const [hintVillage, setHintVillage] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [pick, setPick] = useState<CourseSeedPick | null>(null);

  const townPlaces = useMemo(() => {
    if (places && places.length > 0) return places;
    if (hintPlaces.length > 0) return hintPlaces;
    return placesFromWorldSpec(worldSpec);
  }, [places, hintPlaces, worldSpec]);

  const livingTalks = talks.length > 0 ? talks : hintTalks;
  const talkSuggest = useMemo(
    () => suggestCourseFromTalks(livingTalks, locale),
    [livingTalks, locale],
  );
  const placeSuggest = useMemo(
    () => suggestCourseFromPlaces(townPlaces, locale),
    [townPlaces, locale],
  );
  const villagePack =
    worldCoursePrefersNightMarket(worldSpec) || hintVillage;
  const { genreId, packId } = genreProfileFromWorldSpec(worldSpec);
  const recommendHintKey = courseAuthorRecommendHintKey({
    genreId,
    packId,
    villagePack,
  });

  useEffect(() => {
    if (!open) return;
    const req = gameId
      ? api.community.residents(gameId)
      : projectId
        ? api.community.worldResidents(projectId)
        : null;
    if (!req) return;
    let cancelled = false;
    const applySpecHints = (spec: unknown): void => {
      const fromSpec = placesFromWorldSpec(spec);
      if (fromSpec.length > 0) setHintPlaces([...fromSpec]);
      setHintVillage(worldCoursePrefersNightMarket(spec));
    };
    const loadSpec = (pid: string): Promise<void> =>
      api.world
        .get(pid)
        .then((res) => {
          if (cancelled) return;
          if (res.world?.spec) applySpecHints(res.world.spec);
        })
        .catch(() => undefined);
    void req
      .then((res) => {
        if (cancelled) return;
        setResidents(res.residents);
        setAgentKey((cur) => cur ?? res.residents[0]?.key);
        setHintPlaces([...(res.places ?? [])]);
        setHintVillage(Boolean(res.villagePack));
        setHintTalks(
          (res.talks ?? []).map((row, i) => ({
            id: `hint-${i}`,
            eventId: `hint-${i}`,
            turnIndex: i,
            simTime: 0,
            kind: row.kind ?? 'dialogue',
            who: row.who ?? '',
            text: row.text,
          })),
        );
        const first = res.residents[0]?.name;
        if (first) {
          setPrompt((cur) =>
            cur.trim()
              ? cur
              : locale === 'en'
                ? `Is ${first} still in town tonight`
                : `${first} 今夜是否还在镇上`,
          );
        }
      })
      .catch(() => {
        if (worldSpec) applySpecHints(worldSpec);
        if (projectId) return loadSpec(projectId);
        if (!gameId) return;
        return api.community
          .getGame(gameId)
          .then((game) => {
            const raw =
              game && typeof game === 'object'
                ? (game as { authorProjectId?: unknown }).authorProjectId
                : '';
            const pid = typeof raw === 'string' ? raw.trim() : '';
            if (!pid) return;
            return loadSpec(pid);
          })
          .catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [open, gameId, projectId, locale, worldSpec]);

  useEffect(() => {
    if (!open) return;
    const req = gameId
      ? api.community.course(gameId)
      : projectId
        ? api.community.worldCourse(projectId)
        : null;
    if (!req) return;
    let cancelled = false;
    void req
      .then((next) => {
        if (cancelled) return;
        setBoard((prev) => mergeCourseBoardPoll(prev, next));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, gameId, projectId]);

  useEffect(() => {
    if (open) return;
    setStep(0);
    setPick(null);
    setBusy(null);
  }, [open]);

  const picks = availableCourseSeedPicks({
    villagePack,
    residentCount: residents.length,
    placeCount: townPlaces.length,
    hasTalks: Boolean(talkSuggest),
  });

  const applyPick = (next: CourseSeedPick): void => {
    setPick(next);
    if (next === 'resident') {
      const name = residents.find((row) => row.key === agentKey)?.name
        ?? residents[0]?.name
        ?? '';
      if (name) {
        setPrompt(
          locale === 'en'
            ? `Is ${name} still in town tonight`
            : `${name} 今夜是否还在镇上`,
        );
        setLabels([
          locale === 'en' ? 'Still here' : '还在',
          locale === 'en' ? 'Left town' : '离开',
          '',
          '',
        ]);
      }
    } else if (next === 'places' && placeSuggest) {
      setPrompt(placeSuggest.prompt);
      setLabels([
        placeSuggest.options[0]?.label ?? '',
        placeSuggest.options[1]?.label ?? '',
        placeSuggest.options[2]?.label ?? '',
        placeSuggest.options[3]?.label ?? '',
      ]);
    } else if (next === 'talks' && talkSuggest) {
      setPrompt(talkSuggest.prompt);
      setLabels([
        talkSuggest.options[0]?.label ?? '',
        talkSuggest.options[1]?.label ?? '',
        talkSuggest.options[2]?.label ?? '',
        talkSuggest.options[3]?.label ?? '',
      ]);
    }
    setStep(2);
  };

  const replacePolicy = courseCanAuthorReplace(board?.current ?? null);
  const queuePolicy = courseCanAuthorQueue({
    current: board?.current ?? null,
    queued: board?.queued,
  });

  const buildPlacesTalksSeed = (
    kind: 'places' | 'talks',
  ): CourseSeedBody | null => {
    const suggest = kind === 'places' ? placeSuggest : talkSuggest;
    if (!suggest) return null;
    const trimmedPrompt = prompt.trim() || suggest.prompt;
    const options = labels
      .map((label, i) => {
        const trimmed = label.trim();
        if (trimmed.length < 2) return null;
        const base = suggest.options[i];
        return {
          key: `c${i + 1}`,
          label: trimmed,
          needles: base ? [...base.needles] : [],
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (options.length < 2) return null;
    return { kind, prompt: trimmedPrompt, options };
  };

  const placesTalksEdited = useMemo(() => {
    if (pick !== 'places' && pick !== 'talks') return false;
    const suggest = pick === 'places' ? placeSuggest : talkSuggest;
    const built = buildPlacesTalksSeed(pick);
    if (!built || !suggest || !built.prompt || !built.options) return false;
    if (built.prompt.trim() !== suggest.prompt.trim()) return true;
    return built.options.some(
      (row, i) => (row.label ?? '').trim() !== (suggest.options[i]?.label ?? '').trim(),
    );
  }, [pick, prompt, labels, placeSuggest, talkSuggest]);

  const seed = (body: CourseSeedBody): void => {
    if (body.queue) {
      if (!queuePolicy.ok) {
        if (queuePolicy.reasonKey) {
          message.warning(t(queuePolicy.reasonKey));
        }
        return;
      }
    } else if (board?.current) {
      if (!replacePolicy.ok) {
        if (replacePolicy.reasonKey) {
          message.warning(t(replacePolicy.reasonKey));
        }
        return;
      }
    }
    setBusy(body.kind ?? 'auto');
    const payload: CourseSeedBody = {
      ...body,
      ...(board?.current ? { replace: true } : {}),
    };
    const req = gameId
      ? api.community.seedCourse(gameId, payload)
      : projectId
        ? api.community.seedWorldCourse(projectId, payload)
        : null;
    if (!req) return;
    void req
      .then((next) => {
        setBoard((prev) => mergeCourseBoardPoll(prev, next));
        onSeeded?.(next);
        message.success(
          body.queue
            ? t('product.obs.course.queue.saved')
            : body.cancelQueue
              ? t('product.obs.course.queue.cancelled')
              : t('product.obs.course.seeded'),
        );
        if (!body.queue) onClose();
      })
      .catch((err: unknown) => message.error(courseErrorCopy(t, err)))
      .finally(() => setBusy(null));
  };

  const customBuilt = useMemo(
    () => buildCustomCourseSeed(prompt, labels),
    [prompt, labels],
  );

  const recommendQuery = useMemo(() => {
    if (!open) return null;
    if (step === 0) return { kind: 'auto' as const };
    if (step < 2 || !pick) return null;
    if (pick === 'places' || pick === 'talks') {
      const built = buildPlacesTalksSeed(pick);
      if (built && placesTalksEdited && courseRecommendNeedsPost(built)) {
        return built;
      }
      const kind = courseSeedPickRecommendKind(pick);
      if (kind) return { kind };
      return null;
    }
    const kind = courseSeedPickRecommendKind(pick);
    if (kind) {
      return {
        kind,
        ...(pick === 'resident' && agentKey ? { agentKey } : {}),
      };
    }
    if (pick === 'custom' && customBuilt) {
      return {
        kind: 'custom' as const,
        prompt: customBuilt.prompt,
        options: customBuilt.options,
      };
    }
    return null;
  }, [
    open,
    step,
    pick,
    agentKey,
    customBuilt,
    placesTalksEdited,
    prompt,
    labels,
    placeSuggest,
    talkSuggest,
  ]);

  const showServerPreview = recommendQuery !== null;
  const recommendEmptyHint = courseRecommendEmptyHintKey({
    talkCount: livingTalks.length,
    placeCount: townPlaces.length,
    residentCount: residents.length,
  });
  const { preview: recommendPreview, loading: recommendLoading, error: recommendError, reload: reloadRecommend } =
    useCourseRecommendPreview({
      enabled: showServerPreview,
      gameId,
      projectId,
      ...(recommendQuery ?? { kind: 'auto' }),
    });

  const talkHints = useMemo(
    () =>
      livingTalks.map((row) => ({
        ...(row.who ? { who: row.who } : {}),
        text: row.text,
        kind: row.kind,
      })),
    [livingTalks],
  );
  const reachMeta = useMemo(() => {
    if (!pick || pick === 'auto' || pick === 'village') return null;
    if (pick === 'talks') {
      return validateCourseSeedReachability({
        seedPick: 'talks',
        options: [],
        recentTalks: talkHints,
      });
    }
    if (pick === 'resident') {
      return validateCourseSeedReachability({
        seedPick: 'resident',
        options: [],
        recentTalks: talkHints,
      });
    }
    if (pick === 'places') {
      return validateCourseSeedReachability({
        seedPick: 'places',
        options: [],
        recentTalks: talkHints,
      });
    }
    if (!customBuilt) return null;
    return validateCourseSeedReachability({
      seedPick: 'custom',
      options: customBuilt.options.map((row) => ({
        label: row.label ?? '',
        needles: row.needles,
      })),
      recentTalks: talkHints,
    });
  }, [pick, customBuilt, talkHints]);

  const lastVoid = board?.history[0]?.voidReason ?? board?.current?.voidReason;
  const previewLabels = labels.map((row) => row.trim()).filter((row) => row.length >= 2);
  const residentName =
    residents.find((row) => row.key === agentKey)?.name ?? residents[0]?.name ?? '';

  const canAdvance = (): boolean => {
    if (!pick) return false;
    if (
      showServerPreview &&
      (step === 2 || step === 3) &&
      (recommendLoading || !recommendPreview)
    ) {
      return false;
    }
    if (pick === 'auto' || pick === 'village') return true;
    if (pick === 'resident') return Boolean(agentKey);
    if (pick === 'places') return Boolean(placeSuggest);
    if (pick === 'talks') return Boolean(talkSuggest);
    return Boolean(buildCustomCourseSeed(prompt, labels));
  };

  const winLines = useMemo(() => {
    if (!pick) return [] as string[];
    if (pick === 'resident' && residentName) {
      return [
        courseWinLine({
          locale,
          predicate: { type: 'agent_presence', present: true, name: residentName },
        }),
        courseWinLine({
          locale,
          predicate: { type: 'agent_presence', present: false, name: residentName },
        }),
      ];
    }
    if (pick === 'places' && placeSuggest) {
      return placeSuggest.options.map(
        (row) =>
          `${row.label} · ${courseWinLine({
            locale,
            label: row.label,
            predicate: { type: 'event_needle', needles: row.needles },
          })}`,
      );
    }
    if (pick === 'talks' && talkSuggest) {
      return talkSuggest.options.map(
        (row) =>
          `${row.label} · ${courseWinLine({
            locale,
            label: row.label,
            predicate: { type: 'event_needle', needles: row.needles },
          })}`,
      );
    }
    return previewLabels.map(
      (label) => `${label} · ${courseWinLine({ locale, label })}`,
    );
  }, [
    pick,
    residentName,
    placeSuggest,
    talkSuggest,
    previewLabels,
    locale,
  ]);

  const townMeta = authorSeedTownMeta({
    talkCount: livingTalks.length,
    placeCount: townPlaces.length,
    residentCount: residents.length,
    villagePack,
  });

  const confirm = (opts?: { readonly queue?: boolean }): void => {
    if (pick === 'custom' && reachMeta && !reachMeta.ok) {
      message.warning(t('product.obs.course.reachability.lowBlock'));
      return;
    }
    if (pick === 'auto') {
      seed(opts?.queue ? { queue: true } : {});
      return;
    }
    if (pick === 'village') {
      seed(opts?.queue ? { kind: 'night_market', queue: true } : { kind: 'night_market' });
      return;
    }
    if (pick === 'resident') {
      if (!agentKey) {
        message.warning(t('product.obs.course.err.no_agents'));
        return;
      }
      seed(
        opts?.queue
          ? { kind: 'binary', agentKey, queue: true }
          : { kind: 'binary', agentKey },
      );
      return;
    }
    if (pick === 'places') {
      const built = buildPlacesTalksSeed('places');
      if (!built) {
        message.warning(
          t(
            townPlaces.length === 0
              ? 'product.obs.course.modal.needPlace'
              : 'product.obs.course.modal.needPlaces',
          ),
        );
        return;
      }
      seed(opts?.queue ? { ...built, queue: true } : built);
      return;
    }
    if (pick === 'talks') {
      const built = buildPlacesTalksSeed('talks');
      if (!built) {
        message.warning(t('product.obs.course.modal.needTalks'));
        return;
      }
      seed(opts?.queue ? { ...built, queue: true } : built);
      return;
    }
    const built = buildCustomCourseSeed(prompt, labels);
    if (!built) {
      message.warning(t('product.obs.course.seed.needTwo'));
      return;
    }
    seed(opts?.queue ? { ...built, queue: true } : built);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('product.obs.course.authorTitle')}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div className="og-course-seed-steps" aria-hidden>
          <span className={step === 0 ? 'is-on' : undefined}>
            {`0 ${t('product.obs.course.modal.step0')}`}
          </span>
          <span className={step === 1 ? 'is-on' : undefined}>
            {`1 ${t('product.obs.course.modal.step1')}`}
          </span>
          <span className={step === 2 ? 'is-on' : undefined}>
            {`2 ${t('product.obs.course.modal.step2')}`}
          </span>
          <span className={step === 3 ? 'is-on' : undefined}>
            {`3 ${t('product.obs.course.modal.step3')}`}
          </span>
        </div>
        {seedEmpty ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {t('product.obs.course.seedEmpty')}
          </Text>
        ) : null}
        {board?.current && !replacePolicy.ok && replacePolicy.reasonKey ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {t(replacePolicy.reasonKey)}
          </Text>
        ) : board?.current ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.modal.replace')}
            {` · ${board.current.prompt}`}
          </Text>
        ) : null}
        {lastVoid ? (
          <Text type="warning" style={{ fontSize: 12 }}>
            {t(`product.obs.course.void.${lastVoid}`)}
            {' · '}
            {t('product.obs.course.modal.voidHint')}
          </Text>
        ) : step === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(recommendHintKey)}
          </Text>
        ) : step === 1 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.modal.pickHint')}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.modal.voidHint')}
          </Text>
        )}

        {step === 0 ? (
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatAuthorSeedTownMeta(townMeta, t)}
            </Text>
            <CourseRecommendPreviewCard
              preview={recommendPreview}
              loading={recommendLoading}
              error={recommendError}
              hintKey={recommendEmptyHint}
              onRetry={reloadRecommend}
            />
            <Button
              type="primary"
              block
              loading={busy === 'auto'}
              disabled={
                recommendLoading ||
                !recommendPreview ||
                (Boolean(board?.current) && !replacePolicy.ok)
              }
              onClick={() => seed({})}
            >
              {t('product.obs.course.modal.useRecommend')}
            </Button>
            <Button block onClick={() => setStep(1)}>
              {t('product.obs.course.modal.advanced')}
            </Button>
          </Space>
        ) : null}

        {step === 1 ? (
          <>
            <div className="og-course-seed-picks">
              {picks.map((row) => (
                <Button
                  key={row}
                  type={row === 'auto' ? 'primary' : 'default'}
                  block
                  onClick={() => applyPick(row)}
                >
                  {t(courseSeedPickLabelKey(row))}
                </Button>
              ))}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatAuthorSeedTownMeta(townMeta, t)}
            </Text>
          </>
        ) : null}

        {step === 2 && pick ? (
          <>
            {pick === 'auto' ? (
              <Text>{t('product.obs.course.modal.autoHint')}</Text>
            ) : null}
            {pick === 'village' ? (
              <Text>{t('product.obs.course.modal.villageHint')}</Text>
            ) : null}
            {showServerPreview ? (
              <CourseRecommendPreviewCard
                preview={recommendPreview}
                loading={recommendLoading}
                error={recommendError}
                hintKey={recommendEmptyHint}
                onRetry={reloadRecommend}
              />
            ) : null}
            {pick === 'resident' ? (
              <Select
                style={{ width: '100%' }}
                value={agentKey}
                options={residents.map((row) => ({
                  value: row.key,
                  label: row.name,
                }))}
                onChange={(value) => {
                  const key = String(value);
                  setAgentKey(key);
                  const name = residents.find((row) => row.key === key)?.name;
                  if (!name) return;
                  setPrompt(
                    locale === 'en'
                      ? `Is ${name} still in town tonight`
                      : `${name} 今夜是否还在镇上`,
                  );
                }}
              />
            ) : null}
            {courseSeedPickNeedsForm(pick) ? (
              <>
                <Input
                  maxLength={80}
                  value={prompt}
                  placeholder={t('product.obs.course.seed.prompt')}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                {labels.map((label, i) => (
                  <Input
                    key={i}
                    maxLength={24}
                    value={label}
                    placeholder={t('product.obs.course.seed.option', {
                      n: String(i + 1),
                    })}
                    onChange={(e) =>
                      setLabels((prev) =>
                        prev.map((row, idx) => (idx === i ? e.target.value : row)),
                      )
                    }
                  />
                ))}
              </>
            ) : null}
            {reachMeta && courseSeedPickNeedsForm(pick) ? (
              <Text
                type={
                  reachMeta.reachability === 'high'
                    ? 'success'
                    : reachMeta.reachability === 'medium'
                      ? 'warning'
                      : 'danger'
                }
                style={{ fontSize: 12 }}
              >
                {t(
                  courseReachabilityTagKey(
                    courseReachabilityTagForPick({
                      pick,
                      reachability: reachMeta.reachability,
                    }),
                  ),
                )}
              </Text>
            ) : null}
            {winLines.length > 0 && courseSeedPickNeedsForm(pick) ? (
              <Space orientation="vertical" size={2} style={{ width: '100%' }}>
                <Text style={{ fontSize: 12 }}>{t('product.obs.course.modal.liveWin')}</Text>
                {winLines.map((line) => (
                  <Text key={line} type="secondary" style={{ fontSize: 12 }}>
                    {t('product.obs.course.modal.win')}
                    {line}
                  </Text>
                ))}
              </Space>
            ) : null}
          </>
        ) : null}

        {step === 3 && pick ? (
          <Space orientation="vertical" size={6} style={{ width: '100%' }}>
            {board?.current ? (
              <>
                <Text type="warning" style={{ fontSize: 12 }}>
                  {t('product.obs.course.modal.replaceFrom', {
                    prompt: board.current.prompt,
                  })}
                </Text>
                <Text type="warning" style={{ fontSize: 12 }}>
                  {t('product.obs.course.modal.replaceTo', {
                    prompt: authorReplacePreviewPrompt({
                      pick,
                      prompt,
                      pickLabel: t(courseSeedPickLabelKey(pick)),
                    }),
                  })}
                </Text>
              </>
            ) : null}
            <Text strong>
              {pick === 'custom' || !showServerPreview
                ? prompt.trim() || t(courseSeedPickLabelKey(pick))
                : recommendPreview?.prompt ?? t(courseSeedPickLabelKey(pick))}
            </Text>
            {showServerPreview ? (
              <CourseRecommendPreviewCard
                preview={recommendPreview}
                loading={recommendLoading}
                error={recommendError}
                hintKey={recommendEmptyHint}
                onRetry={reloadRecommend}
              />
            ) : winLines.length > 0 ? (
              winLines.map((line) => (
                <Text key={line} type="secondary" style={{ fontSize: 12 }}>
                  {t('product.obs.course.modal.win')}
                  {line}
                </Text>
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('product.obs.course.modal.confirmHint')}
              </Text>
            )}
            {!showServerPreview && reachMeta ? (
              <Text
                type={
                  reachMeta.reachability === 'high'
                    ? 'success'
                    : reachMeta.reachability === 'medium'
                      ? 'warning'
                      : 'danger'
                }
                style={{ fontSize: 12 }}
              >
                {t(
                  courseReachabilityTagKey(
                    courseReachabilityTagForPick({
                      pick,
                      reachability: reachMeta.reachability,
                    }),
                  ),
                )}
              </Text>
            ) : null}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('product.obs.course.modal.confirmHint')}
            </Text>
          </Space>
        ) : null}

        <Space>
          {step > 0 ? (
            <Button
              onClick={() =>
                setStep((cur) => (cur === 3 ? 2 : cur === 2 ? 1 : 0))
              }
            >
              {t('product.obs.course.modal.back')}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button
              type="primary"
              disabled={!canAdvance()}
              onClick={() => setStep(3)}
            >
              {t('product.obs.course.modal.next')}
            </Button>
          ) : null}
          {step === 3 ? (
            <>
              {queuePolicy.ok ? (
                <Button
                  loading={Boolean(busy)}
                  disabled={!canAdvance()}
                  onClick={() => confirm({ queue: true })}
                >
                  {t('product.obs.course.modal.queueNext')}
                </Button>
              ) : null}
              <Button
                type="primary"
                loading={Boolean(busy)}
                disabled={!canAdvance()}
                onClick={() => confirm()}
              >
                {t('product.obs.course.modal.customGo')}
              </Button>
            </>
          ) : null}
        </Space>
      </Space>
    </Modal>
  );
};
