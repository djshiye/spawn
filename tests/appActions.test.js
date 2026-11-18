import {ActionMatchCache, matchAppActions} from '../build/search/appActions.js';
import {assert, assertEquals, run, test} from './harness.js';

const app = (id, name, actions, keys = []) => ({id, name, keys: [name.toLowerCase(), ...keys], description: '',
    actions: () => actions.map(([aid, an]) => ({id: aid, name: an}))});
const FIREFOX = app('firefox.desktop', 'Firefox', [['new-window', 'New Window'], ['new-private-window', 'New Private Window'], ['profile-manager-window', 'Profile Manager']]);
const CHROME = app('chrome.desktop', 'Google Chrome', [['new-window', 'New Window'], ['new-private-window', 'New Incognito Window']]);
const CODE = app('code.desktop', 'Visual Studio Code', [['new-empty-window', 'New Empty Window']]);
const PLAIN = app('gedit.desktop', 'Text Editor', []);
const APPS = [FIREFOX, CHROME, CODE, PLAIN];
const m = q => matchAppActions(q, APPS).map(r => `${r.app.name}: ${r.action.name}`);

test('app part + action part find the action', () => {
    assertEquals(m('firefox private'), ['Firefox: New Private Window']);
    assertEquals(m('chrome incognito'), ['Google Chrome: New Incognito Window']);
    assertEquals(m('firefox profile'), ['Firefox: Profile Manager']);
    assertEquals(m('Firefox PRIVATE window'), ['Firefox: New Private Window']);
});

test('several actions match: best first, capped by the limit', () => {
    const r = m('firefox window');
    assertEquals(r.length, 3);
    assert(r.includes('Firefox: New Window'));
    assertEquals(matchAppActions('firefox window', APPS, 2).length, 2);
});

test('multi-word app names', () => {
    assertEquals(m('visual studio code empty'), ['Visual Studio Code: New Empty Window']);
    assertEquals(m('vsc empty'), ['Visual Studio Code: New Empty Window']);
});

test('the action id matches too', () => {
    assertEquals(m('firefox profile-manager'), ['Firefox: Profile Manager']);
});

test('no app part, no action part, wrong order, weak or no matches give nothing', () => {
    assertEquals(m('firefox'), []);
    assertEquals(m('private'), []);
    assertEquals(m('private firefox'), []);
    assertEquals(m('firefox xyz'), []);
    assertEquals(m('text editor new window'), []); // an app without actions
    assertEquals(m('fx private'), []); // a loose app match offers no actions
    assertEquals(m('firefox p'), []); // one-letter action part
    assertEquals(m(''), []);
    assertEquals(m('a b c d e f g h'), []);
});

test('a cache kept between keystrokes gives the same matches, and follows a new apps list', () => {
    const cache = new ActionMatchCache();
    const queries = ['f', 'fi', 'firefox', 'firefox p', 'firefox pr', 'firefox private', 'firefox private w',
        'chrome incognito', 'vsc empty', 'visual studio code empty', 'firefxo private', 'text editor new window',
        'firefox profile-manager', 'fx private'];
    for (let pass = 0; pass < 2; pass++) {
        for (const q of queries) {
            const plain = matchAppActions(q, APPS).map(r => `${r.app.name}: ${r.action.name} ${r.score}`);
            const cached = matchAppActions(q, APPS, 5, cache).map(r => `${r.app.name}: ${r.action.name} ${r.score}`);
            assertEquals(cached, plain, q);
        }
    }
    const fewer = [CHROME, CODE];
    assertEquals(matchAppActions('firefox private', fewer, 5, cache), []);
    assertEquals(matchAppActions('chrome incognito', fewer, 5, cache).map(r => r.action.name), ['New Incognito Window']);
});

run();
