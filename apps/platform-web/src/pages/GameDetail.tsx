/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The work page carries both halves of the loop: a visitor can play (or watch a
 * town) without an account, and one line is enough to fork it into their own
 * studio. Worlds are framed as a stage — day count and residents, not a score.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Layout,
  Typography,
  Button,
  Space,
  Breadcrumb,
  Spin,
  Tag,
  message,
  Row,
  Col,
  Card,
  Alert,
  Input,
  Avatar,
  Select,
  Switch,
  Tooltip,
  Collapse,
} from 'antd';
import {
  ArrowLeftOutlined,
  ShareAltOutlined,
  StarOutlined,
  StarFilled,
  PlayCircleOutlined,
  ForkOutlined,
  HomeOutlined,
  MoonOutlined,
  SunOutlined,
  HeartOutlined,
  HeartFilled,
  TeamOutlined,
  ClockCircleOutlined,
  FlagOutlined,
} from '@ant-design/icons';
import {
  api,
  type CommunityLicense,
  type CourseBoard,
  type PublicAuthor,
  type RemixParent,
  type WorkCommerce,
  type WorldHeadline,
  type CourseReturnHint,
  type WorldStatusDto,
} from '../services/api';
import { featureFlags } from '../utils/featureFlags';
import { GameComments } from '../components/Community/GameComments';
import { AfterPlayPrompt } from '../components/Community/AfterPlayPrompt';
import { JiaxiBanner } from '../components/Community/JiaxiBanner';
import { KaiActions } from '../components/Community/KaiActions';
import { KaiMarketBar } from '../components/Community/KaiMarketBar';
import { InviteLanding } from '../components/Community/InviteLanding';
import { Leaderboard } from '../components/Community/Leaderboard';
import { ReportButton } from '../components/Community/ReportButton';
import { RemixComposer } from '../components/Community/RemixComposer';
import { WorldWhispers } from '../components/Community/WorldWhispers';
import { WorldAudienceHint } from '../components/Community/WorldAudienceHint';
import { WorldPresenceTag } from '../components/Community/WorldPresenceTag';
import {
  courseTeaser,
  courseTeaserBadgeKey,
  courseTeaserTagColor,
} from '../components/Community/communityCourseLine';
import { communityWorldOpenHref } from '../components/Community/communityWorldOpen';
import { SocietyTownCourseDesk } from '../components/World/SocietyTownCourseDesk';
import { SocietyTownCourseAuthorModal } from '../components/World/SocietyTownCourseAuthorModal';
import { SocietyTownAuthorOpsBar } from '../components/World/SocietyTownAuthorOpsBar';
import { useCourseAuthorTownContext } from '../components/World/useCourseAuthorTownContext';
import { leaseActive } from '@opengame/platform-shared';
import type { TalkLine } from '../components/World/societyTownStageModel';
import { SocietyTownGuestDesk } from '../components/World/SocietyTownGuestDesk';
import { SocietyTownStage } from '../components/World/SocietyTownStage';
import { scrollToCourseDesk } from '../components/World/societyTownTimeDesk';
import { isCourseDeepLinkActive, isCourseFollowOpenLand, isCourseWatchPushLand, stripCourseLandingParams } from '../components/World/courseShare';
import { trackCourseEvent } from '../components/World/courseTelemetry';
import { hydrateCourseWatchLanding } from '../components/World/courseWatchLand';
import type { TownLiveChrome } from '../components/World/societyTownHonesty';
import { useTheme } from '../hooks/useTheme';
import { useAppStore } from '../store';
import { useT, translateApiError } from '../services/i18n';
import { previewIframeAllow, previewIframeSandbox } from '../utils/previewIframeSandbox';
import {
  courseDeskReturnPath,
  peekPendingCourse,
  peekPendingRemix,
  peekPendingSocial,
  rememberLoginReturnTo,
  rememberPendingRemix,
  rememberPendingSocial,
  takePendingRemix,
  takePendingSocial,
} from '../utils/loginIntent';
import {
  featuredJiaxiCard,
  landPaidJiaxi,
  openWalletForPaywall,
  paywallNeedCopy,
  walletPathForPaywall,
} from '../utils/kaiPaywall';
import { parsePlayScoreMessage, withCommunityPlayContext } from '../utils/playContext';
import { applyWeChatShareCard } from '../mobile/wechat';
import { buildShareCard } from '../utils/shareCard';
import { sharePublishedWork } from '../utils/shareWork';

const { Header, Content } = Layout;
const { Text, Paragraph } = Typography;

interface GameDetailData {
  id: string;
  title: string;
  slug: string;
  description: string;
  thumbnail: string;
  category: string;
  isPublic: boolean;
  isFeatured?: boolean;
  playCount: number;
  remixCount?: number;
  publishedAt: string;
  deployment: {
    id: string;
    previewUrl: string;
  };
  rating: number;
  ratingCount: number;
  tags: { name: string; slug: string; color?: string }[];
  author?: PublicAuthor | null;
  world?: WorldStatusDto | null;
  parent?: RemixParent | null;
  headline?: WorldHeadline | null;
  course?: CourseReturnHint | null;
  license?: CommunityLicense;
  /** Server-resolved so the UI never has to interpret the licence itself. */
  remixAllowed?: boolean;
  watermark?: boolean;
  /** Whether the reader may change the licence and watermark on this work. */
  viewerIsAuthor?: boolean;
  /** Author-only: studio project for the full observatory. */
  authorProjectId?: string | null;
  isOfficial?: boolean;
  challengeId?: string | null;
  commerce?: WorkCommerce;
  tonight?: {
    tip: number;
    jiaxi: number;
    xiangyi: number;
    event: number;
    townTime?: number;
    worldLight?: number;
    jiaxiByCard?: Record<string, number>;
  } | null;
  /** Set only for the author: everyone else gets a 404 for a hidden work. */
  takenDownAt?: string | null;
  takedownReason?: string | null;
}

