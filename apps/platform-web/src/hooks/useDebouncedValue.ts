/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value`. Useful for live-search inputs so we
 * don't fire one request per keystroke. Cancels the pending timer on every
 * keystroke and on unmount.
 *
 * The default 250ms feels snappy without being so eager that we hit the
 * API while the user is still typing a word.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
