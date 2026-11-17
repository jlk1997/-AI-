# @opengame/embed

Tiny client for embedding OpenGame community games on any website.

## Two ways to use

### 1. Drop-in `<script>` tag

```html
<div data-opengame="flappy-2026" data-width="800" data-height="600"></div>
<script src="https://api.opengame.dev/embed.js" defer></script>
```

The script hydrates every `[data-opengame]` it finds, with no JS framework
required. Subsequent SPA route changes can call `window.OpenGame.rescan()`.

### 2. React component

```tsx
import { OpenGameEmbed } from '@opengame/embed/react';

export function HomePage() {
  return <OpenGameEmbed slug="flappy-2026" width={800} height={600} />;
}
```

### 3. Imperative

```ts
import { attachEmbed } from '@opengame/embed';

await attachEmbed(document.getElementById('host')!, 'flappy-2026');
```

## API base

All helpers accept `apiBase` to point at a self-hosted OpenGame:

```ts
attachEmbed(el, 'my-game', { apiBase: 'https://api.example.com' });
```

When omitted, both the React and vanilla helpers default to
`https://api.opengame.dev`. The drop-in `<script>` infers the base from
`document.currentScript.src` so it auto-targets the host serving `embed.js`.
