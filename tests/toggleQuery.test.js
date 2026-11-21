import {matchToggles, parseToggleQuery} from '../build/search/answers/toggleQuery.js';
import {assertEquals, run, test} from './harness.js';

const entries = [
    {key: 'dark', name: 'Dark mode', synonyms: ['dark mode', 'dark style', 'dark theme']},
    {key: 'nightLight', name: 'Night Light', synonyms: ['night light', 'blue light']},
    {key: 'dnd', name: 'Do Not Disturb', synonyms: ['do not disturb', 'dnd', 'mute notifications']},
    {key: 'wifi', name: 'Wi-Fi', synonyms: ['wifi', 'wi fi', 'wireless', 'wlan']},
    {key: 'bluetooth', name: 'Bluetooth', synonyms: ['bluetooth']},
    {key: 'aeroplane', name: 'Aeroplane mode', synonyms: ['aeroplane mode', 'airplane mode', 'flight mode']},
];
const m = q => matchToggles(q, entries).map(r => [r.item.key, r.score, r.want]);

test('parsing the state', () => {
    assertEquals(parseToggleQuery('wifi off'), {core: 'wifi', want: false});
    assertEquals(parseToggleQuery('Turn ON Bluetooth'), {core: 'bluetooth', want: true});
    assertEquals(parseToggleQuery('turn dark mode off'), {core: 'dark mode', want: false});
    assertEquals(parseToggleQuery('switch off wifi'), {core: 'wifi', want: false});
    assertEquals(parseToggleQuery('enable night light'), {core: 'night light', want: true});
    assertEquals(parseToggleQuery('disable dnd'), {core: 'dnd', want: false});
    assertEquals(parseToggleQuery('toggle dark mode'), {core: 'dark mode', want: null});
    assertEquals(parseToggleQuery('dark mode'), {core: 'dark mode', want: null});
    assertEquals(parseToggleQuery('da'), null);
    assertEquals(parseToggleQuery('x'.repeat(41)), null);
});

test('a name or synonym toggles', () => {
    assertEquals(m('dark mode'), [['dark', 1000, null]]);
    assertEquals(m('dnd'), [['dnd', 900, null]]);
    assertEquals(m('wifi'), [['wifi', 900, null]]);
    assertEquals(m('Wi-Fi'), [['wifi', 1000, null]]);
    assertEquals(m('airplane mode'), [['aeroplane', 900, null]]);
    assertEquals(m('aeroplane mode'), [['aeroplane', 1000, null]]);
});

test('prefixes need three characters and start at a word', () => {
    assertEquals(m('da'), []);
    assertEquals(m('dar'), [['dark', 880, null]]);
    assertEquals(m('blue'), [['bluetooth', 880, null], ['nightLight', 800, null]]);
    assertEquals(m('light'), [['nightLight', 780, null]]);
    assertEquals(m('disturb'), [['dnd', 780, null]]);
    assertEquals(m('ight'), []);
});

test('with a state it is a command', () => {
    assertEquals(m('wifi off'), [['wifi', 1000, false]]);
    assertEquals(m('turn on bluetooth'), [['bluetooth', 1000, true]]);
    assertEquals(m('disable night light'), [['nightLight', 1000, false]]);
    assertEquals(m('blue on'), [['nightLight', 900, true], ['bluetooth', 900, true]]);
    assertEquals(m('dark mode on'), [['dark', 1000, true]]);
});

test('ordinary searches do not match', () => {
    for (const q of ['firefox', 'terminal', 'settings', 'on', 'off', 'turn on', 'turn off', 'enable', 'toggle', 'mode', 'not', 'fi', 'steam', 'calculator', 'files'])
        assertEquals(m(q), [], q);
});

run();
