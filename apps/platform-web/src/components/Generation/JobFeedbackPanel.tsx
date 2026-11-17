/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Rate, Input, Button, Space, message } from 'antd';
import { api } from '../../services/api';

interface JobFeedbackPanelProps {
  projectId: string;
  jobId: string | null;
}

export const JobFeedbackPanel: React.FC<JobFeedbackPanelProps> = ({
  projectId,
  jobId,
}) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!jobId) return null;

  const submit = async () => {
    if (rating <= 0) {
      message.warning('请先选择评分');
      return;
    }
    setSubmitting(true);
    try {
      await api.agent.submitFeedback(projectId, jobId, { rating, comment });
      message.success('感谢反馈，我们会据此优化下一轮生成');
    } catch {
      message.error('提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>这版游戏满意吗？</span>
      <Rate value={rating} onChange={setRating} />
      <Input.TextArea
        rows={2}
        placeholder="可选：说说哪里不满意（会写入项目记忆）"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button size="small" loading={submitting} onClick={submit}>
        提交反馈
      </Button>
    </Space>
  );
};
