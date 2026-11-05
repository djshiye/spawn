// Preferences page "Pinned & Shortcuts": pinned apps and folders, directory and application
// shortcuts (all reorderable) and the power buttons.
//
// Public API:
//   createPinnedPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';

import {PowerType} from '../../core/constants.js';
import type {PrefsContext} from '../context.js';
import {createEntryList} from '../lists.js';
import {toggleListGroup} from '../toggleList.js';
import {enumRow, group, switchRow} from '../widgets.js';

const POWER: ReadonlyArray<readonly [number, string, string]> = [
    [PowerType.LOGOUT, 'Log Out', 'system-log-out-symbolic'],
    [PowerType.LOCK, 'Lock', 'system-lock-screen-symbolic'],
    [PowerType.RESTART, 'Restart', 'system-reboot-symbolic'],
    [PowerType.POWER_OFF, 'Power Off', 'system-shutdown-symbolic'],
    [PowerType.SUSPEND, 'Suspend', 'media-playback-pause-symbolic'],
    [PowerType.HYBRID_SLEEP, 'Hybrid Sleep', 'weather-clear-night-symbolic'],
    [PowerType.HIBERNATE, 'Hibernate', 'weather-clear-night-symbolic'],
    [PowerType.SWITCH_USER, 'Switch User', 'system-users-symbolic'],
];

export function createPinnedPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'pinned',
        title: 'Pinned & Shortcuts',
        icon_name: 'starred-symbolic',
    });
    const s = ctx.settings;

    const pinned = createEntryList(ctx, {
        title: 'Pinned apps',
        description: 'Shown in the pinned view. Folders can hold several apps.',
        kind: 'pinned',
        source: {get: () => s.get('pinned-apps'), set: v => s.set('pinned-apps', v), keys: ['pinned-apps']},
        reset: true,
    });
    page.add(pinned);

    const directories = createEntryList(ctx, {
        title: 'Folder shortcuts',
        description: 'Places listed in the right pane.',
        kind: 'directory',
        source: {get: () => s.get('directory-shortcuts'), set: v => s.set('directory-shortcuts', v), keys: ['directory-shortcuts']},
        reset: true,
    });
    page.add(directories);

    const applications = createEntryList(ctx, {
        title: 'Application shortcuts',
        description: 'Apps, commands and separators listed in the right pane.',
        kind: 'application',
        source: {get: () => s.get('application-shortcuts'), set: v => s.set('application-shortcuts', v), keys: ['application-shortcuts']},
        reset: true,
    });
    page.add(applications);

    page.add(group(ctx, 'Extra shortcuts', [
        switchRow(ctx, 'show-external-devices', 'External devices', 'Mounted drives and network locations, with an eject button'),
        switchRow(ctx, 'show-bookmarks', 'Bookmarks', 'The bookmarks of the Files sidebar'),
    ], {reset: ['show-external-devices', 'show-bookmarks'], description: 'Listed between the folder shortcuts and the application shortcuts.'}));

    page.add(toggleListGroup(ctx, {
        key: 'power-options',
        title: 'Power buttons',
        description: 'Choose which buttons appear and in which order.',
        items: POWER,
        fallbackIcon: 'system-shutdown-symbolic',
        resetKeys: ['power-options', 'power-display-style'],
        resetMessage: 'Power buttons reset to defaults',
    }));
    page.add(group(ctx, 'Power button style', [
        enumRow(ctx, 'power-display-style', 'Show power buttons as', [
            ['Default', 'Buttons at the bottom'],
            ['In_Line', 'Buttons in line with the shortcuts'],
            ['Menu', 'A single power menu'],
        ]),
    ]));
    return page;
}
