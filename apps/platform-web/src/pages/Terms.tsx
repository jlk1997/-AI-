/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hosting agreement. Three questions actually matter to someone publishing
 * here — who owns what they generated, what the platform is allowed to do with
 * it, and what happens when someone remixes it — so those are the first three
 * sections and they are written in the same plain language as the product.
 *
 * The text lives here rather than in the i18n dictionary because a legal
 * document read as a whole should not be assembled from forty separate keys.
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
  title: '用户协议与托管条款',
  updated: '最近更新：2025 年',
  intro:
    '在 AI隔壁世界引擎上生成、发布或游玩作品，即表示你同意以下条款。我们尽量写得像人话，如果哪一条你看不懂，那是我们的问题，欢迎来问。',
  sections: [
    {
      heading: '一、你生成的东西归你',
      paragraphs: [
        '你用 AI隔壁世界引擎生成的游戏、世界、美术与代码，著作权归你本人（或你所属的组织）所有。平台不主张所有权，也不会把它转卖给第三方。',
        '你需要保证提交的提示词与素材不侵犯他人权利，不含违法内容。这一条是你对平台和其他创作者的承诺。',
      ],
    },
    {
      heading: '二、你授权我们托管与展示',
      paragraphs: [
        '发布作品时，你授予平台一项非独占、可撤回、全球范围的许可，用于存储、编译、分发与展示你的作品，以及生成封面、分享卡与推荐位所需的缩略图。',
        '这项许可只为让别人能玩到你的作品而存在。你随时可以把作品改为私有或删除，我们会停止对外分发；已经缓存在 CDN 上的副本会在缓存过期后失效。',
        '玩家拿到的始终是编译后的托管播放包，工作区源码不会下发给玩家。',
      ],
    },
    {
      heading: '三、改编（Remix）与分成',
      paragraphs: [
        '每个作品都带一个改编许可：允许改编、需署名改编、不允许改编。改编只能在平台内进行——服务端复制一份私有工作区，改编者从头到尾看不到你的源码。',
        '当有人改编你的作品并继续生成时，其消耗点数中的一部分会按平台公布的比例进入你的钱包。这是我们希望你愿意开放改编的理由：被改比被藏更有价值。',
        '标注“不允许改编”的作品，fork 接口会直接拒绝。',
      ],
    },
    {
      heading: '四、点数、订阅与退款',
      paragraphs: [
        '生成消耗点数。点数可以通过订阅按月发放，也可以单独购买。点数用于兑换算力，不是法定货币，不可提现、不计息。',
        '已消耗的点数不退。未使用的点数在账户存续期间有效；若因平台原因导致生成失败，我们会把点数退回你的钱包，并在账本中留下记录。',
      ],
    },
    {
      heading: '五、社区规则与下架',
      paragraphs: [
        '禁止发布侵权、违法、含成人内容或恶意代码的作品。任何人都可以举报，运营会逐条处理。',
        '被判定违规的作品会被下架：作品从社区隐藏、播放会话停止签发，但你的项目与源码仍然保留在你的账户里。如果你认为判断有误，可以申诉，恢复是可逆的。',
      ],
    },
    {
      heading: '六、我们不承诺什么',
      paragraphs: [
        '我们不承诺网页游戏“无法被破解”。我们做的是：源码不下发、播放走短时会话、产物带水印与指纹、盗用可追溯可下架。这是能诚实做到的部分。',
        '服务按“现状”提供。我们会尽力保持可用，但不对生成结果的商业价值作出保证。',
      ],
    },
  ],
};

const EN: Document = {
  title: 'Terms of Service and Hosting Agreement',
  updated: 'Last updated: 2025',
  intro:
    'By generating, publishing or playing work on Gebi (AI隔壁世界引擎) you agree to what follows. We have tried to write it in the same plain language as the product; if a clause is unclear, that is our fault and we would like to hear about it.',
  sections: [
    {
      heading: '1. What you generate is yours',
      paragraphs: [
        'The games, worlds, art and code you generate on Gebi belong to you (or to your organization). The platform claims no ownership and does not resell your work.',
        'In return you warrant that the prompts and assets you submit do not infringe anyone else’s rights and are not unlawful. That promise is made to us and to every other creator here.',
      ],
    },
    {
      heading: '2. You license us to host and show it',
      paragraphs: [
        'When you publish, you grant the platform a non-exclusive, revocable, worldwide licence to store, build, distribute and display your work, including the thumbnails and share cards needed to show it to other people.',
        'That licence exists only so others can play what you made. You may make a work private or delete it at any time and we stop distributing it; copies already cached at a CDN expire with the cache.',
        'Players always receive a compiled, hosted play bundle. Your workspace source is never delivered to a player.',
      ],
    },
    {
      heading: '3. Remixing and revenue share',
      paragraphs: [
        'Every work carries a remix licence: open to remix, remix with credit, or no remixing. A remix happens inside the platform — the server copies a private workspace, and the person remixing never sees your source.',
        'When someone remixes your work and keeps generating, a published share of the points they spend lands in your wallet. That is the reason we would rather you open a work up than hide it: being remixed should pay better than being locked.',
        'For a work marked "no remixing", the fork endpoint simply refuses.',
      ],
    },
    {
      heading: '4. Points, plans and refunds',
      paragraphs: [
        'Generation costs points. Points arrive monthly with a plan or can be bought outright. They buy compute; they are not money, cannot be cashed out and earn no interest.',
        'Spent points are not refundable. Unused points remain valid while the account exists. If a generation fails for reasons on our side, we return the points to your wallet and leave a line in the ledger saying so.',
      ],
    },
    {
      heading: '5. Community rules and takedowns',
      paragraphs: [
        'Do not publish work that infringes, breaks the law, contains adult material, or ships malicious code. Anyone can report a work, and a curator decides on each report.',
        'An upheld report takes the work down: it is hidden from the community and play sessions stop being issued, but your project and source stay in your account. Takedowns are reversible, so an appeal can undo one.',
      ],
    },
    {
      heading: '6. What we do not promise',
      paragraphs: [
        'We do not claim a web game can be made impossible to copy. What we do is real and limited: source is never shipped, playback runs through short-lived sessions, bundles carry a watermark and a fingerprint, and theft can be traced and taken down.',
        'The service is provided as-is. We work to keep it up, but we make no promise about the commercial value of anything generated with it.',
      ],
    },
  ],
};

export default function TermsPage(): React.ReactElement {
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
