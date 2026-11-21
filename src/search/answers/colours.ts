// Colour conversion for the search box: "#3584e4", "rgb(53, 132, 228)", "hsl(213, 77%, 55%)", "colour rebeccapurple".
// Pure (imports only the Answer type); unit-testable with gjs -m (tests/colours.test.js).
//
// Text forms (case-insensitive):
//   #rgb #rgba #rrggbb #rrggbbaa            hex with a "#"
//   rgb(r, g, b) rgba(r, g, b, a)           also space separated, "rgb 53 132 228", "rgb(53 132 228 / 0.8)";
//                                           r g b 0..255 (or 0%..100%), alpha 0..1 or 0%..100%
//   hsl(h, s%, l%) hsla(h, s%, l%, a)       also "hsl 213 77 55"; hue is any number (modulo 360), s l 0..100
//   colour <anything above> | <hex without #> | <CSS name>     "colour rebeccapurple", "color dark slate grey",
//                                           "colour 3584e4". A bare "3584e4" or "red" is not a colour.
// Rows: Hex colour, RGB, HSL (with " · <name>" on the hex row when the colour is exactly a CSS name);
// the format the user typed goes last. Every row carries `swatch`.
//
// Public API:
//   colourAnswers(query): Answer[]      [] unless the whole query is a valid colour

import type {Answer} from './types.js';

const ICON = 'color-select-symbolic';
const MAX_LENGTH = 80;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const BARE_HEX = /^([0-9a-f]{3}|[0-9a-f]{6})$/;
const KEYWORD = /^colou?r +(\S.*)$/;
const FUNC = /^(rgba?|hsla?)\s*(?:\(([^()]*)\)|\s([^()]+))$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(%?)$/;
const HUE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg)?$/;

// CSS Color Module level 4 named colours; the first of two equal values is the one shown ("gray", not "grey").
const NAMED_TEXT =
    'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,' +
    'black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,' +
    'cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,' +
    'crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,' +
    'darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,' +
    'darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,' +
    'darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,' +
    'deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,' +
    'floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,' +
    'goldenrod:daa520,gray:808080,grey:808080,green:008000,greenyellow:adff2f,honeydew:f0fff0,hotpink:ff69b4,' +
    'indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,' +
    'lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
    'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
    'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
    'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,' +
    'maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,' +
    'mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
    'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
    'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,' +
    'orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
    'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,' +
    'powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,' +
    'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
    'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
    'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,' +
    'turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
    'yellowgreen:9acd32';

let byName: Map<string, number> | null = null;
let byValue: Map<number, string> | null = null;

function buildNames(): void {
    byName = new Map();
    byValue = new Map();
    for (const item of NAMED_TEXT.split(',')) {
        const i = item.indexOf(':');
        const name = item.slice(0, i);
        const value = parseInt(item.slice(i + 1), 16);
        byName.set(name, value);
        if (!byValue.has(value))
            byValue.set(value, name);
    }
}

interface Colour {
    r: number;
    g: number;
    b: number;
    /** 0..1, or null when the colour is opaque. */
    a: number | null;
    /** The format that was typed: 'hex', 'rgb' or 'hsl'. */
    typed: string;
}

function parseHex(digits: string, typed: string): Colour {
    let h = digits;
    if (h.length <= 4)
        h = h.replace(/./g, '$&$&');
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: a === 1 ? null : a, typed,
    };
}

function parseAlpha(text: string): number | null {
    const m = NUMBER.exec(text);
    if (!m)
        return null;
    const v = parseFloat(text) / (m[1] ? 100 : 1);
    return v >= 0 && v <= 1 ? v : null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const hue = (((h % 360) + 360) % 360) / 360;
    const sat = s / 100;
    const lig = l / 100;
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    const channel = (t: number): number => {
        if (t < 0)
            t += 1;
        if (t > 1)
            t -= 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [
        Math.round(channel(hue + 1 / 3) * 255), Math.round(channel(hue) * 255), Math.round(channel(hue - 1 / 3) * 255),
    ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0)
        return [0, 0, Math.round(l * 100)];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === rr)
        h = ((gg - bb) / d + 6) % 6;
    else if (max === gg)
        h = (bb - rr) / d + 2;
    else
        h = (rr - gg) / d + 4;
    return [Math.round(h * 60) % 360, Math.round(s * 100), Math.round(l * 100)];
}

