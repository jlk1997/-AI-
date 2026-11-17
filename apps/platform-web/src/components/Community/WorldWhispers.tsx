/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The guestbook of a published town. Comments under a game are talk *about* the
 * work; a whisper goes *into* it — the society reacts and the next visitor sees
 * the consequence. That is why this is not `GameComments` with a different title.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Card, Empty, Input, List, Space, Switch, Tag, Typography, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { MessageOutlined, SendOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type CourseView, type WorldWhisper } from '../../services/api';
import { WHISPER_DESK_ID } from '../World/societyTownTimeDesk';
import { courseWhisperPlaceholder, courseInEvidencePhase } from '../World/courseAuthorFlow';
import { trackCourseEventOnce } from '../World/courseTelemetry';
import { featureFlags } from '../../utils/featureFlags';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import {
  openWalletForPaywall,
  paywallFromError,
  paywallNeedCopy,
} from '../../utils/kaiPaywall';

const { Text, Paragraph } = Typography;

interface WorldWhispersProps {
  gameId: string;
  canWhisper: boolean;
  /** Paid 巷议 costs this many points and lands as town rumor. */
  paidCost?: number;
  xiangyiEnabled?: boolean;
  /** Called with the sentence so login can hand it back afterwards. */
  onRequireLogin: (line: string) => void;
  /** What the visitor typed before we sent them to sign in. */
  initialLine?: string;
  /** Bumped by the parent when the sim clock moved, to re-read the list. */
  refreshToken?: number;
  /** Called after a whisper actually reached the town. */
  onWhispered?: () => void;
  /** Sit inside the town inspector instead of a second card on the page. */
  embedded?: boolean;
  /** Guest desks may open tonight’s night-market board. Authors must seed. */
  ensureCourse?: boolean;
  /** When embedded beside an active course desk, reuse its snapshot instead of polling. */
  courseSnapshot?: CourseView | null;
}

