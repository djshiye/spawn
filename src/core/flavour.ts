// Build flavour: is this a DEV build (the headless test sandbox, tools/dev-shell.sh) or a RELEASE build?
//
// A release package (tools/build.sh --release: the extension zip and the RPM) contains none of the test hooks:
// no Dev D-Bus interface, no Ui hooks (they can type keys, click and take screenshots), no benchmark. The build
// replaces this file with build-aux/release-stubs/src/core/flavour.ts, which says `DEV_BUILD = false`, and
// drops the `dev-mode` key from the packaged schema. So in a release the `dev-mode` setting cannot enable
// anything, whoever sets it: there is no code left that would read it.
//
// Public API:
//   DEV_BUILD                  true in a dev build, false in a release build
//   isDevMode(settings)        DEV_BUILD and the `dev-mode` setting is on (the only way the hooks are switched on)

import type {SpawnSettings} from './settings.js';

export const DEV_BUILD = true;

export function isDevMode(settings: SpawnSettings): boolean {
    return DEV_BUILD && settings.get('dev-mode');
}
