/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hosted-engine GDD contract. Archetype is a camera/physics hint.
 * MechanicSpec is generation truth. Never copy _Template* / LevelManager.
 */

export type HostedGddArchetype =
  | 'platformer'
  | 'top_down'
  | 'grid_logic'
  | 'tower_defense'
  | 'ui_heavy';

/** Legacy template-SKU docs (agent-test/docs). Default off on the hosted path. */
export function isLegacyGddDocsEnabled(): boolean {
  const raw = process.env['PLATFORM_GDD_LEGACY_DOCS']?.trim();
  return raw === '1' || raw === 'true';
}

export const HOSTED_GDD_SYSTEM_PREFIX = `You are writing a Technical GDD for OpenGame's **hosted Phaser engine**.

## Hosted engine (overrides any later template docs)

- **MechanicSpec is the generation truth.** Named loops and modules in the Config Summary / MechanicSpec must be implemented. Archetype is only camera / physics (gravity, side vs top-down, discrete vs continuous).
- **Do NOT copy** \`_TemplatePlayer.ts\`, \`_TemplateEnemy.ts\`, \`_TemplateLevel.ts\`, \`_TemplateArena.ts\`, \`_TemplateEntity.ts\`, \`_TemplateGridLevel.ts\`, \`_TemplateTower.ts\`, \`_TemplateTDEnemy.ts\`, \`_TemplateTDLevel.ts\`, \`_TemplateBattle.ts\`, \`_TemplateDualBattle.ts\`, \`_TemplateChapter.ts\`, \`_TemplateCharacterSelect.ts\`, \`_TemplateEnding.ts\`, or \`LevelManager.ts\`. Those files are **not on the hosted path**.
- **Do NOT** tell the coder to read \`template_api.md\` as a copy list. Write \`src/scenes/*Scene.ts\` classes, register them in \`src/main.ts\` \`bootstrap({ extraScenes })\`.
- Mixed explore + board/match/cards/emitter: **keep World/Title**, merge extra capability Scenes. Never delete the world stage to swap in a SPACE-to-score arcade shell.
- Import capability packages from \`public/CAPABILITY.json\`: \`@opengame/module-board\` (rules / Match3Rules), \`@opengame/module-cards\`, \`@opengame/module-emitter\`, \`@opengame/module-td\`, \`@opengame/module-dialogue\`, \`@opengame/module-combat\`, \`@opengame/module-world\`, \`@opengame/module-systems\`, \`@opengame/module-platform\`.
- Chess / tactics: Scene presents; rules live in \`rulesForBoardKind\` / \`legalMoves\` / \`applyMove\` / \`winner\`.
- Match-3: \`Match3Rules.create\` / \`findMatches\` / \`legalSwaps\` / \`applySwap\` — not a Candy Crush project.
- Cards: \`createStarterDeck\` / \`draw\` / \`playCard\` — not a finished deckbuilder SKU.
- Danmaku: \`emitRadial\` / \`stepBullets\` / \`hitTest\` — not a finished bullet-hell SKU.
- Custom named loops (赶海, etc.) must use the user's phrase as the acceptance signal. Do not pad \`registry.won\` to fake them.

## GDD sections on the hosted path

| Section | Title | Downstream |
|---------|-------|------------|
| 0 | Technical Architecture | \`src/main.ts\` extraScenes + \`public/game.json\` scene ids |
| 1 | Visual Style & Asset Registry | generate_game_assets |
| 2 | Game Configuration | MERGE \`src/gameConfig.json\` |
| 3 | Scene / loop architecture | Coder writes Phaser.Scene files |
| 4 | Level / content | ASCII or tables as **design notes**; maps may be code-defined |
| 5 | Implementation roadmap | File-level tasks (no template COPY) |
| 6 | Playable acceptance | Named loops from MechanicSpec |
`;

export function hostedBuiltinCoreRules(): string {
  return `---

## Universal GDD Rules (hosted)

### Forbidden
- Copying \`_Template*\` or editing \`LevelManager.ts\`
- Inventing a sixth exclusive archetype bucket
- Replacing a named loop with an unrelated arcade shell (SPACE to score, snake, flappy)
- Unspecified numeric values — write exact numbers

### Required
- Scene keys in Section 0 must match \`src/main.ts\` extraScenes
- Each MechanicSpec named loop gets an acceptance checkbox in Section 6
- Assets png/webp only
`;
}

