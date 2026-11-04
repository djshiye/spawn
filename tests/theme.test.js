import {ACCENT_COLORS, accentColor, buildCss, sanitizeColor, withAlpha} from '../build/theme/css.js';
import {assert, assertEquals, run, test} from './harness.js';

const off = v => [false, v];
const input = (over = {}) => ({
    accent: accentColor('blue'),
    override: false,
    colors: {
        background: 'rgba(48,48,49,0.98)', foreground: 'rgb(223,223,223)', border: 'rgb(60,60,60)',
        borderWidth: 1, borderRadius: 14, fontSize: 11, separator: 'rgb(90,90,90)',
        itemHoverBg: 'rgb(70,70,71)', itemHoverFg: 'rgb(255,255,255)', itemActiveBg: 'rgb(80,80,81)', itemActiveFg: 'rgb(255,255,255)',
    },
    buttonColors: {
        fg: off('#fff'), bg: off('#000'), borderRadius: off(0), borderWidth: off(0), borderColor: off('#000'),
        hoverBg: off('#000'), hoverFg: off('#fff'), activeBg: off('#000'), activeFg: off('#fff'),
    },
    ...over,
});

test('accent palette maps every GNOME accent name, unknown -> blue', () => {
    for (const name of ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'])
        assert(/^#[0-9a-f]{6}$/.test(accentColor(name)), name);
    assertEquals(accentColor('blue'), '#3584e4');
    assertEquals(accentColor('nonsense'), ACCENT_COLORS.blue);
});

test('default CSS: accent only, no override or button rules', () => {
    const css = buildCss(input());
    assert(css.includes('#3584e4'), 'accent present');
    assert(css.includes('rgba(53, 132, 228, 0.25)'), 'focus alpha');
    assert(!css.includes('.popup-menu-content'), 'no override rules');
    assert(!css.includes('.panel-button.spawn-button'), 'no disabled button rules');
});

test('every focusable item gets the accent ring; pressed is a 55% accent', () => {
    const css = buildCss(input());
    for (const sel of ['.spawn-user-card:focus', '.spawn-nav-button:focus', '.spawn-power-button:focus', '.spawn-tile:focus'])
        assert(css.includes(sel), sel);
    assert(css.includes('box-shadow: inset 0 0 0 2px #3584e4;'), 'focus ring');
    const active = css.slice(css.indexOf('.spawn-tile:active'));
    assert(active.includes('rgba(53, 132, 228, 0.55)'), 'pressed fill');
    assert(!css.includes('.spawn-tile:active,\n.spawn-row:selected'), ':active is its own rule');
});

test('override adds popup colours, font size and item states', () => {
    const css = buildCss(input({override: true}));
    assert(css.includes('.spawn-popup .popup-menu-content'));
    assert(css.includes('background-color: rgba(48,48,49,0.98);'));
    assert(css.includes('font-size: 11pt;'));
    assert(css.includes('.spawn-popup .spawn-tile:hover'));
    assert(css.includes('rgb(80,80,81)'));
});

test('button tuples apply only when enabled, independent of override', () => {
    const base = input();
    base.buttonColors.fg = [true, '#ff0000'];
    base.buttonColors.borderWidth = [true, 2];
    base.buttonColors.hoverBg = [true, 'rgb(1,2,3)'];
    const css = buildCss(base);
    assert(css.includes('#panel .panel-button.spawn-button {'), 'selector outranks the shell theme');
    assert(css.includes('color: #ff0000;'));
    assert(css.includes('border-width: 2px;'));
    assert(css.includes('#panel .panel-button.spawn-button:hover'));
    assert(css.includes('box-shadow: inset 0 0 0 100px rgb(1,2,3);'), 'hover colour overrides the theme overlay');
    assert(!css.includes('spawn-button:active'), 'disabled active tuple omitted');
});

test('unsafe colour strings are dropped, never embedded', () => {
    assertEquals(sanitizeColor('red; } * { display: none'), null);
    assertEquals(sanitizeColor('url(x)'), null);
    assertEquals(sanitizeColor(''), null);
    assertEquals(sanitizeColor(42), null);
    assertEquals(sanitizeColor(' #abc '), '#abc');
    assertEquals(sanitizeColor('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)');
    assertEquals(sanitizeColor('transparent'), 'transparent');
    const bad = input({override: true});
    bad.colors.background = 'red; } .x { color: blue';
    bad.buttonColors.bg = [true, 'x;y'];
    const css = buildCss(bad);
    assert(!css.includes('.x {'));
    assert(!css.includes('x;y'));
    assert(!css.includes('background-color: red'));
});

test('invalid accent falls back to blue; search radius is optional', () => {
    assert(buildCss(input({accent: 'evil;}'})).includes('#3584e4'));
    assert(!buildCss(input()).includes('border-radius: 25px'));
    assert(buildCss(input({searchEntryRadius: [true, 25]})).includes('.spawn-search-box {\n    border-radius: 25px;'));
    assert(!buildCss(input({searchEntryRadius: [false, 25]})).includes('border-radius: 25px'));
});

test('withAlpha handles hex, rgb and passes through unknown formats', () => {
    assertEquals(withAlpha('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
    assertEquals(withAlpha('#3584e4', 2), 'rgba(53, 132, 228, 1)');
    assertEquals(withAlpha('rgb(10, 20, 30)', 0.1), 'rgba(10, 20, 30, 0.1)');
    assertEquals(withAlpha('rgba(10,20,30,0.9)', 0.1), 'rgba(10, 20, 30, 0.1)');
    assertEquals(withAlpha('red', 0.1), 'red');
});

test('balanced braces in the full CSS', () => {
    const base = input({override: true, searchEntryRadius: [true, 10]});
    base.buttonColors.fg = [true, '#fff'];
    const css = buildCss(base);
    assertEquals(css.split('{').length, css.split('}').length);
});

run();
