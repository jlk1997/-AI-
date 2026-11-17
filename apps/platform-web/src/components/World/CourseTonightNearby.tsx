/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * When this town has no board, nudge visitors to a nearby open board.
 */

import React, { useEffect, useState } from 'react';
import { Button, Space, Typography } from 'antd';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import {
  collectStakeTonightItems,
  courseStakeTonightHref,
  summarizeCourseTonight,
} from '../Community/communityCourseLine';

const { Text } = Typography;

export const CourseTonightNearby: React.FC = () => {
  const { t } = useT();
  const [slug, setSlug] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.community
      .courseTonight()
      .then((res) => {
        if (cancelled) return;
        const items = collectStakeTonightItems(
          res.items.map((row) => ({
            id: row.gameId,
            slug: row.slug,
            title: row.title,
            course: row.course,
          })),
        );
        const top = summarizeCourseTonight(items)?.topItems[0];
        if (!top) return;
        setSlug(top.slug);
        setTitle(top.title);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!slug) return null;

  return (
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('product.obs.course.nearbyHint')}
      </Text>
      <Button
        type="link"
        size="small"
        style={{ padding: 0, height: 'auto' }}
        href={courseStakeTonightHref(slug)}
      >
        {t('product.obs.course.nearbyCta', { town: title ?? slug })}
      </Button>
    </Space>
  );
};
