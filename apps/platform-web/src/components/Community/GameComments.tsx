/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card,
  Typography,
  Input,
  Button,
  Space,
  Avatar,
  Popconfirm,
  Rate,
  message,
  Spin,
} from 'antd';
import {
  DeleteOutlined,
  HeartFilled,
  HeartOutlined,
  MessageOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import { useAppStore } from '../../store';
import {
  peekPendingSocial,
  rememberLoginReturnTo,
  rememberPendingSocial,
  takePendingSocial,
} from '../../utils/loginIntent';
import { ReportButton } from './ReportButton';

const { Text } = Typography;
const { TextArea } = Input;

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  likesCount: number;
  likedByMe?: boolean;
  replies?: Comment[];
  user: {
    id: string;
    handle: string | null;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

interface GameCommentsProps {
  gameId: string;
  rating: number;
  ratingCount: number;
  onRatingChange?: (rating: number) => void;
}

export const GameComments: React.FC<GameCommentsProps> = ({
  gameId,
  rating,
  ratingCount,
  onRatingChange,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const navigate = useNavigate();
  const { isAuthenticated } = useAppStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [userRating, setUserRating] = useState<number>(0);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';
  const headerBorder = isDark ? '#27272a' : '#e2e8f0';
  const itemBorder = isDark ? '#262626' : '#f1f5f9';
  const strongColor = isDark ? '#e4e4e7' : '#1e293b';
  const bodyColor = isDark ? '#a1a1aa' : '#64748b';

  const loadComments = async () => {
    setLoading(true);
    try {
      const data = await api.community.getComments(gameId);
      setComments(data.comments);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadComments();
  }, [gameId]);

  /** Coming back from /login should post the sentence they already typed. */
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const pending = peekPendingSocial();
    if (!pending || pending.gameId !== gameId) return;
    if (pending.kind !== 'comment' && pending.kind !== 'rating') return;
    takePendingSocial();
    if (pending.kind === 'comment' && pending.content.trim()) {
      setNewComment(pending.content);
      void (async () => {
        try {
          await api.community.submitComment(gameId, pending.content);
          setNewComment('');
          message.success(t('community.comments.postSuccess'));
          void loadComments();
        } catch {
          message.error(t('community.comments.postFail'));
        }
      })();
      return;
    }
    if (pending.kind === 'rating') {
      setUserRating(pending.rating);
      void (async () => {
        try {
          await api.community.submitRating(gameId, pending.rating);
          message.success(t('community.comments.ratingSuccess'));
          onRatingChange?.(pending.rating);
        } catch {
          message.error(t('community.comments.ratingFail'));
        }
      })();
    }
  }, [gameId, isAuthenticated]);

  const requireLogin = (pending: Parameters<typeof rememberPendingSocial>[0]): void => {
    rememberPendingSocial(pending);
    rememberLoginReturnTo(window.location.pathname);
    navigate('/login');
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim()) {
      message.warning(t('community.comments.enterContent'));
      return;
    }
    if (!isAuthenticated) {
      message.info(t('community.comments.needLogin'));
      requireLogin({ kind: 'comment', gameId, content: newComment.trim() });
      return;
    }

    setSubmitting(true);
    try {
      await api.community.submitComment(gameId, newComment);
      setNewComment('');
      message.success(t('community.comments.postSuccess'));
      loadComments();
    } catch (error) {
      message.error(t('community.comments.postFail'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string): Promise<void> => {
    const text = replyText.trim();
    if (!text) return;
    if (!isAuthenticated) {
      message.info(t('community.comments.needLogin'));
      requireLogin({ kind: 'comment', gameId, content: text });
      return;
    }
    setSubmitting(true);
    try {
      await api.community.submitComment(gameId, text, parentId);
      setReplyText('');
      setReplyTo(null);
      loadComments();
    } catch {
      message.error(t('community.comments.postFail'));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * The count comes back from the server rather than being incremented here:
   * a double tap or a stale page then converges on the truth instead of
   * drifting away from it.
   */
  const handleToggleLike = async (comment: Comment): Promise<void> => {
    if (!isAuthenticated) {
      message.info(t('community.comments.needLogin'));
      requireLogin({ kind: 'comment', gameId, content: '' });
      return;
    }
    try {
      const res = comment.likedByMe
        ? await api.community.unlikeComment(comment.id)
        : await api.community.likeComment(comment.id);
      const apply = (list: Comment[]): Comment[] =>
        list.map((item) => ({
          ...item,
          ...(item.id === comment.id
            ? { likedByMe: res.liked, likesCount: res.likesCount }
            : {}),
          ...(item.replies ? { replies: apply(item.replies) } : {}),
        }));
      setComments((prev) => apply(prev));
    } catch {
      message.error(t('community.comments.likeFail'));
    }
  };

  const handleDelete = async (commentId: string): Promise<void> => {
    try {
      await api.community.deleteComment(commentId);
      message.success(t('community.comments.deleted'));
      loadComments();
    } catch {
      message.error(t('community.comments.deleteFail'));
    }
  };

  const handleRatingChange = async (value: number) => {
    if (!isAuthenticated) {
      message.info(t('community.comments.needLogin'));
      requireLogin({ kind: 'rating', gameId, rating: value });
      return;
    }
    setUserRating(value);
    try {
      await api.community.submitRating(gameId, value);
      message.success(t('community.comments.ratingSuccess'));
      onRatingChange?.(value);
    } catch (error) {
      message.error(t('community.comments.ratingFail'));
    }
  };

  /** One comment row. Replies use the same row without the reply affordance. */
  const renderComment = (comment: Comment, isReply = false): React.ReactElement => (
    <Space align="start" style={{ width: '100%' }}>
      <Avatar
        size={isReply ? 'small' : 'default'}
        icon={<UserOutlined />}
        src={comment.user?.avatarUrl ?? undefined}
        style={{ background: 'var(--color-ember)' }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          {comment.user?.handle ? (
            <Link to={`/u/${comment.user.handle}`} style={{ color: strongColor }}>
              <Text strong style={{ color: strongColor }}>
                {comment.user.displayName}
              </Text>
            </Link>
          ) : (
            <Text strong style={{ color: strongColor }}>
              {comment.user?.displayName ?? 'player'}
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 11 }}>
            {new Date(comment.createdAt).toLocaleString()}
          </Text>
        </div>
        <Text style={{ color: bodyColor }}>{comment.content}</Text>
        <div style={{ marginTop: 6 }}>
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={
                comment.likedByMe ? (
                  <HeartFilled style={{ color: '#f43f5e' }} />
                ) : (
                  <HeartOutlined />
                )
              }
              onClick={() => void handleToggleLike(comment)}
            >
              {comment.likesCount > 0 ? comment.likesCount : null}
            </Button>
            {isReply ? null : (
              <Button
                type="text"
                size="small"
                icon={<MessageOutlined />}
                onClick={() => {
                  setReplyTo((prev) => (prev === comment.id ? null : comment.id));
                  setReplyText('');
                }}
              >
                {t('community.comments.reply')}
              </Button>
            )}
            <ReportButton commentId={comment.id} />
            {/* The API decides who may delete; showing it to everyone would be
                a promise we cannot keep, so it is offered only to signed-in
                readers and refused server-side for anyone else's comment. */}
            {isAuthenticated ? (
              <Popconfirm
                title={t('community.comments.deleteConfirm')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() => void handleDelete(comment.id)}
              >
                <Button type="text" size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            ) : null}
          </Space>
        </div>
      </div>
    </Space>
  );

  return (
    <Card
      title={
        <Space>
          <span>{t('community.comments.playerRating')}</span>
          <Rate
            allowHalf
            value={rating}
            disabled
            style={{ color: '#fbbf24' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {rating.toFixed(1)} {t('community.gameDetail.ratingCount', { count: ratingCount })}
          </Text>
        </Space>
      }
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
      }}
      styles={{
        header: { borderBottom: `1px solid ${headerBorder}` },
      }}
    >
      <div
        style={{
          marginBottom: 24,
          padding: 16,
          background: isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.06)',
          borderRadius: 8,
        }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {t('community.comments.rateGame')}
        </Text>
        <Rate
          allowHalf
          value={userRating}
          onChange={handleRatingChange}
          style={{ color: '#fbbf24' }}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {t('community.comments.yourThoughts')}
        </Text>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <TextArea
            placeholder={t('community.comments.placeholder')}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            maxLength={2000}
            showCount
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={submitting}
            onClick={handleSubmitComment}
            style={{ alignSelf: 'flex-end' }}
          >
            {t('community.comments.post')}
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {comments.length === 0 && !loading ? (
          <Text type="secondary" style={{ display: 'block', padding: '16px 0' }}>
            {t('community.comments.empty')}
          </Text>
        ) : (
          <div>
            {comments.map((comment, index) => (
              <div
                key={comment.id}
                style={{
                  borderBottom:
                    index < comments.length - 1 ? `1px solid ${itemBorder}` : 'none',
                  padding: '16px 0',
                }}
              >
                {renderComment(comment)}
                {(comment.replies ?? []).length > 0 ? (
                  <div
                    style={{
                      marginLeft: 40,
                      marginTop: 12,
                      paddingLeft: 12,
                      borderLeft: `2px solid ${itemBorder}`,
                    }}
                  >
                    {(comment.replies ?? []).map((reply) => (
                      <div key={reply.id} style={{ marginBottom: 12 }}>
                        {renderComment(reply, true)}
                      </div>
                    ))}
                  </div>
                ) : null}
                {replyTo === comment.id ? (
                  <div style={{ marginLeft: 40, marginTop: 12 }}>
                    <Space orientation="vertical" style={{ width: '100%' }}>
                      <TextArea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={t('community.comments.replyPlaceholder')}
                        maxLength={2000}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                      />
                      <Space style={{ alignSelf: 'flex-end' }}>
                        <Button size="small" onClick={() => setReplyTo(null)}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          loading={submitting}
                          onClick={() => void handleSubmitReply(comment.id)}
                        >
                          {t('community.comments.reply')}
                        </Button>
                      </Space>
                    </Space>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Spin>
    </Card>
  );
};
