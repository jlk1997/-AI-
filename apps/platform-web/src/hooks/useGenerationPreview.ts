/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preview URL application for the studio — extracted from useGeneration
 * so SSE / poll stays in the parent hook.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { api } from '../services/api';
import {
  buildSuccessIteratePrompts,
  detectIterateKind,
} from '../utils/iterateSuggestions';
import type { Message } from '../components/Conversation/MessageItem';
import type { GenerationState, StageStatus } from './useGeneration';

export function useGenerationPreview(opts: {
  readonly t: (key: string) => string;
  readonly uiEpochRef: MutableRefObject<number>;
  readonly activeProjectIdRef: MutableRefObject<string | null>;
  readonly appliedPreviewDeploymentRef: MutableRefObject<string | null>;
  readonly setDeploymentId: Dispatch<SetStateAction<string | null>>;
  readonly setStageStatuses: Dispatch<
    SetStateAction<{
      generate: StageStatus;
      build: StageStatus;
      deploy: StageStatus;
    }>
  >;
  readonly setGenerationState: Dispatch<SetStateAction<GenerationState>>;
  readonly setPreviewUrl: Dispatch<SetStateAction<string | null>>;
  readonly setMessages: Dispatch<SetStateAction<Message[]>>;
}): {
  fetchEarlyPlayablePreview: (projectId: string, refined: boolean) => Promise<void>;
  fetchPreviewUrl: (
    projectId: string,
    opts?: {
      force?: boolean;
      deploymentId?: string;
      /** Re-sign even when this deployment is already on stage. User refresh only. */
      remint?: boolean;
    },
  ) => Promise<void>;
} {
  const {
    t,
    uiEpochRef,
    activeProjectIdRef,
    appliedPreviewDeploymentRef,
    setDeploymentId,
    setStageStatuses,
    setGenerationState,
    setPreviewUrl,
    setMessages,
  } = opts;

  const fetchEarlyPlayablePreview = useCallback(
    async (projectId: string, refined: boolean) => {
      const epoch = uiEpochRef.current;
      try {
        const deploymentsResponse = await api.deployments.list(projectId);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        const latestDeployment = deploymentsResponse.deployments[0];
        if (!latestDeployment) return;
        const sameDeployment =
          appliedPreviewDeploymentRef.current === latestDeployment.id;
        if (sameDeployment) {
          setDeploymentId(latestDeployment.id);
          setStageStatuses((prev) => ({
            ...prev,
            generate: 'success',
            build: 'success',
            deploy: 'success',
          }));
          setGenerationState('preview');
          return;
        }
        const previewResponse = await api.deployments.getPreviewUrl(
          latestDeployment.id,
        );
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        appliedPreviewDeploymentRef.current = latestDeployment.id;
        setPreviewUrl(previewResponse.url);
        setDeploymentId(latestDeployment.id);
        setStageStatuses((prev) => ({
          ...prev,
          generate: 'success',
          build: 'success',
          deploy: 'success',
        }));
        setGenerationState('preview');
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
          if (lastIndex !== -1) {
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              status: 'success',
              content: refined
                ? t('generate.preview.earlyPlayableRefinedHint')
                : t('generate.preview.earlyPlayableHint'),
            };
          }
          return newMessages;
        });
      } catch (e) {
        console.error('获取早期可玩预览失败:', e);
      }
    },
    [
      t,
      uiEpochRef,
      activeProjectIdRef,
      appliedPreviewDeploymentRef,
      setDeploymentId,
      setStageStatuses,
      setGenerationState,
      setPreviewUrl,
      setMessages,
    ],
  );

  const fetchPreviewUrl = useCallback(
    async (
      projectId: string,
      opts?: { force?: boolean; deploymentId?: string; remint?: boolean },
    ) => {
      const epoch = uiEpochRef.current;
      try {
        let latestId = opts?.deploymentId?.trim() || '';
        if (!latestId) {
          const deploymentsResponse = await api.deployments.list(projectId);
          if (
            uiEpochRef.current !== epoch ||
            activeProjectIdRef.current !== projectId
          ) {
            return;
          }
          latestId = deploymentsResponse.deployments[0]?.id ?? '';
        }
        if (!latestId) {
          if (opts?.force || opts?.remint) {
            throw new Error('no preview deployment');
          }
          return;
        }
        const sameDeployment = appliedPreviewDeploymentRef.current === latestId;
        const shouldRemint = Boolean(opts?.remint) || (Boolean(opts?.force) && !sameDeployment);
        if (!sameDeployment || shouldRemint) {
          const previewResponse = await api.deployments.getPreviewUrl(latestId);
          if (
            uiEpochRef.current !== epoch ||
            activeProjectIdRef.current !== projectId
          ) {
            return;
          }
          appliedPreviewDeploymentRef.current = latestId;
          setPreviewUrl(previewResponse.url);
        }
        setDeploymentId(latestId);
        setStageStatuses((prev) => ({ ...prev, deploy: 'success' }));
        setGenerationState('preview');

        if (opts?.force) {
          return;
        }

        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
          const lastUser = [...newMessages]
            .reverse()
            .find((m) => m.role === 'user');
          const kind = detectIterateKind({
            lastUserPrompt: lastUser?.content ?? null,
            recentSummaries: [
              lastUser?.content ?? '',
              newMessages[lastIndex]?.confirmStrip ?? '',
            ],
          });
          const nextPrompts = buildSuccessIteratePrompts(kind);
          if (lastIndex !== -1) {
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              status: 'success',
              content: t('generate.preview.deploySuccessHint'),
              suggestedPrompts: nextPrompts,
              suggestAsNextSteps: true,
            };
          }
          return newMessages;
        });
      } catch (e) {
        console.error('获取预览 URL 失败:', e);
        if (opts?.force) throw e;
      }
    },
    [
      t,
      uiEpochRef,
      activeProjectIdRef,
      appliedPreviewDeploymentRef,
      setDeploymentId,
      setStageStatuses,
      setGenerationState,
      setPreviewUrl,
      setMessages,
    ],
  );

  return { fetchEarlyPlayablePreview, fetchPreviewUrl };
}
