/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Modal, message } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';

import { useT } from '../../services/i18n';
import { courseShareActKey, shareCourseBoard } from './courseShare';
import { CourseSharePoster } from './CourseSharePoster';
import { trackCourseEvent } from './courseTelemetry';

export const CourseShareButton: React.FC<{
  readonly title: string;
  readonly slugOrId: string;
  readonly prompt: string;
  readonly pool?: number;
  readonly status?: string;
  readonly bettingClosesAt?: string;
  readonly canon?: string | null;
  readonly contested?: boolean;
  readonly myStakeLabel?: string | null;
  readonly size?: 'small' | 'middle';
  readonly block?: boolean;
  readonly withPoster?: boolean;
}> = ({
  title,
  slugOrId,
  prompt,
  pool,
  status,
  bettingClosesAt,
  canon,
  contested,
  myStakeLabel,
  size = 'small',
  block = false,
  withPoster = false,
}) => {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);

  const actKey =
    status && bettingClosesAt
      ? courseShareActKey({ status, bettingClosesAt })
      : null;

  const runShare = (): void => {
    setBusy(true);
    void shareCourseBoard({
      title,
      slugOrId,
      prompt,
      pool,
      canon,
      actKey,
      myStakeLabel,
      t,
    })
      .then((result) => {
        trackCourseEvent('course_share', {
          result,
          slug: slugOrId,
          poster: withPoster,
        });
        if (result === 'shared') {
          message.success(t('product.obs.course.share.ok'));
          setPosterOpen(false);
        } else if (result === 'copied') {
          message.success(t('product.obs.course.share.copied'));
          setPosterOpen(false);
        } else {
          message.warning(t('product.obs.course.share.fail'));
        }
      })
      .finally(() => setBusy(false));
  };

  const onClick = (): void => {
    if (withPoster) {
      setPosterOpen(true);
      return;
    }
    runShare();
  };

  return (
    <>
      <Button
        size={size}
        block={block}
        icon={<ShareAltOutlined />}
        loading={busy}
        onClick={onClick}
      >
        {t('product.obs.course.share.cta')}
      </Button>
      {withPoster ? (
        <Modal
          open={posterOpen}
          title={t('product.obs.course.share.posterTitle')}
          onCancel={() => setPosterOpen(false)}
          footer={[
            <Button key="cancel" onClick={() => setPosterOpen(false)}>
              {t('product.obs.course.share.posterClose')}
            </Button>,
            <Button
              key="share"
              type="primary"
              loading={busy}
              icon={<ShareAltOutlined />}
              onClick={runShare}
            >
              {t('product.obs.course.share.cta')}
            </Button>,
          ]}
        >
          <CourseSharePoster
            title={title}
            prompt={prompt}
            pool={pool}
            actKey={actKey}
            canon={canon}
            contested={contested}
            bettingClosesAt={bettingClosesAt}
            myStakeLabel={myStakeLabel}
          />
        </Modal>
      ) : null}
    </>
  );
};
