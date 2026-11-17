/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_BUBBLE_TIERS,
  AGENT_SPRITE_HEIGHT_TILES,
  agentChromeLift,
  agentLabelText,
  agentSpriteHeight,
  chromeClusterSlot,
  chromeRectsOverlap,
  crowdSpreadOffset,
  shouldDrawTalkArc,
  shouldFollowSpeech,
  shouldShowObjectLabel,
  chromeOriginBottomRect,
  nameplateDepth,
  shouldHideNameUnderSpeech,
  speechBubbleBgDepth,
  speechBubbleTextDepth,
  talkArcDepth,
  isSharedNpcAsset,
  minimapBox,
  minimapDockForFollow,
  preferUniquePortraitFile,
  regionNavAlpha,
  speechFocusPoint,
} from '../scaffold/src/ui/agentChrome';

describe('agentChromeLift', () => {
  it('places name and bubble above the sprite body', () => {
    const tileSize = 48;
    const by = 400;
    const spriteHeight = agentSpriteHeight(tileSize);
    const lift = agentChromeLift(tileSize);
    const bodyTop = by - spriteHeight;
    expect(spriteHeight).toBe(tileSize * AGENT_SPRITE_HEIGHT_TILES);
    expect(by - lift.nameLift).toBeLessThan(bodyTop);
    expect(by - lift.bubbleLift(0)).toBeLessThan(bodyTop);
    expect(by - lift.bubbleLift(0)).toBeLessThan(by - lift.nameLift);
  });

  it('staggers neighbour bubbles without dropping into the body', () => {
    const tileSize = 32;
    const by = 200;
    const bodyTop = by - agentSpriteHeight(tileSize);
    const lift = agentChromeLift(tileSize);
    expect(by - lift.bubbleLift(2)).toBeLessThan(by - lift.bubbleLift(0));
    expect(by - lift.bubbleLift(2)).toBeLessThan(bodyTop);
    expect(lift.bubbleLift(3)).not.toBe(lift.bubbleLift(0));
    expect(lift.bubbleLift(AGENT_BUBBLE_TIERS)).toBe(lift.bubbleLift(0));
  });

  it('still clears a short portrait sprite', () => {
    const tileSize = 48;
    const by = 300;
    const short = tileSize * 0.9;
    const lift = agentChromeLift(tileSize, short);
    expect(by - lift.nameLift).toBeLessThan(by - short);
  });
});

describe('chromeClusterSlot', () => {
  it('keeps four nameplates and bubbles from overlapping', () => {
    const tileSize = 48;
    const bx = 240;
    const by = 320;
    const lift = agentChromeLift(tileSize);
    const names = [0, 1, 2, 3].map((i) => {
      const slot = chromeClusterSlot(i, 4, tileSize);
      return {
        x: bx + slot.nameDx,
        y: by - lift.nameLift - slot.nameDy,
        w: 56,
        h: 18,
      };
    });
    const bubbles = [0, 1, 2, 3].map((i) => {
      const slot = chromeClusterSlot(i, 4, tileSize);
      return {
        x: bx + slot.bubbleDx,
        y: by - lift.bubbleLift(slot.bubbleTier),
        w: 120,
        h: 36,
      };
    });
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) {
        expect(chromeRectsOverlap(names[i]!, names[j]!)).toBe(false);
        expect(chromeRectsOverlap(bubbles[i]!, bubbles[j]!)).toBe(false);
      }
    }
  });

  it('fans bodies farther than the old 12px ring', () => {
    const a = crowdSpreadOffset(0, 4);
    const b = crowdSpreadOffset(1, 4);
    expect(Math.hypot(a.dx - b.dx, a.dy - b.dy)).toBeGreaterThan(16);
    expect(Math.hypot(a.dx, a.dy)).toBeGreaterThanOrEqual(15);
  });
});

describe('agentLabelText', () => {
  it('drops the partner tag when a pile is crowded', () => {
    expect(
      agentLabelText({
        name: '石头',
        partner: '铁柱',
        clusterSize: 4,
      }),
    ).toBe('石头');
    expect(
      agentLabelText({
        name: '石头',
        partner: '铁柱',
        clusterSize: 4,
        selected: true,
      }),
    ).toBe('石头 · 💬铁柱');
    expect(
      agentLabelText({
        name: '石头',
        partner: '铁柱',
        clusterSize: 2,
      }),
    ).toBe('石头 · 💬铁柱');
    expect(
      agentLabelText({
        name: '阿禾',
        action: '往麦田走',
        clusterSize: 1,
      }),
    ).toBe('阿禾 · 往麦田走');
  });
});

