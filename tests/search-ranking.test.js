// App search ranking with the REAL appKeys + scoring (the same code AppsProvider runs), on a
// fake application list: id keys must not pollute results (finding: ".desktop" / reverse-DNS).
import {appKeys, descriptionKey, idKey} from '../build/model/appKeys.js';
import {hasAlnum, rankItemsBy, scoreApp, scoreDescription, scoreMatch} from '../build/search/rank.js';
import {assert, assertEquals, run, test} from './harness.js';

const KEY_WEIGHT = 0.7;

function app(name, id, opts = {}) {
    return {
        name,
        id,
        description: descriptionKey(opts.description),
        keys: appKeys({name, id, genericName: opts.generic, keywords: opts.keywords, executable: opts.exec, fullName: opts.fullName}),
    };
}

const APPS = [
    app('Files', 'org.gnome.Nautilus.desktop', {description: 'Access and organize files', generic: 'File Manager', exec: '/usr/bin/nautilus', keywords: ['folder', 'manager']}),
    app('GNOME Terminal', 'org.gnome.Terminal.desktop', {generic: 'Terminal', exec: 'gnome-terminal'}),
    app('Text Editor', 'org.gnome.TextEditor.desktop', {keywords: ['text', 'editor']}),
    app('Settings', 'org.gnome.Settings.desktop', {exec: 'gnome-control-center', keywords: ['preferences']}),
    app('Calculator', 'org.gnome.Calculator.desktop'),
    app('Spotify', 'com.spotify.Client.desktop', {generic: 'Music Player', exec: 'spotify'}),
    app('Compressor', 'com.github.huluti.Compressor.desktop', {generic: 'Image Compressor'}),
    app('Visual Studio Code', 'code.desktop', {generic: 'Text Editor', exec: '/usr/share/code/code', keywords: ['vscode']}),
    app('Firefox', 'org.mozilla.firefox.desktop', {exec: 'firefox', description: 'Browse the Web'}),
    app('Flatseal', 'com.github.tchx84.Flatseal.desktop', {description: 'Manage Flatpak permissions', keywords: ['seal', 'sandbox', 'override']}),
    app('Flatpak Installer', 'org.example.FlatpakInstaller.desktop', {description: 'Install bundles'}),
    app('Software', 'org.gnome.Software.desktop', {description: 'Add, remove or update software on this computer', keywords: ['flatpak', 'packages']}),
    app('Bottles', 'com.usebottles.bottles.desktop', {exec: '/usr/bin/flatpak', description: 'Run Windows software'}),
    app('Notes', 'org.example.Notes.desktop', {description: 'Take notes; search in your terminal, firefox, settings and code snippets'}),
    app('Desktop Icons Settings', 'org.example.DesktopIcons.desktop'),
    app('Organizer', 'io.github.someone.Organizer.desktop'),
    app('LibreOffice Writer', 'libreoffice-writer.desktop', {exec: 'libreoffice'}),
];

function search(query) {
    return rankItemsBy(query, APPS, (a, q) => scoreApp(q, a.name, a.keys, KEY_WEIGHT, a.description)).map(r => r.item.name);
}

test('idKey drops .desktop and reverse-DNS prefixes', () => {
    assertEquals(idKey('org.gnome.Nautilus.desktop'), 'Nautilus');
    assertEquals(idKey('com.spotify.Client'), 'Client');
    assertEquals(idKey('io.github.someone.Organizer.desktop'), 'Organizer');
    assertEquals(idKey('code.desktop'), 'code');
    assertEquals(idKey('gnome-terminal.desktop'), 'gnome-terminal');
    assertEquals(idKey('foo.bar'), 'foo.bar');
});

test('"code": Visual Studio Code first, no Spotify / Compressor', () => {
    const r = search('code');
    assertEquals(r[0], 'Visual Studio Code');
    assert(!r.includes('Spotify'), JSON.stringify(r));
    assert(!r.includes('Compressor'), JSON.stringify(r));
});

