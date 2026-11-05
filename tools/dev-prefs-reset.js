// Run by tools/dev-prefs.sh --apply-import INSIDE the sandbox (after dev-prefs-import.js): proves that the prefs'
// Gio.Settings is not left in delay-apply mode by Reset / Undo / Import. After each of them a change made
// through the prefs' SpawnSettings must reach dconf, which is read by a SEPARATE process (`dconf read`).
// Usage: gjs -m tools/dev-prefs-reset.js <build dir>      (exits non-zero and throws on a failure)
import System from 'system';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const build = System.programArgs[0];
const {readArcMenuSnapshot, planMigration, applyMigration, spawnDefaults, iconInstalled} = await import(`file://${build}/migrate/arcmenu.js`);
const {SpawnSettings} = await import(`file://${build}/core/settings.js`);
const {resetKeys, resetWithUndo} = await import(`file://${build}/prefs/widgets.js`);

const PATH = '/org/gnome/shell/extensions/spawn/';
const source = Gio.SettingsSchemaSource.new_from_directory(`${build}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, PATH), source);

const dconfRead = key => {
    Gio.Settings.sync();
    const [ok, out] = GLib.spawn_command_line_sync(`dconf read ${PATH}${key}`);
    if (!ok)
        throw new Error(`dconf read ${key} failed`);
    return new globalThis.TextDecoder().decode(out).trim();
};

let failures = 0;
function check(what, key, expected) {
    const got = dconfRead(key);
    const fine = got === expected && settings.raw.delay_apply === false && settings.raw.has_unapplied === false;
    globalThis.print(`${fine ? 'ok  ' : 'FAIL'} ${what}: dconf ${key} = ${got} (expected ${expected}), delay_apply=${settings.raw.delay_apply}`);
    if (!fine)
        failures++;
}

// 1. Reset (what a group's Reset button does), then an ordinary change.
settings.set('menu-height', 700);
check('write before reset', 'menu-height', '700');
const toasts = [];
const ctx = {settings, window: {add_toast: t => toasts.push(t)}};
resetKeys(ctx, ['menu-height']);
check('after resetKeys', 'menu-height', '');
settings.set('menu-height', 810);
check('change after Reset', 'menu-height', '810');

// 2. Reset with Undo, then the Undo button, then a change.
resetWithUndo(ctx, ['menu-height'], 'reset');
check('after resetWithUndo', 'menu-height', '');
toasts[toasts.length - 1].emit('button-clicked');
check('after Undo of the reset', 'menu-height', '810');
settings.set('menu-height', 820);
check('change after Undo', 'menu-height', '820');

// 3. The real import of the sandbox ArcMenu settings, its Undo and a change after each.
const snapshot = readArcMenuSnapshot(build);
if (!snapshot)
    throw new Error('snapshot is null');
const plan = planMigration(snapshot, spawnDefaults(settings), {iconExists: v => iconInstalled(build, v)});
// dev-prefs-import.js already imported once, so the Undo below goes back to "done".
const doneBefore = dconfRead('migration-done');
const result = applyMigration(plan, settings);
check('after Import (migration-done)', 'migration-done', 'true');
settings.set('menu-height', 830);
check('change after Import', 'menu-height', '830');
settings.set('hide-activities-button', false);
check('hide-activities-button after Import', 'hide-activities-button', 'false');
settings.restore(result.undo);
check('after Undo of the import (migration-done)', 'migration-done', doneBefore);
settings.set('menu-height', 840);
check('change after Undo of the import', 'menu-height', '840');

// Leave the sandbox as the import left it.
applyMigration(plan, settings);
Gio.Settings.sync();

if (failures > 0) {
    globalThis.print(`${failures} check(s) failed`);
    throw new Error('JS ERROR: prefs settings left in delay mode / writes not reaching dconf');
}
globalThis.print('prefs settings stay writable after Reset / Undo / Import');
