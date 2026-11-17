/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-create guide for society worlds. Three plain steps: people, places,
 * kind of days. Inspiration chips only fill the form — they are not a town.
 */

import React from 'react';
import { Input } from 'antd';
import { ART_STYLES, type ArtStyleId } from '@opengame/world-spec';

import { getLocale, useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import {
  toggleVenue,
  venuesForPack,
  withPack,
  withTownCast,
  withUseCase,
  WORLD_CAST_EXAMPLES,
  worldNotePreview,
} from './composeWorldBrief';
import {
  WORLD_LIVED_IN_IDS,
  WORLD_PACK_ID_LIST,
  WORLD_SCALE_IDS,
  WORLD_USE_CASE_ID_LIST,
  townExtrasOf,
  worldPopulationOf,
  type WorldCreatePrefs,
  type WorldLivedInId,
  type WorldPackId,
  type WorldScaleId,
  type WorldUseCaseId,
  type WorldVenueId,
} from './worldCreatePrefs';

interface WorldCreateGuideProps {
  readonly value: WorldCreatePrefs;
  readonly onChange: (next: WorldCreatePrefs) => void;
  readonly disabled?: boolean;
}

function Chip(props: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className={`og-world-chip${props.active ? ' is-on' : ''}`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function Step(props: {
  readonly n: string;
  readonly title: string;
  readonly hint: string;
  readonly need?: boolean;
  readonly extra?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={`og-world-brief__step${props.need ? ' is-need' : ''}`}>
      <div className="og-world-brief__step-head">
        <div>
          <p className="og-world-brief__kicker">{props.n}</p>
          <h3 className="og-world-brief__title">{props.title}</h3>
        </div>
        {props.extra}
      </div>
      <p className="og-world-brief__hint">{props.hint}</p>
      {props.children}
    </section>
  );
}

export const WorldCreateGuide: React.FC<WorldCreateGuideProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { t } = useT();
  const join = t('world.create.castJoin');
  const locale = getLocale() === 'en' ? 'en' : 'zh';
  const missingPeople = !value.castA.trim() && !value.castB.trim() && !value.note.trim();

  const patchCast = (partial: Partial<Pick<WorldCreatePrefs, 'castA' | 'castB' | 'rumor'>>) =>
    onChange(
      withTownCast(
        value,
        {
          castA: partial.castA ?? value.castA,
          castB: partial.castB ?? value.castB,
          rumor: partial.rumor ?? value.rumor,
        },
        join,
      ),
    );

  const pickArt = (artStyleId: ArtStyleId) => onChange({ ...value, artStyleId });
  const pickScale = (scale: WorldScaleId) => onChange({ ...value, scale });
  const pickLivedIn = (livedIn: WorldLivedInId) => onChange({ ...value, livedIn });
  const pickPack = (packId: WorldPackId) => onChange(withPack(value, packId));
  const pickUseCase = (useCase: WorldUseCaseId) => onChange(withUseCase(value, useCase));
  const pickVenue = (id: WorldVenueId) => onChange(toggleVenue(value, id));
  const fillExample = () =>
    onChange(withTownCast(value, WORLD_CAST_EXAMPLES[value.packId][locale], join));

  const venueNames = value.venues
    .map((id) => t(`world.create.venue.${id}`))
    .join(t('world.create.venueJoin'));
  const notePreview = worldNotePreview(value.note, t('world.create.noteEmpty'));

  return (
    <div className="og-world-brief">
      <Step
        n={t('world.create.step1')}
        title={t('world.create.note')}
        hint={t('world.create.noteHint')}
        need={missingPeople}
        extra={
          <button
            type="button"
            className="og-world-brief__fill"
            disabled={disabled}
            onClick={fillExample}
          >
            {t('world.create.fillExample')}
          </button>
        }
      >
        <div className="og-world-brief__pair">
          <label className="og-world-field">
            <span>{t('world.create.castA')}</span>
            <Input
              value={value.castA}
              disabled={disabled}
              maxLength={32}
              placeholder={t(`world.create.castAPh.${value.packId}`)}
              onChange={(e) => patchCast({ castA: e.target.value })}
            />
          </label>
          <label className="og-world-field">
            <span>{t('world.create.castB')}</span>
            <Input
              value={value.castB}
              disabled={disabled}
              maxLength={32}
              placeholder={t(`world.create.castBPh.${value.packId}`)}
              onChange={(e) => patchCast({ castB: e.target.value })}
            />
          </label>
        </div>
        <label className="og-world-field">
          <span>{t('world.create.rumor')}</span>
          <Input.TextArea
            value={value.rumor}
            disabled={disabled}
            maxLength={160}
            autoSize={{ minRows: 2, maxRows: 3 }}
            placeholder={t(`world.create.rumorPh.${value.packId}`)}
            onChange={(e) => patchCast({ rumor: e.target.value })}
          />
        </label>
        {missingPeople ? (
          <p className="og-world-brief__warn">{t('world.create.needNames')}</p>
        ) : null}
      </Step>

      <Step n={t('world.create.step2')} title={t('world.create.venues')} hint={t('world.create.venuesHint')}>
        <div className="og-world-chip-row">
          {venuesForPack(value.packId).map((v) => (
            <Chip
              key={v.id}
              active={value.venues.includes(v.id)}
              disabled={disabled}
              label={t(`world.create.venue.${v.id}`)}
              onClick={() => pickVenue(v.id)}
            />
          ))}
        </div>
      </Step>

      <Step n={t('world.create.step3')} title={t('world.create.pack')} hint={t('world.create.packHint')}>
        <div className="og-world-chip-row">
          {WORLD_PACK_ID_LIST.map((id) => (
            <Chip
              key={id}
              active={value.packId === id}
              disabled={disabled}
              label={t(`world.create.pack.${id}`)}
              onClick={() => pickPack(id)}
            />
          ))}
        </div>
        <p className="og-world-brief__sub">{t('world.create.useCase')}</p>
        <p className="og-world-brief__hint">{t('world.create.useCaseHint')}</p>
        <div className="og-world-chip-row">
          {WORLD_USE_CASE_ID_LIST.map((id) => (
            <Chip
              key={`use-${id}`}
              active={value.useCase === id}
              disabled={disabled}
              label={t(`world.create.useCase.${id}`)}
              onClick={() => pickUseCase(id)}
            />
          ))}
        </div>
      </Step>

      <details className="og-world-brief__more">
        <summary>{t('world.create.moreContract')}</summary>
        <p className="og-world-brief__sub">{t('world.create.scale')}</p>
        <p className="og-world-brief__hint">{t('world.create.scaleHint')}</p>
        <div className="og-world-chip-row">
          {(featureFlags.demoOpenWorld
            ? ([...WORLD_SCALE_IDS, 'large', 'city'] as const)
            : WORLD_SCALE_IDS
          ).map((id) => (
            <Chip
              key={id}
              active={value.scale === id}
              disabled={disabled}
              label={t(`world.create.scale.${id}`)}
              onClick={() => pickScale(id)}
            />
          ))}
        </div>
        <p className="og-world-brief__hint">
          {t('world.create.scaleExplain', {
            extras: townExtrasOf(value),
            total: worldPopulationOf(value),
          })}
        </p>
        <p className="og-world-brief__sub">{t('world.create.livedIn')}</p>
        <div className="og-world-chip-row">
          {WORLD_LIVED_IN_IDS.map((id) => (
            <Chip
              key={id}
              active={value.livedIn === id}
              disabled={disabled}
              label={t(`world.create.livedIn.${id}`)}
              onClick={() => pickLivedIn(id)}
            />
          ))}
        </div>
        <p className="og-world-brief__sub">{t('world.create.art')}</p>
        <p className="og-world-brief__hint">{t(`intake.art.${value.artStyleId}.desc`)}</p>
        <div className="og-world-chip-row">
          {ART_STYLES.map((style) => (
            <Chip
              key={style.id}
              active={value.artStyleId === style.id}
              disabled={disabled}
              label={t(`intake.art.${style.id}`)}
              onClick={() => pickArt(style.id)}
            />
          ))}
        </div>
      </details>

      <p className="og-world-brief__summary">
        {t('world.create.summary', {
          note: notePreview,
          art: t(`intake.art.${value.artStyleId}`),
          scale: t(`world.create.scale.${value.scale}`),
          livedIn: t(`world.create.livedIn.${value.livedIn}`),
          pack: t(`world.create.pack.${value.packId}`),
          useCase: t(`world.create.useCase.${value.useCase}`),
          venues: venueNames,
        })}
      </p>
      {featureFlags.courseUxV2 ? (
        <p className="og-world-brief__engine">
          {t('world.create.engineNote', {
            engine: t(
              featureFlags.hasLlmKey
                ? 'world.create.engine.llm'
                : 'world.create.engine.heuristic',
            ),
            hint: t(
              featureFlags.hasLlmKey
                ? 'world.create.engineHint.llm'
                : 'world.create.engineHint.heuristic',
            ),
          })}
        </p>
      ) : null}
    </div>
  );
};
