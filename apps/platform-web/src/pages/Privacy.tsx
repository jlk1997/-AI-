/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Privacy notice. Whole document, not forty i18n keys — same rule as Terms.
 */

import { useNavigate } from 'react-router-dom';
import { Button, Card, Divider, Typography } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

import { useT } from '../services/i18n';

const { Title, Paragraph, Text } = Typography;

interface Section {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

interface Document {
  readonly title: string;
  readonly updated: string;
  readonly intro: string;
  readonly sections: readonly Section[];
}

const ZH: Document = {
  title: '隐私政策',
  updated: '最近更新：2026 年 8 月',
  intro:
    '隔壁（AI隔壁世界引擎 / Gebi）会收集让你登录、生成、发布和围观所必需的信息。下面写的是我们实际做的事，不是法务套话。公司主体与投诉邮箱由运营在上线当日填入。',
  sections: [
    {
      heading: '一、我们收集什么',
      paragraphs: [
        '登录：邮箱、微信 openid / unionid，或手机号（仅在开通短信时）。',
        '创作：你提交的提示词、生成的游戏与世界、封面与分享卡。',
        '游玩：短时播放会话、今晚巷口计次、你主动写的评论与举报。',
        '账本：点数进出、订单号。点数不是法定货币，不能提现。',
      ],
    },
    {
      heading: '二、存在哪里、给谁',
      paragraphs: [
        '账户与账本在我们的数据库；工作区与预览包在对象存储。',
        '生成会把提示词发给模型供应商（例如 MiniMax）。我们不把你的源码发给玩家。',
        '支付回调只用于入账。商户密钥不在本页，也不写进前端。',
        '账户资料在你关闭账户后匿名化；会话吊销约 16 天。账本哈希与下架记录会留更久，用于反欺诈与申诉。对象存储里的预览包随下架停止对外分发。',
      ],
    },
    {
      heading: '三、你的权利',
      paragraphs: [
        '你可以导出自己的资料、作品列表和账本摘要（不含别人的耳语全文）。',
        '你可以关闭账户：公开作品下架、登录失效。账本哈希会留存一段时间，用于反欺诈。',
        '发布需要你勾选同意本政策与用户协议，并填写出生年。未满约定年龄不能公开发布。',
      ],
    },
    {
      heading: '四、投诉',
      paragraphs: [
        '中国：按个人信息保护法行使权利。海外：按 GDPR / CCPA 向我们提出查阅、更正、删除。',
        '投诉渠道与公司主体由运营填写。在此之前，请通过站点内举报或登录邮箱联系。',
      ],
    },
  ],
};

const EN: Document = {
  title: 'Privacy Policy',
  updated: 'Last updated: August 2026',
  intro:
    'Gebi (AI隔壁世界引擎) collects only what is needed to sign in, generate, publish and watch. This is what the product actually does. The legal entity and complaint address are filled in by the operator on launch day.',
  sections: [
    {
      heading: '1. What we collect',
      paragraphs: [
        'Sign-in: email, WeChat openid / unionid, or a phone number when SMS is enabled.',
        'Creation: prompts you submit, generated games and worlds, covers and share cards.',
        'Play: short-lived play sessions, tonight-at-the-alley counts, comments and reports you write.',
        'Ledger: point movements and order ids. Points are not money and cannot be cashed out.',
      ],
    },
    {
      heading: '2. Where it lives, and who sees it',
      paragraphs: [
        'Accounts and the ledger sit in our database; workspaces and preview packs sit in object storage.',
        'Generation sends prompts to a model vendor (for example MiniMax). Player builds never include your source.',
        'Payment callbacks exist only to credit an order. Merchant keys are not on this page and never ship to the browser.',
        'Closing an account anonymizes the profile. Sign-in revocation lasts about 16 days. Ledger hashes and takedown records stay longer for fraud review and appeals. Preview packs stop being served once a work is taken down.',
      ],
    },
    {
      heading: '3. Your rights',
      paragraphs: [
        'You can export your profile, works list and a ledger summary (not other people\'s whispers).',
        'You can close the account: public works come down and sessions stop. A hashed ledger trail is kept for fraud disputes.',
        'Publishing requires accepting these terms and a birth year. Below the age floor, work stays private.',
      ],
    },
    {
      heading: '4. Complaints',
      paragraphs: [
        'In China: PIPL access, correction and deletion. Overseas: GDPR / CCPA requests to the same product.',
        'The operator fills in the legal entity and mailbox on launch day. Until then, use in-product reports or the sign-in email.',
      ],
    },
  ],
};

export default function PrivacyPage(): React.ReactElement {
  const navigate = useNavigate();
  const { locale, t } = useT();
  const doc = locale === 'zh-CN' ? ZH : EN;

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto', overflow: 'auto' }}>
      <Card>
        <Title level={3} style={{ marginTop: 0 }}>
          {doc.title}
        </Title>
        <Text type="secondary">{doc.updated}</Text>
        <Paragraph style={{ marginTop: 16 }}>{doc.intro}</Paragraph>
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <Divider />
            <Title level={5}>{section.heading}</Title>
            {section.paragraphs.map((text) => (
              <Paragraph key={text.slice(0, 24)}>{text}</Paragraph>
            ))}
          </section>
        ))}
        <Divider />
        <Button icon={<HomeOutlined />} onClick={() => navigate('/community')}>
          {t('common.home')}
        </Button>
      </Card>
    </div>
  );
}
