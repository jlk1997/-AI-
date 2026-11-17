/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const JOB_TYPES = [
  'generate',
  'build',
  'publish',
  'bench',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DEPLOYMENT_CHANNELS = ['preview', 'production'] as const;
export type DeploymentChannel = (typeof DEPLOYMENT_CHANNELS)[number];

/** Default daily job cap per organization (overridable via env on API). */
export const DEFAULT_DAILY_JOB_LIMIT_PER_ORG = 500;

/** Default max concurrent queued+running jobs per organization. */
export const DEFAULT_MAX_CONCURRENT_JOBS_PER_ORG = 2;

export {
  JOB_LOG_S3_TAIL_SEPARATOR,
  resolveJobLogS3ObjectKey,
  summarizeJobLogKey,
} from './jobLog.js';
export {
  acquireRedisLock,
  LockBusyError,
  societyWorldLockKey,
  withRedisLock,
  type AcquiredLock,
  type RedisLikeForLock,
  type RedisLockOptions,
} from './redisLock.js';
export {
  PRESENCE_HIDDEN_GRACE_MS,
  SOCIETY_AUTHOR_WATCH_TTL_MS,
  SOCIETY_PRESENCE_TTL_MAX_MS,
  SOCIETY_PRESENCE_TTL_MS,
  authorWatchTtlMs,
  clampSocietyPresenceTtlMs,
  guestPresenceDecision,
  guestPresenceWriteGuard,
  leaseActive,
  presenceWhilePageVisible,
  societyTalkMuteReason,
  societyTalksAllowed,
  stackPermitUntil,
  townCatalogHeat,
  townPresenceBadge,
} from './societyLease.js';
export {
  SOCIETY_EMERGENCY_BUDGET,
  SOCIETY_TALK_BUDGET,
  SOCIETY_WORLD_LIGHT,
  activeLightBonus,
  authorFundingOpen,
  talkFundingOpen,
  grantHourLightBonusOn,
  orderLiveWorldsForCourse,
  pacedTalkSlotsThisWalk,
  parseWorldLightSku,
  peekEmergencyTalkOn,
  peekSocietyTalkBudgetOn,
  pickSocietyLlmLane,
  RELEASE_TALKS_SCRIPT,
  releaseSocietyTalksOn,
  RESERVE_EMERGENCY_SCRIPT,
  RESERVE_TALKS_SCRIPT,
  reserveEmergencyTalkOn,
  reserveSocietyTalksOn,
  SOCIETY_TALK_TTL_SEC,
  settleSocietyTalksOn,
  societyEmergencyTalkKey,
  societyTalkBudgetKeys,
  societyTalkBudgetOpenOn,
  societyTalkBudgetView,
  societyTalkHourBonus,
  societyTalkHourBucket,
  societyTalkHourResetsAt,
  tipExtendsLightMs,
  societyTalkMinutesLeftInHour,
  societyTalksOverBudget,
  stackWorldLight,
  talkBudgetReserveExceeded,
  type SocietyTalkBudgetOpts,
  type SocietyTalkBudgetRedis,
  type SocietyTalkBudgetView,
  type SocietyTalkLane,
  type WorldLightSku,
} from './societyTalkBudget.js';
export {
  SOCIETY_LATEST_FRAME_TTL_SEC,
  societyChannel,
  societyLatestFrameKey,
  worldIdFromSocietyChannel,
} from './societyFrame.js';
export {
  BINARY_STAY_COURSE,
  COURSE,
  COURSE_VOID_REASONS,
  NIGHT_MARKET_COURSE_OPTIONS,
  NIGHT_MARKET_COURSE_PROMPT,
  alleyCourseOverlapsChinaDay,
  authorCourseRake,
  buildCustomCourseSeed,
  courseWinLine,
  placesFromWorldSpec,
  scoreCourseLabelHits,
  suggestCourseFromTalks,
  suggestCourseFromPlaces,
  canAddStake,
  canWithdrawCourseStake,
  courseContest,
  courseCanonLine,
  coursePromptLocale,
  courseVoidCanonLine,
  worldCoursePrefersNightMarket,
  nextWorldCourseSeedKind,
  courseEventLooksLikeLeave,
  coursePhaseClock,
  chinaWallClock,
  lastAgentPresenceSignal,
  courseSettleForceVoid,
  courseShouldSettleNow,
  courseRake,
  courseStakeSteps,
  courseVoidReasonKey,
  decideCourseOutcome,
  courseSettlementTelemetry,
  eventMatchesPredicate,
  isCourseStakeStep,
  isLivingCourseEvidence,
  judgeCourseWindow,
  matchCourseOptionKey,
  maxAdditionalStake,
  needlesFromLine,
  parseCoursePredicate,
  previewCoursePayout,
  previewCourseEvidenceHits,
  talksToCourseFacts,
  beatsEligibleForCourse,
  courseBoardReachability,
  courseEvidenceHealthOf,
  courseSteeringPromptBlock,
  courseSteeringWindowOpen,
  courseTownReadyForSeed,
  WORLD_COURSE_SEED_ATTEMPTS,
  recentTalkHaystack,
  validateCourseSeedReachability,
  settlePariMutuel,
  transcriptFingerprint,
  type CourseClockPhase,
  type CourseEvidenceHealth,
  type CourseEvidenceOption,
  type CourseEvidenceTalk,
  type CourseReachability,
  type CourseSeedSource,
  type CourseSteeringHint,
  type CoursePayoutRow,
  type CoursePredicate,
  type CourseStakeRow,
  type CourseStatus,
  type CourseTalkHint,
  type CourseVoidReason,
  type CourseSettlementTelemetry,
  type CourseEventFact,
} from './courseMarket.js';
export {
  courseActIndex,
  courseActLabelKey,
  courseActPrimaryNoteKey,
  courseCanAuthorReplace,
  courseCanAuthorQueue,
  courseInEvidencePhase,
  courseSettlementState,
  courseSettlementTitleKey,
  courseActDisplay,
  courseActDisplayLabelKey,
  type CourseAct,
  type CourseActView,
  type CourseActDisplay,
  type CourseActDisplayView,
  type CourseSettlementState,
} from './courseAct.js';
export {
  courseRoundMs,
  parseCourseRoundPreset,
  type CourseRoundPreset,
} from './courseRound.js';
export {
  buildAwayPoseCourseFacts,
  courseBoardPulse,
  courseLocationLooksAway,
  type AwayPoseAgentSnapshot,
  type CoursePulse,
  type CoursePulseBoard,
  type CoursePulseKind,
  type CoursePulseView,
} from './coursePulse.js';
export {
  composeJobLogKey,
  detectLlmAuthError,
  detectLlmQuotaError,
  formatLlmQuotaErrorSummary,
  isLlmAuthErrorLike,
  isLlmKeyRotateErrorLike,
  isLlmQuotaErrorLike,
  type LlmAuthErrorInfo,
  type LlmQuotaErrorInfo,
} from './llmQuotaError.js';
export {
  announceProgress,
  describeProgressBar,
  shouldDismissOnEscape,
  type LiveRegionMessage,
  type ProgressDescriptor,
  type ProgressStep,
} from './a11y.js';
export {
  LLM_BUCKET_CAPS,
  llmBucketKey,
  takeLlmTokens,
  takeWorldLlmTokens,
  worldBelongsToShard,
  worldLlmBucketKey,
  type LlmBucketCaps,
  type LlmBucketRedis,
  type LlmLane,
} from './llmBucket.js';
export {
  createPerfMarker,
  withPerfMarker,
  type PerfMarker,
  type PerfMarkerBudget,
  type PerfSample,
} from './perfMarker.js';
