import { bootstrap, enableHotReload } from '@opengame/runtime';

// Relative URL so preview works under any path (e.g. `/v1/preview-dist/.../index.html`).
// A root-absolute `/game.json` would fetch the site origin and often return SPA HTML instead of DSL.
const game = await bootstrap({ source: './game.json' });

// Dev only: listen for IDE hot-reload + tunable messages.
// Stripped by tree-shake in production builds because the bridge guards itself
// on `window`. We keep it unconditional so the IDE's Tunable panel still works
// against the published preview URL.
enableHotReload({ game });
