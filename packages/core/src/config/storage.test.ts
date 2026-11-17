/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { OPENGAME_DIR, resolveConfigDirName, Storage } from './storage.js';

describe('resolveConfigDirName', () => {
  it('writes new dirs as .opengame when neither exists', () => {
    expect(
      resolveConfigDirName(
        path.join(os.tmpdir(), `og-no-config-${Date.now()}`),
      ),
    ).toBe(OPENGAME_DIR);
  });
});

describe('Storage – getGlobalSettingsPath', () => {
  it('returns settings.json under the resolved global config dir', () => {
    expect(Storage.getGlobalSettingsPath()).toBe(
      path.join(Storage.getGlobalQwenDir(), 'settings.json'),
    );
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = path.join(os.tmpdir(), `og-project-${Date.now()}`);
  const storage = new Storage(projectRoot);
  const projectDir = storage.getQwenDir();

  it('getWorkspaceSettingsPath uses the dual-read config dir', () => {
    expect(storage.getWorkspaceSettingsPath()).toBe(
      path.join(projectDir, 'settings.json'),
    );
  });

  it('getUserCommandsDir lives next to global settings', () => {
    expect(Storage.getUserCommandsDir()).toBe(
      path.join(Storage.getGlobalQwenDir(), 'commands'),
    );
  });

  it('getProjectCommandsDir uses the project config dir', () => {
    expect(storage.getProjectCommandsDir()).toBe(
      path.join(projectDir, 'commands'),
    );
  });

  it('getMcpOAuthTokensPath lives next to global settings', () => {
    expect(Storage.getMcpOAuthTokensPath()).toBe(
      path.join(Storage.getGlobalQwenDir(), 'mcp-oauth-tokens.json'),
    );
  });
});
