/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Button,
  Input,
  Drawer,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  ForkOutlined,
  HeartFilled,
  HeartOutlined,
  InfoCircleOutlined,
  ShareAltOutlined,
  TrophyOutlined,
} from '@ant-design/icons';

import {
  api,
  type PublicAuthor,
  type RemixParent,
  type CourseReturnHint,
  type CourseBoard,
  type WorkCommerce,
  type WorldStatusDto,
} from '../../services/api.js';
import {
  featuredJiaxiCard,
  landPaidJiaxi,
  openWalletForPaywall,
  paywallNeedCopy,
  walletPathForPaywall,
} from '../../utils/kaiPaywall.js';
import { AfterPlayPrompt } from '../../components/Community/AfterPlayPrompt.js';
import { InviteLanding } from '../../components/Community/InviteLanding.js';
import { RemixComposer } from '../../components/Community/RemixComposer.js';
import { JiaxiBanner } from '../../components/Community/JiaxiBanner.js';
import { KaiActions } from '../../components/Community/KaiActions.js';
import { useT, translateApiError } from '../../services/i18n.js';
import { useAppStore } from '../../store/index.js';
import { GameComments } from '../../components/Community/GameComments.js';
import { Leaderboard } from '../../components/Community/Leaderboard.js';
import { ReportButton } from '../../components/Community/ReportButton.js';
import { WorldWhispers } from '../../components/Community/WorldWhispers.js';
import { SocietyTownStage } from '../../components/World/SocietyTownStage.js';
import { SocietyTownGuestDesk } from '../../components/World/SocietyTownGuestDesk.js';
import { SocietyTownCourseDesk } from '../../components/World/SocietyTownCourseDesk.js';
import { SocietyTownCourseAuthorModal } from '../../components/World/SocietyTownCourseAuthorModal.js';
import { SocietyTownAuthorOpsBar } from '../../components/World/SocietyTownAuthorOpsBar.js';
import {
  guestCourseChromeKey,
  coursePulseShouldOpenSheet,
} from '../../components/World/courseAuthorFlow.js';
import { useCourseAuthorTownContext } from '../../components/World/useCourseAuthorTownContext.js';
import type { TalkLine } from '../../components/World/societyTownStageModel.js';
import { leaseActive, worldCoursePrefersNightMarket } from '@opengame/platform-shared';
import type { CoursePulse } from '@opengame/platform-shared';
import type { TownLiveChrome } from '../../components/World/societyTownHonesty.js';
import { worldAudienceLine } from '../../components/Community/WorldAudienceHint.js';
import {
  courseTeaser,
  courseTeaserShowsPrompt,
} from '../../components/Community/communityCourseLine.js';
import { featureFlags } from '../../utils/featureFlags.js';
import { isCourseDeepLinkActive, isCourseFollowOpenLand, isCourseWatchPushLand, stripCourseLandingParams } from '../../components/World/courseShare.js';
import { trackCourseEvent } from '../../components/World/courseTelemetry.js';
import { hydrateCourseWatchLanding } from '../../components/World/courseWatchLand.js';
import { previewIframeAllow, previewIframeSandbox } from '../../utils/previewIframeSandbox.js';
import {
  parsePlayScoreMessage,
  postPlaySession,
  withCommunityPlayContext,
  withPlayDeploymentContext,
} from '../../utils/playContext.js';
import {
  courseDeskReturnPath,
  peekPendingCourse,
  rememberLoginReturnTo,
  rememberPendingRemix,
  rememberPendingSocial,
  takePendingRemix,
} from '../../utils/loginIntent.js';
import { downloadPoster } from '../../utils/poster.js';
import { buildShareCard } from '../../utils/shareCard.js';
import { applyWeChatShareCard, share } from '../wechat.js';

const { Text, Paragraph } = Typography;

