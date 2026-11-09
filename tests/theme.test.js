import {ACCENT_COLORS, accentColor, accentForeground, buildCss, cardSurface, parseColor, raisedSurface, sanitizeColor, withAlpha} from '../build/theme/css.js';
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

test('the folder card is derived from the menu background: lifted on dark, brighter than the menu on light', () => {
    // dark: neutral stays neutral (no bluish cast), and the card is lighter than the menu
    assertEquals(cardSurface('rgb(36,36,36)', 'rgb(255,255,255)'), raisedSurface('rgb(36,36,36)', 'rgb(255,255,255)'));
    const dark = parseColor(cardSurface('rgb(36,36,36)', 'rgb(255,255,255)'));
    assert(dark[0] === dark[1] && dark[1] === dark[2] && dark[0] > 36, 'neutral dark menu, neutral lighter card');
    // light: opened towards white, never darker than the menu, opaque
    const light = parseColor(cardSurface('rgb(240,240,240)', 'rgb(0,0,0)'));
    assertEquals(light.slice(0, 3), [249, 249, 249]);
    assertEquals(light[3], 1);
    assertEquals(cardSurface('hsl(0,0%,0%)', null), null);
});

test('folder popup card is opaque even when the custom menu colour is see-through', () => {
    assertEquals(parseColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
    assertEquals(parseColor('#ffffff80')?.[3].toFixed(2), '0.50');
    assertEquals(parseColor('hsl(0, 0%, 0%)'), null);
    // Dark and 40 % opaque: flattened onto black, lifted 7 % towards white text.
    assertEquals(raisedSurface('rgba(20,20,24,0.4)', 'rgb(255,255,255)'), 'rgb(25, 25, 27)');
    // Light: flattened onto white, lifted towards the dark text.
    assertEquals(raisedSurface('rgba(245,247,250,0.5)', 'rgb(18,51,84)'), 'rgb(234, 237, 241)');
    assertEquals(raisedSurface('hsl(0,0%,0%)', null), null);
    const css = buildCss(input({override: true, colors: {...input().colors, background: 'rgba(12,12,14,0.55)'}}));
    const card = css.slice(css.indexOf('.spawn-folder-popup'));
    const bg = /background-color: ([^;]+);/.exec(card)[1];
    assert(bg.startsWith('rgb('), `card background must be opaque, got ${bg}`);
    assert(!card.slice(0, card.indexOf('}')).includes('rgba(12,12,14,0.55)'), 'menu colour not reused as is');
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
    for (const sel of ['.spawn-user-card:focus .spawn-card-surface', '.spawn-nav-button:focus .spawn-nav-surface',
        '.spawn-power-button:focus .spawn-power-surface', '.spawn-tile:focus .spawn-tile-surface'])
        assert(css.includes(sel), sel);
    assert(css.includes('box-shadow: inset 0 0 0 2px #3584e4;'), 'focus ring');
    const active = css.slice(css.indexOf('.spawn-tile:active'));
    assert(active.includes('rgba(53, 132, 228, 0.55)'), 'pressed fill');
    assert(!css.includes('.spawn-tile:active,\n.spawn-row:selected'), ':active is its own rule');
});

test('rows, tiles and buttons are tinted on their visible face, never on the transparent hit-area button', () => {
    const css = buildCss(input({override: true}));
    const faces = {
        '.spawn-pinned-row': '.spawn-row-surface', '.spawn-list-row': '.spawn-row-surface', '.spawn-category-row': '.spawn-row-surface',
        '.spawn-result-row': '.spawn-row-surface', '.spawn-shortcut-row': '.spawn-row-surface', '.spawn-tile': '.spawn-tile-surface',
        '.spawn-user-card': '.spawn-card-surface', '.spawn-nav-button': '.spawn-nav-surface', '.spawn-power-button': '.spawn-power-surface',
    };
    for (const state of [':focus', ':active', ':hover']) {
        const scope = state === ':hover' ? '.spawn-popup ' : '';
        for (const [button, face] of Object.entries(faces))
            assert(css.includes(`${scope}${button}${state} ${face}`), `${button} face ${state}`);
    }
    // a selector that ENDS at the button would paint the gap around the item
    const names = Object.keys(faces).map(b => b.slice(1)).join('|');
    assert(!new RegExp(`\\.(${names}|spawn-folder-tile):(focus|active|hover|selected|checked)\\s*[,{]`).test(css), 'button itself styled');
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

test('menu-arrow-rise: a rule for the main popup only (not the runner), independent of the override, clamped', () => {
    assert(!buildCss(input()).includes('-arrow-rise'), 'no rule without the setting');
    assert(!buildCss(input({arrowRise: [false, 12]})).includes('-arrow-rise'), 'disabled');
    const css = buildCss(input({arrowRise: [true, 12]}));
    assert(css.includes('.spawn-menu-popup {\n    -arrow-rise: 12px;\n}'), css);
    assert(!css.includes('.popup-menu-content'), 'override stays off');
    assert(buildCss(input({arrowRise: [true, 400]})).includes('-arrow-rise: 50px;'));
    assert(buildCss(input({arrowRise: [true, -400]})).includes('-arrow-rise: 0px;'));
});

test('balanced braces in the full CSS', () => {
    const base = input({override: true, searchEntryRadius: [true, 10]});
    base.buttonColors.fg = [true, '#fff'];
    const css = buildCss(base);
    assertEquals(css.split('{').length, css.split('}').length);
});

test('accentForeground: white on blue, dark on yellow and orange', () => {
    assertEquals(accentForeground(ACCENT_COLORS.blue), '#ffffff');
    assertEquals(accentForeground(ACCENT_COLORS.yellow), 'rgba(0,0,0,0.87)');
    assertEquals(accentForeground('nonsense'), '#ffffff');
});

run();
