// The panel button settings, shown on the General page: what the button shows and where it sits (main page),
// plus its size, padding, click actions and context menu (the "More button options" sub-page).
//
// Public API:
//   panelButtonGroup(ctx: PrefsContext): Adw.PreferencesGroup     the "Panel button" group of the General page
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {createIconRow} from '../iconPicker.js';
import {createEntryList} from '../lists.js';
import {enumRow, entryRow, group, label, type Option, spinRow, subpageRow, switchRow, watch} from '../widgets.js';

const CLICK: readonly Option[] = [['Menu', 'Open the menu'], ['ContextMenu', 'Open the context menu'], ['None', 'Do nothing']];

/** `menu-position-alignment`: a 0..100 slider (Left - Centre - Right), shown only while the button is centred in the panel. */
function alignmentRow(ctx: PrefsContext): Adw.ActionRow {
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1, page_increment: 10, value: ctx.settings.get('menu-position-alignment')}),
        digits: 0,
        draw_value: false,
        hexpand: true,
        valign: Gtk.Align.CENTER,
        width_request: 220,
    });
    scale.add_mark(0, Gtk.PositionType.BOTTOM, 'Left');
    scale.add_mark(50, Gtk.PositionType.BOTTOM, 'Centre');
    scale.add_mark(100, Gtk.PositionType.BOTTOM, 'Right');
    label(scale, 'Menu alignment');
    ctx.settings.raw.bind('menu-position-alignment', scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    const row = new Adw.ActionRow({
        title: 'Menu alignment',
        subtitle: 'Where the menu opens under a centred button',
        activatable_widget: scale,
    });
    row.add_suffix(scale);
    const refresh = (): void => {
        row.visible = ctx.settings.get('position-in-panel') === 'Center';
    };
    refresh();
    watch(ctx, row, ['position-in-panel'], refresh);
    return row;
}

/** The sub-page with the button settings most people never change. */
function moreButtonGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    const iconSize = spinRow(ctx, 'menu-button-icon-size', 'Icon size', 14, 64, {subtitle: 'In pixels'});
    const refresh = (): void => {
        const mode = ctx.settings.get('menu-button-appearance');
        iconSize.set_visible(mode === 'Icon' || mode === 'Icon_Text' || mode === 'Text_Icon');
    };
    refresh();
    watch(ctx, iconSize, ['menu-button-appearance'], refresh);

    const sizeKeys: SettingKey[] = ['menu-button-icon-size', 'menu-button-padding', 'menu-button-position-offset'];
    const clickKeys: SettingKey[] = ['menu-button-left-click-action', 'menu-button-middle-click-action', 'menu-button-right-click-action'];
    return [
        group(ctx, 'Size and spacing', [
            iconSize,
            spinRow(ctx, 'menu-button-padding', 'Horizontal padding', -1, 25, {subtitle: 'In pixels', special: [{value: -1, label: 'Default'}]}),
            spinRow(ctx, 'menu-button-position-offset', 'Position offset', 0, 20, {
                subtitle: 'Number of panel items to skip from the chosen edge',
            }),
        ], {reset: sizeKeys}),
        group(ctx, 'Clicks', [
            enumRow(ctx, 'menu-button-left-click-action', 'Left click', CLICK),
            enumRow(ctx, 'menu-button-middle-click-action', 'Middle click', CLICK),
            enumRow(ctx, 'menu-button-right-click-action', 'Right click', CLICK),
        ], {reset: clickKeys}),
        createEntryList(ctx, {
            title: 'Context menu',
            description: 'Shown by a click set to “Open the context menu” (right click by default), or with the Menu key on the focused button.',
            kind: 'context',
            source: {get: () => ctx.settings.get('context-menu-items'), set: v => ctx.settings.set('context-menu-items', v), keys: ['context-menu-items']},
            reset: true,
        }),
    ];
}

export function panelButtonGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const appearance = enumRow(ctx, 'menu-button-appearance', 'Show', [
        ['Icon', 'Icon only'],
        ['Text', 'Text only'],
        ['Icon_Text', 'Icon, then text'],
        ['Text_Icon', 'Text, then icon'],
        ['None', 'Nothing (hidden button)'],
    ]);
    const iconRow = createIconRow(ctx);
    const text = entryRow(ctx, 'menu-button-text', 'Label');

    // Only the rows that apply to what the button shows are on screen.
    const refresh = (): void => {
        const mode = ctx.settings.get('menu-button-appearance');
        iconRow.set_visible(mode === 'Icon' || mode === 'Icon_Text' || mode === 'Text_Icon');
        text.set_visible(mode === 'Text' || mode === 'Icon_Text' || mode === 'Text_Icon');
    };
    refresh();
    watch(ctx, appearance, ['menu-button-appearance'], refresh);

    const more = subpageRow(ctx, {
        title: 'More button options',
        subtitle: 'Size, padding, clicks and the right-click menu',
        build: () => moreButtonGroups(ctx),
    });

    return group(ctx, 'Panel button', [
        appearance,
        iconRow,
        text,
        enumRow(ctx, 'position-in-panel', 'Position', [['Left', 'Left'], ['Center', 'Centre'], ['Right', 'Right']]),
        alignmentRow(ctx),
        switchRow(ctx, 'multi-monitor', 'Show on every monitor', 'Add the button to the panel of each monitor (Dash to Panel)'),
        switchRow(ctx, 'hide-activities-button', 'Hide the Activities button', 'Restored to its previous state when Spawn is turned off'),
        more,
    ], {
        reset: [
            'menu-button-appearance', 'menu-button-text', 'menu-button-icon', 'position-in-panel',
            'menu-position-alignment', 'multi-monitor', 'hide-activities-button',
        ],
    });
}
