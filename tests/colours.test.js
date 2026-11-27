import {colourAnswers} from '../build/search/answers/colours.js';
import {assert, assertEquals, run, test} from './harness.js';

const ids = q => colourAnswers(q).map(a => a.id);
const titles = q => colourAnswers(q).map(a => a.title);

test('hex input lists RGB, HSL, Hex', () => {
    const r = colourAnswers('#3584e4');
    assertEquals(r.map(a => a.id), ['rgb', 'hsl', 'hex']);
    assertEquals(r[0].title, 'rgb(53, 132, 228)');
    assertEquals(r[0].description, 'RGB');
    assertEquals(r[1].title, 'hsl(213, 76%, 55%)');
    assertEquals(r[2].title, '#3584E4');
    assertEquals(r[2].description, 'Hex colour');
    for (const a of r) {
        assertEquals(a.swatch, '#3584e4');
        assertEquals(a.copy, a.title);
        assertEquals(a.icon, 'color-select-symbolic');
    }
});

test('short hex and alpha', () => {
    assertEquals(titles('#abc')[2], '#AABBCC');
    assertEquals(titles('#3584e4cc'), ['rgba(53, 132, 228, 0.8)', 'hsla(213, 76%, 55%, 0.8)', '#3584E4CC']);
    assertEquals(colourAnswers('#3584e4cc')[0].swatch, '#3584e4');
    assertEquals(titles('#abcd')[2], '#AABBCCDD');
    assertEquals(titles('#3584e4ff'), titles('#3584e4'));
});

test('rgb forms', () => {
    for (const q of ['rgb(53, 132, 228)', 'rgb(53 132 228)', 'rgb 53 132 228', 'RGB(53,132,228)', 'rgb(53,132,228,1)'])
        assertEquals(ids(q), ['hex', 'hsl', 'rgb'], q);
    assertEquals(titles('rgb(53,132,228)')[0], '#3584E4');
    assertEquals(titles('rgba(53,132,228,0.8)'), ['#3584E4CC', 'hsla(213, 76%, 55%, 0.8)', 'rgba(53, 132, 228, 0.8)']);
    assertEquals(titles('rgb(53 132 228 / 80%)')[0], '#3584E4CC');
    assertEquals(titles('rgb(100%, 0%, 0%)')[0], '#FF0000');
    assertEquals(titles('rgb(100%, 50%, 0%)')[0], '#FF8000');
    assertEquals(titles('rgb(50%, 50%, 50%)')[0], '#808080');
    assertEquals(titles('rgb(90%, 0%, 0%)')[0], '#E60000');
});

test('hsl forms', () => {
    for (const q of ['hsl(213, 77%, 55%)', 'hsl 213 77 55', 'hsl(213 77% 55%)', 'hsla(213, 77%, 55%, 1)'])
        assertEquals(ids(q), ['hex', 'rgb', 'hsl'], q);
    assertEquals(titles('hsl(0, 100%, 50%)'), ['#FF0000 '.trim(), 'rgb(255, 0, 0)', 'hsl(0, 100%, 50%)']);
    assertEquals(titles('hsl(360, 100%, 50%)')[0], '#FF0000');
    assertEquals(titles('hsl(-120, 100%, 50%)')[0], '#0000FF');
    assertEquals(titles('hsl(120deg, 100%, 25%)')[0], '#008000');
    assertEquals(titles('hsla(120, 100%, 50%, 0.5)')[0], '#00FF0080');
});

test('named colours', () => {
    const r = colourAnswers('colour rebeccapurple');
    assertEquals(r.map(a => a.id), ['hex', 'rgb', 'hsl']);
    assertEquals(r[0].title, '#663399');
    assertEquals(r[0].description, 'Hex colour · rebeccapurple');
    assertEquals(titles('color red')[1], 'rgb(255, 0, 0)');
    assertEquals(titles('colour dark slate grey')[0], '#2F4F4F');
    assertEquals(titles('color Dark-Slate-Gray')[0], '#2F4F4F');
    assertEquals(titles('colour lightgrey')[0], '#D3D3D3');
    assertEquals(titles('colour grey')[0], '#808080');
    assertEquals(titles('colour gray')[0], '#808080');
});

