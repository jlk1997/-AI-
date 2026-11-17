/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { Typography, Spin } from 'antd';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { Message } from './MessageItem';
import { useT } from '../../services/i18n';
import { GenerationModeBar } from '../World/GenerationModeBar';
import type { GenerationMode, WorldTemplateId } from '../World/worldTemplates';
import {
  firstClickWorldTemplates,
  promptForWorldTemplate,
  researchWorldTemplates,
} from '../World/worldTemplates';
import { WorldCreateGuide } from '../World/WorldCreateGuide';
import {
  applyWorldTemplateToPrefs,
  composeWorldGeneratePrompt,
  composeWorldTemplatePrompt,
  worldNotePreview,
} from '../World/composeWorldBrief';
import { type WorldCreatePrefs } from '../World/worldCreatePrefs';
import { emptyStateGameChips } from '../../utils/iterateSuggestions';
import { BrandMark } from '../../brand/BrandMark';

const { Text } = Typography;

interface ConversationPanelProps {
  messages: Message[];
  onSendMessage: (content: string, images?: string[]) => void;
  loading?: boolean;
  chatInputAnchorRef?: React.RefObject<HTMLDivElement | null>;
  generationMode?: GenerationMode;
  onGenerationModeChange?: (mode: GenerationMode) => void;
  onOpenWorldPanel?: () => void;
  /** When true, world chat follow-ups edit Spec instead of regenerating. */
  hasWorldTip?: boolean;
  worldCreatePrefs?: WorldCreatePrefs;
  onWorldCreatePrefsChange?: (next: WorldCreatePrefs) => void;
  draftValue?: string;
  draftNonce?: number;
  onUseSuggestion?: (prompt: string) => void;
  onSendSuggestion?: (prompt: string) => void;
  onRegenerate?: () => void;
  onShareToCommunity?: () => void;
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  messages,
  onSendMessage,
  loading,
  chatInputAnchorRef,
  generationMode = 'game',
  onGenerationModeChange,
  onOpenWorldPanel,
  hasWorldTip = false,
  worldCreatePrefs,
  onWorldCreatePrefsChange,
  draftValue,
  draftNonce,
  onUseSuggestion,
  onSendSuggestion,
  onRegenerate,
  onShareToCommunity,
}) => {
  const { t } = useT();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  type PromptChip = {
    label: string;
    prompt: string;
    templateId?: WorldTemplateId;
    description?: string;
    recommended?: boolean;
  };

  const gameExamples: PromptChip[] = emptyStateGameChips().map((c) => ({
    label: c.label,
    prompt: c.prompt,
    recommended: c.recommended,
  }));

  const worldFirstClick = firstClickWorldTemplates();
  const worldResearch = researchWorldTemplates();

  const worldEditChips: PromptChip[] = [
    {
      label: t('conversation.chip.worldEdit.traitor'),
      prompt: t('world.edit.examplePrompt'),
    },
    {
      label: t('conversation.chip.worldEdit.forest'),
      prompt:
        '扩展一片神秘森林，加入可观察的社会事件道具与居民日常（药庐、猎场即可）；不要改成通关任务链。',
    },
    {
      label: t('conversation.chip.worldEdit.quest'),
      prompt:
        '给邮差加一条会传播的传闻种子（聚会/矿脉消息），并补上与铁匠、旅店老板的关系。',
    },
  ];

  const [showResearch, setShowResearch] = useState(false);
  const showWorldCreateGuide =
    generationMode === 'world' && !hasWorldTip && Boolean(worldCreatePrefs);
  const worldBriefReady = Boolean(worldCreatePrefs?.note.trim());
  const sendFromBrief = (id?: WorldTemplateId) => {
    if (!worldCreatePrefs) {
      if (id) onSendMessage(promptForWorldTemplate(id));
      return;
    }
    if (!id) {
      onSendMessage(composeWorldGeneratePrompt(worldCreatePrefs));
      return;
    }
    const next = applyWorldTemplateToPrefs(worldCreatePrefs, id);
    onWorldCreatePrefsChange?.(next);
    onSendMessage(composeWorldTemplatePrompt(next, id));
  };

  const chips: PromptChip[] =
    generationMode === 'world'
      ? hasWorldTip
        ? worldEditChips
        : [
            {
              label: t('world.create.generateFromBrief'),
              prompt: worldCreatePrefs
                ? composeWorldGeneratePrompt(worldCreatePrefs)
                : '',
              description: worldCreatePrefs
                ? t('world.create.summary', {
                    note: worldNotePreview(
                      worldCreatePrefs.note,
                      t('world.create.noteEmpty'),
                    ),
                    art: t(`intake.art.${worldCreatePrefs.artStyleId}`),
                    scale: t(`world.create.scale.${worldCreatePrefs.scale}`),
                    livedIn: t(
                      `world.create.livedIn.${worldCreatePrefs.livedIn}`,
                    ),
                    pack: t(`world.create.pack.${worldCreatePrefs.packId}`),
                    useCase: t(
                      `world.create.useCase.${worldCreatePrefs.useCase}`,
                    ),
                    venues: worldCreatePrefs.venues
                      .map((v) => t(`world.create.venue.${v}`))
                      .join(t('world.create.venueJoin')),
                  })
                : undefined,
              recommended: true,
            },
            ...worldFirstClick.map((tpl) => ({
              label: `${tpl.emoji} ${t(tpl.titleKey)}`,
              prompt: tpl.prompt,
              templateId: tpl.id,
              description: t(tpl.descKey),
            })),
          ]
      : gameExamples;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-layout)',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 20px' }}>
        {messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 0 32px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: showWorldCreateGuide ? 64 : 100,
                height: showWorldCreateGuide ? 64 : 100,
                borderRadius: showWorldCreateGuide ? 16 : 24,
                background: 'var(--color-night)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: showWorldCreateGuide ? 14 : 28,
                boxShadow:
                  generationMode === 'world'
                    ? '0 12px 40px color-mix(in srgb, var(--color-teal) 32%, transparent)'
                    : 'var(--glow-ember)',
              }}
            >
              <BrandMark size={showWorldCreateGuide ? 34 : 52} />
            </div>
            <Text
              style={{
                fontSize: showWorldCreateGuide ? 18 : 20,
                color: 'var(--text-primary)',
                marginBottom: 10,
                display: 'block',
                fontWeight: 600,
              }}
            >
              {generationMode === 'world'
                ? t('conversation.welcome.worldTitle')
                : t('conversation.welcome.title')}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: 'var(--text-secondary)',
                maxWidth: showWorldCreateGuide ? 440 : 360,
                lineHeight: 1.7,
                marginBottom: showWorldCreateGuide ? 16 : 28,
              }}
            >
              {generationMode === 'world'
                ? hasWorldTip
                  ? t('conversation.welcome.worldEditTip')
                  : t('conversation.welcome.worldDesc')
                : t('conversation.welcome.desc')}
            </Text>
            {showWorldCreateGuide && worldCreatePrefs && onWorldCreatePrefsChange ? (
              <div style={{ width: '100%', maxWidth: 520, marginBottom: 20 }}>
                <WorldCreateGuide
                  value={worldCreatePrefs}
                  onChange={onWorldCreatePrefsChange}
                  disabled={loading}
                />
              </div>
            ) : null}
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                maxWidth: 520,
              }}
            >
              {chips
                .filter((c) => c.recommended)
                .map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    className={
                      generationMode === 'world'
                        ? `og-world-go${worldBriefReady ? '' : ' is-need'}`
                        : undefined
                    }
                      onClick={() =>
                        example.templateId
                          ? sendFromBrief(example.templateId)
                          : onSendMessage(example.prompt)
                      }
                    style={
                      generationMode === 'world'
                        ? undefined
                        : {
                            width: '100%',
                            textAlign: 'left',
                            cursor: 'pointer',
                            border: '1px solid var(--color-ember)',
                            background:
                              'color-mix(in srgb, var(--color-ember) 12%, var(--bg-card))',
                            borderRadius: 16,
                            padding: '14px 18px',
                          }
                    }
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color:
                          generationMode === 'world'
                            ? worldBriefReady
                              ? 'color-mix(in srgb, var(--text-inverse) 78%, transparent)'
                              : 'var(--color-teal)'
                            : 'var(--color-ember)',
                        display: 'block',
                        marginBottom: 4,
                      }}
                    >
                      {t('world.quickStart.recommended')}
                    </Text>
                    <Text
                      strong
                      style={{
                        fontSize: 15,
                        color:
                          generationMode === 'world' && worldBriefReady
                            ? 'var(--text-inverse)'
                            : 'var(--text-primary)',
                        display: 'block',
                      }}
                    >
                      {example.label}
                    </Text>
                    {example.description ? (
                      <Text
                        style={{
                          fontSize: 12,
                          color:
                            generationMode === 'world' && worldBriefReady
                              ? 'color-mix(in srgb, var(--text-inverse) 78%, transparent)'
                              : 'var(--text-secondary)',
                          display: 'block',
                          marginTop: 4,
                          lineHeight: 1.5,
                        }}
                      >
                        {example.description}
                      </Text>
                    ) : null}
                  </button>
                ))}
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                {generationMode === 'world' && !hasWorldTip ? (
                  <Text
                    style={{
                      width: '100%',
                      textAlign: 'center',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {t('world.create.shortcuts')}
                  </Text>
                ) : null}
                {chips
                  .filter((c) => !c.recommended)
                  .map((example) => (
                    <Text
                      key={example.label}
                      style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        background: 'var(--bg-lane)',
                        padding: '10px 18px',
                        borderRadius: 20,
                        cursor: 'pointer',
                        border: '1px solid var(--border-color)',
                        transition: 'all 0.2s ease',
                      }}
                      onClick={() =>
                        example.templateId
                          ? sendFromBrief(example.templateId)
                          : onSendMessage(example.prompt)
                      }
                    >
                      {example.label}
                    </Text>
                  ))}
              </div>
              {generationMode === 'world' && !hasWorldTip && worldResearch.length ? (
                <div style={{ width: '100%', textAlign: 'center' }}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                    onClick={() => setShowResearch((v) => !v)}
                  >
                    {t('conversation.welcome.moreResearch')}
                  </Text>
                  {showResearch
                    ? worldResearch.map((tpl) => (
                        <Text
                          key={tpl.id}
                          style={{
                            display: 'block',
                            marginTop: 8,
                            fontSize: 13,
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                          onClick={() => sendFromBrief(tpl.id)}
                        >
                          {tpl.emoji} {t(tpl.titleKey)}
                        </Text>
                      ))
                    : null}
                </div>
              ) : null}
            </div>
            {generationMode === 'world' && !hasWorldTip ? (
              <Text
                style={{
                  marginTop: 20,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('conversation.welcome.worldTip')}
              </Text>
            ) : null}
            {showWorldCreateGuide ? null : (
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('conversation.welcome.artStyleHint')}
              </Text>
            )}
          </div>
        ) : (
          <MessageList
            messages={messages}
            loading={loading}
            onUseSuggestion={onUseSuggestion}
            onSendSuggestion={onSendSuggestion}
            onRegenerate={onRegenerate}
            onShareToCommunity={onShareToCommunity}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        ref={chatInputAnchorRef}
        style={{
          flexShrink: 0,
          padding: '12px 20px 16px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-card)',
        }}
      >
        {onGenerationModeChange ? (
          <GenerationModeBar
            mode={generationMode}
            onChange={onGenerationModeChange}
            onOpenWorldPanel={onOpenWorldPanel}
          />
        ) : null}
        {generationMode === 'world' && hasWorldTip && messages.length > 0 ? (
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {worldEditChips.map((chip) => (
              <Text
                key={chip.label}
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  background: 'color-mix(in srgb, var(--color-teal) 10%, var(--bg-card))',
                  padding: '6px 12px',
                  borderRadius: 16,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--color-teal)',
                  opacity: loading ? 0.5 : 1,
                }}
                onClick={() => {
                  if (!loading) onSendMessage(chip.prompt);
                }}
              >
                {chip.label}
              </Text>
            ))}
          </div>
        ) : null}
        <ChatInput
          onSend={onSendMessage}
          loading={loading}
          generationMode={generationMode}
          draftValue={draftValue}
          draftNonce={draftNonce}
          allowEmptySend={showWorldCreateGuide}
          placeholder={
            generationMode === 'world'
              ? hasWorldTip
                ? t('chat.placeholderWorldEdit')
                : t('chat.placeholderWorld')
              : t('chat.placeholder')
          }
        />
        {loading ? (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : null}
      </div>
    </div>
  );
};
