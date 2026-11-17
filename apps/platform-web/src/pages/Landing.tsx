/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { BrandLockup } from '../brand/BrandMark';
import { api, get, TOKEN_KEY, type WorldActivityItem } from '../services/api';
import { useT } from '../services/i18n';
import { rememberLoginReturnTo } from '../utils/loginIntent';
import { buildLandingPreview, type LandingLine } from './landingPreview';
import '../styles/landing.css';

function signedIn(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export function Landing(): React.ReactElement {
  const { t } = useT();
  const navigate = useNavigate();
  const [lines, setLines] = useState<LandingLine[]>([]);
  const [residents, setResidents] = useState<number | null>(null);
  const [townTitle, setTownTitle] = useState<string | null>(null);
  const [towns, setTowns] = useState<Array<{ id: string; slug: string; title: string }>>([]);
  const [games, setGames] = useState<Array<{ id: string; slug: string; title: string }>>([]);
  const icp = import.meta.env.VITE_ICP_NUMBER?.trim();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [activity, featured] = await Promise.all([
        api.community.worldActivity(6).catch(() => ({ items: [] as WorldActivityItem[] })),
        api.community.getFeaturedGames().catch(() => ({ games: [] as Array<Record<string, string>> })),
      ]);
      if (cancelled) return;
      const items = activity.items ?? [];
      setLines(
        items.map((item) => ({
          speaker: item.speakerName || item.title,
          text: item.line,
          town: item.title,
        })),
      );
      const first = items[0];
      setTownTitle(first?.title ?? null);
      if (first?.gameId) {
        const snap = await get<{ agents?: unknown[] }>(
          `/community/games/${first.gameId}/society/snapshot`,
        ).catch(() => null);
        if (!cancelled && snap && Array.isArray(snap.agents)) setResidents(snap.agents.length);
      }
      const cards = (featured.games ?? []) as Array<{ id: string; slug: string; title: string; category?: string }>;
      setTowns(cards.filter((card) => card.category === 'world').slice(0, 3));
      setGames(cards.filter((card) => card.category !== 'world').slice(0, 3));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = buildLandingPreview({ lines, residents, townTitle });

  const start = (mode: 'world' | 'game'): void => {
    const target = `/?mode=${mode}`;
    if (!signedIn()) {
      rememberLoginReturnTo(target);
      navigate('/login');
      return;
    }
    navigate(target);
  };

  return (
    <div className="og-landing">
      <nav className="og-landing__nav">
        <BrandLockup variant="full" />
        <div className="og-landing__links">
          <a href="#towns">{t('landing.nav.towns')}</a>
          <Link to="/community?kind=game">{t('landing.nav.games')}</Link>
        </div>
        {signedIn() ? (
          <Link to="/profile">{t('landing.nav.me')}</Link>
        ) : (
          <Link to="/login">{t('nav.signIn')}</Link>
        )}
        <Button type="primary" onClick={() => start('world')}>
          {t('landing.cta.create')}
        </Button>
      </nav>

      <header className="og-landing__hero">
        <div>
          <div className="og-landing__kicker">{t('landing.kicker')}</div>
          <h1>{t('landing.hero.title')}</h1>
          <p className="og-landing__lede">{t('landing.hero.lede')}</p>
          <div className="og-landing__actions">
            <Button type="primary" size="large" onClick={() => start('world')}>
              {t('landing.cta.free')}
            </Button>
            <Button size="large" href="#towns">
              {t('landing.cta.browse')}
            </Button>
          </div>
        </div>
        <aside className="og-landing__card" aria-label={t('landing.preview.label')}>
          <div className="og-landing__card-top">
            <span>{preview.townTitle ?? t('landing.preview.sampleTown')}</span>
            <span className="og-landing__badge">
              {preview.mode === 'sample'
                ? t('landing.preview.sample')
                : t('landing.preview.residents', { count: preview.residents ?? 0 })}
            </span>
          </div>
          {preview.lines.map((line) => (
            <div className="og-landing__line" key={`${line.speaker}-${line.text}`}>
              <strong>{line.speaker}</strong>
              <span>{line.text}</span>
            </div>
          ))}
        </aside>
      </header>

      <section className="og-landing__section">
        <h2>{t('landing.can.title')}</h2>
        <p className="og-landing__lede">{t('landing.can.lede')}</p>
        <div className="og-landing__grid">
          {(['watch', 'forecast', 'edit'] as const).map((id) => (
            <article className="og-landing__card" key={id}>
              <h3>{t(`landing.can.${id}.title`)}</h3>
              <p>{t(`landing.can.${id}.body`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="og-landing__section">
        <h2>{t('landing.steps.title')}</h2>
        <div className="og-landing__steps">
          {(['1', '2', '3'] as const).map((id) => (
            <article className="og-landing__card" key={id}>
              <div className="og-landing__step">{id}</div>
              <h3>{t(`landing.step.${id}.title`)}</h3>
              <p>{t(`landing.step.${id}.body`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="og-landing__section" id="towns">
        <h2>{t('landing.towns.title')}</h2>
        <p className="og-landing__lede">{t('landing.towns.lede')}</p>
        {towns.length > 0 ? (
          <div className="og-landing__towns">
            {towns.map((town) => (
              <Link className="og-landing__town" key={town.id} to={`/community/game/${town.slug}`}>
                <strong>{town.title}</strong>
              </Link>
            ))}
          </div>
        ) : (
          <Button type="primary" onClick={() => start('world')}>
            {t('landing.towns.empty')}
          </Button>
        )}
      </section>

      <section className="og-landing__section" id="games">
        <h2>{t('landing.games.title')}</h2>
        <p className="og-landing__lede">{t('landing.games.lede')}</p>
        {games.length > 0 ? (
          <div className="og-landing__games">
            {games.map((game) => (
              <Link className="og-landing__game" key={game.id} to={`/play/${game.slug}`}>
                <strong>{game.title}</strong>
              </Link>
            ))}
          </div>
        ) : null}
        <Button style={{ marginTop: 16 }} onClick={() => start('game')}>
          {t('landing.games.cta')}
        </Button>
      </section>

      <section className="og-landing__section og-landing__faq">
        <h2>{t('landing.faq.title')}</h2>
        {(['cost', 'time', 'real', 'public'] as const).map((id) => (
          <details key={id}>
            <summary>{t(`landing.faq.${id}.q`)}</summary>
            <p>{t(`landing.faq.${id}.a`)}</p>
          </details>
        ))}
      </section>

      <footer className="og-landing__footer">
        <span>{t('app.brand')}</span>
        <span>
          <Link to="/terms">{t('terms.title')}</Link>
          {' · '}
          <Link to="/privacy">{t('privacy.title')}</Link>
          {icp ? ` · ${icp}` : null}
        </span>
      </footer>
    </div>
  );
}
