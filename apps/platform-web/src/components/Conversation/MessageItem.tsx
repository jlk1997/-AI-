/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Typography, Space, Tag, Button, Dropdown, Tooltip, message } from 'antd';
import {
  RobotOutlined,
  UserOutlined,
  CheckCircleFilled,
  CopyOutlined,
  CheckOutlined,
  LikeOutlined,
  DislikeOutlined,
  BulbOutlined,
  FormOutlined,
  ThunderboltOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useT } from '../../services/i18n';
import { parseRecoverySuggestedPrompts } from '../../utils/jobFailureText';
import { isShareToCommunityPrompt } from '../../utils/iterateSuggestions';

const { Text, Paragraph } = Typography;

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'sending' | 'success' | 'error';
  images?: string[]; // base64 图片列表
  codeChanges?: {
    files: string[];
    summary: string;
  };
  /** Recovery / next-step prompts (FAIL or success iterate chips). */
  suggestedPrompts?: string[];
  /** ChangePlan confirm strip: 「本轮将改：…」 */
  confirmStrip?: string;
  /** When true, suggestion chips use success (amber) styling instead of error red. */
  suggestAsNextSteps?: boolean;
}

interface MessageItemProps {
  message: Message;
  onRegenerate?: () => void;
  onFeedback?: (type: 'like' | 'dislike') => void;
  onUseSuggestion?: (prompt: string) => void;
  onSendSuggestion?: (prompt: string) => void;
  /** Dedicated share CTA on success next-steps card. */
  onShareToCommunity?: () => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message: msg,
  onRegenerate,
  onFeedback,
  onUseSuggestion,
  onSendSuggestion,
  onShareToCommunity,
}) => {
  const { t } = useT();
  const [displayedContent, setDisplayedContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const recoveryPrompts = useMemo(() => {
    const raw =
      msg.suggestedPrompts && msg.suggestedPrompts.length > 0
        ? msg.suggestedPrompts
        : msg.status === 'error'
          ? parseRecoverySuggestedPrompts(msg.content)
          : [];
    return raw.filter((p) => !isShareToCommunityPrompt(p)).slice(0, 4);
  }, [msg.suggestedPrompts, msg.status, msg.content]);

  const chipsAreNextSteps =
    msg.suggestAsNextSteps === true && msg.status === 'success';
  const showShareCta = Boolean(chipsAreNextSteps && onShareToCommunity);
  const showSuggestionChips =
    (recoveryPrompts.length > 0 || showShareCta) &&
    (onUseSuggestion || onSendSuggestion || onShareToCommunity) &&
    (msg.status === 'error' ||
      (msg.suggestAsNextSteps === true && msg.status === 'success'));

  // 打字机效果
  useEffect(() => {
    if (msg.role === 'user') {
      setDisplayedContent(msg.content);
      return;
    }

    if (msg.content !== displayedContent) {
      setIsTyping(true);
      setDisplayedContent('');

      let index = 0;
      const timer = setInterval(() => {
        if (index < msg.content.length) {
          setDisplayedContent(msg.content.slice(0, index + 1));
          index++;
        } else {
          setIsTyping(false);
          clearInterval(timer);
        }
      }, 20);

      return () => clearInterval(timer);
    }

    return undefined;
  }, [msg.content, msg.role]);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    message.success('已复制到剪贴板');
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = msg.role === 'user';

  // 快捷指令菜单
  const quickCommandItems: MenuProps['items'] = [
    {
      key: 'add-scores',
      label: '添加计分系统',
      onClick: () => message.info('已添加：添加计分系统'),
    },
    {
      key: 'add-levels',
      label: '添加关卡系统',
      onClick: () => message.info('已添加：添加关卡系统'),
    },
    {
      key: 'add-powerups',
      label: '添加道具系统',
      onClick: () => message.info('已添加：添加道具系统'),
    },
    {
      key: 'add-sound',
      label: '添加音效',
      onClick: () => message.info('已添加：添加音效'),
    },
    {
      key: 'change-theme',
      label: '换个主题/风格',
      onClick: () => message.info('已添加：换个主题/风格'),
    },
    {
      type: 'divider',
    },
    {
      key: 'custom',
      label: '自定义需求...',
      onClick: () => message.info('请在下方输入框中描述你的需求'),
    },
  ];

  // AI 消息的操作菜单
  const aiActionItems: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <CopyOutlined />,
      label: '复制内容',
      onClick: handleCopy,
    },
    {
      key: 'regenerate',
      icon: <BulbOutlined />,
      label: '重新生成',
      onClick: () => onRegenerate?.(),
    },
    {
      type: 'divider',
    },
    {
      key: 'like',
      icon: <LikeOutlined />,
      label: '效果不错',
      onClick: () => {
        onFeedback?.('like');
        message.success('感谢反馈！');
      },
    },
    {
      key: 'dislike',
      icon: <DislikeOutlined />,
      label: '需要改进',
      onClick: () => {
        onFeedback?.('dislike');
        message.info('我们会改进生成效果');
      },
    },
  ];

  return (
    <div
      ref={messageRef}
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
        animation: 'fadeIn 0.3s ease',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          display: 'flex',
          flexDirection: isUser ? 'row-reverse' : 'row',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        {/* 头像 */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isUser ? 'var(--color-ember)' : 'var(--color-teal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isUser ? (
            <UserOutlined style={{ color: '#fff', fontSize: 16 }} />
          ) : (
            <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
          )}
        </div>

        {/* 消息内容 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size="small" style={{ marginBottom: 4 }}>
            <Text
              strong
              style={{
                color: isUser ? 'var(--text-secondary)' : 'var(--color-teal)',
                fontSize: 12,
              }}
            >
              {isUser ? t('chat.sender.you') : t('chat.sender.assistant')}
            </Text>
            {msg.status === 'sending' && (
              <Tag color="gold" style={{ fontSize: 10, marginLeft: 8 }}>
                {t('chat.status.sending')}
              </Tag>
            )}
            {msg.status === 'error' && (
              <CheckCircleFilled style={{ color: '#ef4444', fontSize: 12 }} />
            )}
            {msg.status === 'success' && !isTyping && (
              <CheckCircleFilled style={{ color: '#22c55e', fontSize: 12 }} />
            )}
          </Space>

          {!isUser && msg.confirmStrip ? (
            <div
              style={{
                marginBottom: 8,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--color-gold) 16%, var(--bg-card))',
                border: '1px solid color-mix(in srgb, var(--color-gold) 45%, var(--border-color))',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {msg.confirmStrip}
            </div>
          ) : null}

          {/* 消息气泡 */}
          <div style={{ position: 'relative' }}>
            <Dropdown
              menu={{ items: isUser ? quickCommandItems : aiActionItems }}
              trigger={isTyping ? [] : ['click']}
              placement={isUser ? 'bottomRight' : 'bottomLeft'}
            >
              <div
                className={isUser ? 'og-msg-bubble og-msg-bubble--user' : 'og-msg-bubble og-msg-bubble--ai'}
                style={{
                  background: isUser ? 'var(--color-ember)' : 'var(--bg-lane)',
                  borderRadius:
                    isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  padding: '12px 16px',
                  color: isUser ? 'var(--text-inverse)' : 'var(--text-primary)',
                  cursor: isTyping ? 'default' : 'pointer',
                }}
              >
                {isUser ? (
                  <>
                    {msg.images && msg.images.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          marginBottom: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {msg.images.map((img, idx) => (
                          <img
                            key={idx}
                            src={img}
                            alt={`参考图 ${idx + 1}`}
                            style={{
                              maxWidth: 120,
                              maxHeight: 120,
                              borderRadius: 8,
                              objectFit: 'cover',
                              border: '1px solid rgba(255,255,255,0.2)',
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <Paragraph style={{ marginBottom: 0, color: 'var(--text-inverse)' }}>
                      {msg.content}
                    </Paragraph>
                  </>
                ) : (
                  <Paragraph
                    style={{
                      marginBottom: 0,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {displayedContent}
                    {isTyping && (
                      <span
                        style={{
                          opacity: 0.5,
                          animation: 'blink 1s infinite',
                        }}
                      >
                        |
                      </span>
                    )}
                  </Paragraph>
                )}
              </div>
            </Dropdown>
          </div>

          {/* 代码变更提示 */}
          {msg.codeChanges && msg.codeChanges.files.length > 0 && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                background: 'var(--bg-card)',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
              }}
            >
              <Text type="secondary" style={{ fontSize: 11 }}>
                已修改 {msg.codeChanges.files.length} 个文件
              </Text>
              <div
                style={{
                  marginTop: 4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                {msg.codeChanges.files.map((file) => (
                  <Tag key={file} style={{ fontSize: 10, margin: 0 }}>
                    {file}
                  </Tag>
                ))}
              </div>
            </div>
          )}

          {showSuggestionChips ? (
            <div
              style={{
                marginTop: 8,
                padding: '10px 12px',
                background: chipsAreNextSteps ? '#0f1412' : '#1a1212',
                borderRadius: 10,
                border: chipsAreNextSteps
                  ? '1px solid rgba(52, 211, 153, 0.28)'
                  : '1px solid #7f1d1d',
              }}
            >
              {showShareCta ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: recoveryPrompts.length > 0 ? 10 : 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(129, 140, 248, 0.35)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Text
                      style={{
                        display: 'block',
                        fontSize: 13,
                        color: '#e0e7ff',
                        fontWeight: 600,
                      }}
                    >
                      {t('generate.nextSteps.shareTitle')}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, color: '#a5b4fc' }}
                    >
                      {t('generate.nextSteps.shareDesc')}
                    </Text>
                  </div>
                  <Button
                    type="primary"
                    size="middle"
                    icon={<ShareAltOutlined />}
                    onClick={() => onShareToCommunity?.()}
                    style={{ flexShrink: 0 }}
                  >
                    {t('generate.nextSteps.shareCta')}
                  </Button>
                </div>
              ) : null}
              {recoveryPrompts.length > 0 ? (
                <>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {chipsAreNextSteps
                      ? t('generate.nextSteps.hint')
                      : t('generate.failedJobs.useSuggestionHint')}
                  </Text>
                  <Space
                    orientation="vertical"
                    size={4}
                    style={{ marginTop: 6, width: '100%' }}
                  >
                    {recoveryPrompts.map((prompt, i) => (
                      <Space key={`rec-${msg.id}-${i}`} wrap size={[4, 4]}>
                        <Text
                          style={{
                            fontSize: 11,
                            maxWidth: 260,
                            color: chipsAreNextSteps ? '#86efac' : '#fca5a5',
                          }}
                          ellipsis={{ tooltip: prompt }}
                        >
                          {i + 1}. {prompt}
                        </Text>
                        {onUseSuggestion ? (
                          <Button
                            size="small"
                            type="dashed"
                            icon={<FormOutlined />}
                            onClick={() => onUseSuggestion(prompt)}
                          >
                            {t('generate.failedJobs.useSuggestion', { n: i + 1 })}
                          </Button>
                        ) : null}
                        {onSendSuggestion ? (
                          <Button
                            size="small"
                            type="primary"
                            danger={!chipsAreNextSteps}
                            ghost
                            icon={<ThunderboltOutlined />}
                            onClick={() => onSendSuggestion(prompt)}
                          >
                            {chipsAreNextSteps
                              ? t('generate.nextSteps.send')
                              : t('generate.failedJobs.sendSuggestion')}
                          </Button>
                        ) : null}
                      </Space>
                    ))}
                  </Space>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 0.5; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};
