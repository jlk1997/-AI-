/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branching choice UI aligned with agent-test ui_heavy ChoicePanel —
 * used by Chapter / dialogue scenes in the engine scaffold.
 */

import Phaser from 'phaser';

export interface ChoiceDisplayOption {
  readonly text: string;
  readonly enabled?: boolean;
}

export interface ChoicePanelConfig {
  readonly layout?: 'vertical' | 'horizontal';
  readonly spacing?: number;
  readonly buttonWidth?: number;
  readonly buttonHeight?: number;
  readonly buttonColor?: number;
  readonly buttonHoverColor?: number;
  readonly keyboardNav?: boolean;
  /** Enable Chinese-safe wrap on option labels (default true). */
  readonly wordWrap?: boolean;
  /**
   * Visual dimmer behind choices (default true). Never interactive —
   * a full-screen interactive backdrop steals clicks from choice buttons.
   */
  readonly modalBackdrop?: boolean;
}

/** Above GameUiKit dialogue (100–102) and typical world HUD. */
export const CHOICE_PANEL_DEPTH = 1200;

/**
 * Vertical/horizontal choice buttons with optional prompt + keyboard nav.
 * Emits `selected` with (optionIndex, optionText).
 *
 * Hit targets are **scene-level** GameObjects (not nested in a Container).
 * Phaser 3 often delivers pointerover to nested Container children but drops
 * pointerdown/up — which matches "hover works, click does nothing".
 */
