// RELEASE replacement for src/ui/devHooks.ts: the Ui test hooks do not exist in a release build.
// Copied over the real file by tools/build.sh --release.

import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import type {AppIndex} from '../model/appIndex.js';
import type {SpawnPopup} from './menu.js';

export function installUiDevHooks(_scope: Scope, _settings: SpawnSettings, _popup: SpawnPopup, _appIndex: AppIndex): void {
}
