/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Typography, Space, Badge, Tooltip } from 'antd';
import { StarFilled, EyeOutlined, ForkOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../services/i18n';

const { Text, Paragraph } = Typography;

interface GameCardProps {
  game: {
    id: string;
    title: string;
    slug: string;
    description?: string;
    thumbnail?: string;
    category?: string;
    playCount?: number;
    remixCount?: number;
    rating?: number;
    ratingCount?: number;
    tags?: { name: string; slug: string; color?: string }[];
    publishedAt?: string;
    challengeId?: string | null;
    jiaxiEnabled?: boolean;
  };
  deployment?: {
    previewUrl?: string;
  };
}

const categoryColors: Record<string, string> = {
  arcade: '#ef4444',
  puzzle: '#e0b25a',
  action: '#f59e0b',
  strategy: '#10b981',
  rpg: '#c45c26',
  story: '#c45c26',
  world: '#2a9d8f',
  other: '#6b7280',
};

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
  const navigate = useNavigate();
  const { t } = useT();

  const handleClick = () => {
    navigate(`/community/game/${game.slug || game.id}`);
  };

  const categoryKey = game.category || 'other';
  const categoryColor = categoryColors[categoryKey] ?? categoryColors.other;
  const categoryRaw = t(`community.category.${categoryKey}`);
  const categoryDisplay = categoryRaw.startsWith('community.category')
    ? game.category || 'other'
    : categoryRaw;
  const titleColor = 'var(--text-primary)';
  const descColor = 'var(--text-secondary)';
  const coverBg = 'var(--bg-lane)';

  return (
    <Card
      hoverable
      className="og-game-card"
      onClick={handleClick}
      style={{
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}
      styles={{
        body: { padding: 0 },
      }}
      cover={
        <div
          style={{
            height: 180,
            background: `linear-gradient(160deg, ${categoryColor}55, var(--color-night))`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {game.thumbnail ? (
            <img
              src={game.thumbnail}
              alt={game.title}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <PlayCircleOutlined style={{ fontSize: 64, color: 'rgba(224,178,90,0.7)' }} />
          )}

          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'rgba(0,0,0,0.6)',
              borderRadius: 4,
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <EyeOutlined style={{ fontSize: 12, color: '#a1a1aa' }} />
            <Text style={{ fontSize: 11, color: '#a1a1aa' }}>
              {game.playCount || 0}
            </Text>
            {(game.remixCount ?? 0) > 0 ? (
              <>
                <ForkOutlined style={{ fontSize: 11, color: '#e0b25a' }} />
                <Text style={{ fontSize: 11, color: '#e0b25a' }}>{game.remixCount}</Text>
              </>
            ) : null}
          </div>

          <Badge
            color={categoryColor}
            text={
              <Text
                style={{
                  fontSize: 10,
                  color: '#fff',
                  background: 'rgba(0,0,0,0.6)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {categoryDisplay}
              </Text>
            }
            style={{ position: 'absolute', top: 8, left: 8 }}
          />
        </div>
      }
    >
      <div style={{ padding: 12, background: coverBg }}>
        <Paragraph
          strong
          ellipsis={{ rows: 1 }}
          style={{
            color: titleColor,
            marginBottom: 8,
            fontSize: 15,
          }}
        >
          {game.title}
        </Paragraph>
        {game.challengeId ? (
          <Text style={{ fontSize: 11, color: '#f59e0b' }}>{t('community.prize.badge')}</Text>
        ) : game.jiaxiEnabled !== false ? (
          <Text style={{ fontSize: 11, color: '#fb923c' }}>{t('kai.jiaxi.badge')}</Text>
        ) : null}

        <Paragraph
          type="secondary"
          ellipsis={{ rows: 2 }}
          style={{
            fontSize: 12,
            color: descColor,
            marginBottom: 12,
            minHeight: 32,
          }}
        >
          {game.description || t('community.gameCard.noDescription')}
        </Paragraph>

        {game.tags && game.tags.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Space size={4} wrap>
              {game.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.slug}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: `${tag.color || 'var(--color-ember)'}20`,
                    color: tag.color || 'var(--color-ember)',
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </Space>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Space>
            <StarFilled style={{ color: '#fbbf24', fontSize: 14 }} />
            <Text style={{ color: '#fbbf24', fontSize: 13 }}>
              {game.rating ? game.rating.toFixed(1) : '0.0'}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ({game.ratingCount || 0})
            </Text>
          </Space>

          {game.publishedAt && (
            <Tooltip title={new Date(game.publishedAt).toLocaleDateString()}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(game.publishedAt).toLocaleDateString()}
              </Text>
            </Tooltip>
          )}
        </div>
      </div>
    </Card>
  );
};