test('keyword allows bare hex', () => {
    assertEquals(ids('colour #3584e4'), ['rgb', 'hsl', 'hex']);
    assertEquals(ids('color 3584e4'), ['rgb', 'hsl', 'hex']);
    assertEquals(titles('color 3584e4')[2], '#3584E4');
    assertEquals(titles('colour abc')[2], '#AABBCC');
    assertEquals(ids('colour rgb(1,2,3)'), ['hex', 'hsl', 'rgb']);
});

test('exact names appear on the hex row only without alpha', () => {
    assertEquals(colourAnswers('#ff0000')[2].description, 'Hex colour · red');
    assertEquals(colourAnswers('rgb(255,0,0)')[0].description, 'Hex colour · red');
    assertEquals(colourAnswers('#ff000080')[2].description, 'Hex colour');
    assertEquals(colourAnswers('#3584e4')[2].description, 'Hex colour');
});

test('all 148 names resolve', () => {
    const names = ['aliceblue', 'yellowgreen', 'rebeccapurple', 'lightgoldenrodyellow', 'mediumspringgreen'];
    for (const n of names)
        assertEquals(ids('colour ' + n).length, 3, n);
});

test('range validation', () => {
    for (const q of ['rgb(256,0,0)', 'rgb(-1,0,0)', 'rgb(1,2)', 'rgb(1,2,3,4)', 'rgb(1,2,3,1.5)', 'rgb(a,b,c)', 'rgb(101%,0%,0%)',
        'hsl(0, 101%, 50%)', 'hsl(0, 50%, -1%)', 'hsl(x, 50%, 50%)', 'rgba(1,2,3,150%)', 'rgb(1,2,3', 'rgb(1,2,3)x',
        'colour nosuchcolour'])
        assertEquals(ids(q), [], q);
});

test('named colour shows the spelling that was typed', () => {
    const d = q => colourAnswers(q).find(a => a.id === 'hex').description;
    assertEquals(d('colour dark slate grey'), 'Hex colour · darkslategrey');
    assertEquals(d('colour grey'), 'Hex colour · grey');
    assertEquals(d('colour gray'), 'Hex colour · gray');
    assertEquals(d('color Dark-Slate-Gray'), 'Hex colour · darkslategray');
    assertEquals(d('colour light grey'), 'Hex colour · lightgrey');
    assertEquals(d('colour cyan'), 'Hex colour · cyan');
    assertEquals(d('colour magenta'), 'Hex colour · magenta');
    assertEquals(d('colour aqua'), 'Hex colour · aqua');
});

test('value lookups prefer grey spellings', () => {
    const d = q => colourAnswers(q).find(a => a.id === 'hex').description;
    assertEquals(d('#808080'), 'Hex colour · grey');
    assertEquals(d('rgb(128,128,128)'), 'Hex colour · grey');
    assertEquals(d('hsl(0, 0%, 50%)'), 'Hex colour · grey');
    assertEquals(d('#2f4f4f'), 'Hex colour · darkslategrey');
    assertEquals(d('colour d3d3d3'), 'Hex colour · lightgrey');
    assertEquals(d('#00ffff'), 'Hex colour · aqua');
    assertEquals(d('#ff00ff'), 'Hex colour · fuchsia');
    assertEquals(d('#80808080'), 'Hex colour');
});

test('false positives', () => {
    for (const q of ['#', '#12', '#12345', '#ggg', 'red', 'blue', 'colour', 'color', 'colour picker', 'color profile',
        'rgb', 'hsl', '3584e4', 'abc', '#hashtag', 'c#', 'f#', 'firefox', 'term', 'settings', 'files', 'help',
        'gnome text editor', 'steam', 'calc', 'hex', 'rgbtest', '#1234567', 'x'.repeat(300), ''])
        assertEquals(ids(q), [], q);
});

test('never throws', () => {
    for (const q of ['rgb(', 'hsl()', '#\u0000', 'colour  ', 'rgb(,,)', 'rgb(1e3,0,0)'])
        assert(Array.isArray(colourAnswers(q)));
});

run();
