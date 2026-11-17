/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { Inventory } from './inventory.js';
import { createActorStats, gainXp } from './growth.js';
import { QuestDag } from './questDag.js';
import { TurnCombat } from './combat.js';
import { craft, Shop } from './economy.js';

describe('module-systems', () => {
  it('inventory and shop', () => {
    const inv = new Inventory();
    const shop = new Shop([{ id: 'ore', name: 'Ore', price: 10 }], 100);
    expect(shop.buy('ore', inv, 2)).toBe(true);
    expect(inv.count('ore')).toBe(2);
    expect(shop.gold).toBe(80);
  });

  it('levels up', () => {
    const s = createActorStats();
    const { leveled } = gainXp(s, 1000);
    expect(leveled).toBeGreaterThan(0);
    expect(s.level).toBeGreaterThan(1);
  });

  it('quest dag unlocks', () => {
    const dag = new QuestDag([
      { id: 'q1', title: 'First', requires: [], status: 'locked' },
      { id: 'q2', title: 'Second', requires: ['q1'], status: 'locked' },
    ]);
    expect(dag.get('q1')?.status).toBe('available');
    dag.start('q1');
    dag.complete('q1');
    expect(dag.get('q2')?.status).toBe('available');
  });

  it('turn combat resolves', () => {
    const battle = new TurnCombat(
      [{ id: 'p', name: 'Hero', hp: 20, maxHp: 20, atk: 5, gauge: 0, speed: 40, statuses: [] }],
      [{ id: 'e', name: 'Wolf', hp: 10, maxHp: 10, atk: 2, gauge: 0, speed: 20, statuses: [] }],
    );
    for (let i = 0; i < 20 && battle.outcome() === 'ongoing'; i++) {
      const actor = battle.tickGauges();
      if (!actor) break;
      const target =
        actor.id === 'p' ? battle.enemies[0]! : battle.allies[0]!;
      battle.applyAction(actor, { kind: 'attack', targetId: target.id });
    }
    expect(battle.outcome()).toBe('win');
  });

  it('crafts', () => {
    const inv = new Inventory();
    inv.add('ore', 2);
    inv.add('herb', 1);
    expect(
      craft(
        {
          id: 'potion',
          inputs: [
            { itemId: 'ore', qty: 1 },
            { itemId: 'herb', qty: 1 },
          ],
          output: { itemId: 'potion', qty: 1 },
        },
        inv,
      ),
    ).toBe(true);
    expect(inv.count('potion')).toBe(1);
  });
});
