// Best match across sections: the leader pick (search/bestMatch.ts) with the REAL scores of the ranking code.
import {appKeys, descriptionKey} from '../build/model/appKeys.js';
import {builtinPanels, matchPanels} from '../build/search/panelIndex.js';
import {pickLeader, sectionRank} from '../build/search/bestMatch.js';
import {matchPower} from '../build/search/powerKeywords.js';
import {rankApps} from '../build/search/rank.js';
import {assertEquals, run, test} from './harness.js';

function app(name, id, opts = {}) {
    return {
        name,
        id,
        description: descriptionKey(opts.description),
        keys: appKeys({name, id, genericName: opts.generic, keywords: opts.keywords, executable: opts.exec}),
    };
}

const APPS = [
    app('ImageMagick', 'display-im6.q16.desktop', {exec: 'display', keywords: ['display', 'image']}),
    app('Calculator', 'org.gnome.Calculator.desktop', {exec: 'gnome-calculator'}),
    app('Settings', 'org.gnome.Settings.desktop', {exec: 'gnome-control-center', keywords: ['preferences']}),
    app('Ptyxis', 'org.gnome.Ptyxis.desktop', {generic: 'Terminal', exec: 'ptyxis', keywords: ['terminal', 'shell']}),
    app('Files', 'org.gnome.Nautilus.desktop', {generic: 'File Manager'}),
];

/** The sections a query produces, as ResultList sees them: [providerId, order, top score]. */
function tops(query, {power = []} = {}) {
    const out = [];
    const apps = rankApps(query, APPS);
    if (apps.length)
        out.push({providerId: 'apps', order: 3000, score: apps[0].score});
    const panels = matchPanels(query, builtinPanels());
    if (panels.length)
        out.push({providerId: 'settingsPanels', order: 4000, score: panels[0].score});
    const p = matchPower(query, power);
    if (p.length)
        out.push({providerId: 'power', order: 5000, score: p[0].score});
    return out;
}

test('"display" picks the Displays panel, not the app that lists display as a keyword', () => {
    assertEquals(pickLeader(tops('display')), 'settingsPanels');
});

test('"calc", "settings" and "term" / "ptyxis" keep their apps as the best match', () => {
    for (const q of ['calc', 'settings', 'term', 'ptyxis'])
        assertEquals(pickLeader(tops(q)), 'apps', q);
});

test('an equal score goes to the section registered first', () => {
    assertEquals(pickLeader([
        {providerId: 'settingsPanels', order: 4000, score: 1000},
        {providerId: 'apps', order: 3000, score: 1000},
    ]), 'apps');
});

test('windows, recent files and shell providers never lead', () => {
    assertEquals(pickLeader([
        {providerId: 'windows', order: 5000, score: 1000},
        {providerId: 'recentFiles', order: 6000, score: 1000},
        {providerId: 'shell:org.gnome.Characters.desktop', order: 7000, score: 1000},
    ]), null);
    assertEquals(pickLeader([
        {providerId: 'windows', order: 5000, score: 1000},
        {providerId: 'apps', order: 3000, score: 400},
    ]), 'apps');
});

test('an answer keeps the top: no leader while a calculator or conversion result shows', () => {
    assertEquals(pickLeader([
        {providerId: 'calculator', order: 0, score: 1000},
        {providerId: 'apps', order: 3000, score: 1000},
    ]), null);
    assertEquals(pickLeader([
        {providerId: 'conversion', order: 1000, score: 1000},
        {providerId: 'settingsPanels', order: 4000, score: 900},
    ]), null);
});

test('no sections, or sections without a score, have no leader', () => {
    assertEquals(pickLeader([]), null);
    assertEquals(pickLeader([{providerId: 'apps', order: 3000, score: 0}]), null);
});

test('an exact power action word is the best match against an app that only matches by prefix', () => {
    const power = [{name: 'Restart', synonyms: ['restart', 'reboot']}];
    const apps = [{providerId: 'apps', order: 3000, score: 860}];
    const top = matchPower('restart', power)[0].score;
    assertEquals(pickLeader([...apps, {providerId: 'power', order: 5000, score: top}]), 'power');
});

test('sectionRank: the leader sorts before every other section, the rest by provider order', () => {
    const order = [['calculator', 0], ['apps', 3000], ['settingsPanels', 4000], ['recentFiles', 6000]];
    const sorted = [...order].sort((a, b) => sectionRank(a[1], a[0], 'settingsPanels') - sectionRank(b[1], b[0], 'settingsPanels'));
    assertEquals(sorted.map(s => s[0]), ['settingsPanels', 'calculator', 'apps', 'recentFiles']);
    const plain = [...order].sort((a, b) => sectionRank(a[1], a[0], null) - sectionRank(b[1], b[0], null));
    assertEquals(plain.map(s => s[0]), ['calculator', 'apps', 'settingsPanels', 'recentFiles']);
});

run();