function parseFunction(kind: string, body: string): Colour | null {
    const args = body.trim().split(/[\s,/]+/);
    if (args.length !== 3 && args.length !== 4)
        return null;
    let alpha: number | null = null;
    if (args.length === 4) {
        alpha = parseAlpha(args[3]);
        if (alpha === null)
            return null;
        if (alpha === 1)
            alpha = null;
    }
    if (kind.charCodeAt(0) === 114) {
        const v: number[] = [];
        for (let i = 0; i < 3; i++) {
            const m = NUMBER.exec(args[i]);
            if (!m)
                return null;
            const n = m[1] ? parseFloat(args[i]) * 2.55 : parseFloat(args[i]);
            if (n < 0 || n > 255.0000001)
                return null;
            v.push(Math.min(255, Math.round(n)));
        }
        return {r: v[0], g: v[1], b: v[2], a: alpha, typed: 'rgb'};
    }
    if (!HUE.test(args[0]))
        return null;
    const sl: number[] = [];
    for (let i = 1; i < 3; i++) {
        if (!NUMBER.test(args[i]))
            return null;
        const n = parseFloat(args[i]);
        if (n < 0 || n > 100)
            return null;
        sl.push(n);
    }
    const [r, g, b] = hslToRgb(parseFloat(args[0]), sl[0], sl[1]);
    return {r, g, b, a: alpha, typed: 'hsl'};
}

function parseColour(text: string, keyword: boolean): Colour | null {
    if (text.charCodeAt(0) === 35) {
        const m = HEX.exec(text);
        return m ? parseHex(m[1], 'hex') : null;
    }
    const f = FUNC.exec(text);
    if (f)
        return parseFunction(f[1], f[2] ?? f[3]);
    if (!keyword)
        return null;
    if (BARE_HEX.test(text))
        return parseHex(text, 'hex');
    if (!byName)
        buildNames();
    const v = (byName as Map<string, number>).get(text.replace(/[\s_-]+/g, ''));
    if (v === undefined)
        return null;
    return {r: v >> 16, g: (v >> 8) & 255, b: v & 255, a: null, typed: 'name'};
}

function hex2(n: number): string {
    return (n < 16 ? '0' : '') + n.toString(16);
}

function alphaText(a: number): string {
    return String(parseFloat(a.toFixed(2)));
}

function rows(c: Colour): Answer[] {
    const base = `${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    const swatch = `#${base}`;
    const hexTitle = `#${(base + (c.a === null ? '' : hex2(Math.round(c.a * 255)))).toUpperCase()}`;
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    const al = c.a === null ? '' : `, ${alphaText(c.a)}`;
    const rgbTitle = c.a === null ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}${al})`;
    const hslTitle = c.a === null ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%${al})`;
    let hexDesc = 'Hex colour';
    if (c.a === null) {
        if (!byValue)
            buildNames();
        const name = (byValue as Map<number, string>).get((c.r << 16) | (c.g << 8) | c.b);
        if (name)
            hexDesc += ` · ${name}`;
    }
    const all: Array<[string, string, string]> = [
        ['hex', hexTitle, hexDesc], ['rgb', rgbTitle, 'RGB'], ['hsl', hslTitle, 'HSL'],
    ];
    const typedIndex = all.findIndex(r => r[0] === c.typed);
    if (typedIndex >= 0)
        all.push(all.splice(typedIndex, 1)[0]);
    return all.map(([id, title, description]) => ({id, title, copy: title, description, icon: ICON, swatch}));
}

export function colourAnswers(query: string): Answer[] {
    if (query.length > MAX_LENGTH || query.length < 4)
        return [];
    // Cheap reject: a colour starts with "#", "rgb", "hsl" or "colo(u)r".
    const c = query.charCodeAt(0) | 32;
    if (c !== 35 && c !== 114 && c !== 104 && c !== 99)
        return [];
    try {
        let text = query.trim().toLowerCase();
        let keyword = false;
        const k = KEYWORD.exec(text);
        if (k) {
            keyword = true;
            text = k[1].trim();
        }
        const colour = parseColour(text, keyword);
        return colour ? rows(colour) : [];
    } catch {
        return [];
    }
}
