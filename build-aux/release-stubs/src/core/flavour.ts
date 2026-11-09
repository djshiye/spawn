// RELEASE replacement for src/core/flavour.ts (see there). Copied over the real file by tools/build.sh --release.

import type {SpawnSettings} from './settings.js';

export const DEV_BUILD = false;

export function isDevMode(_settings: SpawnSettings): boolean {
    return false;
}
