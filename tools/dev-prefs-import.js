// Run by tools/dev-prefs.sh --apply-import INSIDE the sandbox: applies the real migration
// (readArcMenuSnapshot -> planMigration -> applyMigration) against the sandbox dconf.
// Usage: gjs -m tools/dev-prefs-import.js <build dir>
import System from 'system';
import Gio from 'gi://Gio';

const build = System.programArgs[0];
const {readArcMenuSnapshot, planMigration, applyMigration, spawnDefaults, iconInstalled} = await import(`file://${build}/migrate/arcmenu.js`);
const {SpawnSettings} = await import(`file://${build}/core/settings.js`);

const source = Gio.SettingsSchemaSource.new_from_directory(`${build}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, '/org/gnome/shell/extensions/spawn/'), source);

const snapshot = readArcMenuSnapshot(build);
if (!snapshot)
    throw new Error('snapshot is null');
const plan = planMigration(snapshot, spawnDefaults(settings), {iconExists: v => iconInstalled(build, v)});
const result = applyMigration(plan, settings);
Gio.Settings.sync();
globalThis.print(`applied ${plan.items.length} items (${result.written} written, ${result.reset} equal to the defaults and reset, ${result.failed.length} rejected), ${plan.folders.length} folders, ${plan.skipped.length} skipped`);