interface PlayWork {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  category: string;
  playCount?: number;
  remixCount?: number;
  rating?: number;
  ratingCount?: number;
  deployment?: { id: string; previewUrl: string };
  author?: PublicAuthor | null;
  world?: WorldStatusDto | null;
  parent?: RemixParent | null;
  /** Author's remix policy; absent on older rows means the permissive default. */
  license?: string | null;
  remixAllowed?: boolean;
  commerce?: WorkCommerce;
  viewerIsAuthor?: boolean;
  authorProjectId?: string | null;
  takenDownAt?: string | null;
  takedownReason?: string | null;
  course?: CourseReturnHint | null;
}

function withObserveMode(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('mode', 'observe');
    return parsed.toString();
  } catch {
    return url.includes('?') ? `${url}&mode=observe` : `${url}?mode=observe`;
  }
}

type Sheet = 'none' | 'about' | 'remix' | 'board' | 'course';

/**
 * Fullscreen hosted play. This is the page a WeChat share link opens, so it
 * loads straight into the game: no account, no detail page, no scroll before
 * the first frame.
 */
export const MobilePlay: React.FC = () => {
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const { isAuthenticated } = useAppStore();

  const [work, setWork] = useState<PlayWork | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');
  const [following, setFollowing] = useState(false);
  const [remixLine, setRemixLine] = useState('');
  const [remixLoading, setRemixLoading] = useState(false);
  const [scoreTick, setScoreTick] = useState(0);
  const [whisperTick, setWhisperTick] = useState(0);
  const [tipLightUntil, setTipLightUntil] = useState<string | null>(null);
  const [afterPlay, setAfterPlay] = useState(false);
  const [appealMessage, setAppealMessage] = useState('');
  const [appealSending, setAppealSending] = useState(false);
  const [townChrome, setTownChrome] = useState<TownLiveChrome | null>(null);
  const [courseAuthorOpen, setCourseAuthorOpen] = useState(false);
  const [courseBoard, setCourseBoard] = useState<CourseBoard | null>(null);
  const [courseSheetStatus, setCourseSheetStatus] = useState<string | null>(null);
  const [courseTalks, setCourseTalks] = useState<readonly TalkLine[]>([]);
  const [courseLiveNudge, setCourseLiveNudge] = useState(0);
  const [leaseNow, setLeaseNow] = useState(() => Date.now());
  const [resumeClockNonce, setResumeClockNonce] = useState(0);
  const hadCourseStakeRef = useRef(false);
  const courseDeepLinkHandled = useRef(false);
  const [courseShareLanding, setCourseShareLanding] = useState(false);
  const [courseFollowLanding, setCourseFollowLanding] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleCoursePulse = useCallback((pulse: CoursePulse) => {
    if (coursePulseShouldOpenSheet(pulse, hadCourseStakeRef.current)) {
      setSheet('course');
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setLeaseNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isWorld = work?.category === 'world';
  const authorTown = useCourseAuthorTownContext(
    work?.viewerIsAuthor ? work.id : null,
    Boolean(isWorld && work?.viewerIsAuthor && featureFlags.courseMarket),
  );
  const remixAllowed = work?.remixAllowed !== false;

  useEffect(() => {
    if (!slugOrId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    setTownChrome(null);
    setTipLightUntil(null);
    void (async () => {
      try {
        const detail = (await api.community.getGame(slugOrId)) as PlayWork;
        if (cancelled) return;
        setWork(detail);
        setCourseSheetStatus(detail.course?.status ?? null);
        if (detail.takenDownAt) {
          setPlayUrl(null);
          return;
        }

        const res = await api.community.playUrl(slugOrId);
        if (cancelled) return;
        const base = detail.category === 'world' ? withObserveMode(res.url) : res.url;
        const withGame = withCommunityPlayContext(base, detail.id);
        setPlayUrl(
          detail.deployment?.id
            ? withPlayDeploymentContext(withGame, detail.deployment.id)
            : withGame,
        );
      } catch (err) {
        if (!cancelled) setFailed(translateApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slugOrId]);

  useEffect(() => {
    if (!work || !isWorld || courseDeepLinkHandled.current) return;
    if (!isCourseDeepLinkActive(searchParams)) return;
    courseDeepLinkHandled.current = true;
    const followLand = isCourseFollowOpenLand(searchParams);
    const watchLand = isCourseWatchPushLand(searchParams);
    const pending = peekPendingCourse();
    const resumingPending = Boolean(pending && pending.gameId === work.id);
    setCourseShareLanding(!followLand && !watchLand && !resumingPending);
    if (followLand) {
      setCourseFollowLanding(true);
    }
    trackCourseEvent('course_share_land', {
      surface: 'mobile',
      watchPush: watchLand,
      followOpen: followLand,
      shareCoach: !followLand && !watchLand && !resumingPending,
    });
    if (watchLand && work.id) {
      void hydrateCourseWatchLanding(work.id);
    }
    if (searchParams.has('follow') || searchParams.has('watch')) {
      setSearchParams(stripCourseLandingParams(searchParams), { replace: true });
    }
    setSheet('course');
  }, [work, isWorld, searchParams, setSearchParams]);

  // The card is what makes the link worth forwarding — register it as soon as
  // we know the title, not after the bundle finishes loading.
  useEffect(() => {
    if (!work) return;
    void applyWeChatShareCard(
      buildShareCard({
        slug: work.slug,
        title: work.title,
        description: work.description,
        thumbnail: work.thumbnail,
        category: work.category,
        authorName: work.author?.handle ?? work.author?.displayName ?? null,
        remixCount: work.remixCount,
      }),
    );
  }, [work]);

  useEffect(() => {
    if (!work || !isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await api.community.followState(work.id);
        if (!cancelled) setFollowing(state.following);
      } catch {
        /* follow state is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, work]);

  // Watching counts as catching up with the town clock.
  useEffect(() => {
    if (!work || !isWorld || !isAuthenticated) return;
    const simTime = work.world?.simTime;
    if (simTime == null) return;
    void api.community.markSeen(work.id, simTime).catch(() => undefined);
  }, [isAuthenticated, isWorld, work]);

  useEffect(() => {
    if (!work) return;
    void api.community.visit(work.id).catch(() => undefined);
  }, [work]);

  // The bundle cannot hold a session, so the parent submits the score.
  useEffect(() => {
    if (!work) return;
    const onMessage = (event: MessageEvent): void => {
      const parsed = parsePlayScoreMessage(event.data);
      if (!parsed) return;
      if (parsed.gameId && parsed.gameId !== work.id) return;
      if (!isAuthenticated) {
        rememberPendingSocial({
          kind: 'score',
          gameId: work.id,
          score: parsed.score,
          playerName: parsed.playerName ?? 'player',
        });
        return;
      }
      void api.community
        .submitScore(work.id, parsed.score, parsed.playerName ?? 'player')
        .then((res) => {
          message.success(t('community.leaderboard.submitSuccess', { rank: String(res.rank) }));
          setScoreTick((n) => n + 1);
          if (work.category !== 'world') setAfterPlay(true);
        })
        .catch(() => undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isAuthenticated, t, work]);

  const requireLogin = useCallback(
    (then?: () => void): boolean => {
      if (isAuthenticated) {
        then?.();
        return true;
      }
      rememberLoginReturnTo(
        courseDeskReturnPath(`/play/${slugOrId ?? ''}${window.location.search}`),
      );
      navigate('/login');
      return false;
    },
    [isAuthenticated, navigate, slugOrId],
  );

  const onShare = async (): Promise<void> => {
    if (!work) return;
    const card = buildShareCard({
      slug: work.slug,
      title: work.title,
      description: work.description,
      thumbnail: work.thumbnail,
      category: work.category,
      authorName: work.author?.handle ?? work.author?.displayName ?? null,
      remixCount: work.remixCount,
    });
    const result = await share(card);
    if (result === 'wechat') message.info(t('mobile.share.wechatHint'));
    else if (result === 'copied') message.success(t('mobile.share.copied'));
    else if (result === 'failed') message.error(t('mobile.share.failed'));
    try {
      const saved = await downloadPoster({
        slug: work.slug,
        title: work.title,
        description: work.description,
        thumbnail: work.thumbnail,
        authorName: work.author?.handle ?? work.author?.displayName ?? null,
      });
      if (saved) message.success(t('mobile.share.posterSaved'));
    } catch {
      /* poster is optional */
    }
  };

  const onFollow = async (): Promise<void> => {
    if (!work) return;
    if (!requireLogin()) return;
    try {
      if (following) {
        await api.community.unfollow(work.id);
        setFollowing(false);
      } else {
        await api.community.follow(work.id);
        setFollowing(true);
      }
    } catch (err) {
      message.error(translateApiError(err));
    }
  };

  const submitRemix = async (): Promise<void> => {
    if (!work) return;
    const line = remixLine.trim();
    if (!line) return;
    if (!isAuthenticated) {
      rememberPendingRemix({
        slugOrId: work.slug,
        line,
        kind: isWorld ? 'world' : 'game',
        intent: 'remix',
      });
      requireLogin();
      return;
    }
    setRemixLoading(true);
    try {
      const res = await api.remix.forkCommunityGame(work.slug, { line });
      takePendingRemix();
      navigate(`/?project=${res.project.id}&remix=${encodeURIComponent(line)}`);
    } catch (err) {
      message.error(translateApiError(err));
    } finally {
      setRemixLoading(false);
    }
  };

  // Someone who signed in mid-sentence lands back here with it intact.
  useEffect(() => {
    if (!isAuthenticated || !work) return;
    const pending = takePendingRemix();
    if (pending && pending.slugOrId === work.slug) {
      setRemixLine(pending.line);
      setSheet('remix');
    }
  }, [isAuthenticated, work]);

  if (loading) {
    return (
      <div className="og-play-stage" style={{ display: 'grid', placeItems: 'center' }}>
        <Spin tip={t('mobile.play.loading')} />
      </div>
    );
  }

  if (work?.takenDownAt) {
    return (
      <div className="og-play-stage" style={{ padding: 16, overflow: 'auto' }}>
        <Alert
          type="error"
          showIcon
          message={t('community.takedown.title')}
          description={
            <>
              <div>
                {work.takedownReason
                  ? t('community.takedown.reason', { reason: work.takedownReason })
                  : t('community.takedown.hint')}
              </div>
              {work.viewerIsAuthor ? (
                <div style={{ marginTop: 12 }}>
                  <Input.TextArea
                    rows={3}
                    value={appealMessage}
                    onChange={(e) => setAppealMessage(e.target.value)}
                    placeholder={t('account.appeal')}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={appealSending}
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      if (!appealMessage.trim()) return;
                      setAppealSending(true);
                      void api.auth
                        .fileAppeal(work.id, appealMessage.trim())
                        .then(() => {
                          message.success(t('account.appeal.sent'));
                          setAppealMessage('');
                        })
                        .catch(() => message.error(t('account.appeal.failed')))
                        .finally(() => setAppealSending(false));
                    }}
                  >
                    {t('account.appeal')}
                  </Button>
                </div>
              ) : null}
            </>
          }
        />
        <Button
          style={{ marginTop: 16 }}
          onClick={() => navigate('/community')}
        >
          {t('mobile.play.backToCommunity')}
        </Button>
      </div>
    );
  }

  if (failed || !work) {
    return (
      <Result
        status="404"
        title={t('mobile.play.notPlayable')}
        subTitle={failed ?? ''}
        extra={
          <Button type="primary" onClick={() => navigate('/community')}>
            {t('mobile.play.backToCommunity')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="og-play-stage">
      <div style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 5 }}>
        <InviteLanding compact />
      </div>
      {playUrl ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: isWorld ? 'flex' : undefined,
            flexDirection: isWorld ? 'column' : undefined,
            minHeight: 0,
          }}
        >
          {isWorld ? (
            <SocietyTownStage
              role={work.viewerIsAuthor && work.authorProjectId ? 'author' : 'guest'}
              projectId={
                work.viewerIsAuthor && work.authorProjectId
                  ? work.authorProjectId
                  : undefined
              }
              gameId={work.id}
              previewUrl={playUrl}
              hasWorld
              compact
              autoloadMap
              courseHost="page"
              pageCourseBoard={courseBoard}
              courseDeskActive={sheet === 'course'}
              guestDesk={
                work.viewerIsAuthor
                  ? undefined
                  : {
                      commerce: work.commerce,
                      canSpend: isAuthenticated,
                      whisperTick,
                      onRequireLogin: (line) => {
                        if (line && work.slug) {
                          rememberPendingRemix({
                            slugOrId: work.slug,
                            line,
                            kind: 'world',
                            intent: 'whisper',
                          });
                        }
                        requireLogin();
                      },
                      onWhispered: () => setWhisperTick((n) => n + 1),
                      lightUntil: tipLightUntil,
                    }
              }
              onTownLiveChange={setTownChrome}
              onCourseContextChange={({ talks, liveNudge }) => {
                setCourseTalks(talks);
                setCourseLiveNudge(liveNudge);
              }}
              resumeClockNonce={resumeClockNonce}
            />
          ) : (
          <iframe
            ref={iframeRef}
            className="og-play-stage__frame"
            src={playUrl}
            title={work.title}
            onLoad={() =>
              postPlaySession(iframeRef.current, {
                token: useAppStore.getState().token,
                deploymentId: work.deployment?.id,
              })
            }
            sandbox={previewIframeSandbox(playUrl)}
            allow={previewIframeAllow()}
          />
          )}
          <JiaxiBanner />
          {afterPlay && !isWorld ? (
            <AfterPlayPrompt
              onCheer={() => {
                setAfterPlay(false);
                void api.community
                  .tip(work.id, 5)
                  .then(() => message.success(t('kai.tip.ok')))
                  .catch((err) => {
                    const wall = openWalletForPaywall(err, navigate);
                    message.warning(wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'));
                    if (!wall) navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                  });
              }}
              onJiaxi={
                work.commerce?.jiaxiEnabled && work.commerce.cards.length
                  ? () => {
                      setAfterPlay(false);
                      const card = featuredJiaxiCard(
                        work.commerce?.cards,
                        work.commerce?.featuredCardId,
                      );
                      if (!card) return;
                      void api.community
                        .jiaxi(work.id, card.id)
                        .then((res) => {
                          const landed = res.cards?.length ? res.cards : [res.card];
                          message.success(
                            t('kai.jiaxi.ok', { label: landed.map((c) => c.label).join(' · ') }),
                          );
                          void landPaidJiaxi(iframeRef.current, landed, () =>
                            api.community.jiaxiConsume(work.id),
                          );
                        })
                        .catch((err) => {
                          const wall = openWalletForPaywall(err, navigate);
                          message.warning(wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'));
                          if (!wall) navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                        });
                    }
                  : undefined
              }
              onJiaxiRun={
                work.commerce?.jiaxiEnabled &&
                work.commerce.runBundle &&
                work.commerce.runBundle.cardIds.length > 1
                  ? () => {
                      setAfterPlay(false);
                      void api.community
                        .jiaxi(work.id, undefined, 'run')
                        .then((res) => {
                          const landed = res.cards?.length ? res.cards : [res.card];
                          message.success(
                            t('kai.jiaxi.ok', {
                              label: landed.map((c) => c.label).join(' · '),
                            }),
                          );
                          void landPaidJiaxi(iframeRef.current, landed, () =>
                            api.community.jiaxiConsume(work.id),
                          );
                        })
                        .catch((err) => {
                          const wall = openWalletForPaywall(err, navigate);
                          message.warning(wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'));
                          if (!wall) navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                        });
                    }
                  : undefined
              }
              onRemix={
                remixAllowed
                  ? () => {
                      setAfterPlay(false);
                      setSheet('remix');
                    }
                  : undefined
              }
              jiaxiLabel={
                featuredJiaxiCard(work.commerce?.cards, work.commerce?.featuredCardId)?.label
              }
              jiaxiRunLabel={t('kai.jiaxi.run')}
              onDismiss={() => setAfterPlay(false)}
            />
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <Alert type="warning" message={t('mobile.play.notPlayable')} showIcon />
        </div>
      )}

      <div
        className="og-play-stage__overlay"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <button
          type="button"
          className="og-play-stage__chip"
          onClick={() => navigate('/community')}
          aria-label={t('mobile.play.back')}
        >
          <ArrowLeftOutlined />
        </button>
        <div className="og-play-stage__chip" style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {work.title}
          </span>
        </div>
        <button
          type="button"
          className="og-play-stage__chip"
          onClick={() => void onShare()}
          aria-label={t('mobile.play.share')}
        >
          <ShareAltOutlined />
        </button>
        {isWorld && featureFlags.courseMarket && !work.viewerIsAuthor ? (
          <button
            type="button"
            className="og-play-stage__chip og-play-stage__chip--stake"
            onClick={() => setSheet('course')}
          >
            {(() => {
              const teaser = courseTeaser(work.course);
              const chrome = t(
                guestCourseChromeKey(courseSheetStatus ?? work.course?.status),
              );
              return teaser?.open && teaser.actKey
                ? `${t(teaser.actKey)} · ${chrome}`
                : chrome;
            })()}
          </button>
        ) : isWorld && featureFlags.courseMarket && work.viewerIsAuthor ? (
          <button
            type="button"
            className="og-play-stage__chip og-play-stage__chip--stake"
            onClick={() => setSheet('course')}
          >
            {t('product.obs.course.authorTitle')}
          </button>
        ) : null}
        {isWorld ? (
          <button
            type="button"
            className="og-play-stage__chip"
            onClick={() => void onFollow()}
            aria-label={following ? t('community.following') : t('community.follow')}
          >
            {following ? <HeartFilled /> : <HeartOutlined />}
          </button>
        ) : null}
        <button
          type="button"
          className="og-play-stage__chip"
          onClick={() => setSheet('about')}
          aria-label={t('mobile.play.detail')}
        >
          <InfoCircleOutlined />
        </button>
        </div>
        {isWorld && (townChrome || work.world) ? (
          <div
            className="og-play-stage__chip"
            style={{
              width: '100%',
              height: 'auto',
              minHeight: 28,
              padding: '4px 12px',
              fontSize: 12,
              lineHeight: 1.4,
              whiteSpace: 'normal',
            }}
          >
            {[
              (() => {
                const teaser = courseTeaser(work.course);
                if (!teaser) return null;
                return courseTeaserShowsPrompt(teaser)
                  ? t('community.world.coursePrompt', { prompt: teaser.prompt })
                  : teaser.prompt;
              })(),
              townChrome ? t(townChrome.honestyKey) : null,
              worldAudienceLine(t, {
                simTime: work.world?.simTime ?? null,
                simDays: work.world?.simDays ?? null,
                residents: work.world?.residents ?? 0,
                lastAdvancedAt: work.world?.lastAdvancedAt ?? null,
                living: townChrome?.living ?? work.world?.living ?? false,
                speaking: townChrome?.speaking ?? work.world?.speaking,
                clockPaused: townChrome?.clockPaused ?? work.world?.clockPaused,
                watcherCount: townChrome?.watcherCount ?? work.world?.watcherCount,
                lamp: townChrome?.lamp ?? work.world?.lamp ?? null,
              }),
            ]
              .filter((bit, i, all): bit is string => Boolean(bit) && all.indexOf(bit) === i)
              .join(' · ')}
          </div>
        ) : null}
      </div>

      {isWorld ? null : (
      <div className="og-play-dock">
        <Button
          block
          type="primary"
          icon={<ForkOutlined />}
          disabled={!remixAllowed}
          onClick={() => setSheet('remix')}
        >
          {remixAllowed ? t('mobile.play.remix') : t('mobile.play.remixLocked')}
        </Button>
        <Button icon={<TrophyOutlined />} onClick={() => setSheet('board')} />
        <Button
          icon={following ? <HeartFilled /> : <HeartOutlined />}
          onClick={() => void onFollow()}
        />
      </div>
      )}

      <Drawer
        className="og-sheet"
        placement="bottom"
        height="76%"
        open={sheet === 'about'}
        onClose={() => setSheet('none')}
        title={work.title}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space>
            <Avatar src={work.author?.avatarUrl ?? undefined} size="small">
              {(work.author?.displayName ?? '?').slice(0, 1)}
            </Avatar>
            <Text
              style={{ cursor: work.author?.handle ? 'pointer' : 'default' }}
              onClick={() => work.author?.handle && navigate(`/u/${work.author.handle}`)}
            >
              {work.author?.displayName ?? t('mobile.play.unknownAuthor')}
            </Text>
            {isWorld && work.world?.simDays != null && (
              <Tag color="cyan">
                {t('mobile.card.simDays', { days: String(work.world.simDays) })}
              </Tag>
            )}
            <ReportButton gameId={work.id} variant="text" />
          </Space>
          {work.parent && (
            <Text
              type="secondary"
              className={work.license === 'remix-credit' ? 'og-remix-credit' : undefined}
              style={{ fontSize: 12 }}
            >
              {t(
                work.license === 'remix-credit'
                  ? 'community.lineage.mustCredit'
                  : 'mobile.play.remixedFrom',
              )}{' '}
              <a onClick={() => navigate(`/play/${work.parent?.slug}`)}>{work.parent.title}</a>
            </Text>
          )}
          {work.description && <Paragraph type="secondary">{work.description}</Paragraph>}
          {!remixAllowed && (
            <Alert type="info" showIcon message={t('mobile.play.remixLockedHint')} />
          )}
          {work.commerce && !isWorld ? (
            <KaiActions
              gameId={work.id}
              isWorld={Boolean(isWorld)}
              commerce={work.commerce}
              canSpend={isAuthenticated}
              iframeRef={iframeRef}
              onRequireLogin={requireLogin}
            />
          ) : null}
          {isWorld && work.viewerIsAuthor ? (
            <WorldWhispers
              gameId={work.id}
              canWhisper={isAuthenticated}
              paidCost={0}
              xiangyiEnabled={false}
              refreshToken={whisperTick}
              courseSnapshot={courseBoard ? courseBoard.current : undefined}
              onRequireLogin={(line) => {
                rememberPendingRemix({
                  slugOrId: work.slug,
                  line,
                  kind: 'world',
                  intent: 'whisper',
                });
                requireLogin();
              }}
            />
          ) : !isWorld ? (
            <GameComments
              gameId={work.id}
              rating={work.rating ?? 0}
              ratingCount={work.ratingCount ?? 0}
            />
          ) : null}
        </Space>
      </Drawer>

      <Drawer
        className="og-sheet"
        placement="bottom"
        height="76%"
        open={sheet === 'course'}
        onClose={() => setSheet('none')}
        title={
          work.viewerIsAuthor
            ? t('product.obs.course.authorTitle')
            : t('mobile.play.course')
        }
      >
        {work.viewerIsAuthor ? (
          <>
            <SocietyTownAuthorOpsBar
              gameId={work.id}
              projectId={work.authorProjectId}
              board={courseBoard}
              paused={townChrome?.clockPaused ?? work.world?.clockPaused ?? false}
              funded={leaseActive(tipLightUntil ?? null, leaseNow)}
              nowMs={leaseNow}
              recommendHintKey={authorTown.recommendHintKey}
              onOpenAdvanced={() => setCourseAuthorOpen(true)}
              onOpenFund={() => setSheet('board')}
              onResumeClock={() => setResumeClockNonce((n) => n + 1)}
              onSeeded={setCourseBoard}
            />
            <SocietyTownCourseDesk
              gameId={work.id}
              canStake={false}
              isAuthor
              actBarCompact
              liveNudge={courseLiveNudge}
              pollActive={sheet === 'course'}
              shareTitle={work.title}
              shareSlugOrId={work.slug || work.id}
              onOpenAuthorSeed={() => setCourseAuthorOpen(true)}
              onRequireLogin={requireLogin}
              onBoard={setCourseBoard}
            />
            <SocietyTownCourseAuthorModal
              open={courseAuthorOpen}
              onClose={() => setCourseAuthorOpen(false)}
              gameId={work.id}
              projectId={work.authorProjectId}
              talks={courseTalks}
              places={authorTown.places}
              worldSpec={authorTown.worldSpecPreview}
              seedEmpty={!courseBoard?.current}
              locale={locale === 'en' ? 'en' : 'zh-CN'}
              onSeeded={setCourseBoard}
            />
          </>
        ) : (
          <SocietyTownGuestDesk
            slot="full"
            gameId={work.id}
            commerce={work.commerce}
            canSpend={isAuthenticated}
            whisperTick={whisperTick}
            liveNudge={courseLiveNudge}
            pollActive={sheet === 'course'}
            talks={courseTalks}
            actBarCompact
            shareTitle={work.title}
            shareSlugOrId={work.slug || work.id}
            courseShareLanding={courseShareLanding}
            courseFollowLanding={courseFollowLanding}
            onShareLandingDone={() => setCourseShareLanding(false)}
            onOpenCourse={() => setSheet('course')}
            onPulse={handleCoursePulse}
            onCourseStatus={setCourseSheetStatus}
            onCourseBoard={(board) => {
              setCourseBoard(board);
              if ((board?.current?.myPoints ?? 0) > 0) {
                hadCourseStakeRef.current = true;
              }
            }}
            onRequireLogin={(line) => {
              if (line && work.slug) {
                rememberPendingRemix({
                  slugOrId: work.slug,
                  line,
                  kind: 'world',
                  intent: 'whisper',
                });
              }
              requireLogin();
            }}
            onWhispered={() => setWhisperTick((n) => n + 1)}
            permitHint=""
            talkBudgetHint={t('product.obs.guestWatchHint')}
            onTownMoved={(info) => {
              if (info?.lightUntil) setTipLightUntil(info.lightUntil);
            }}
          />
        )}
      </Drawer>

      <Drawer
        className="og-sheet"
        placement="bottom"
        height="60%"
        open={sheet === 'board'}
        onClose={() => setSheet('none')}
        title={t('mobile.play.leaderboard')}
      >
        <Leaderboard gameId={work.id} gameTitle={work.title} refreshToken={scoreTick} />
      </Drawer>

      <Drawer
        className="og-sheet"
        placement="bottom"
        height="auto"
        open={sheet === 'remix'}
        onClose={() => setSheet('none')}
        title={t('mobile.play.remixTitle')}
      >
        <RemixComposer
          lane={isWorld ? 'world' : 'game'}
          chips={
            isWorld
              ? [
                  t('community.remix.chip.world.1'),
                  t('community.remix.chip.world.2'),
                  t('community.remix.chip.world.3'),
                ]
              : [
                  t('community.remix.chip.game.1'),
                  t('community.remix.chip.game.2'),
                  t('community.remix.chip.game.3'),
                ]
          }
          value={remixLine}
          onChange={setRemixLine}
          onSubmit={() => void submitRemix()}
          loading={remixLoading}
          locked={!remixAllowed}
          lockedMessage={t('mobile.play.remixLockedHint')}
          hint={t('mobile.play.remixHint')}
          placeholder={
            isWorld ? t('mobile.play.remixPlaceholderWorld') : t('mobile.play.remixPlaceholder')
          }
          submitLabel={t('mobile.play.remixSubmit')}
          requireLine
        />
      </Drawer>
    </div>
  );
};

export default MobilePlay;
