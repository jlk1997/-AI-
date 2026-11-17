import Phaser from 'phaser';
import type { WorldGameEngine } from '../engine/WorldGameEngine';
import { DISPLAY_FONT, UI_FONT, fontPx } from '../ui/fonts';

export class EndingScene extends Phaser.Scene {
  constructor() {
    super('Ending');
  }

  create(): void {
    const kind = (this.registry.get('endKind') as string) ?? 'victory';
    const engine = this.registry.get('engine') as WorldGameEngine;
    const { width, height } = this.scale;
    const victory = kind === 'victory';
    const palette = engine?.world.styleAnchor?.palette ?? [];
    const bg = palette[0]
      ? Phaser.Display.Color.HexStringToColor(palette[0]).color
      : victory
        ? 0x081c15
        : 0x1a0000;
    this.cameras.main.setBackgroundColor(bg);

    const title = this.add
      .text(width / 2, height * 0.28, victory ? 'Victory' : 'Defeat', {
        fontSize: '52px',
        color: victory ? '#95d5b2' : '#ff758f',
        fontFamily: DISPLAY_FONT,
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: title,
      scale: 1.05,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    const quests = engine?.world.narrative.quests
      ?.map((q) => `${q.title}: ${q.status}`)
      .join('\n');
    const completed =
      engine?.world.narrative.quests?.filter((q) => q.status === 'completed')
        .length ?? 0;

    this.add
      .text(
        width / 2,
        height * 0.48,
        victory
          ? `You reshaped this world.\nQuests cleared: ${completed}\n${quests ?? ''}`
          : 'The world remembers your fall.\nPress ENTER to retry from title.',
        {
          fontFamily: UI_FONT,
          fontSize: fontPx(18),
          color: '#e9ecef',
          align: 'center',
          wordWrap: { width: width * 0.7 },
        },
      )
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.78, 'ENTER — Title', {
        fontFamily: UI_FONT,
        fontSize: fontPx(15),
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    this.input.keyboard!.once('keydown-ENTER', () => {
      this.scene.start('Title');
    });
  }
}
