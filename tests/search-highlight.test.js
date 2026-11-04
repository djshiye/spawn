import {highlightMarkup} from '../build/search/highlight.js';
import {assertEquals, run, test} from './harness.js';

test('plain match, case-insensitive', () => {
    assertEquals(highlightMarkup('Firefox', 'fire'), '<b>Fire</b>fox');
    assertEquals(highlightMarkup('Firefox', 'FOX'), 'Fire<b>fox</b>');
});

test('no terms or empty text', () => {
    assertEquals(highlightMarkup('a & b', ''), 'a &amp; b');
    assertEquals(highlightMarkup('', 'x'), '');
    assertEquals(highlightMarkup('a <b>', 'zzz'), 'a &lt;b&gt;');
});

test('markup characters are escaped inside and outside marks', () => {
    assertEquals(highlightMarkup('R&D <lab>', 'r&d'), '<b>R&amp;D</b> &lt;lab&gt;');
});

test('non-BMP characters are never split', () => {
    assertEquals(highlightMarkup('🔥 Tab firefox', 'fire'), '🔥 Tab <b>fire</b>fox');
    assertEquals(highlightMarkup('🔥 Tab firefox', '🔥'), '<b>🔥</b> Tab firefox');
    assertEquals(highlightMarkup('a😀b😀c', 'b😀'), 'a😀<b>b😀</b>c');
});

test('length-changing case folds keep marks aligned', () => {
    // 'İstanbul map'.toLowerCase() is one code unit longer than the text.
    assertEquals(highlightMarkup('İstanbul map', 'map'), 'İstanbul <b>map</b>');
    assertEquals(highlightMarkup('İstanbul map', 'stanbul'), 'İ<b>stanbul</b> map');
    assertEquals(highlightMarkup('İstanbul map', 'istanbul'), '<b>İstanbul</b> map');
});

test('diacritics-insensitive like the ranking', () => {
    assertEquals(highlightMarkup('Café Crème', 'cafe'), '<b>Café</b> Crème');
});

test('several terms, overlapping and repeated', () => {
    assertEquals(highlightMarkup('Visual Studio Code', 'vis cod'), '<b>Vis</b>ual Studio <b>Cod</b>e');
    assertEquals(highlightMarkup('banana', 'an'), 'b<b>anan</b>a');
});

run();
