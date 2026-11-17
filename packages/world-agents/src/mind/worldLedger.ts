/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * What is true in the town after an action settles: money, health, custody,
 * supplies, organizations, and whether a district is closed.
 */

export type Injury =
  | 'ok'
  | 'light'
  | 'serious'
  | 'disabled'
  | 'dead'
  | 'missing';

export type PersonLedger = {
  readonly agentId: string;
  readonly money: number;
  readonly job: string;
  readonly home: string;
  readonly items: readonly string[];
  readonly reputation: number;
  readonly facts: readonly string[];
  readonly injury: Injury;
  readonly custody: 'free' | 'detained' | 'arrested';
  readonly gear: readonly string[];
};

export type DistrictState = {
  readonly regionId: string;
  readonly control: string;
  readonly lockdown: 'open' | 'curfew' | 'closed' | 'exclusion';
  readonly power: boolean;
  readonly road: boolean;
  readonly net: boolean;
  readonly hospitalBeds: number;
};

export type OrgStock = {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
  readonly food: number;
  readonly fuel: number;
  readonly medicine: number;
  readonly cash: number;
};

export type WorldLedger = {
  readonly people: Readonly<Record<string, PersonLedger>>;
  readonly districts: Readonly<Record<string, DistrictState>>;
  readonly orgs: Readonly<Record<string, OrgStock>>;
  readonly prices: Readonly<Record<string, number>>;
  readonly facts: readonly string[];
};

export function emptyLedger(): WorldLedger {
  return { people: {}, districts: {}, orgs: {}, prices: { food: 1, fuel: 1 }, facts: [] };
}

export function ensurePerson(
  ledger: WorldLedger,
  agentId: string,
  seed?: Partial<PersonLedger>,
): WorldLedger {
  if (ledger.people[agentId]) return ledger;
  const person: PersonLedger = {
    agentId,
    money: seed?.money ?? 100,
    job: seed?.job ?? '',
    home: seed?.home ?? '',
    items: seed?.items ?? [],
    reputation: seed?.reputation ?? 0,
    facts: seed?.facts ?? [],
    injury: seed?.injury ?? 'ok',
    custody: seed?.custody ?? 'free',
    gear: seed?.gear ?? [],
  };
  return { ...ledger, people: { ...ledger.people, [agentId]: person } };
}

export type LedgerPatch = {
  readonly person?: {
    readonly agentId: string;
    readonly moneyDelta?: number;
    readonly job?: string;
    readonly home?: string;
    readonly injury?: Injury;
    readonly custody?: PersonLedger['custody'];
    readonly fact?: string;
    readonly gearAdd?: string;
  };
  readonly district?: Partial<DistrictState> & { readonly regionId: string };
  readonly price?: { readonly key: string; readonly value: number };
  readonly fact?: string;
  readonly org?: Partial<OrgStock> & { readonly id: string; readonly name?: string };
};

const WORSE: Record<Injury, number> = {
  ok: 0,
  light: 1,
  serious: 2,
  disabled: 3,
  missing: 3,
  dead: 4,
};

export function applyLedger(ledger: WorldLedger, patch: LedgerPatch): WorldLedger {
  let next = ledger;
  if (patch.person) {
    next = ensurePerson(next, patch.person.agentId);
    const prev = next.people[patch.person.agentId]!;
    const injury =
      patch.person.injury && WORSE[patch.person.injury] >= WORSE[prev.injury]
        ? patch.person.injury
        : prev.injury;
    const person: PersonLedger = {
      ...prev,
      money: Math.max(0, prev.money + (patch.person.moneyDelta ?? 0)),
      job: patch.person.job ?? prev.job,
      home: patch.person.home ?? prev.home,
      injury,
      custody: patch.person.custody ?? prev.custody,
      facts: patch.person.fact
        ? [...prev.facts, patch.person.fact].slice(-12)
        : prev.facts,
      gear: patch.person.gearAdd
        ? [...prev.gear, patch.person.gearAdd].slice(-6)
        : prev.gear,
    };
    next = { ...next, people: { ...next.people, [person.agentId]: person } };
  }
  if (patch.district) {
    const prev = next.districts[patch.district.regionId] ?? {
      regionId: patch.district.regionId,
      control: '日常',
      lockdown: 'open' as const,
      power: true,
      road: true,
      net: true,
      hospitalBeds: 20,
    };
    next = {
      ...next,
      districts: {
        ...next.districts,
        [patch.district.regionId]: { ...prev, ...patch.district },
      },
    };
  }
  if (patch.price) {
    next = {
      ...next,
      prices: { ...next.prices, [patch.price.key]: Math.max(0.1, patch.price.value) },
    };
  }
  if (patch.fact) {
    next = { ...next, facts: [...next.facts, patch.fact].slice(-40) };
  }
  if (patch.org) {
    const prev = next.orgs[patch.org.id] ?? {
      id: patch.org.id,
      name: patch.org.name ?? patch.org.id,
      members: [],
      food: 10,
      fuel: 10,
      medicine: 4,
      cash: 100,
    };
    next = {
      ...next,
      orgs: { ...next.orgs, [patch.org.id]: { ...prev, ...patch.org, id: patch.org.id } },
    };
  }
  return next;
}

export function countInjuries(ledger: WorldLedger): {
  readonly light: number;
  readonly serious: number;
  readonly dead: number;
  readonly detained: number;
} {
  let light = 0;
  let serious = 0;
  let dead = 0;
  let detained = 0;
  for (const person of Object.values(ledger.people)) {
    if (person.injury === 'light') light += 1;
    if (person.injury === 'serious' || person.injury === 'disabled') serious += 1;
    if (person.injury === 'dead') dead += 1;
    if (person.custody !== 'free') detained += 1;
  }
  return { light, serious, dead, detained };
}
