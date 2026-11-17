/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { registerServiceWorker, watchInstallPrompt } from './mobile/pwa.js';
import './styles/global.css';
import './styles/mobile.css';

watchInstallPrompt();
registerServiceWorker();

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