export function hostedSection3(archetype: HostedGddArchetype): string {
  const common = `Specify **Phaser.Scene** files under \`src/scenes/\`. Each scene: key string, input, win/lose, which MechanicSpec loops it implements, which capability packages it imports.

Do **not** name \`_Template*.ts\` or \`LevelManager.ts\`. Mixed compositions keep World/Title and add capability scenes (\`BoardTurnScene\`, \`Match3Scene\`, \`CardsHandScene\`, \`EmitterScene\`) via extraScenes.`;
  if (archetype === 'grid_logic') {
    return `${common}

Chess/tactics: \`BoardTurnScene\` + \`@opengame/module-board\`.
Match-3: \`Match3Scene\` + \`Match3Rules\`.
Snake/2048/flappy: keep the seeded arcade carrier; replace only presentation, not the loop.
Puzzle/roguelike without a dedicated module: implement the named loop in a custom Scene using grid coordinates — do not invent BoardManager-as-product.`;
  }
  if (archetype === 'tower_defense') {
    return `${common}

Use \`@opengame/module-td\` (WaveManager / EconomyManager). Towers, enemies, and waves are data + Scene presentation. Do not copy TD templates.`;
  }
  if (archetype === 'ui_heavy') {
    return `${common}

Dialogue: \`@opengame/module-dialogue\` + ChoicePanel. Cards: \`@opengame/module-cards\`. Combat: \`TurnManager\` from module-combat. Write Title / Chapter / Battle / Ending as Phaser.Scenes.`;
  }
  if (archetype === 'top_down') {
    return `${common}

Walkable world: \`@opengame/module-world\`. Bound board/match/cards/emitter are extra Scenes, not a new exclusive kernel.`;
  }
  return `${common}

Side-view + gravity. Player movement in a Level Scene. Combat optional via module-combat. Do not copy platformer character templates.`;
}

export function hostedSection4(archetype: HostedGddArchetype): string {
  if (archetype === 'platformer' || archetype === 'top_down') {
    return `Design 1 playable layout unless the user asked for more. ASCII is a **design note** for the coder (or optional generate_tilemap). You may invent a small valid layout; do not require copying templates A/B/C/D. Hosted games may also place platforms/tiles in code.

List spawn, hazards, and win/lose in coordinates the Scene can implement.`;
  }
  if (archetype === 'ui_heavy') {
    return `No tilemaps. Write the actual dialogue lines, card names, or quiz items the Scene will show. Cards should mention \`@opengame/module-cards\` if MechanicSpec includes cards.`;
  }
  if (archetype === 'tower_defense') {
    return `Code-defined path grid (BUILDABLE / PATH / SPAWN / EXIT). List waypoints and a short wave table. Do not use generate_tilemap. Import \`@opengame/module-td\`.`;
  }
  return `Code-defined grid or rule table. Chess/tactics: the board comes from module-board, not a tilemap. Match-3: piece types + score target. Do not use generate_tilemap.`;
}

/** Camera / physics only. Never a finished-game SKU or copy list. */
export function hostedPhysicsHint(archetype: HostedGddArchetype): string {
  const hints: Record<HostedGddArchetype, string> = {
    platformer: 'Side view, gravity on, left/right + jump. Platforms in a Level Scene.',
    top_down: 'Top-down, zero gravity, 8-way walk. World is a stage; bound loops are extra Scenes.',
    grid_logic: 'Discrete grid, no gravity. Chess/match use module-board. Snake/2048 keep their carrier.',
    tower_defense: 'Top-down, place on a path grid, waves via module-td. No player avatar required.',
    ui_heavy: 'Pointer / choice. Dialogue and cards are modules, not a visual-novel SKU.',
  };
  return `---

## Camera / physics hint (${archetype})

${hints[archetype]}
`;
}

export function hostedImplementation(archetype: HostedGddArchetype): string {
  return `### Implementation (hosted engine — no template copy)
1. Register Phaser Scenes in \`src/main.ts\` \`extraScenes\`. Keep World/Title when MechanicSpec is mixed.
2. Implement MechanicSpec \`loops[]\`. Import \`modules[]\` packages. Read \`public/CAPABILITY.json\`.
3. Camera/physics hint for this job: **${archetype}**.
4. **Do NOT** copy \`_Template*.ts\` or \`LevelManager.ts\`.
5. Win/lose must set \`registry.won\` / scene transition for the named loop — not a SPACE score shell unless the loop is that arcade.`;
}