export const WorldWhispers: React.FC<WorldWhispersProps> = ({
  gameId,
  canWhisper,
  paidCost = 6,
  xiangyiEnabled = true,
  onRequireLogin,
  initialLine = '',
  refreshToken = 0,
  onWhispered,
  embedded = false,
  ensureCourse = false,
  courseSnapshot,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const navigate = useNavigate();
  const [whispers, setWhispers] = useState<WorldWhisper[]>([]);
  const [line, setLine] = useState(initialLine);
  const [sending, setSending] = useState(false);
  const [paid, setPaid] = useState(false);
  const [firstXiangyi, setFirstXiangyi] = useState(false);
  const [course, setCourse] = useState<CourseView | null>(null);
  const [hangOptionId, setHangOptionId] = useState<string | null>(null);
  const inputRef = useRef<TextAreaRef>(null);

  useEffect(() => {
    if (initialLine) setLine(initialLine);
  }, [initialLine]);

  useEffect(() => {
    if (!canWhisper) return;
    void api.billing
      .market()
      .then((m) => setFirstXiangyi(Boolean(m.firstXiangyi)))
      .catch(() => undefined);
  }, [canWhisper]);

  const xiangyiPay =
    firstXiangyi && paidCost > 0 ? Math.max(1, Math.floor(paidCost * 0.5)) : paidCost;

  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';

  useEffect(() => {
    let cancelled = false;
    void api.community
      .whispers(gameId)
      .then((res) => {
        if (!cancelled) setWhispers(res.whispers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gameId, refreshToken]);

  useEffect(() => {
    if (!featureFlags.courseMarket) return;
    if (courseSnapshot !== undefined) {
      setCourse(courseSnapshot);
      if (courseSnapshot?.myOptionId) setHangOptionId(courseSnapshot.myOptionId);
      return;
    }
    let cancelled = false;
    const pull = (): void => {
      void api.community
        .course(gameId, { ensure: ensureCourse })
        .then((res) => {
          if (cancelled) return;
          setCourse(res.current);
          if (res.current?.myOptionId) setHangOptionId(res.current.myOptionId);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gameId, refreshToken, ensureCourse, courseSnapshot]);

  const send = async (): Promise<void> => {
    const text = line.trim();
    if (text.length < 2) return;
    if (!canWhisper) {
      message.info(t('community.whisper.needLogin'));
      onRequireLogin(text);
      return;
    }
    setSending(true);
    try {
      const res = await api.community.whisper(
        gameId,
        text,
        undefined,
        paid && xiangyiEnabled,
        paid && course
          ? { nodeId: course.id, ...(hangOptionId ? { optionId: hangOptionId } : {}) }
          : undefined,
      );
      setLine('');
      message.success(t('community.whisper.sent'));
      if (res.rumor) {
        message.info(t('community.whisper.rumor', { text: res.rumor }));
      }
      const fresh = await api.community.whispers(gameId).catch(() => null);
      if (fresh) setWhispers(fresh.whispers);
      onWhispered?.();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const code = (err as { code?: string })?.code;
      if (status === 402 || code === 'QUOTA_EXCEEDED') {
        const wall = openWalletForPaywall(err, navigate);
        message.warning(paywallNeedCopy(t, wall ?? paywallFromError(err)));
      } else if (status === 429) {
        message.warning(t('community.whisper.slowDown'));
      } else if (status === 423 || code === 'society_busy') {
        message.warning(t('community.whisper.busy'));
      } else {
        message.error(t('community.whisper.failed'));
      }
    } finally {
      setSending(false);
    }
  };

  const shown = embedded ? whispers.slice(0, 6) : whispers;
  const whisperPlaceholder = courseWhisperPlaceholder({ course, t });
  const evidenceWhisper =
    course
    && courseInEvidencePhase({
      status: course.status,
      bettingClosesAt: course.bettingClosesAt ?? course.opensAt,
    })
    && (course.myPoints ?? 0) > 0;

  useEffect(() => {
    if (!evidenceWhisper) return;
    trackCourseEventOnce(
      `whisper-banner:${gameId}`,
      'course_whisper_evidence_banner',
      { gameId, staked: true },
    );
  }, [evidenceWhisper, gameId]);

  return (
    <Card
      id={embedded ? WHISPER_DESK_ID : undefined}
      size={embedded ? 'small' : 'default'}
      title={
        embedded ? undefined : (
        <Space>
          <MessageOutlined style={{ color: 'var(--color-teal)' }} />
          <span>{t('community.whisper.title')}</span>
        </Space>
        )
      }
      style={
        embedded
          ? { background: 'transparent', border: 'none', marginBottom: 0 }
          : { background: cardBg, border: `1px solid ${cardBorder}`, marginBottom: 24 }
      }
      styles={embedded ? { body: { padding: 0 } } : undefined}
    >
      {embedded ? null : (
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('community.whisper.hint')}
      </Paragraph>
      )}
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        {evidenceWhisper ? (
          <div className="og-course-whisper-banner">
            <Text style={{ fontSize: 12 }}>
              {t('product.obs.course.whisperEvidenceBanner')}
            </Text>
            <Button
              size="small"
              type="primary"
              onClick={() => inputRef.current?.focus()}
            >
              {t('product.obs.course.whisperEvidenceCta')}
            </Button>
          </div>
        ) : null}
        <Input.TextArea
          ref={inputRef}
          rows={2}
          value={line}
          maxLength={200}
          onChange={(e) => setLine(e.target.value)}
          placeholder={whisperPlaceholder}
        />
        {xiangyiEnabled && course && (course.status === 'open' || course.status === 'closed') ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.hangHint')}
            {course.myOptionId ? ` · ${t('product.obs.course.hangYours')}` : ''}
          </Text>
        ) : null}
        {xiangyiEnabled && paid && course && (course.status === 'open' || course.status === 'closed') ? (
          <Space wrap size={6}>
            <Text style={{ fontSize: 12 }}>{t('product.obs.course.hang')}</Text>
            {course.options.map((option) => (
              <Button
                key={option.id}
                size="small"
                type={hangOptionId === option.id ? 'primary' : 'default'}
                onClick={() =>
                  setHangOptionId((prev) => (prev === option.id ? null : option.id))
                }
              >
                {option.label}
              </Button>
            ))}
          </Space>
        ) : null}
        {xiangyiEnabled && paidCost > 0 ? (
          <Space>
            <Switch checked={paid} onChange={setPaid} />
            <Text style={{ fontSize: 12 }}>
              {t('kai.xiangyi.toggle', { points: xiangyiPay })}
              {firstXiangyi ? ` ${t('kai.jiaxi.half')}` : ''}
            </Text>
          </Space>
        ) : null}
        <Button
          type="primary"
          block
          icon={<SendOutlined />}
          loading={sending}
          disabled={line.trim().length < 2}
          onClick={() => void send()}
        >
          {paid && xiangyiEnabled
            ? t('kai.xiangyi.send', { points: xiangyiPay })
            : t('community.whisper.send')}
        </Button>
      </Space>

      {shown.length === 0 ? (
        embedded ? null : (
        <Empty
          description={t('community.whisper.empty')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ marginTop: 16 }}
        />
        )
      ) : (
        <List
          style={{ marginTop: 8 }}
          dataSource={shown}
          renderItem={(item) => {
            const day =
              item.simTime != null ? Math.floor(item.simTime / 24) + 1 : null;
            return (
              <List.Item>
                <List.Item.Meta
                  avatar={
                    <Avatar src={item.author.avatarUrl ?? undefined} size="small">
                      {item.author.displayName.slice(0, 1).toUpperCase()}
                    </Avatar>
                  }
                  title={
                    <Space size={6} wrap>
                      {item.author.handle ? (
                        <Link to={`/u/${item.author.handle}`}>
                          {item.author.displayName}
                        </Link>
                      ) : (
                        <Text>{item.author.displayName}</Text>
                      )}
                      {item.paid ? <Tag color="gold">{t('kai.xiangyi.paidTag')}</Tag> : null}
                      {item.courseHangLabel || item.courseOptionId ? (
                        <Tag>
                          {item.courseHangLabel
                            ? t('product.obs.course.stakedSaid', {
                                label: item.courseHangLabel,
                              })
                            : t('product.obs.course.hung')}
                        </Tag>
                      ) : null}
                      {day != null ? (
                        <Tag color="cyan">{t('community.whisper.atDay', { day })}</Tag>
                      ) : null}
                    </Space>
                  }
                  description={<Text style={{ fontSize: 13 }}>{item.text}</Text>}
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};
