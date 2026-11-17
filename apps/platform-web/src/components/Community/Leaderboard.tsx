/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Card, Typography, Input, Button, Modal, Space, message, Spin } from 'antd';
import { TrophyOutlined, SendOutlined, CrownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAppStore } from '../../store';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import { rememberLoginReturnTo } from '../../utils/loginIntent';

const { Text } = Typography;

interface LeaderboardProps {
  gameId: string;
  gameTitle: string;
  /** Bumped when the framed game posts a score so the list refreshes. */
  refreshToken?: number;
}

interface LeaderboardEntry {
  rank: number;
  playerName: string;
  score: number;
  metadata?: Record<string, any>;
  achievedAt: string;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ gameId, gameTitle, refreshToken = 0 }) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const navigate = useNavigate();
  const { isAuthenticated } = useAppStore();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitModalVisible, setSubmitModalVisible] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [score, setScore] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';
  const headerBorder = isDark ? '#27272a' : '#e2e8f0';
  const rowBorder = isDark ? '#262626' : '#f1f5f9';
  const strongColor = isDark ? '#e4e4e7' : '#1e293b';

  const loadLeaderboard = async () => {
    setLoading(true);
    try {
      const data = await api.community.getLeaderboard(gameId, 20);
      setLeaderboard(data.leaderboard);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadLeaderboard();
  }, [gameId, refreshToken]);

  const handleSubmitScore = async () => {
    const scoreNum = parseInt(score, 10);
    if (isNaN(scoreNum) || scoreNum < 0) {
      message.error(t('community.leaderboard.invalidScore'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.community.submitScore(
        gameId,
        scoreNum,
        playerName || 'Anonymous',
      );
      message.success(t('community.leaderboard.submitSuccess', { rank: result.rank }));
      setSubmitModalVisible(false);
      setPlayerName('');
      setScore('');
      loadLeaderboard();
    } catch (error) {
      message.error(t('community.leaderboard.submitFail'));
    } finally {
      setSubmitting(false);
    }
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return '#fbbf24';
    if (rank === 2) return '#c0c0c0';
    if (rank === 3) return '#cd7f32';
    return '#6b7280';
  };

  return (
    <Card
      title={
        <Space>
          <TrophyOutlined style={{ color: '#fbbf24' }} />
          <span>{t('community.leaderboard.title', { title: gameTitle })}</span>
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => {
            // A score belongs to somebody; sending a guest to a form that will
            // 401 on submit wastes the only thing they were willing to do.
            if (!isAuthenticated) {
              message.info(t('community.leaderboard.needLogin'));
              rememberLoginReturnTo(window.location.pathname);
              navigate('/login');
              return;
            }
            setSubmitModalVisible(true);
          }}
          size="small"
        >
          {t('community.leaderboard.submit')}
        </Button>
      }
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
      }}
      styles={{
        header: { borderBottom: `1px solid ${headerBorder}` },
        body: { padding: 0 },
      }}
    >
      <Spin spinning={loading}>
        {leaderboard.length === 0 && !loading ? (
          <Text type="secondary" style={{ display: 'block', padding: 24 }}>
            {t('community.leaderboard.empty')}
          </Text>
        ) : (
          <div>
            {leaderboard.map((item, index) => (
              <div
                key={`${item.rank}-${item.playerName}-${item.achievedAt}`}
                style={{
                  padding: '12px 16px',
                  borderBottom:
                    index < leaderboard.length - 1 ? `1px solid ${rowBorder}` : 'none',
                  background:
                    item.rank <= 3 ? `${getRankColor(item.rank)}10` : 'transparent',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: `${getRankColor(item.rank)}30`,
                      border: `2px solid ${getRankColor(item.rank)}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: 14,
                      color: getRankColor(item.rank),
                    }}
                  >
                    {item.rank <= 3 ? (
                      <CrownOutlined style={{ fontSize: 14 }} />
                    ) : (
                      item.rank
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <Text strong style={{ color: strongColor }}>
                      {item.playerName}
                    </Text>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <Text
                      strong
                      style={{
                        color: item.rank <= 3 ? getRankColor(item.rank) : strongColor,
                        fontSize: 16,
                      }}
                    >
                      {item.score.toLocaleString()}
                    </Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 10 }}>
                      {new Date(item.achievedAt).toLocaleDateString()}
                    </Text>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>

      <Modal
        title={t('community.leaderboard.modalTitle')}
        open={submitModalVisible}
        onCancel={() => setSubmitModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setSubmitModalVisible(false)}>
            {t('common.cancel')}
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={submitting}
            onClick={handleSubmitScore}
          >
            {t('common.ok')}
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {t('community.leaderboard.playerName')}
            </Text>
            <Input
              placeholder={t('community.leaderboard.playerPlaceholder')}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
            />
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {t('community.leaderboard.score')}
            </Text>
            <Input
              type="number"
              placeholder={t('community.leaderboard.scorePlaceholder')}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              min={0}
            />
          </div>
        </Space>
      </Modal>
    </Card>
  );
};
