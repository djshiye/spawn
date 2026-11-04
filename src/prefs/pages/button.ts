// Preferences page "Button": icon, size, padding, label, click actions and context menu items of the panel button.
//
// Public API:
//   createButtonPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';

import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {createIconRow} from '../iconPicker.js';
import {createEntryList} from '../lists.js';
import {enumRow, entryRow, group, type Option, spinRow, watch} from '../widgets.js';

const CLICK: readonly Option[] = [['Menu', 'Open the menu'], ['ContextMenu', 'Open the context menu'], ['None', 'Do nothing']];

export function createButtonPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'button',
        title: 'Button',
        icon_name: 'view-app-grid-symbolic',
    });

    const appearance = enumRow(ctx, 'menu-button-appearance', 'Show', [
        ['Icon', 'Icon only'],
        ['Text', 'Text only'],
        ['Icon_Text', 'Icon, then text'],
        ['Text_Icon', 'Text, then icon'],
        ['None', 'Nothing (hidden button)'],
    ]);
    const text = entryRow(ctx, 'menu-button-text', 'Label');
    const iconRow = createIconRow(ctx);
    const iconSize = spinRow(ctx, 'menu-button-icon-size', 'Icon size', 14, 64);
    const padding = spinRow(ctx, 'menu-button-padding', 'Horizontal padding', -1, 25, {subtitle: '-1 uses the theme default'});

    page.add(group(ctx, 'Appearance', [appearance, text, iconRow, iconSize, padding], {
        reset: ['menu-button-appearance', 'menu-button-text', 'menu-button-icon', 'menu-button-icon-size', 'menu-button-padding'],
    }));

    // The icon rows only matter when the button shows an icon, the label only when it shows text.
    const refresh = (): void => {
        const mode = ctx.settings.get('menu-button-appearance');
        const hasIcon = mode === 'Icon' || mode === 'Icon_Text' || mode === 'Text_Icon';
        const hasText = mode === 'Text' || mode === 'Icon_Text' || mode === 'Text_Icon';
        iconRow.set_sensitive(hasIcon);
        iconSize.set_sensitive(hasIcon);
        text.set_sensitive(hasText);
    };
    refresh();
    watch(ctx, page, ['menu-button-appearance'], refresh);

    const clickKeys: SettingKey[] = ['menu-button-left-click-action', 'menu-button-middle-click-action', 'menu-button-right-click-action'];
    page.add(group(ctx, 'Clicks', [
        enumRow(ctx, 'menu-button-left-click-action', 'Left click', CLICK),
        enumRow(ctx, 'menu-button-middle-click-action', 'Middle click', CLICK),
        enumRow(ctx, 'menu-button-right-click-action', 'Right click', CLICK),
    ], {reset: clickKeys}));

    page.add(createEntryList(ctx, {
        title: 'Context menu',
        description: 'Shown by a click set to "Open the context menu" (right click by default), or with the Menu key on the focused button.',
        kind: 'context',
        source: {get: () => ctx.settings.get('context-menu-items'), set: v => ctx.settings.set('context-menu-items', v), keys: ['context-menu-items']},
        reset: true,
    }));
    return page;
}
