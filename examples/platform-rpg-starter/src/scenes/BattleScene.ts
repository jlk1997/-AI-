import Phaser from 'phaser';
import { TurnManager } from '@opengame/module-combat';

export class BattleScene extends Phaser.Scene {
  private turns!: TurnManager;
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.label = this.add.text(80, 200, '', { fontSize: '20px', color: '#fff' });
    this.turns = new TurnManager({ phases: ['player', 'enemy', 'resolve'], autoAdvance: false });
    this.turns.onPhaseEnter('player', () => {
      this.label.setText('Player turn — press SPACE');
    });
    this.turns.onPhaseEnter('resolve', () => {
      this.label.setText('Victory!');
      this.time.delayedCall(800, () => this.scene.start('EndingScene'));
    });
    this.turns.start();
    this.input.keyboard?.on('keydown-SPACE', () => this.turns.nextPhase());
  }
}