/** Observed worlds open on the town stage, not in play mode. */
function withObserveMode(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('mode', 'observe');
    return parsed.toString();
  } catch {
    return url.includes('?')
      ? `${url.replace(/([?&])mode=[^&]*/, '$1mode=observe')}`
      : `${url}?mode=observe`;
  }
}

export const GameDetail: React.FC = () => {
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { isAuthenticated } = useAppStore();
  const { t, locale } = useT();
  const [game, setGame] = useState<GameDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [remixLoading, setRemixLoading] = useState(false);
  const [remixLine, setRemixLine] = useState('');
  const [whisperDraft, setWhisperDraft] = useState('');
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [isCurator, setIsCurator] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [license, setLicense] = useState<CommunityLicense>('remix-ok');
  const [watermark, setWatermark] = useState(true);
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [scoreTick, setScoreTick] = useState(0);
  const [whisperTick, setWhisperTick] = useState(0);
  const [tipLightUntil, setTipLightUntil] = useState<string | null>(null);
  const [appealMessage, setAppealMessage] = useState('');
  const [appealSending, setAppealSending] = useState(false);
  const [courseCanon, setCourseCanon] = useState<string | null>(null);
  const [courseBoard, setCourseBoard] = useState<CourseBoard | null>(null);
  const [courseAuthorOpen, setCourseAuthorOpen] = useState(false);
  const [courseTalks, setCourseTalks] = useState<readonly TalkLine[]>([]);
  const [courseLiveNudge, setCourseLiveNudge] = useState(0);
  const [leaseNow, setLeaseNow] = useState(() => Date.now());
  const [resumeClockNonce, setResumeClockNonce] = useState(0);
  const [challenge, setChallenge] = useState<{
    id: string;
    title: string;
    prompt: string;
    entryPoints?: number;
    poolPoints?: number;
  } | null>(null);
  const [entering, setEntering] = useState(false);
  const [afterPlay, setAfterPlay] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const remixRef = useRef<HTMLDivElement>(null);
  const courseDeepLinkHandled = useRef(false);
  const [courseShareLanding, setCourseShareLanding] = useState(false);
  const [courseFollowLanding, setCourseFollowLanding] = useState(false);

  const isWorld = game?.category === 'world';
  const authorTown = useCourseAuthorTownContext(
    game?.viewerIsAuthor ? game.id : null,
    Boolean(isWorld && game?.viewerIsAuthor && featureFlags.courseMarket),
  );

  useEffect(() => {
    if (!isWorld || !game || courseDeepLinkHandled.current) return;
    if (!isCourseDeepLinkActive(searchParams)) return;
    courseDeepLinkHandled.current = true;
    const followLand = isCourseFollowOpenLand(searchParams);
    const watchLand = isCourseWatchPushLand(searchParams);
    const pending = peekPendingCourse();
    const resumingPending = Boolean(pending && pending.gameId === game.id);
    // Share coach is for pure ?course=1 shares — not follow/watch one-shots or login resume.
    setCourseShareLanding(!followLand && !watchLand && !resumingPending);
    if (followLand) {
      setCourseFollowLanding(true);
    }
    trackCourseEvent('course_share_land', {
      surface: 'desktop',
      watchPush: watchLand,
      followOpen: followLand,
      shareCoach: !followLand && !watchLand && !resumingPending,
    });
    if (watchLand && game.id) {
      void hydrateCourseWatchLanding(game.id);
    }
    if (searchParams.has('follow') || searchParams.has('watch')) {
      setSearchParams(stripCourseLandingParams(searchParams), { replace: true });
    }
    window.setTimeout(() => scrollToCourseDesk(), 400);
  }, [isWorld, game, searchParams, setSearchParams]);

  useEffect(() => {
    const timer = window.setInterval(() => setLeaseNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const shellBg = 'var(--bg-layout)';
  const headerBg = 'var(--bg-header)';
  const headerBorder = 'var(--border-color)';
  const mutedColor = 'var(--text-secondary)';
  const cardBg = 'var(--bg-card)';
  const cardBorder = 'var(--border-color)';
  const titleColor = 'var(--text-primary)';
  const bodyColor = 'var(--text-secondary)';
  const strongColor = 'var(--text-primary)';
  const dividerColor = 'var(--border-color)';
  const previewGrad = isWorld
    ? 'radial-gradient(90% 70% at 20% 0%, color-mix(in srgb, var(--color-teal) 28%, transparent), transparent 55%), linear-gradient(160deg, #1a2a28, var(--color-night))'
    : 'radial-gradient(90% 70% at 20% 0%, rgba(224, 178, 90, 0.28), transparent 55%), linear-gradient(160deg, #2a2118, var(--color-night))';
  // Older rows predate licences; absent means the permissive default.
  const remixAllowed = game?.remixAllowed !== false;

  useEffect(() => {
    const loadGame = async () => {
      if (!slugOrId) return;

      setLoading(true);
      try {
        const data = await api.community.getGame(slugOrId);
        setGame(data);
        setTipLightUntil(null);
        if (data.category === 'world' && featureFlags.courseMarket) {
          const board = await api.community.course(data.id, { ensure: true }).catch(() => null);
          setCourseBoard(board);
          setCourseCanon(board?.history[0]?.canon ?? board?.current?.canon ?? null);
        } else {
          setCourseCanon(null);
        }
        setFeatured(Boolean(data.isFeatured));
        setLicense((data.license as CommunityLicense) ?? 'remix-ok');
        setWatermark(data.watermark !== false);

        // Studio preview-url is org-member only. A signed-in visitor used to
        // hit 403 on every load before falling back to the public play URL.
        let url: string | null = null;
        if (isAuthenticated && data.viewerIsAuthor && data.deployment?.id) {
          url = await api.deployments
            .getPreviewUrl(data.deployment.id)
            .then((res) => res.url)
            .catch(() => null);
        }
        if (!url) {
          url = await api.community
            .playUrl(data.slug || data.id)
            .then((res) => res.url)
            .catch(() => null);
        }
        setPreviewUrl(url);

        if (isAuthenticated) {
          void api.community.visit(data.id).catch(() => undefined);
          void api.community
            .followState(data.id)
            .then((res) => setFollowing(res.following))
            .catch(() => undefined);
          void api.me
            .capabilities()
            .then((res) => setIsCurator(res.curator))
            .catch(() => undefined);
        }
      } catch (error) {
        console.error('Failed to load game:', error);
        message.error(t('community.gameDetail.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    void loadGame();
  }, [slugOrId, isAuthenticated]);

  useEffect(() => {
    void api.community
      .currentChallenge()
      .then((res) => setChallenge(res.challenge))
      .catch(() => undefined);
  }, []);

  /** Coming back from /login should land on the sentence the visitor typed. */
  useEffect(() => {
    const pending = peekPendingRemix();
    if (!pending || pending.slugOrId !== slugOrId) return;
    if (pending.intent === 'whisper') {
      setWhisperDraft(pending.line);
      takePendingRemix();
      return;
    }
    if (!remixLine) setRemixLine(pending.line);
  }, [slugOrId]);

  /** Watching in the iframe counts as catching up — not only a new-window open. */
  useEffect(() => {
    if (!isWorld || !following || !game?.world?.simTime || !previewUrl) return;
    void api.community.markSeen(game.id, game.world.simTime).catch(() => undefined);
  }, [isWorld, following, game?.id, game?.world?.simTime, previewUrl]);

  const submitPlayScore = async (score: number, playerName: string): Promise<void> => {
    if (!game) return;
    if (!isAuthenticated) {
      message.info(t('community.leaderboard.needLogin'));
      rememberPendingSocial({
        kind: 'score',
        gameId: game.id,
        score,
        playerName,
      });
      rememberLoginReturnTo(window.location.pathname);
      navigate('/login');
      return;
    }
    try {
      const result = await api.community.submitScore(game.id, score, playerName || 'Anonymous');
      message.success(t('community.leaderboard.submitSuccess', { rank: result.rank }));
      setScoreTick((n) => n + 1);
      if (!isWorld) setAfterPlay(true);
    } catch {
      message.error(t('community.leaderboard.submitFail'));
    }
  };

  /** A framed game posts its score here; the iframe cannot carry the JWT. */
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return;
      const parsed = parsePlayScoreMessage(ev.data);
      if (!parsed || !game) return;
      if (parsed.gameId && parsed.gameId !== game.id) return;
      void submitPlayScore(parsed.score, parsed.playerName ?? 'Anonymous');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [game?.id, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !game) return;
    const pending = peekPendingSocial();
    if (!pending || pending.kind !== 'score' || pending.gameId !== game.id) return;
    takePendingSocial();
    void submitPlayScore(pending.score, pending.playerName);
  }, [isAuthenticated, game?.id]);

  useEffect(() => {
    if (!game) return;
    void applyWeChatShareCard(
      buildShareCard({
        slug: game.slug,
        title: game.title,
        description: game.description,
        thumbnail: game.thumbnail,
        category: game.category,
        authorName: game.author?.handle ?? game.author?.displayName ?? null,
        remixCount: game.remixCount,
        canon: courseCanon,
      }),
    );
  }, [
    game?.slug,
    game?.title,
    game?.description,
    game?.thumbnail,
    game?.category,
    game?.remixCount,
    game?.author?.handle,
    game?.author?.displayName,
    courseCanon,
  ]);

  const handleShare = () => {
    if (!game) return;
    void sharePublishedWork({
      slug: game.slug,
      title: game.title,
      description: game.description,
      thumbnail: game.thumbnail,
      category: game.category,
      authorName: game.author?.handle ?? game.author?.displayName ?? null,
      remixCount: game.remixCount,
      canon: courseCanon,
    }).then(({ result, posterSaved }) => {
      if (result === 'wechat') message.info(t('mobile.share.wechatHint'));
      else if (result === 'copied') message.success(t('community.gameDetail.shareCopied'));
      else if (result === 'failed') message.error(t('mobile.share.failed'));
      if (posterSaved) message.success(t('mobile.share.posterSaved'));
    });
  };

  const stayOnStage = (): void => {
    document.getElementById('og-work-stage')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const onTownLiveChange = useCallback((live: TownLiveChrome) => {
    setGame((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        world: {
          simTime: prev.world?.simTime ?? null,
          simDays: prev.world?.simDays ?? null,
          residents: prev.world?.residents ?? 0,
          lastAdvancedAt: prev.world?.lastAdvancedAt ?? null,
          ...prev.world,
          living: live.living,
          speaking: live.speaking,
          clockPaused: live.clockPaused,
          watcherCount: live.watcherCount,
          lamp: live.lamp ?? prev.world?.lamp ?? null,
        },
      };
    });
  }, []);

  const handlePlay = () => {
    if (!game) return;
    if (isWorld) {
      if (following && game.world?.simTime != null) {
        void api.community.markSeen(game.id, game.world.simTime).catch(() => undefined);
      }
      if (game.viewerIsAuthor) {
        const dest = communityWorldOpenHref({
          viewerIsAuthor: true,
          authorProjectId: game.authorProjectId,
          slug: game.slug,
          gameId: game.id,
        });
        if (dest) window.open(dest.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (previewUrl) {
        stayOnStage();
        return;
      }
      const dest = communityWorldOpenHref({
        viewerIsAuthor: false,
        slug: game.slug,
        gameId: game.id,
      });
      if (dest) window.open(dest.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!previewUrl) return;
    window.open(
      withCommunityPlayContext(previewUrl, game.id),
      '_blank',
    );
  };

  const requireLogin = (line?: string, intent: 'remix' | 'whisper' = 'remix') => {
    if (line && slugOrId) {
      rememberPendingRemix({
        slugOrId,
        line,
        kind: isWorld ? 'world' : 'game',
        intent,
      });
    }
    rememberLoginReturnTo(
      isWorld
        ? courseDeskReturnPath(
            `${window.location.pathname}${window.location.search}`,
          )
        : window.location.pathname,
    );
    navigate('/login');
  };

  const handleRemix = async (line?: string) => {
    if (!game) return;
    const sentence = (line ?? remixLine).trim();
    if (!isAuthenticated) {
      message.info(t('community.remix.needLogin'));
      requireLogin(sentence);
      return;
    }
    setRemixLoading(true);
    try {
      const result = await api.remix.forkCommunityGame(game.slug || game.id, {
        ...(sentence ? { line: sentence } : {}),
      });
      takePendingRemix();
      message.success(
        sentence
          ? t('community.remix.ready')
          : t('community.gameDetail.remixSuccess', { name: result.project.name }),
      );
      const params = new URLSearchParams({ project: result.project.id });
      if (result.kind === 'world') params.set('mode', 'world');
      if (sentence) params.set('remix', sentence);
      navigate(`/?${params.toString()}`);
    } catch (err) {
      message.error(translateApiError(err));
    } finally {
      setRemixLoading(false);
    }
  };

  const toggleFeatured = async () => {
    if (!game) return;
    setFeatureLoading(true);
    try {
      const res = await api.community.setFeatured(game.id, !featured);
      setFeatured(res.isFeatured);
      message.success(
        res.isFeatured ? t('community.curate.done') : t('community.curate.undone'),
      );
    } catch (err) {
      message.error(translateApiError(err));
    } finally {
      setFeatureLoading(false);
    }
  };

  /**
   * Licence and watermark are the two things an author can still change after
   * publishing, so they are saved one at a time rather than behind a form: the
   * result is visible on the next play either way.
   */
  const saveLicense = async (payload: {
    license?: CommunityLicense;
    watermark?: boolean;
  }): Promise<void> => {
    if (!game) return;
    setLicenseSaving(true);
    try {
      const res = await api.community.setLicense(game.id, payload);
      setLicense(res.license);
      setWatermark(res.watermark);
      setGame({ ...game, license: res.license, remixAllowed: res.license !== 'no-remix' });
      message.success(t('community.authorSettings.saved'));
    } catch (err) {
      message.error(translateApiError(err));
    } finally {
      setLicenseSaving(false);
    }
  };

  const toggleFollow = async () => {
    if (!game) return;
    if (!isAuthenticated) {
      message.info(t('community.follow.needLogin'));
      requireLogin();
      return;
    }
    setFollowLoading(true);
    try {
      if (following) {
        await api.community.unfollow(game.id);
        setFollowing(false);
      } else {
        await api.community.follow(game.id);
        setFollowing(true);
      }
    } catch {
      message.error(t('community.follow.failed'));
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout style={{ height: '100%', background: shellBg }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            minHeight: 200,
          }}
        >
          <Spin size="large" />
        </div>
      </Layout>
    );
  }

  if (!game) {
    return (
      <Layout style={{ height: '100%', background: shellBg }}>
        <Content style={{ padding: 24 }}>
          <Text style={{ color: bodyColor }}>{t('community.gameDetail.notFound')}</Text>
        </Content>
      </Layout>
    );
  }

  const categoryKey = game.category || 'other';
  const categoryRaw = t(`community.category.${categoryKey}`);
  const categoryLabel = categoryRaw.startsWith('community.category')
    ? game.category || 'other'
    : categoryRaw;

  const remixChips = isWorld
    ? [
        t('community.remix.chip.world.1'),
        t('community.remix.chip.world.2'),
        t('community.remix.chip.world.3'),
      ]
    : [
        t('community.remix.chip.game.1'),
        t('community.remix.chip.game.2'),
        t('community.remix.chip.game.3'),
      ];

  const framedUrl = previewUrl
    ? withCommunityPlayContext(isWorld ? withObserveMode(previewUrl) : previewUrl, game.id)
    : null;

  return (
    <Layout
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: shellBg,
      }}
    >
      <Header
        style={{
          flexShrink: 0,
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          lineHeight: '56px',
          padding: '0 20px',
        }}
      >
        <Space wrap>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/community')}
            style={{ color: mutedColor }}
          >
            {t('community.gameDetail.back')}
          </Button>
          <Breadcrumb
            items={[
              {
                title: (
                  <Link to="/community" style={{ color: mutedColor }}>
                    {t('community.gameDetail.home')}
                  </Link>
                ),
              },
              { title: <span style={{ color: titleColor }}>{game.title}</span> },
            ]}
          />
        </Space>

        <Space size={4}>
          <Tooltip title={t('nav.goCreate.tip')}>
            <Button
              type="text"
              icon={<HomeOutlined />}
              onClick={() => navigate('/')}
              style={{ color: mutedColor }}
            />
          </Tooltip>
          <Tooltip title={isDark ? t('common.switchToLight') : t('common.switchToDark')}>
            <Button
              type="text"
              icon={isDark ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{ color: mutedColor }}
            />
          </Tooltip>
          <Button
            type="text"
            icon={following ? <HeartFilled style={{ color: '#f472b6' }} /> : <HeartOutlined />}
            loading={followLoading}
            onClick={() => void toggleFollow()}
            style={{ color: mutedColor }}
          >
            {following ? t('community.following') : t('community.follow')}
          </Button>
          <Button
            type="text"
            icon={<ShareAltOutlined />}
            onClick={handleShare}
            style={{ color: mutedColor }}
          >
            {t('community.gameDetail.share')}
          </Button>
          <ReportButton gameId={game.id} variant="text" size="middle" />
          {isCurator ? (
            <>
              <Tooltip title={t('community.curate.tip')}>
                <Button
                  type="text"
                  icon={featured ? <StarFilled style={{ color: '#fbbf24' }} /> : <StarOutlined />}
                  loading={featureLoading}
                  onClick={() => void toggleFeatured()}
                  style={{ color: mutedColor }}
                >
                  {featured ? t('community.curate.featured') : t('community.curate.feature')}
                </Button>
              </Tooltip>
              <Button
                type="text"
                onClick={() => {
                  if (!game) return;
                  void api.community
                    .setOfficial(game.id, !game.isOfficial)
                    .then((res) => {
                      setGame({ ...game, isOfficial: res.isOfficial });
                      message.success(
                        res.isOfficial ? t('community.official.on') : t('community.official.off'),
                      );
                    })
                    .catch((err) => message.error(translateApiError(err)));
                }}
                style={{ color: mutedColor }}
              >
                {game.isOfficial ? t('community.official') : t('community.official.set')}
              </Button>
              <Button
                type="text"
                icon={<FlagOutlined />}
                onClick={() => navigate('/admin/reports')}
                style={{ color: mutedColor }}
              >
                {t('admin.reports.title')}
              </Button>
            </>
          ) : null}
        </Space>
      </Header>

      <Content
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 24,
        }}
      >
        {game.takenDownAt ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 24 }}
            message={t('community.takedown.title')}
            description={
              <>
                <div>
                  {game.takedownReason
                    ? t('community.takedown.reason', { reason: game.takedownReason })
                    : t('community.takedown.hint')}
                </div>
                {game.viewerIsAuthor ? (
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
                          .fileAppeal(game.id, appealMessage.trim())
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
        ) : null}

        <Row gutter={[24, 24]}>
          <Col xs={24} lg={16}>
            <div
              id="og-work-stage"
              className={`og-work-stage ${isWorld ? 'is-world' : ''}`}
              style={{ marginBottom: 24 }}
            >
              <div
                className={`og-work-stage__surface ${isWorld ? 'og-work-stage__surface--town' : ''}`}
                style={{ background: previewGrad }}
              >
                {isWorld && previewUrl ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', minHeight: 0, height: '100%' }}>
                    <SocietyTownStage
                      role={game.viewerIsAuthor && game.authorProjectId ? 'author' : 'guest'}
                      projectId={
                        game.viewerIsAuthor && game.authorProjectId
                          ? game.authorProjectId
                          : undefined
                      }
                      gameId={game.id}
                      previewUrl={previewUrl}
                      hasWorld
                      autoloadMap
                      courseHost="page"
                      pageCourseBoard={courseBoard}
                      courseDeskActive
                      guestDesk={{
                        commerce: game.commerce,
                        canSpend: isAuthenticated,
                        whisperDraft: game.viewerIsAuthor ? undefined : whisperDraft,
                        whisperTick: game.viewerIsAuthor ? undefined : whisperTick,
                        onRequireLogin: (line) =>
                          requireLogin(line, line ? 'whisper' : 'remix'),
                        onWhispered: game.viewerIsAuthor
                          ? undefined
                          : () => setWhisperTick((n) => n + 1),
                        lightUntil: tipLightUntil,
                      }}
                      onTownLiveChange={onTownLiveChange}
                      onCourseContextChange={({ talks, liveNudge }) => {
                        setCourseTalks(talks);
                        setCourseLiveNudge(liveNudge);
                      }}
                      resumeClockNonce={resumeClockNonce}
                    />
                  </div>
                ) : framedUrl ? (
                  <>
                    <iframe
                      ref={iframeRef}
                      className="og-work-stage__frame"
                      src={framedUrl}
                      title={game.title}
                      sandbox={previewIframeSandbox(framedUrl)}
                      allow={previewIframeAllow()}
                    />
                    <JiaxiBanner />
                    {afterPlay && !isWorld ? (
                      <AfterPlayPrompt
                        onCheer={() => {
                          setAfterPlay(false);
                          void api.community
                            .tip(game.id, 5)
                            .then(() => message.success(t('kai.tip.ok')))
                            .catch((err) => {
                              const wall = openWalletForPaywall(err, navigate);
                              message.warning(
                                wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'),
                              );
                              if (!wall) navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                            });
                        }}
                        onJiaxi={
                          game.commerce?.jiaxiEnabled && game.commerce.cards.length
                            ? () => {
                                setAfterPlay(false);
                                const card = featuredJiaxiCard(
                                  game.commerce?.cards,
                                  game.commerce?.featuredCardId,
                                );
                                if (!card) return;
                                void api.community
                                  .jiaxi(game.id, card.id)
                                  .then((res) => {
                                    const landed = res.cards?.length ? res.cards : [res.card];
                                    message.success(
                                      t('kai.jiaxi.ok', {
                                        label: landed.map((c) => c.label).join(' · '),
                                      }),
                                    );
                                    void landPaidJiaxi(iframeRef.current, landed, () =>
                                      api.community.jiaxiConsume(game.id),
                                    );
                                  })
                                  .catch((err) => {
                                    const wall = openWalletForPaywall(err, navigate);
                                    message.warning(
                                      wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'),
                                    );
                                    if (!wall) {
                                      navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                                    }
                                  });
                              }
                            : undefined
                        }
                        onJiaxiRun={
                          game.commerce?.jiaxiEnabled &&
                          game.commerce.runBundle &&
                          game.commerce.runBundle.cardIds.length > 1
                            ? () => {
                                setAfterPlay(false);
                                void api.community
                                  .jiaxi(game.id, undefined, 'run')
                                  .then((res) => {
                                    const landed = res.cards?.length ? res.cards : [res.card];
                                    message.success(
                                      t('kai.jiaxi.ok', {
                                        label: landed.map((c) => c.label).join(' · '),
                                      }),
                                    );
                                    void landPaidJiaxi(iframeRef.current, landed, () =>
                                      api.community.jiaxiConsume(game.id),
                                    );
                                  })
                                  .catch((err) => {
                                    const wall = openWalletForPaywall(err, navigate);
                                    message.warning(
                                      wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'),
                                    );
                                    if (!wall) {
                                      navigate(walletPathForPaywall({ sku: 'pack_kai' }));
                                    }
                                  });
                              }
                            : undefined
                        }
                        onRemix={
                          remixAllowed
                            ? () => {
                                setAfterPlay(false);
                                remixRef.current?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'center',
                                });
                              }
                            : undefined
                        }
                        jiaxiLabel={
                          featuredJiaxiCard(game.commerce?.cards, game.commerce?.featuredCardId)
                            ?.label
                        }
                        jiaxiRunLabel={t('kai.jiaxi.run')}
                        onDismiss={() => setAfterPlay(false)}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <PlayCircleOutlined style={{ fontSize: 64, color: 'var(--color-gold)' }} />
                    <Text type="secondary" style={{ marginTop: 16 }}>
                      {t('community.gameDetail.previewLoading')}
                    </Text>
                  </>
                )}

              </div>
              {previewUrl &&
              (remixAllowed || (isWorld && game.viewerIsAuthor) || !isWorld) ? (
                <div className="og-work-stage__bar">
                  {remixAllowed ? (
                    <Button
                      icon={<ForkOutlined />}
                      onClick={() =>
                        remixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                    >
                      {t('community.gameDetail.remix')}
                    </Button>
                  ) : null}
                  {isWorld && game.viewerIsAuthor ? (
                    <Button
                      type="primary"
                      size="large"
                      icon={<PlayCircleOutlined />}
                      onClick={handlePlay}
                    >
                      {t('generate.preview.openObservatory')}
                    </Button>
                  ) : !isWorld ? (
                    <Button
                      type="primary"
                      size="large"
                      icon={<PlayCircleOutlined />}
                      onClick={handlePlay}
                    >
                      {t('community.gameDetail.openNewWindow')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!isAuthenticated ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
                message={t(
                  isWorld
                    ? 'community.gameDetail.guestWorld'
                    : 'community.gameDetail.guestPlay',
                )}
              />
            ) : null}

            <Card
              title={<span style={{ color: titleColor }}>{game.title}</span>}
              style={{
                background: cardBg,
                border: `1px solid ${cardBorder}`,
                marginBottom: 24,
              }}
              extra={
                <Space>
                  <StarOutlined style={{ color: '#fbbf24' }} />
                  <Text style={{ color: '#fbbf24' }}>{game.rating.toFixed(1)}</Text>
                  <Text type="secondary">
                    {t('community.gameDetail.ratingCount', { count: game.ratingCount })}
                  </Text>
                </Space>
              }
            >
              {game.author ? (
                <Space size={8} style={{ marginBottom: 12 }}>
                  <Avatar size="small" src={game.author.avatarUrl ?? undefined}>
                    {game.author.displayName.slice(0, 2).toUpperCase()}
                  </Avatar>
                  {game.author.handle ? (
                    <Link to={`/u/${game.author.handle}`}>{game.author.displayName}</Link>
                  ) : (
                    <Text style={{ color: strongColor }}>{game.author.displayName}</Text>
                  )}
                </Space>
              ) : null}

              {game.parent ? (
                <Paragraph
                  className={game.license === 'remix-credit' ? 'og-remix-credit' : undefined}
                  style={{ marginBottom: 12 }}
                >
                  <Text type="secondary">
                    {t(
                      game.license === 'remix-credit'
                        ? 'community.lineage.mustCredit'
                        : 'community.lineage.remixOf',
                    )}{' '}
                  </Text>
                  <Link to={`/community/game/${game.parent.slug}`}>{game.parent.title}</Link>
                </Paragraph>
              ) : null}

              {game.headline ? (
                <Paragraph
                  italic
                  ellipsis={{ rows: 2 }}
                  style={{ color: bodyColor, marginBottom: 12 }}
                >
                  {game.headline.speakerName
                    ? `${game.headline.speakerName}：${game.headline.line}`
                    : game.headline.line}
                </Paragraph>
              ) : null}

              <div style={{ marginBottom: 16 }}>
                <Tag color={isWorld ? '#2A9D8F' : '#C45C26'}>{categoryLabel}</Tag>
                {game.isOfficial ? <Tag color="gold">{t('community.official')}</Tag> : null}
                <WorldPresenceTag
                  living={game.world?.living}
                  speaking={game.world?.speaking}
                  clockPaused={game.world?.clockPaused}
                />
                <WorldAudienceHint status={game.world} muted={false} />
                {(() => {
                  const teaser = courseTeaser(game.course);
                  if (!teaser) return null;
                  return (
                    <Tag color={courseTeaserTagColor(teaser)}>
                      {t(courseTeaserBadgeKey(teaser))}
                    </Tag>
                  );
                })()}
                {game.tonight && game.viewerIsAuthor && !isWorld ? (
                  <Tag color="magenta">
                    {t('kai.author.tonightKind', {
                      tip: game.tonight.tip,
                      jiaxi: game.tonight.jiaxi,
                      xiangyi: game.tonight.xiangyi,
                      townTime: game.tonight.townTime ?? 0,
                      worldLight: game.tonight.worldLight ?? 0,
                    })}
                    {game.tonight.jiaxiByCard &&
                    Object.keys(game.tonight.jiaxiByCard).length > 0
                      ? ` · ${t('kai.tonight.cards', {
                          cards: Object.entries(game.tonight.jiaxiByCard)
                            .map(([id, n]) => {
                              const label =
                                game.commerce?.cards.find((c) => c.id === id)?.label ?? id;
                              return `${label}×${n}`;
                            })
                            .join(' '),
                        })}`
                      : ''}
                  </Tag>
                ) : null}
                {game.tags?.map((tag) => (
                  <Tag
                    key={tag.slug}
                    style={{
                      background: `${tag.color || (isWorld ? '#2A9D8F' : '#C45C26')}20`,
                      color: tag.color || (isWorld ? '#2A9D8F' : '#C45C26'),
                      border: 'none',
                    }}
                  >
                    {tag.name}
                  </Tag>
                ))}
              </div>

              <Paragraph style={{ color: bodyColor }}>
                {game.description || t('community.noDescription')}
              </Paragraph>
              <div
                style={{
                  display: 'flex',
                  gap: 24,
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: `1px solid ${dividerColor}`,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {t(
                      isWorld
                        ? 'community.gameDetail.watchCount'
                        : 'community.gameDetail.playCount',
                    )}
                  </Text>
                  <Text strong style={{ color: strongColor }}>
                    {game.playCount || 0}
                  </Text>
                </div>
                {(game.remixCount ?? 0) > 0 ? (
                  <div>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {t('community.gameDetail.remixCount')}
                    </Text>
                    <Text strong style={{ color: strongColor }}>
                      {game.remixCount}
                    </Text>
                  </div>
                ) : null}
                <div>
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {t('community.gameDetail.publishedAt')}
                  </Text>
                  <Text strong style={{ color: strongColor }}>
                    {new Date(game.publishedAt).toLocaleDateString()}
                  </Text>
                </div>
                {game.world?.simDays ? (
                  <div>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      <ClockCircleOutlined /> {t('community.world.simDays', { days: game.world.simDays })}
                    </Text>
                  </div>
                ) : null}
                {game.world?.residents ? (
                  <div>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      <TeamOutlined /> {t('community.world.people', { count: game.world.residents })}
                    </Text>
                  </div>
                ) : null}
              </div>
            </Card>

            <GameComments
              gameId={game.id}
              rating={game.rating}
              ratingCount={game.ratingCount}
            />
          </Col>

          <Col xs={24} lg={8} style={{ display: 'flex', flexDirection: 'column' }}>
            <InviteLanding />
            {isWorld ? null : <KaiMarketBar compact />}
            {isWorld && featureFlags.courseMarket ? (
              <Card
                className="og-course-card"
                title={
                  game.viewerIsAuthor
                    ? t('product.obs.course.authorTitle')
                    : t('product.obs.course.tonight')
                }
                style={{
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                  marginBottom: 24,
                  order: 0,
                }}
              >
                {game.viewerIsAuthor ? (
                  <>
                    <SocietyTownAuthorOpsBar
                      gameId={game.id}
                      projectId={game.authorProjectId}
                      board={courseBoard}
                      paused={game.world?.clockPaused ?? false}
                      funded={leaseActive(tipLightUntil ?? null, leaseNow)}
                      nowMs={leaseNow}
                      recommendHintKey={authorTown.recommendHintKey}
                      onOpenAdvanced={() => setCourseAuthorOpen(true)}
                      onOpenFund={() => scrollToCourseDesk()}
                      onResumeClock={() => setResumeClockNonce((n) => n + 1)}
                      onSeeded={(board) => {
                        setCourseBoard(board);
                        setCourseCanon(
                          board.history[0]?.canon ?? board.current?.canon ?? null,
                        );
                      }}
                    />
                    <SocietyTownCourseDesk
                      gameId={game.id}
                      canStake={false}
                      isAuthor
                      liveNudge={courseLiveNudge}
                      shareTitle={game.title}
                      shareSlugOrId={game.slug || game.id}
                      onOpenAuthorSeed={() => setCourseAuthorOpen(true)}
                      onRequireLogin={() => requireLogin()}
                      onBoard={(board) => {
                        setCourseBoard(board);
                        setCourseCanon(
                          board?.history[0]?.canon ?? board?.current?.canon ?? null,
                        );
                      }}
                    />
                    <SocietyTownCourseAuthorModal
                      open={courseAuthorOpen}
                      onClose={() => setCourseAuthorOpen(false)}
                      gameId={game.id}
                      projectId={game.authorProjectId}
                      talks={courseTalks}
                      places={authorTown.places}
                      worldSpec={authorTown.worldSpecPreview}
                      seedEmpty={!courseBoard?.current}
                      locale={locale === 'en' ? 'en' : 'zh-CN'}
                      onSeeded={(board) => {
                        setCourseBoard(board);
                        setCourseCanon(
                          board.history[0]?.canon ?? board.current?.canon ?? null,
                        );
                      }}
                    />
                  </>
                ) : (
                  <SocietyTownGuestDesk
                    slot="full"
                    gameId={game.id}
                    commerce={game.commerce}
                    canSpend={isAuthenticated}
                    whisperDraft={whisperDraft}
                    whisperTick={whisperTick}
                    liveNudge={courseLiveNudge}
                    talks={courseTalks}
                    actBarCompact
                    shareTitle={game.title}
                    shareSlugOrId={game.slug || game.id}
                    courseShareLanding={courseShareLanding}
                    courseFollowLanding={courseFollowLanding}
                    onShareLandingDone={() => setCourseShareLanding(false)}
                    onOpenCourse={() => scrollToCourseDesk()}
                    permitHint=""
                    talkBudgetHint={t('product.obs.guestWatchHint')}
                    onRequireLogin={(line) =>
                      requireLogin(line, line ? 'whisper' : 'remix')
                    }
                    onWhispered={() => setWhisperTick((n) => n + 1)}
                    onTownMoved={(info) => {
                      if (info?.lightUntil) setTipLightUntil(info.lightUntil);
                    }}
                    onCourseBoard={(board) => {
                      setCourseBoard(board);
                      setCourseCanon(
                        board?.history[0]?.canon ?? board?.current?.canon ?? null,
                      );
                    }}
                  />
                )}
              </Card>
            ) : null}
            {!isWorld && challenge ? (
              <Card
                style={{
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                  marginBottom: 24,
                }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Text strong>{t('community.prize.title')}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {challenge.title} · {challenge.prompt}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('community.prize.pool', {
                      entry: challenge.entryPoints ?? 10,
                      pool: challenge.poolPoints ?? 0,
                    })}
                  </Text>
                  {isAuthenticated ? (
                    <Button
                      size="small"
                      type="primary"
                      loading={entering}
                      onClick={() => {
                        setEntering(true);
                        void api.community
                          .enterChallenge(challenge.id, game.id)
                          .then((res) => {
                            message.success(
                              res.already
                                ? t('community.prize.already')
                                : t('community.prize.entered', { pool: res.poolPoints ?? 0 }),
                            );
                          })
                          .catch((err) => {
                            const status = (err as { status?: number }).status;
                            if (status === 402) {
                              const wall = openWalletForPaywall(err, navigate);
                              message.warning(
                                wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'),
                              );
                              return;
                            }
                            message.error(t('community.prize.fail'));
                          })
                          .finally(() => setEntering(false));
                      }}
                    >
                      {t('community.prize.enterWork')}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => requireLogin()}>
                      {t('community.prize.enter')}
                    </Button>
                  )}
                </Space>
              </Card>
            ) : null}
            <Card
              className="og-remix-card"
              title={
                <Space>
                  <ForkOutlined />
                  <span>{t('community.remix.title')}</span>
                </Space>
              }
              style={{
                background: cardBg,
                border: `1px solid ${cardBorder}`,
                marginBottom: 24,
                order: isWorld ? 4 : 0,
              }}
            >
              <div ref={remixRef}>
                <RemixComposer
                  lane={isWorld ? 'world' : 'game'}
                  chips={remixChips}
                  value={remixLine}
                  onChange={setRemixLine}
                  onSubmit={() => void handleRemix()}
                  loading={remixLoading}
                  locked={!remixAllowed}
                  lockedMessage={t('community.detail.remixLocked')}
                  hint={isWorld ? t('community.remix.hintWorld') : t('community.remix.hintGame')}
                  placeholder={t('community.remix.placeholder')}
                  submitLabel={t('community.remix.go')}
                  extra={
                    remixAllowed ? (
                      <>
                        <Button
                          block
                          style={{ marginTop: 8 }}
                          loading={remixLoading}
                          onClick={() => {
                            if (!game) return;
                            const sentence = remixLine.trim();
                            if (!isAuthenticated) {
                              requireLogin(sentence);
                              return;
                            }
                            setRemixLoading(true);
                            void api.remix
                              .forkCommunityGame(game.slug || game.id, {
                                ...(sentence ? { line: sentence } : {}),
                                branch: true,
                              })
                              .then((result) => {
                                takePendingRemix();
                                message.success(t('kai.branch.ok'));
                                const params = new URLSearchParams({ project: result.project.id });
                                if (result.kind === 'world') params.set('mode', 'world');
                                if (sentence) params.set('remix', sentence);
                                navigate(`/?${params.toString()}`);
                              })
                              .catch((err) => {
                                const status = (err as { status?: number }).status;
                                if (status === 402) {
                                  const wall = openWalletForPaywall(err, navigate);
                                  message.warning(
                                    wall ? paywallNeedCopy(t, wall) : t('kai.needPoints'),
                                  );
                                  return;
                                }
                                message.error(translateApiError(err));
                              })
                              .finally(() => setRemixLoading(false));
                          }}
                        >
                          {t('kai.branch.go', { points: game.commerce?.remixBranch ?? 8 })}
                        </Button>
                        {isWorld ? (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                            {t('community.gameDetail.whisperHint')}
                          </Text>
                        ) : null}
                      </>
                    ) : null
                  }
                />
              </div>
            </Card>

            {game.commerce && !isWorld ? (
              <KaiActions
                gameId={game.id}
                isWorld={Boolean(isWorld)}
                commerce={game.commerce}
                viewerIsAuthor={game.viewerIsAuthor}
                canSpend={isAuthenticated}
                iframeRef={iframeRef}
                onRequireLogin={() => requireLogin()}
                onTownMoved={() => setWhisperTick((n) => n + 1)}
              />
            ) : null}

            {isWorld && game.viewerIsAuthor ? (
              <WorldWhispers
                gameId={game.id}
                canWhisper={isAuthenticated}
                paidCost={0}
                xiangyiEnabled={false}
                initialLine={whisperDraft}
                refreshToken={whisperTick}
                courseSnapshot={courseBoard ? courseBoard.current : undefined}
                onRequireLogin={(text) => requireLogin(text, 'whisper')}
                onWhispered={() => {
                  setWhisperTick((n) => n + 1);
                }}
              />
            ) : !isWorld ? (
              <Leaderboard gameId={game.id} gameTitle={game.title} refreshToken={scoreTick} />
            ) : null}

            <Card
              style={{
                background: cardBg,
                border: `1px solid ${cardBorder}`,
                marginTop: isWorld ? 0 : 24,
                order: isWorld ? 1 : undefined,
              }}
            >
              <Space orientation="vertical" style={{ width: '100%' }}>
                {isWorld && previewUrl && !game.viewerIsAuthor ? null : (
                <Button
                  type="primary"
                  block
                  size="large"
                  icon={<PlayCircleOutlined />}
                  onClick={handlePlay}
                  disabled={!previewUrl}
                >
                  {isWorld
                    ? t('generate.preview.openObservatory')
                    : t('community.gameDetail.startGame')}
                </Button>
                )}
                <Button
                  block
                  icon={following ? <HeartFilled style={{ color: '#f472b6' }} /> : <HeartOutlined />}
                  loading={followLoading}
                  onClick={() => void toggleFollow()}
                >
                  {following ? t('community.following') : t('community.follow')}
                </Button>
                <Button block icon={<ShareAltOutlined />} onClick={handleShare}>
                  {t('community.gameDetail.shareGame')}
                </Button>
              </Space>
            </Card>

            {game.viewerIsAuthor ? (
              <Card
                title={t('community.authorSettings.title')}
                style={{
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                  marginTop: 24,
                }}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('community.authorSettings.license')}
                    </Text>
                    <Select
                      value={license}
                      onChange={(value) => void saveLicense({ license: value })}
                      style={{ width: '100%', marginTop: 4 }}
                      disabled={licenseSaving}
                      options={[
                        {
                          value: 'remix-ok',
                          label: t('community.authorSettings.license.remixOk'),
                        },
                        {
                          value: 'remix-credit',
                          label: t('community.authorSettings.license.remixCredit'),
                        },
                        {
                          value: 'no-remix',
                          label: t('community.authorSettings.license.noRemix'),
                        },
                      ]}
                    />
                  </div>
                  <Space align="start">
                    <Switch
                      checked={watermark}
                      loading={licenseSaving}
                      onChange={(checked) => void saveLicense({ watermark: checked })}
                    />
                    <div>
                      <Text style={{ color: strongColor }}>
                        {t('community.authorSettings.watermark')}
                      </Text>
                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 12, marginBottom: 0 }}
                      >
                        {t('community.authorSettings.watermarkHint')}
                      </Paragraph>
                    </div>
                  </Space>
                </Space>
              </Card>
            ) : null}
          </Col>
        </Row>
      </Content>
    </Layout>
  );
};
