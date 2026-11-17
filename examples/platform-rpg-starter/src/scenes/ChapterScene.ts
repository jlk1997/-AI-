import Phaser from 'phaser';
import { DialogueManager } from '@opengame/module-dialogue';

export class ChapterScene extends Phaser.Scene {
  private dialogue!: DialogueManager;

  constructor() {
    super('ChapterScene');
  }

  create(): void {
    this.dialogue = new DialogueManager(this);
    this.dialogue.on('showText', (_speaker: string, text: string) => {
      this.children.removeAll();
      this.add.text(80, 200, text, { fontSize: '20px', color: '#fff', wordWrap: { width: 800 } });
    });
    this.dialogue.on('dialogueComplete', () => this.scene.start('BattleScene'));
    this.dialogue.loadDialogues([{ type: 'text', text: 'A wild slime appears!' }]);
    this.dialogue.start();
    this.input.on('pointerdown', () => this.dialogue.advance());
  }
}