describe('crowd chrome gates', () => {
  it('only draws a talk arc for live speech or a selection', () => {
    expect(
      shouldDrawTalkArc({
        speakerId: 'a',
        partnerId: 'b',
        liveSpeechIds: new Set(),
        clusterSize: 2,
      }),
    ).toBe(false);
    expect(
      shouldDrawTalkArc({
        speakerId: 'a',
        partnerId: 'b',
        liveSpeechIds: new Set(['a']),
        clusterSize: 6,
      }),
    ).toBe(true);
    expect(
      shouldDrawTalkArc({
        speakerId: 'a',
        partnerId: 'b',
        selectedId: 'b',
        liveSpeechIds: new Set(),
        clusterSize: 6,
      }),
    ).toBe(true);
  });

  it('hides hot object labels under a piled cell', () => {
    expect(
      shouldShowObjectLabel({ hot: true, hovered: false, crowdAtCell: 4 }),
    ).toBe(false);
    expect(
      shouldShowObjectLabel({ hot: true, hovered: true, crowdAtCell: 4 }),
    ).toBe(true);
    expect(
      shouldShowObjectLabel({ hot: true, hovered: false, crowdAtCell: 1 }),
    ).toBe(true);
  });
});

describe('shouldFollowSpeech', () => {
  it('follows when the observer has not locked the camera', () => {
    expect(shouldFollowSpeech({})).toBe(true);
    expect(
      shouldFollowSpeech({
        pinnedAgentId: null,
        regionPinned: null,
        userSteeredCamera: false,
      }),
    ).toBe(true);
  });

  it('does not steal when a resident is pinned', () => {
    expect(shouldFollowSpeech({ pinnedAgentId: 'a1' })).toBe(false);
  });

  it('does not steal when a region is pinned', () => {
    expect(shouldFollowSpeech({ regionPinned: 'square' })).toBe(false);
  });

  it('still follows the next speaker after the observer dragged the map', () => {
    expect(shouldFollowSpeech({ userSteeredCamera: true })).toBe(true);
  });
});

describe('talkArcDepth', () => {
  it('sits between the body and the bubble rectangle', () => {
    const body = 120;
    expect(talkArcDepth(body)).toBeGreaterThan(body);
    expect(talkArcDepth(body)).toBeLessThan(nameplateDepth(body));
    expect(nameplateDepth(body)).toBeLessThan(speechBubbleBgDepth(body));
    expect(speechBubbleBgDepth(body)).toBeLessThan(speechBubbleTextDepth(body));
  });

  it('keeps a rear speaker bubble above a nearer nameplate', () => {
    const speaker = 80;
    const nearer = 400;
    expect(speechBubbleBgDepth(speaker)).toBeGreaterThan(nameplateDepth(nearer));
  });
});

describe('shouldHideNameUnderSpeech', () => {
  it('hides a name sitting on the bubble', () => {
    const bubble = chromeOriginBottomRect(200, 120, 160, 48);
    const name = chromeOriginBottomRect(200, 130, 40, 18);
    expect(shouldHideNameUnderSpeech(name, [bubble])).toBe(true);
  });

  it('keeps a name that is clear of the bubble', () => {
    const bubble = chromeOriginBottomRect(200, 120, 160, 48);
    const name = chromeOriginBottomRect(80, 200, 40, 18);
    expect(shouldHideNameUnderSpeech(name, [bubble])).toBe(false);
  });
});

describe('unique portraits', () => {
  it('rejects the shared npc.png and walk sheets', () => {
    expect(isSharedNpcAsset('./assets/npc.png')).toBe(true);
    expect(isSharedNpcAsset('npc')).toBe(true);
    expect(preferUniquePortraitFile('./assets/npc.png')).toBeUndefined();
    expect(preferUniquePortraitFile('./assets/iron_walk.png')).toBeUndefined();
    expect(preferUniquePortraitFile('./assets/iron.png')).toBe(
      './assets/iron.png',
    );
  });
});

describe('minimapDockForFollow', () => {
  it('stays bottom-right unless the followed pair sits under it', () => {
    expect(
      minimapDockForFollow({
        following: false,
        screenX: 760,
        screenY: 560,
        viewW: 800,
        viewH: 600,
      }),
    ).toBe('bottom-right');
    const box = minimapBox(800, 600, 'bottom-right');
    expect(
      minimapDockForFollow({
        following: true,
        screenX: box.x + box.w / 2,
        screenY: box.y + box.h / 2,
        viewW: 800,
        viewH: 600,
      }),
    ).toBe('top-right');
    expect(
      minimapDockForFollow({
        following: true,
        screenX: 80,
        screenY: 80,
        viewW: 800,
        viewH: 600,
      }),
    ).toBe('bottom-right');
  });
});

describe('speech follow chrome', () => {
  it('lifts the pair above the caption bar', () => {
    const focus = speechFocusPoint(200, 300);
    expect(focus.x).toBe(200);
    expect(focus.y).toBeGreaterThan(300);
  });

  it('hides region tabs harder when the pair sits under them', () => {
    expect(regionNavAlpha({ following: false })).toBe(1);
    expect(regionNavAlpha({ following: true, followScreenY: 200 })).toBe(0.38);
    expect(regionNavAlpha({ following: true, followScreenY: 40 })).toBeLessThan(
      0.2,
    );
  });
});
