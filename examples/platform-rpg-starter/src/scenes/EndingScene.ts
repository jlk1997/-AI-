import Phaser from 'phaser';

export class EndingScene extends Phaser.Scene {
  constructor() {
    super('EndingScene');
  }

  create(): void {
    this.add
      .text(480, 270, 'Thanks for playing!', { fontSize: '24px', color: '#fff' })
      .setOrigin(0.5);
    this.input.once('pointerdown', () => this.scene.start('TitleScene'));
  }
}
