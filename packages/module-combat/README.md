# @opengame/module-combat

Composable **turn-based combat phase engine** for Agent-authored Phaser scenes.

## Usage

```typescript
import { TurnManager } from '@opengame/module-combat';

const tm = new TurnManager({
  phases: ['PLAYER_TURN', 'RESOLVE', 'ENEMY_TURN', 'CHECK_END'],
});
tm.onPhaseEnter('PLAYER_TURN', () => { /* enable UI */ });
tm.onPhaseEnter('CHECK_END', () => { /* if hp<=0 scene.start('GameOver') */ });
tm.start();
// after player acts:
tm.nextPhase();
```

Agent games should implement **custom** `BattleScene.ts` using this API — not fixed template levels.
