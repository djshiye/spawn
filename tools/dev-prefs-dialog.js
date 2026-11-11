// Opens one prefs dialog standalone (for screenshots) inside the dev-prefs sandbox.
// Usage: gjs -m tools/dev-prefs-dialog.js <build dir> <icons|icons-system|apps|folder|shortcut|prompt|new-folder|presets|backup|backup-bad|backup-done>
import System from 'system';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [build, which] = System.programArgs;
const {SpawnSettings} = await import(`file://${build}/core/settings.js`);
const {openIconPicker} = await import(`file://${build}/prefs/iconPicker.js`);
const {chooseApplication, openFolderEditor, promptText} = await import(`file://${build}/prefs/lists.js`);
const {captureShortcut} = await import(`file://${build}/prefs/shortcutDialog.js`);
const {openPresetManager} = await import(`file://${build}/prefs/presets.js`);
const {restoreFrom} = await import(`file://${build}/prefs/backupRows.js`);
const backup = await import(`file://${build}/prefs/backup.js`);
const {toast} = await import(`file://${build}/prefs/widgets.js`);

const source = Gio.SettingsSchemaSource.new_from_directory(`${build}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.spawn', true);
const settings = new SpawnSettings(Gio.Settings.new_full(schema, null, '/org/gnome/shell/extensions/spawn/'), source);

const app = new Adw.Application({application_id: 'io.github.djshiye.Spawn.DevDialog'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: 'Spawn', default_width: 900, default_height: 700});
    window.add(new Adw.PreferencesPage());
    window.present();
    const ctx = {settings, extensionDir: build, window, metadata: {}};
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        switch (which) {
        case 'icons': openIconPicker(ctx); break;
        case 'icons-system': {
            const picker = openIconPicker(ctx);
            picker.sourceBox.selected = 3;
            picker.search.text = 'start';
            break;
        }
        case 'apps': chooseApplication(ctx, new Set(), id => globalThis.print(`picked ${id}`)); break;
        case 'folder': openFolderEditor(ctx, '3c2219f1-a114-4e2e-a06c-51fdefa91991', 'Games'); break;
        case 'shortcut': void captureShortcut(window, '<Super>space'); break;
        case 'prompt': promptText(ctx, 'Rename Folder', 'Games', 'Rename', t => globalThis.print(t)); break;
        case 'presets': openPresetManager(ctx); break;
        case 'backup':
        case 'backup-done': {
            // a backup of a configured state, restored over another one (the confirmation, or the toast after it)
            settings.set('menu-height', 700);
            settings.set('hidden-apps', ['a.desktop', 'b.desktop']);
            settings.set('pinned-apps', [{id: 'f1', name: 'Games', isFolder: 'true'}, {id: 'x.desktop'}]);
            settings.folder('f1').name = 'Games';
            settings.folder('f1').pinnedApps = [{id: 'g1.desktop'}];
            const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'spawn-settings.json']));
            backup.writeBackupFile(file, backup.createBackup(settings, '1.3.0'));
            settings.set('menu-height', 500);
            if (which === 'backup') {
                restoreFrom(ctx, file);
            } else {
                const plan = backup.parseBackup(backup.readBackupFile(file), settings).plan;
                const res = backup.applyBackup(settings, plan);
                toast(ctx, 'Settings restored', () => settings.restore(res.undo));
            }
            break;
        }
        case 'backup-bad': {
            const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'bad.json']));
            backup.writeBackupFile(file, JSON.stringify({format: 'spawn-settings', version: 1, settings: {'menu-height': '99999'}, folders: {}}));
            restoreFrom(ctx, file);
            break;
        }
        default: globalThis.print(`unknown dialog ${which}`);
        }
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