export class ChoicePanel extends Phaser.Events.EventEmitter {
  private readonly scene: Phaser.Scene;
  private readonly panelConfig: ChoicePanelConfig;
  private rootX: number;
  private rootY: number;
  private buttonBgs: Phaser.GameObjects.Rectangle[] = [];
  private buttonLabels: Phaser.GameObjects.Text[] = [];
  private currentOptions: ChoiceDisplayOption[] = [];
  private selectedIndex = 0;
  private picking = false;
  private _visible = false;
  private promptText?: Phaser.GameObjects.Text;
  private upKey?: Phaser.Input.Keyboard.Key;
  private downKey?: Phaser.Input.Keyboard.Key;
  private enterKey?: Phaser.Input.Keyboard.Key;
  private digitKeys: Phaser.Input.Keyboard.Key[] = [];
  private backdrop?: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config?: ChoicePanelConfig,
  ) {
    super();
    this.scene = scene;
    this.rootX = x;
    this.rootY = y;
    this.panelConfig = config ?? {};
  }

  get x(): number {
    return this.rootX;
  }
  set x(v: number) {
    this.rootX = v;
  }

  get y(): number {
    return this.rootY;
  }
  set y(v: number) {
    this.rootY = v;
  }

  /** Compatibility with Scene code that checks `choices.visible`. */
  get visible(): boolean {
    return this._visible;
  }

  setVisible(v: boolean): this {
    if (!v) this.hide();
    else this._visible = true;
    return this;
  }

  showChoices(prompt: string, options: ChoiceDisplayOption[]): void {
    this.clearButtons();
    this.currentOptions = [...options];
    this.picking = false;
    this._visible = true;
    this.ensureBackdrop(
      options.length > 0 && this.panelConfig.modalBackdrop !== false,
    );
    this.layout(prompt, options);
    this.scene.input.setTopOnly(true);
    if (this.panelConfig.keyboardNav !== false) {
      this.bindKeys();
    }
  }

  hide(): void {
    this.clearButtons();
    this.hideBackdrop();
    this._visible = false;
    this.picking = false;
  }

  selectByIndex(index: number): void {
    if (this.picking) return;
    if (!this._visible) return;
    if (index < 0 || index >= this.currentOptions.length) return;
    if (this.currentOptions[index]?.enabled === false) return;
    this.picking = true;
    const text = this.currentOptions[index]?.text ?? '';
    this.emit('selected', index, text);
    this.scene.time.delayedCall(80, () => {
      this.picking = false;
    });
  }

  /** Suggested Y so the stack sits above a ~176px bottom dialogue bar. */
  static stackY(
    sceneHeight: number,
    optionCount: number,
    promptPad = 36,
  ): number {
    const n = Math.max(1, optionCount);
    const stackH = n * 56 + promptPad;
    return Math.max(
      64,
      Math.min(sceneHeight * 0.34, sceneHeight - 210 - stackH),
    );
  }

  destroy(): void {
    this.hide();
    this.backdrop?.destroy();
    this.backdrop = undefined;
    this.removeAllListeners();
  }

  private layout(prompt: string, options: ChoiceDisplayOption[]): void {
    const btnWidth = this.panelConfig.buttonWidth ?? 420;
    const baseHeight = this.panelConfig.buttonHeight ?? 44;
    const spacing = this.panelConfig.spacing ?? 10;
    const btnColor = this.panelConfig.buttonColor ?? 0x1e293b;
    const hoverColor = this.panelConfig.buttonHoverColor ?? 0x334155;
    const vertical = (this.panelConfig.layout ?? 'vertical') === 'vertical';
    const useWrap = this.panelConfig.wordWrap !== false;
    const wrapW = Math.max(120, btnWidth - 28);
    const ox = this.rootX;
    const oy = this.rootY;

    let cursorY = 0;
    if (prompt) {
      this.promptText = this.scene.add
        .text(ox, oy, prompt, {
          fontSize: '18px',
          fontFamily:
            'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          color: '#f8fafc',
          fontStyle: 'bold',
          stroke: '#0f172a',
          strokeThickness: 3,
          wordWrap: useWrap
            ? { width: wrapW, useAdvancedWrap: true }
            : undefined,
          align: 'center',
          padding: { x: 4, y: 4 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(CHOICE_PANEL_DEPTH + 1);
      cursorY = Math.max(28, this.promptText.height + 8);
    }

    options.forEach((option, index) => {
      const estimateLines = useWrap
        ? Math.max(
            1,
            Math.ceil((`${index + 1}. ${option.text}`.length * 9) / wrapW),
          )
        : 1;
      const btnHeight = Math.max(baseHeight, 28 + estimateLines * 18);
      const yOffset = vertical ? cursorY + btnHeight / 2 : cursorY;
      const xOffset = vertical ? 0 : index * (btnWidth + spacing);
      this.createButton(
        option,
        index,
        ox + xOffset,
        oy + yOffset,
        btnWidth,
        btnHeight,
        btnColor,
        hoverColor,
        useWrap,
        wrapW,
      );
      if (vertical) cursorY += btnHeight + spacing;
    });

    this.selectedIndex = 0;
    this.highlightButton(0);
  }

  private ensureBackdrop(enabled: boolean): void {
    if (!enabled) {
      this.hideBackdrop();
      return;
    }
    const cam = this.scene.cameras.main;
    const w = cam.width;
    const h = cam.height;
    if (!this.backdrop || !this.backdrop.active) {
      this.backdrop = this.scene.add
        .rectangle(w / 2, h / 2, w + 4, h + 4, 0x020617, 0.82)
        .setScrollFactor(0)
        .setDepth(CHOICE_PANEL_DEPTH - 2);
    } else {
      this.backdrop.setPosition(w / 2, h / 2);
      this.backdrop.setSize(w + 4, h + 4);
      this.backdrop.setDepth(CHOICE_PANEL_DEPTH - 2);
      this.backdrop.setVisible(true);
    }
    this.backdrop.disableInteractive();
  }

  private hideBackdrop(): void {
    if (this.backdrop?.active) {
      this.backdrop.setVisible(false);
      this.backdrop.disableInteractive();
    }
  }

  private clearButtons(): void {
    for (const bg of this.buttonBgs) {
      bg.removeAllListeners();
      bg.destroy();
    }
    for (const label of this.buttonLabels) label.destroy();
    this.buttonBgs = [];
    this.buttonLabels = [];
    this.promptText?.destroy();
    this.promptText = undefined;
    this.upKey?.destroy();
    this.downKey?.destroy();
    this.enterKey?.destroy();
    this.upKey = undefined;
    this.downKey = undefined;
    this.enterKey = undefined;
    for (const k of this.digitKeys) k.destroy();
    this.digitKeys = [];
  }

  private createButton(
    option: ChoiceDisplayOption,
    index: number,
    worldX: number,
    worldY: number,
    width: number,
    height: number,
    bgColor: number,
    hoverColor: number,
    useWrap: boolean,
    wrapW: number,
  ): void {
    const enabled = option.enabled !== false;
    const label = this.scene.add
      .text(worldX, worldY, `${index + 1}. ${option.text}`, {
        fontSize: '16px',
        fontFamily:
          'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        color: enabled ? '#f1f5f9' : '#94a3b8',
        wordWrap: useWrap
          ? { width: wrapW, useAdvancedWrap: true }
          : undefined,
        align: 'center',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(CHOICE_PANEL_DEPTH + 2);

    const needH = Math.max(height, label.height + 16);
    const bg = this.scene.add
      .rectangle(worldX, worldY, width, needH, bgColor, enabled ? 0.96 : 0.4)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x64748b)
      .setScrollFactor(0)
      .setDepth(CHOICE_PANEL_DEPTH + 1);

    this.buttonBgs.push(bg);
    this.buttonLabels.push(label);

    if (!enabled) return;

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      bg.setFillStyle(hoverColor, 1);
      this.selectedIndex = index;
      this.highlightButton(index);
    });
    bg.on('pointerout', () => bg.setFillStyle(bgColor, 0.96));
    const pick = (
      _p: Phaser.Input.Pointer,
      _x: number,
      _y: number,
      event?: Phaser.Types.Input.EventData,
    ) => {
      event?.stopPropagation?.();
      this.selectByIndex(index);
    };
    bg.on('pointerdown', pick);
    bg.on('pointerup', pick);
  }

  private highlightButton(index: number): void {
    this.buttonBgs.forEach((bg, i) => {
      bg.setStrokeStyle(2, i === index ? 0xfef08a : 0x64748b);
    });
  }

  private bindKeys(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    this.upKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.upKey.on('down', () => {
      if (this.buttonBgs.length === 0) return;
      this.selectedIndex =
        (this.selectedIndex - 1 + this.buttonBgs.length) %
        this.buttonBgs.length;
      this.highlightButton(this.selectedIndex);
    });
    this.downKey.on('down', () => {
      if (this.buttonBgs.length === 0) return;
      this.selectedIndex = (this.selectedIndex + 1) % this.buttonBgs.length;
      this.highlightButton(this.selectedIndex);
    });
    this.enterKey.on('down', () => this.selectByIndex(this.selectedIndex));
    const digitCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
      Phaser.Input.Keyboard.KeyCodes.NINE,
    ];
    digitCodes.forEach((code, i) => {
      const key = kb.addKey(code);
      key.on('down', () => this.selectByIndex(i));
      this.digitKeys.push(key);
    });
  }
}
