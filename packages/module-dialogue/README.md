# @opengame/module-dialogue

Event-driven **dialogue sequence engine** for custom Phaser scenes.

```typescript
import { DialogueManager } from '@opengame/module-dialogue';

const dm = new DialogueManager(this);
dm.on('showText', (speaker, text) => { /* render box */ });
dm.on('dialogueComplete', () => this.scene.start('BattleScene'));
dm.loadDialogues([{ type: 'text', speaker: 'NPC', text: 'Hello!' }]);
dm.start();
```

Pair with `@opengame/runtime` `ChoicePanel` or your own UI.