test('"desk" only matches things that really contain it', () => {
    assertEquals(search('desk'), ['Desktop Icons Settings']);
    assertEquals(search('desktop'), ['Desktop Icons Settings']);
});

test('"org" does not match every org.* app', () => {
    const r = search('org');
    assertEquals(r[0], 'Organizer');
    assert(r.length <= 2, JSON.stringify(r)); // Files only via its description "organize files"
    assert(!r.includes('Calculator') && !r.includes('Firefox'), JSON.stringify(r));
});

test('"gnome" finds GNOME Terminal (and the control center via exec), not every org.gnome app', () => {
    const r = search('gnome');
    assertEquals(r[0], 'GNOME Terminal');
    assert(!r.includes('Files') && !r.includes('Calculator') && !r.includes('Text Editor'), JSON.stringify(r));
});

test('id, exec and keywords still find apps', () => {
    assertEquals(search('nautilus')[0], 'Files');
    assertEquals(search('vscode')[0], 'Visual Studio Code');
    assertEquals(search('fire')[0], 'Firefox');
    assertEquals(search('lo writer')[0], 'LibreOffice Writer');
});

test('"flatpak" finds Flatseal through its description, name matches first', () => {
    const r = search('flatpak');
    assertEquals(r[0], 'Flatpak Installer');
    assert(r.includes('Flatseal'), JSON.stringify(r));
    assert(r.indexOf('Flatseal') > r.indexOf('Flatpak Installer'), JSON.stringify(r));
    assert(!r.includes('Bottles'), 'generic launcher exec (flatpak) must not be a key: ' + JSON.stringify(r));
});

test('"permissions" finds Flatseal; whole word / prefix / inner substring, no fuzzy', () => {
    assertEquals(search('permissions')[0], 'Flatseal');
    assertEquals(search('permis')[0], 'Flatseal');
    assertEquals(search('rmission')[0], 'Flatseal');
    assert(!search('pmsn').includes('Flatseal'));
    assert(!search('mp').includes('Flatseal')); // too short for descriptions
    assert(!search('mng').includes('Flatseal'));
    assertEquals(scoreDescription('manage', descriptionKey('Manage Flatpak permissions')) > 0, true);
    assertEquals(scoreDescription('man pe', descriptionKey('Manage Flatpak permissions')), 0); // 'pe' too short
    assertEquals(scoreDescription('manage perm', descriptionKey('Manage Flatpak permissions')) > 0, true);
    assertEquals(scoreDescription('manage zzz', descriptionKey('Manage Flatpak permissions')), 0);
});

test('X-GNOME-FullName is an ordinary key', () => {
    assert(appKeys({name: 'Terminal', fullName: 'GNOME Terminal'}).includes('gnome terminal'));
});

test('description matches never outrank name matches (code / fire / term / set)', () => {
    assertEquals(search('code')[0], 'Visual Studio Code');
    assertEquals(search('fire')[0], 'Firefox');
    assertEquals(search('term')[0], 'GNOME Terminal');
    assertEquals(search('set')[0], 'Settings');
    // A description-only hit (Notes) is listed after every name hit at word / substring level.
    for (const q of ['code', 'fire', 'term', 'set'])
        assert(search(q).indexOf('Notes') !== 0, q);
});

test('punctuation-only queries have no alphanumerics', () => {
    assert(!hasAlnum('.') && !hasAlnum('-') && !hasAlnum(' ?! '));
    assert(hasAlnum('a.') && hasAlnum('2+2') && hasAlnum('日本'));
});

test('uncased scripts: the second word of a CJK title is a word prefix', () => {
    const second = scoreMatch('テスト', '日本語 テスト');
    const inside = scoreMatch('テスト', '日本語テスト');
    assert(second >= 700, `second word ${second}`);
    assert(inside < 700 && inside > 0, `inside ${inside}`);
});

run();
