import { bootstrap } from '@opengame/runtime/bootstrap';
import { TitleScene } from './scenes/TitleScene';
import { ChapterScene } from './scenes/ChapterScene';
import { BattleScene } from './scenes/BattleScene';
import { EndingScene } from './scenes/EndingScene';

await bootstrap({
  source: './game.json',
  extraScenes: [TitleScene, ChapterScene, BattleScene, EndingScene],
});
