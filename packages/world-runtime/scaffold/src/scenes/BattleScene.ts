import Phaser from 'phaser';
import { WorldGameEngine } from '../engine/WorldGameEngine';
import { UI_FONT, fontPx } from '../ui/fonts';

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
  }

  create(): void {
    const engine = this.registry.get('engine') as WorldGameEngine;
    const enemyId = this.registry.get('battleEnemyId') as string;
    const enemy = engine.world.entities.find((e) => e.id === enemyId);
    const { width, height } = this.scale;

    this.cameras.main.setBackgroundColor('#1a0000');
    if (this.textures.exists('background')) {
      this.add
        .image(width / 2, height / 2, 'background')
        .setDisplaySize(width, height)
        .setAlpha(0.35)
        .setTint(0x7f1d1d)
        .setDepth(-10);
    }
    if (this.textures.exists('player')) {
      this.add.image(width * 0.28, height * 0.55, 'player').setDisplaySize(96, 120);
    }
    if (this.textures.exists('enemy')) {
      this.add.image(width * 0.72, height * 0.55, 'enemy').setDisplaySize(96, 120);
    }

    this.add
      .text(width / 2, 40, 'Combat', {
        fontFamily: UI_FONT,
        fontSize: '30px',
        color: '#ffccd5',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 90, `vs ${enemy?.name ?? 'Foe'}`, {
        fontFamily: UI_FONT,
        fontSize: fontPx(20),
        color: '#fff',
      })
      .setOrigin(0.5);

    const logBox = this.add
      .text(40, 140, 'Press SPACE to fight…', {
        fontFamily: UI_FONT,
        fontSize: fontPx(16),
        color: '#ffe5ec',
        wordWrap: { width: width - 80 },
      })
      .setDepth(10);

    let fought = false;
    const fight = () => {
      if (fought) return;
      fought = true;
      this.cameras.main.shake(160, 0.01);
      this.cameras.main.flash(120, 255, 80, 80);
      try {
        if (this.cache.audio.exists('sfx_coin')) {
          this.sound.play('sfx_coin', { volume: 0.4 });
        }
      } catch {
        /* optional */
      }
      const result = engine.resolveCombat(enemyId);
      logBox.setText(
        result.log.join('\n') +
          `\n\n${result.victory ? 'Victory!' : 'You were defeated…'}`,
      );
      if (result.victory) {
        this.cameras.main.flash(180, 80, 220, 120);
        try {
          if (this.cache.audio.exists('sfx_win')) {
            this.sound.play('sfx_win', { volume: 0.5 });
          }
        } catch {
          /* optional */
        }
      } else {
        this.cameras.main.shake(220, 0.014);
        try {
          if (this.cache.audio.exists('sfx_lose')) {
            this.sound.play('sfx_lose', { volume: 0.5 });
          }
        } catch {
          /* optional */
        }
      }
      this.time.delayedCall(1600, () => {
        if (engine.isDefeat()) {
          this.registry.set('endKind', 'defeat');
          this.scene.start('Ending');
          return;
        }
        if (engine.isVictory()) {
          this.registry.set('endKind', 'victory');
          this.scene.start('Ending');
          return;
        }
        this.scene.start('WorldExplore');
      });
    };

    this.input.keyboard!.once('keydown-SPACE', fight);
    this.input.once('pointerdown', fight);
  }
}
