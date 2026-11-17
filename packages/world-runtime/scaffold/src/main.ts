import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { WorldExploreScene } from './scenes/WorldExploreScene';
import { BattleScene } from './scenes/BattleScene';
import { EndingScene } from './scenes/EndingScene';
import { SocietyReplayScene } from './scenes/SocietyReplayScene';
import { WorldGameEngine, type WorldSpecDoc } from './engine/WorldGameEngine';
import { ensureFontsReady, installTextDefaults } from './ui/fonts';

type SocietyReplayPayload = {
  version?: number;
  simTime?: number;
  agents?: unknown[];
  events?: unknown[];
  report?: unknown;
};

/**
 * Renderer knobs derived from the picked art style.
 *
 * The scaffold cannot import workspace packages, so it reads what the pipeline
 * baked into `world.json` (`presentation.pixelPerfect`) and only sniffs the free
 * text as a fallback for worlds generated before the picker existed.
 */
function artStyleOf(world: Record<string, unknown>): {
  id: string;
  pixelPerfect: boolean;
} {
  const presentation = (world['presentation'] ?? {}) as Record<string, unknown>;
  const anchor = (world['styleAnchor'] ?? {}) as Record<string, unknown>;
  const id =
    typeof presentation['artStyleId'] === 'string'
      ? presentation['artStyleId']
      : typeof anchor['artStyleId'] === 'string'
        ? anchor['artStyleId']
        : '';
  if (typeof presentation['pixelPerfect'] === 'boolean') {
    return { id, pixelPerfect: presentation['pixelPerfect'] };
  }
  if (id) return { id, pixelPerfect: id === 'fine_pixel' };
  const text = typeof anchor['artStyle'] === 'string' ? anchor['artStyle'] : '';
  return { id, pixelPerfect: /pixel|像素|8-?bit|16-?bit/i.test(text) };
}

async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  // Before any Text exists: patch the factory for CJK family + high-DPI
  // rasterisation, and let webfonts settle so the first measure is not taken
  // against a fallback face.
  installTextDefaults();
  const world = await loadJson<Record<string, unknown>>('./world.json');
  if (!world) throw new Error('missing world.json');
  await ensureFontsReady();

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'play' ? 'play' : 'observe';
  // Live observatory: parent postMessages replay — skip fat society_replay.json
  // parse on boot (was freezing the tab on open).
  const replay =
    mode === 'play'
      ? await loadJson<SocietyReplayPayload>('./society_replay.json')
      : null;

  const engine = new WorldGameEngine(world as unknown as WorldSpecDoc);

  const scenes =
    mode === 'play'
      ? [TitleScene, WorldExploreScene, BattleScene, EndingScene, SocietyReplayScene]
      : [SocietyReplayScene, WorldExploreScene, BattleScene, EndingScene, TitleScene];

  const style = artStyleOf(world);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    // 1280x720 instead of 800x600: the canvas was upscaled by Scale.FIT on any
    // modern display, so every asset was resampled up and read as mush.
    width: 1280,
    height: 720,
    backgroundColor: '#0b0f14',
    scene: scenes,
    // Only genuinely pixel styles want nearest-neighbour + pixel snapping;
    // applying it to painterly art produces jagged edges.
    pixelArt: style.pixelPerfect,
    roundPixels: style.pixelPerfect,
    antialias: !style.pixelPerfect,
    scale:
      mode === 'observe'
        ? {
            // The observatory is embedded in panes of every shape. FIT would
            // letterbox a 16:9 buffer inside them and leave big dead bands, so
            // the canvas takes the container size and the scene frames the town
            // itself (see SocietyReplayScene.applyCameraFit).
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.NO_CENTER,
          }
        : {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            // Integral canvas placement — fractional CSS scaling adds its own blur.
            autoRound: true,
          },
    callbacks: {
      preBoot: (game) => {
        game.registry.set('world', world);
        game.registry.set('engine', engine);
        game.registry.set('observeMode', mode === 'observe');
        game.registry.set('artStyleId', style.id);
        game.registry.set('pixelPerfect', style.pixelPerfect);
        if (replay) game.registry.set('societyReplay', replay);
        // Optional speech pacing overrides from the Spec, so a chatty town can
        // be retuned without rebuilding the scaffold.
        const presentation = world['presentation'];
        if (presentation && typeof presentation === 'object') {
          const p = presentation as Record<string, unknown>;
          if (typeof p['speechStaggerMs'] === 'number') {
            game.registry.set('speechStaggerMs', p['speechStaggerMs']);
          }
          if (typeof p['maxLiveSpeech'] === 'number') {
            game.registry.set('maxLiveSpeech', p['maxLiveSpeech']);
          }
        }
      },
    },
  };

  // eslint-disable-next-line no-new
  new Phaser.Game(config);
}

boot().catch((err) => {
  const el = document.getElementById('game-container');
  if (el) el.textContent = String(err);
});
