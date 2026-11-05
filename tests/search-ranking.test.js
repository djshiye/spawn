// App search ranking with the REAL appKeys + scoring (the same code AppsProvider runs), on a
// fake application list: id keys must not pollute results (finding: ".desktop" / reverse-DNS).
import {appKeys, descriptionKey, idKey} from '../build/model/appKeys.js';
import {APP_KEY_WEIGHT, DESCRIPTION_WEIGHT, USAGE_BOOST_MAX, applyRelativeCutoff, applyUsageBoost, hasAlnum, rankApps, scoreApp, scoreDescription, scoreMatch, scoreNormalized} from '../build/search/rank.js';
import {assert, assertEquals, run, test} from './harness.js';

const KEY_WEIGHT = APP_KEY_WEIGHT;

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

function search(query, apps = APPS) {
    return rankApps(query, apps).map(r => r.item.name);
}

function scores(query, apps) {
    return Object.fromEntries(rankApps(query, apps).map(r => [r.item.name, r.score]));
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

// Synthetic entries mirroring the user's real apps (name / keywords / exec / id / description).
const REAL = [
    app('Visual Studio Code', 'code.desktop', {exec: '/usr/share/code/code', keywords: ['vscode'], description: 'Code editing. Redefined.'}),
    app('Claude', 'claude.desktop', {keywords: ['AI Assistant', 'ai', 'chat', 'assistant', 'code', 'llm'], exec: 'claude-desktop'}),
    app('Husk', 'husk.desktop', {description: 'A terminal for code and shells'}),
    app('Files', 'org.gnome.Nautilus.desktop', {exec: 'nautilus', keywords: ['folder', 'manager'], description: 'Access and organize files'}),
    app('Audio Player', 'audio-player.desktop', {description: 'Play audio files'}),
    app('qBittorrent', 'org.qbittorrent.qBittorrent.desktop', {description: 'Download and share files over BitTorrent'}),
    app('Firefox', 'firefox.desktop', {exec: 'firefox', keywords: ['web', 'browser', 'internet']}),
    app('ArtCraft Launcher', 'ai.storyteller.artcraft.desktop', {exec: 'artcraft'}),
    app('PdfCraft', 'ai.storyteller.pdfcraft.desktop', {keywords: ['pdf editor', 'annotate']}),
    app('Prism Launcher', 'org.prismlauncher.PrismLauncher.desktop', {exec: 'prismlauncher', keywords: ['game', 'minecraft', 'mc']}),
    app('ProtonUp-Qt', 'net.davidotek.pupgui2.desktop', {exec: 'pupgui2'}),
    app('FL Studio', 'bottles-flstudio.desktop', {exec: 'bottles-flstudio-flstudio'}),
    app('Flatseal', 'com.github.tchx84.Flatseal.desktop', {keywords: ['seal', 'sandbox']}),
    app('SPT - Launcher', 'spt-launcher.desktop', {exec: '"/opt/spt/launcher.sh"'}),
    app('SPT - Server', 'spt-server.desktop', {exec: '"/opt/spt/server.sh"'}),
    app('Chrome Remote Desktop', 'chrome-crd.desktop', {exec: '/home/u/Apps/helium.appimage'}),
    app('Helium', 'helium.desktop', {exec: 'helium'}),
    app('Maps', 'org.gnome.Maps.desktop', {exec: 'gapplication launch org.gnome.Maps'}),
    app('Tweaks', 'org.gnome.tweaks.desktop', {keywords: ['settings', 'preferences', 'fonts', 'theme', 'startup']}),
    app('Weather', 'org.gnome.Weather.desktop', {keywords: ['forecast']}),
    app('GridCraft', 'ai.storyteller.gridcraft.desktop', {keywords: ['spreadsheet', 'pivot', 'excel']}),
    app('Private Internet Access', 'piavpn.desktop', {exec: 'piavpn'}),
    app('Camera', 'org.gnome.Snapshot.desktop', {keywords: ['picture', 'photos', 'webcam']}),
    app('Image Viewer', 'org.gnome.Loupe.desktop', {keywords: ['picture', 'graphics', 'loupe']}),
    app('System Monitor', 'gnome-system-monitor.desktop', {keywords: ['monitor', 'system', 'process', 'cpu'], exec: 'gnome-system-monitor'}),
    app('Disks', 'org.gnome.DiskUtility.desktop', {keywords: ['disk', 'drive', 'smart', 'partition'], exec: 'gnome-disks'}),
    app('Kvantum Manager', 'kvantummanager.desktop', {exec: 'kvantummanager'}),
    app('Extension Manager', 'com.mattjakeman.ExtensionManager.desktop'),
    app('Foo Page', 'page.codeberg.Foo.desktop'),
];

test('"code": the name beats a keyword (VS Code well ahead of Claude), description hits trail', () => {
    const s = scores('code', REAL);
    const names = Object.keys(s);
    assertEquals(names[0], 'Visual Studio Code');
    assertEquals(names[1], 'Claude');
    assert(s['Visual Studio Code'] - s.Claude >= 100, JSON.stringify(s));
    assert(s.Husk < s.Claude, JSON.stringify(s));
});

test('"files": the name match first, description hits are capped below the name-substring band', () => {
    const s = scores('files', REAL);
    assertEquals(Object.keys(s)[0], 'Files');
    for (const other of ['Audio Player', 'qBittorrent']) {
        assert(s[other] > 0 && s[other] <= 380, `${other} ${s[other]}`);
        assert(s[other] < 400, other);
    }
    assert(DESCRIPTION_WEIGHT * 1000 < 400);
});

test('relative cutoff: a strong top drops the fuzzy tail ("fir" -> only Firefox)', () => {
    assertEquals(search('fir', REAL), ['Firefox']);
    assertEquals(search('fire', REAL), ['Firefox']);
});

test('relative cutoff never applies when the best match is weak', () => {
    const items = [{item: 'a', score: 500}, {item: 'b', score: 100}, {item: 'c', score: 90}];
    assertEquals(applyRelativeCutoff(items).length, 3);
    assertEquals(applyRelativeCutoff([{item: 'a', score: 799}, {item: 'b', score: 1}]).length, 2);
});

test('relative cutoff: >= 800 drops below 25 % of the top, keeps the top, honours the limit', () => {
    const r = [{item: 'a', score: 880}, {item: 'b', score: 400}, {item: 'c', score: 221}, {item: 'd', score: 219}, {item: 'e', score: 5}];
    assertEquals(applyRelativeCutoff(r).map(x => x.item), ['a', 'b', 'c']);
    assertEquals(applyRelativeCutoff([{item: 'a', score: 1000}]).length, 1);
    assertEquals(applyRelativeCutoff([]).length, 0);
    assertEquals(rankApps('fire', [{name: 'Firefox', keys: ['firefox'], description: ''}], 0).length, 0);
});

test('stop words are ignored in descriptions', () => {
    const d = descriptionKey('Browse the web and manage your files with a tool of choice');
    for (const q of ['the', 'and', 'for', 'a', 'an', 'of', 'to', 'in', 'with', 'your', 'you', 'the and'])
        assertEquals(scoreDescription(q, d), 0);
    assert(scoreDescription('browse the web', d) > 0); // the stop word is skipped, the others match
    assert(scoreDescription('files', d) > 0);
    // "the" still finds names / keywords: Tweaks has the keyword "theme", Weather has it in its name
    const names = search('the', REAL);
    assert(names.includes('Tweaks') && names.includes('Weather'), JSON.stringify(names));
    assert(!search('the', [app('Notes', 'notes.desktop', {description: 'Take the notes'})]).includes('Notes'));
});

test('2-letter queries: name word starts and acronyms beat keyword prefixes ("pi", "sm")', () => {
    const pi = search('pi', REAL);
    assertEquals(pi[0], 'Private Internet Access');
    assert(pi.indexOf('GridCraft') > 0 && pi.indexOf('Camera') > 0, JSON.stringify(pi));
    const sm = search('sm', REAL);
    assertEquals(sm[0], 'System Monitor');
    assert(sm.indexOf('Disks') > 0, JSON.stringify(sm));
    // a name word prefix beats any keyword exact/prefix at 2 letters
    const x = [app('Alpha Tool', 'a.desktop'), app('Beta', 'b.desktop', {keywords: ['to', 'tool']})];
    assertEquals(search('to', x)[0], 'Alpha Tool');
});

test('multi-word queries across name and keywords', () => {
    assertEquals(search('minecraft launcher', REAL)[0], 'Prism Launcher');
    assertEquals(search('file manager', REAL)[0], 'Files');
    assertEquals(search('launcher minecraft', REAL)[0], 'Prism Launcher');
    assertEquals(search('minecraft zzz', REAL), []);
    // single-key matches are untouched (cross-key is only a fallback)
    assertEquals(search('visual studio', REAL)[0], 'Visual Studio Code');
    assertEquals(search('fl s', REAL)[0], 'FL Studio');
    assert(scores('fl s', REAL).Flatseal === undefined || scores('fl s', REAL).Flatseal < 400);
    assert(scoreApp('minecraft launcher', 'Prism Launcher', ['prism launcher', 'minecraft'], KEY_WEIGHT, '') > 400);
});

test('- _ . in the query count as word breaks', () => {
    assertEquals(search('fl-studio', REAL)[0], 'FL Studio');
    assertEquals(search('fl_studio', REAL)[0], 'FL Studio');
    assertEquals(search('fl.studio', REAL)[0], 'FL Studio');
    assertEquals(search('proton-up', REAL)[0], 'ProtonUp-Qt');
    assertEquals(search('protonup-qt', REAL)[0], 'ProtonUp-Qt');
    assertEquals(search('spt-server', REAL)[0], 'SPT - Server');
    assert(scores('fl-studio', REAL)['FL Studio'] >= 800);
    // a key that contains the separator keeps matching as typed
    assertEquals(search('gnome-system-monitor', REAL)[0], 'System Monitor');
    assert(scoreMatch('-', 'x') === 0 && scoreMatch('.-_', 'x.y') === 0);
});

test('key hygiene: quotes, wrapper executables and AppImage paths are not keys', () => {
    const spt = REAL.find(a => a.name === 'SPT - Launcher');
    assert(!spt.keys.some(k => k.includes('"')), JSON.stringify(spt.keys));
    assert(spt.keys.includes('launcher.sh'));
    assertEquals(search('helium', REAL), ['Helium']);
    assert(!REAL.find(a => a.name === 'Chrome Remote Desktop').keys.some(k => k.includes('helium')));
    assert(!REAL.find(a => a.name === 'Maps').keys.includes('gapplication'));
    for (const exe of ['gtk-launch', 'nohup', 'uwsm', 'electron', 'node', 'python3.12', 'perl', '/home/u/Apps/Foo.AppImage', '"/x/y/flatpak"'])
        assertEquals(appKeys({name: 'X', executable: exe}), ['x'], exe);
    assertEquals(appKeys({name: 'X', executable: "'/opt/x/run.sh'"}), ['x', 'run.sh']);
});

test('idKey: more reverse-DNS shapes', () => {
    assertEquals(idKey('page.codeberg.Foo.desktop'), 'Foo');
    assertEquals(idKey('chat.example.App'), 'App');
    assertEquals(idKey('one.example.App'), 'App');
    assertEquals(idKey('sh.example.App'), 'App');
    assertEquals(idKey('xyzzy.vendor.Thing'), 'Thing');
    assertEquals(idKey('Foo.bar.baz'), 'Foo.bar.baz'); // capitalised first segment: not reverse-DNS
    assertEquals(idKey('some-app.beta'), 'some-app.beta');
    assertEquals(search('codeberg', REAL), []);
});

// --- "ff" -> Firefox (doubled initial) and initials / acronyms ---

test('"ff" finds Firefox first, ahead of substring hits in Coffee / LibreOffice (was: only FL Studio via its exec key)', () => {
    for (const list of [APPS, REAL]) {
        const r = search('ff', list);
        assertEquals(r[0], 'Firefox', JSON.stringify(r));
    }
    const withNoise = [...APPS, app('Coffee Break', 'coffee.desktop'), app('FL Studio', 'bottles-flstudio.desktop', {exec: 'bottles-flstudio-flstudio'})];
    const s = scores('ff', withNoise);
    assertEquals(Object.keys(s)[0], 'Firefox');
    assert(s.Firefox > s['LibreOffice Writer'] && s.Firefox > s['Coffee Break'], JSON.stringify(s));
});

test('doubled-initial tier is narrow: names only, same word, close, two identical letters', () => {
    assert(scoreNormalized('ff', 'Firefox') === 0, 'off by default (windows / files)');
    assert(scoreNormalized('ff', 'Firefox', true) >= 470 && scoreNormalized('ff', 'Firefox', true) < 540);
    assertEquals(search('fx', REAL), []); // not a doubled letter
    assertEquals(search('ss', [app('Settings', 's.desktop')]), []); // too far apart (window)
    assertEquals(search('ff', [app('Fan Fan', 'x.desktop')]).length, 1); // acronym of two words, as before
    assert(search('tt', [app('Text Editor', 'te.desktop')]).includes('Text Editor'));
    // keys (keywords, exec, id) never use it: only the display name does
    assertEquals(search('ff', [app('Web', 'w.desktop', {exec: 'firefox'})]), []);
    // it does not touch letters inside another word
    assertEquals(search('ff', [app('Alpha Beta', 'ab.desktop')]), []);
});

test('2-letter queries gain no junk: "fi" / "fir" / "of" are unchanged by initials', () => {
    const fi = search('fi', REAL);
    assertEquals(fi[0], 'Files');
    assertEquals(fi[1], 'Firefox');
    const withFoxit = [...REAL, app('Foxit Reader', 'foxit.desktop'), app('Fantasy Intro', 'fi.desktop')];
    assert(!search('fi', withFoxit).includes('Foxit Reader') || scores('fi', withFoxit)['Foxit Reader'] < 470, 'fi must not add Foxit through an initials match');
    assertEquals(search('fir', REAL), ['Firefox']);
    // the initials tier fires for doubled letters only: every other 2-letter query scores exactly as without it
    const names = [...REAL, ...APPS].map(a => a.name);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (const x of letters) {
        for (const y of letters) {
            if (x === y)
                continue;
            for (const name of names)
                assertEquals(scoreNormalized(x + y, name, true), scoreNormalized(x + y, name, false), `${x}${y} ${name}`);
        }
    }
});

test('acronyms: vsc -> Visual Studio Code, gs -> GNOME Software, gt -> GNOME Terminal', () => {
    assertEquals(search('vsc', REAL)[0], 'Visual Studio Code');
    const sw = [app('GNOME Software', 'org.gnome.Software.desktop'), app('Settings', 's.desktop'), app('Calculator', 'c.desktop')];
    assertEquals(search('gs', sw)[0], 'GNOME Software');
    assertEquals(search('gt', APPS)[0], 'GNOME Terminal');
});

// --- usage as a tie-break ---

function usageFrom(order) { // most used first -> 0..1, like AppIndex.usageScore
    const m = new Map(order.map((id, i) => [id, (order.length - i) / order.length]));
    return id => m.get(id) ?? 0;
}

function searchU(query, apps, usageOf) {
    return rankApps(query, apps, undefined, usageOf).map(r => r.item.name);
}

test('usage breaks ties inside a tier: the more used of two near-equal name prefixes goes first', () => {
    const apps = [app('Firefox', 'firefox.desktop'), app('Firejail', 'firejail.desktop')];
    assertEquals(searchU('fi', apps), ['Firefox', 'Firejail']); // no usage: shorter name first, as before
    assertEquals(searchU('fi', apps, () => 0), ['Firefox', 'Firejail']);
    assertEquals(searchU('fi', apps, usageFrom(['firejail.desktop'])), ['Firejail', 'Firefox']);
    assertEquals(searchU('fi', apps, usageFrom(['firejail.desktop', 'firefox.desktop'])), ['Firejail', 'Firefox']);
    assertEquals(searchU('fi', apps, usageFrom(['firefox.desktop', 'firejail.desktop'])), ['Firefox', 'Firejail']);
    // a clearly better name match (Files, 7 points of name ratio) is not overtaken by a hot Firejail
    assertEquals(searchU('fi', [app('Firejail', 'firejail.desktop'), app('Files', 'files.desktop')], usageFrom(['firejail.desktop'])), ['Files', 'Firejail']);
});

test('usage never lifts a weaker tier over a better text match', () => {
    const apps = [app('Code Runner', 'cr.desktop'), app('Claude', 'claude.desktop', {keywords: ['code']}), app('Notes', 'n.desktop', {description: 'edit code snippets'})];
    const base = scores('code', apps);
    const usage = usageFrom(['n.desktop', 'claude.desktop', 'cr.desktop']);
    const boosted = Object.fromEntries(rankApps('code', apps, undefined, usage).map(r => [r.item.name, r.score]));
    assertEquals(Object.keys(boosted), Object.keys(base));
    for (const name of Object.keys(base))
        assert(boosted[name] - base[name] <= USAGE_BOOST_MAX, `${name} ${base[name]} -> ${boosted[name]}`);
    // exhaustive: any single heavily used app, any query, never changes the tier order
    for (const q of ['code', 'co', 'fir', 'fl', 'set', 'term', 'ff', 'vsc', 'files', 'manager', 'flatpak']) {
        const text = rankApps(q, REAL);
        for (const hot of REAL) {
            const out = rankApps(q, REAL, undefined, id => id === hot.id ? 1 : 0);
            assertEquals(out.length, text.length, q);
            const textScore = new Map(text.map(r => [r.item.name, r.score]));
            for (const a of out) {
                for (const b of out) {
                    if (textScore.get(a.item.name) - textScore.get(b.item.name) > USAGE_BOOST_MAX && out.indexOf(a) > out.indexOf(b)) {
                        // a clearly better text match must not end up behind b
                        throw new Error(`${q}: ${a.item.name} (${textScore.get(a.item.name)}) behind ${b.item.name} (${textScore.get(b.item.name)}) with ${hot.name} hot`);
                    }
                }
            }
        }
    }
});

test('usage is clamped to the tier: prefix 850+ stays below exact 1000, substring stays below the initials / acronym tiers', () => {
    const ranked = [{item: {id: 'a'}, score: 459}, {item: {id: 'b'}, score: 465}];
    const out = applyUsageBoost(ranked, id => (id === 'a' ? 1 : 0));
    assert(out.find(r => r.item.id === 'a').score <= 469, JSON.stringify(out)); // substring ceiling = 469
    const hi = applyUsageBoost([{item: {id: 'a'}, score: 897}, {item: {id: 'b'}, score: 700}], () => 1);
    assert(hi[0].score <= 999 && hi[1].score <= 849, JSON.stringify(hi));
    const exact = applyUsageBoost([{item: {id: 'a'}, score: 1000}], () => 1);
    assertEquals(exact[0].score, 1000 + USAGE_BOOST_MAX);
    const edge = applyUsageBoost([{item: {id: 'a'}, score: 538}, {item: {id: 'b'}, score: 541}], id => (id === 'a' ? 1 : 0));
    assertEquals(edge.map(r => r.item.id), ['b', 'a']); // 538 -> at most 539, still behind 541
});

test('no usage data: ranking and scores are exactly as before', () => {
    for (const q of ['code', 'fir', 'ff', 'fl', 'set', 'files', 'minecraft launcher', 'fl-studio', 'gs', 'vsc']) {
        const plain = rankApps(q, REAL).map(r => [r.item.name, r.score]);
        assertEquals(rankApps(q, REAL, undefined, () => 0).map(r => [r.item.name, r.score]), plain, q);
        assertEquals(rankApps(q, REAL, undefined, undefined).map(r => [r.item.name, r.score]), plain, q);
    }
    // items without an id are never boosted
    assertEquals(applyUsageBoost([{item: {name: 'x'}, score: 500}], () => 1)[0].score, 500);
});

test('usage with the regressions: "code" margin, "fir" only Firefox, limit applied after the boost', () => {
    const hot = usageFrom(['claude.desktop', 'firefox.desktop', 'husk.desktop', 'org.gnome.Nautilus.desktop']);
    const s = Object.fromEntries(rankApps('code', REAL, undefined, hot).map(r => [r.item.name, r.score]));
    assertEquals(Object.keys(s)[0], 'Visual Studio Code');
    assert(s['Visual Studio Code'] - s.Claude >= 90, JSON.stringify(s));
    assertEquals(searchU('fir', REAL, hot), ['Firefox']);
    assertEquals(searchU('minecraft launcher', REAL, hot)[0], 'Prism Launcher');
    assertEquals(searchU('file manager', REAL, hot)[0], 'Files');
    assertEquals(searchU('fl-studio', REAL, hot)[0], 'FL Studio');
    assertEquals(searchU('fl_studio', REAL, hot)[0], 'FL Studio');
    assertEquals(searchU('proton-up', REAL, hot)[0], 'ProtonUp-Qt');
    const pair = [app('Firefox', 'firefox.desktop'), app('Firejail', 'firejail.desktop')];
    assertEquals(rankApps('fi', pair, 1, usageFrom(['firejail.desktop'])).map(r => r.item.name), ['Firejail']);
});

run();
