// AppIndex itself needs Shell/GMenu (only available inside gnome-shell); its pure search-key
// helpers are covered here.
import {appKeys, normalize} from '../build/model/appKeys.js';
import {assertEquals, run, test} from './harness.js';

test('normalize lower-cases and folds diacritics', () => {
    assertEquals(normalize('Éditeur de Texte'), 'editeur de texte');
    assertEquals(normalize('Ångström ÖL'), 'angstrom ol');
    assertEquals(normalize('  Files '), 'files');
});

test('normalize tolerates empty input', () => {
    assertEquals(normalize(null), '');
    assertEquals(normalize(undefined), '');
    assertEquals(normalize(''), '');
});

test('appKeys collects name, generic name, keywords, executable and id', () => {
    const keys = appKeys({
        name: 'Files',
        genericName: 'File Manager',
        keywords: ['Folder', 'Manager', 'Explore'],
        executable: '/usr/bin/nautilus',
        id: 'org.gnome.Nautilus.desktop',
    });
    assertEquals(keys, ['files', 'file manager', 'folder', 'manager', 'explore', 'nautilus']);
});

test('appKeys deduplicates after normalisation and drops empties', () => {
    const keys = appKeys({name: 'Café', genericName: 'cafe', keywords: ['', 'CAFÉ', 'Tea'], executable: 'cafe', id: ''});
    assertEquals(keys, ['cafe', 'tea']);
});

test('appKeys keeps only the last segment of a reverse-DNS id, never the .desktop form', () => {
    assertEquals(appKeys({id: 'com.spotify.Client.desktop'}), ['client']);
    assertEquals(appKeys({id: 'code.desktop'}), ['code']);
    assertEquals(appKeys({id: 'gnome-terminal.desktop'}), ['gnome-terminal']);
});

test('appKeys ignores generic launcher executables (flatpak, env, ...)', () => {
    assertEquals(appKeys({name: 'Bottles', executable: '/usr/bin/flatpak', id: 'com.usebottles.bottles.desktop'}), ['bottles']);
    assertEquals(appKeys({name: 'Foo', fullName: 'GNOME Foo', executable: 'foo'}), ['foo', 'gnome foo']);
});

test('appKeys handles missing parts', () => {
    assertEquals(appKeys({}), []);
    assertEquals(appKeys({id: 'foo'}), ['foo']);
});

run();
