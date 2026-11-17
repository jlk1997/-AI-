# Player Saves, Achievements & Profile (P3)

Status: in-progress (P3 / 24-month plan)

This document describes how AI-generated games on the OpenGame platform persist
**player state** and **cross-game achievements**, and how that data is rolled up
into a unified **Player Profile**.

It is the contract between three actors:

1. **`@opengame/runtime`** — provides the in-game SDKs (`SaveStore`,
   `AchievementsClient`) that games call.
2. **`platform-api`** — exposes the REST endpoints, persists rows in `player_saves`
   and `achievements`, and aggregates them for `/me/profile`.
3. **`platform-web`** — renders the Player Profile page and forwards the user's
   session token to the embedded game iframe via `window.__opengame_token__`.

---

## 1. Data model

### `player_saves`
| column          | type    | notes                                   |
|-----------------|---------|-----------------------------------------|
| `id`            | uuid    | PK                                       |
| `user_id`       | uuid    | FK → `users.id`                          |
| `deployment_id` | uuid    | FK → `deployments.id`                   |
| `slot`          | text    | e.g. `default`, `auto`, `slot1`          |
| `payload`       | jsonb   | arbitrary game-defined object             |
| `updated_at`    | timestamp | last write                             |

Unique on `(user_id, deployment_id, slot)`.

### `achievements`
| column            | type      | notes                                |
|-------------------|-----------|--------------------------------------|
| `id`              | uuid      | PK                                   |
| `user_id`         | uuid      | FK → `users.id`                      |
| `deployment_id`   | uuid      | FK → `deployments.id`               |
| `achievement_key` | text      | game-local id, e.g. `first_blood`    |
| `title`           | text      | shown in profile                     |
| `description`     | text?     | optional flavor text                 |
| `icon_url`        | text?     | optional asset                       |
| `progress`        | int       | monotonic counter (stackable trophies) |
| `awarded_at`      | timestamp | first-time award                     |

Unique on `(user_id, deployment_id, achievement_key)` — calling `award()` twice
with the same key only bumps `progress`.

---

## 2. REST contract (`platform-api`)

All endpoints require the same JWT used elsewhere in the platform.

| Verb   | Path                                               | Purpose                       |
|--------|----------------------------------------------------|-------------------------------|
| `PUT`    | `/deployments/:deploymentId/saves/:slot`         | upsert one save slot          |
| `GET`    | `/deployments/:deploymentId/saves/:slot`         | read one save slot            |
| `DELETE` | `/deployments/:deploymentId/saves/:slot`         | delete one save slot          |
| `POST`   | `/deployments/:deploymentId/achievements`        | idempotent award              |
| `GET`    | `/me/profile`                                    | aggregated profile rollup     |

### `GET /me/profile` shape
```jsonc
{
  "userId": "<uuid>",
  "savesCount": 12,
  "achievements": [ /* up to 50 most-recent rows */ ],
  "recentSaves":  [ /* up to 20 most-recent slots */ ]
}
```

---

## 3. In-game SDK (`@opengame/runtime`)

### `SaveStore`
Local-first by default; opt into cloud saves with `SaveStore.remote(...)`:

```ts
import { SaveStore } from '@opengame/runtime';

const saves = SaveStore.remote({
  deploymentId: window.__opengame_deployment_id__!,
  // token defaults to window.__opengame_token__
});

await saves.save({ score: 1234, level: 4 }, 'auto');
const last = await saves.load<{ score: number; level: number }>('auto');
```

If `fetch` is unavailable or the request fails, methods return `null`/no-op so
games never crash because of save infrastructure.

### `AchievementsClient`
```ts
import { AchievementsClient } from '@opengame/runtime';

const ach = new AchievementsClient({
  deploymentId: window.__opengame_deployment_id__!,
});

await ach.award({
  achievementKey: 'first_blood',
  title: 'First Blood',
  description: 'Defeat your first enemy',
});
```

The endpoint is idempotent: subsequent calls with the same key only update
`progress`. Games can therefore call `award` from any gameplay hook.

---

## 4. Frontend (`platform-web`)

* `apps/platform-web/src/pages/Profile.tsx` — renders `/me/profile` as three
  stats + an achievements list + recent saves.
* Reached via the user dropdown ("玩家档案") or `/profile`.
* The page does **not** mutate game state; mutations always come from the
  in-game SDK (so a cheating site cannot grant achievements without playing).

---

## 5. Anti-cheat notes (for future hardening)

The current MVP trusts the authenticated user. Roadmap items:

1. Add **rate limits** per `(user, deployment, achievement_key)`.
2. Require a **session signature** (worker-issued, embedded in the iframe URL)
   so only running deployments can mint achievements for that deployment.
3. Optional server-side **achievement validation hooks** that re-derive
   eligibility from `player_saves`/`leaderboards`.

These are deliberately out of scope for P3.
