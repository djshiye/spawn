import {normalize, rankItems, scoreMatch} from '../build/search/rank.js';
import {assert, assertEquals, run, test} from './harness.js';

const names = items => items.map(r => r.item);

test('normalize folds case, accents and whitespace', () => {
    assertEquals(normalize('  Café   Éclair '), 'cafe eclair');
    assertEquals(normalize('ÅNGSTRÖM'), 'angstrom');
});

test('tiers are ordered exact > prefix > word-prefix > acronym > substring > fuzzy', () => {
    const exact = scoreMatch('code', 'Code');
    const prefix = scoreMatch('cod', 'Code');
    const word = scoreMatch('code', 'Visual Studio Code');
    const acronym = scoreMatch('vsc', 'Visual Studio Code');
    const substring = scoreMatch('ode', 'Code');
    const fuzzy = scoreMatch('cde', 'Code');
    assert(exact === 1000, `exact ${exact}`);
    assert(exact > prefix && prefix > word && word > acronym && acronym > substring && substring > fuzzy && fuzzy > 0,
        JSON.stringify({exact, prefix, word, acronym, substring, fuzzy}));
});

test('scores stay within 0..1000 and no match is 0', () => {
    assertEquals(scoreMatch('xyz', 'Firefox'), 0);
    assertEquals(scoreMatch('', 'Firefox'), 0);
    assertEquals(scoreMatch('fire', ''), 0);
    for (const [q, c] of [['f', 'Firefox'], ['fire', 'Firefox'], ['firefox', 'Firefox']]) {
        const s = scoreMatch(q, c);
        assert(s > 0 && s <= 1000, `${q}/${c} = ${s}`);
    }
});

test('"fire" ranks Firefox before Bonfire', () => {
    const r = rankItems('fire', ['Bonfire', 'Firefox', 'Campfire Tales'], k => [k]);
    assertEquals(names(r)[0], 'Firefox');
    assertEquals(names(r).slice(1).sort(), ['Bonfire', 'Campfire Tales']);
});

test('prefix beats word-prefix beats substring', () => {
    const r = rankItems('term', ['Determine', 'GNOME Terminal', 'Terminal'], k => [k]);
    assertEquals(names(r), ['Terminal', 'GNOME Terminal', 'Determine']);
});

test('shorter names win inside a tier', () => {
    const r = rankItems('fire', ['Firefox Developer Edition', 'Firefox'], k => [k]);
    assertEquals(names(r), ['Firefox', 'Firefox Developer Edition']);
});

test('acronym: "vsc" finds Visual Studio Code ahead of weaker matches', () => {
    const r = rankItems('vsc', ['Vsco Viewer Sc', 'Visual Studio Code', 'Fuzzy Vase Scoop'], k => [k]);
    assertEquals(names(r)[0] === 'Vsco Viewer Sc' ? 'prefix' : names(r)[0], 'prefix'); // prefix still wins
    assert(names(r).includes('Visual Studio Code'));
    const solo = rankItems('vsc', ['Visual Studio Code', 'Calculator'], k => [k]);
    assertEquals(names(solo), ['Visual Studio Code']);
});

test('acronym works with a joined tail ("vscode") and skipped words', () => {
    assert(scoreMatch('vscode', 'Visual Studio Code') > 0);
    assert(scoreMatch('vc', 'Visual Studio Code') > 0);
    assert(scoreMatch('gc', 'Google Chrome') > scoreMatch('gc', 'Orange Cat Sc'));
    assertEquals(scoreMatch('c', 'Visual Studio Code') > 0, true);
});

test('camelCase boundaries count as word starts', () => {
    const camel = scoreMatch('office', 'LibreOffice');
    const plain = scoreMatch('office', 'Superoffice');
    assert(camel > plain, `${camel} vs ${plain}`);
    assert(scoreMatch('writer', 'LibreOffice Writer') > scoreMatch('writer', 'Typewriter'));
    assert(scoreMatch('lo', 'LibreOffice') > 0);
});

test('word boundaries after dash, dot and underscore', () => {
    const w = scoreMatch('fox', 'fire-fox');
    const s = scoreMatch('fox', 'firefox');
    assert(w > s, `${w} vs ${s}`);
    assert(scoreMatch('conf', 'my_conf.d') > scoreMatch('conf', 'myconf'));
});

test('accents are ignored on both sides', () => {
    assert(scoreMatch('cafe', 'Café Menu') >= 850);
    assert(scoreMatch('café', 'Cafe Menu') >= 850);
    assertEquals(scoreMatch('uber', 'Über'), 1000);
});

test('empty and whitespace queries rank nothing', () => {
    assertEquals(rankItems('', ['a', 'b'], k => [k]), []);
    assertEquals(rankItems('   ', ['a', 'b'], k => [k]), []);
});

test('multi-word queries: phrase or every term must match', () => {
    const r = rankItems('studio code', ['Visual Studio Code', 'Studio Tools', 'Code Editor'], k => [k]);
    assertEquals(names(r)[0], 'Visual Studio Code');
    assertEquals(names(r).length, 1);
    const and = rankItems('vis code', ['Visual Studio Code', 'Visual Basic'], k => [k]);
    assertEquals(names(and), ['Visual Studio Code']);
});

test('fuzzy subsequence matches only compact enough hits', () => {
    assert(scoreMatch('frfx', 'Firefox') > 0);
    assertEquals(scoreMatch('fxq', 'Firefox'), 0);
    assertEquals(scoreMatch('abc', 'axxxxxxxxxxxxxxxxxxxxbxxxxxxxxxxxxxxxxxxxxc'), 0);
});

test('rankItems takes the best key, is stable and honours the limit', () => {
    const items = [
        {n: 'b', keys: ['zzz']},
        {n: 'a1', keys: ['alpha']},
        {n: 'a2', keys: ['alpha']},
        {n: 'k', keys: ['x', 'alp']},
    ];
    const r = rankItems('alp', items, i => i.keys);
    assertEquals(r.map(x => x.item.n), ['k', 'a1', 'a2']); // 'alp' exact beats prefix; equal scores keep order
    assertEquals(rankItems('alp', items, i => i.keys, 2).length, 2);
    assertEquals(rankItems('alp', items, i => i.keys, 0), []);
});

test('- _ . in the query are word breaks when the candidate does not match as typed', () => {
    assert(scoreMatch('fl-studio', 'FL Studio') >= 800, String(scoreMatch('fl-studio', 'FL Studio')));
    assert(scoreMatch('fl_studio', 'FL Studio') >= 800);
    assert(scoreMatch('proton-up', 'ProtonUp-Qt') > 600);
    assertEquals(scoreMatch('gnome-terminal', 'gnome-terminal'), 1000); // as typed still wins
    assertEquals(scoreMatch('-', 'FL Studio'), 0);
    assertEquals(scoreMatch('_._', 'FL Studio'), 0);
});

run();
