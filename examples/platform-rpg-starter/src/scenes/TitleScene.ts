import Phaser from 'phaser';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create(): void {
    this.add
      .text(480, 240, 'Platform RPG Starter', { fontSize: '28px', color: '#fff' })
      .setOrigin(0.5);
    this.add
      .text(480, 300, 'Click to Chapter', { fontSize: '18px', color: '#cbd5e1' })
      .setOrigin(0.5);
    this.input.once('pointerdown', () => this.scene.start('ChapterScene'));
  }
}
