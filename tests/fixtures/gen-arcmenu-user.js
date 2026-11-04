// Regenerates arcmenu-user.json from docs/research/user-arcmenu-settings.ini (no dconf access):
//   gjs -m tests/fixtures/gen-arcmenu-user.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(import.meta.url.replace("file://", ""))));
const src = Gio.SettingsSchemaSource.new_from_directory(`${root}/data/migration/arcmenu`, null, true);
const schema = src.lookup('org.gnome.shell.extensions.arcmenu', false);
const folderSchema = src.lookup('org.gnome.shell.extensions.arcmenu.pinned-apps-folders', false);
const [, bytes] = Gio.File.new_for_path(`${root}/docs/research/user-arcmenu-settings.ini`).load_contents(null);
const text = new globalThis.TextDecoder().decode(bytes);
const values = {}, folders = {};
let section = null;
for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = /^\[(.*)\]$/.exec(line);
    if (m) { section = m[1]; continue; }
    const i = line.indexOf('=');
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (section === '/') {
        const t = schema.get_key(k).get_value_type();
        values[k] = GLib.Variant.parse(t, v, null, null).recursiveUnpack();
    } else if (section.startsWith('pinned-apps-folders/')) {
        const t = folderSchema.get_key(k).get_value_type();
        folders[section.split('/')[1]] = GLib.Variant.parse(t, v, null, null).recursiveUnpack();
    }
}
const defaults = {};
for (const k of schema.list_keys())
    defaults[k] = schema.get_key(k).get_default_value().recursiveUnpack();
const out = {values, defaults, folders};
Gio.File.new_for_path(`${root}/tests/fixtures/arcmenu-user.json`).replace_contents(new globalThis.TextEncoder().encode(JSON.stringify(out, null, 1) + '\n'), null, false, Gio.FileCreateFlags.NONE, null);
globalThis.print(Object.keys(values).length, Object.keys(folders).length);
