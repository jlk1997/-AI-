/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component } from '../core/Component.js';

/**
 * A Behavior is a Component that encodes "how this entity acts each tick".
 * Splitting Behaviors out of plain Components is purely conventional — it
 * gives the Planner Agent a smaller vocabulary to compose ("pick 1-2
 * behaviors for this enemy") without losing the unified ECS surface.
 */
export abstract class Behavior extends Component {}
