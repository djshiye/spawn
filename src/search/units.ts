// Unit conversion for the search box: "5 km in miles", "100 f in c", "2 gb in mb", "60 mph in km/h".
// Imports only calc.ts (the number on the left may be an expression: "2*3 km in m"); unit-testable with
// gjs -m (tests/units.test.js).
//
// Text form: <number or expression> <unit> (in | to | as | = | -> | →) <unit>. The number is required.
// "." is the decimal point. Units are matched case-insensitively and must belong to the same category:
//   length       mm cm m km in ft yd mi nmi (inch/inches, foot/feet, mile(s), metre/meter, ...)
//   mass         mg g kg t(onne) oz lb(s) st(one)                         ("ton" is ambiguous: not supported)
//   temperature  c f k (°C, °F, celsius, fahrenheit, kelvin)               offsets, not just factors
//   volume       ml cl l m3, tsp tbsp floz cup pt qt gal (US customary), impgal / ukgal / ukpt (imperial)
//   data         b kb mb gb tb pb (decimal: 1 GB = 1000 MB), kib mib gib tib pib (binary: 1 GiB = 1024 MiB),
//                bit(s); "kb" is kilobytes, not kilobits
//   speed        m/s km/h (kmh, kph) mph kn(knot) ft/s
//   time         ns us ms s min h d wk, year (365.25 days); "month" is not supported (its length varies)
//
// Public API:
//   convertText(text): Conversion | null     null unless the whole text is a valid, finite conversion
//   convert(value, from: Unit, to: Unit): number
//   findUnit(name): Unit | null              lookup by any spelling
//   Conversion: {value (number), unit (target symbol), text (e.g. "3.1068559 mi"), from (e.g. "5 km")}
//   Unit: {symbol, category}

import {evaluate, formatNumber} from './calc.js';

export interface Unit {
    symbol: string;
    category: string;
    /** Size in the category's base unit (kelvin for temperature has an offset as well). */
    factor: number;
    offset: number;
}

export interface Conversion {
    value: number;
    unit: string;
    /** Value and unit symbol, ready to show and copy: "3.1068559 mi". */
    text: string;
    /** The input side: "5 km". */
    from: string;
}

const DIGITS = 8;
const MAX_LENGTH = 120;

// [category, symbol, factor to the base unit, spellings (lower case)]. Base units: m, kg, K, l, B, m/s, s.
const TABLE: Array<[string, string, number, string[]]> = [
    ['length', 'mm', 0.001, ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters']],
    ['length', 'cm', 0.01, ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters']],
    ['length', 'm', 1, ['m', 'metre', 'metres', 'meter', 'meters']],
    ['length', 'km', 1000, ['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers']],
    ['length', 'in', 0.0254, ['in', 'inch', 'inches']],
    ['length', 'ft', 0.3048, ['ft', 'foot', 'feet']],
    ['length', 'yd', 0.9144, ['yd', 'yds', 'yard', 'yards']],
    ['length', 'mi', 1609.344, ['mi', 'mile', 'miles']],
    ['length', 'nmi', 1852, ['nmi', 'nautical mile', 'nautical miles']],

    ['mass', 'mg', 1e-6, ['mg', 'milligram', 'milligrams']],
    ['mass', 'g', 0.001, ['g', 'gram', 'grams', 'gramme', 'grammes']],
    ['mass', 'kg', 1, ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos']],
    ['mass', 't', 1000, ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons']],
    ['mass', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces']],
    ['mass', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']],
    ['mass', 'st', 6.35029318, ['st', 'stone', 'stones']],

    ['temperature', '°C', 1, ['c', '°c', 'celsius', 'degc', 'deg c', 'degrees celsius']],
    ['temperature', '°F', 5 / 9, ['f', '°f', 'fahrenheit', 'degf', 'deg f', 'degrees fahrenheit']],
    ['temperature', 'K', 1, ['k', 'kelvin']],

    ['volume', 'ml', 0.001, ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters']],
    ['volume', 'cl', 0.01, ['cl', 'centilitre', 'centilitres', 'centiliter', 'centiliters']],
    ['volume', 'l', 1, ['l', 'litre', 'litres', 'liter', 'liters']],
    ['volume', 'm³', 1000, ['m3', 'm³', 'cubic metre', 'cubic metres', 'cubic meter', 'cubic meters']],
    ['volume', 'tsp', 0.00492892159375, ['tsp', 'teaspoon', 'teaspoons']],
    ['volume', 'tbsp', 0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons']],
    ['volume', 'fl oz', 0.0295735295625, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']],
    ['volume', 'cup', 0.2365882365, ['cup', 'cups']],
    ['volume', 'pt', 0.473176473, ['pt', 'pint', 'pints']],
    ['volume', 'qt', 0.946352946, ['qt', 'quart', 'quarts']],
    ['volume', 'gal', 3.785411784, ['gal', 'gallon', 'gallons']],
    ['volume', 'imp pt', 0.56826125, ['ukpt', 'imppt', 'imperial pint', 'imperial pints']],
    ['volume', 'imp gal', 4.54609, ['ukgal', 'impgal', 'imperial gallon', 'imperial gallons']],

    ['data', 'bit', 0.125, ['bit', 'bits']],
    ['data', 'B', 1, ['b', 'byte', 'bytes']],
    ['data', 'kB', 1e3, ['kb', 'kilobyte', 'kilobytes']],
    ['data', 'MB', 1e6, ['mb', 'megabyte', 'megabytes']],
    ['data', 'GB', 1e9, ['gb', 'gigabyte', 'gigabytes']],
    ['data', 'TB', 1e12, ['tb', 'terabyte', 'terabytes']],
    ['data', 'PB', 1e15, ['pb', 'petabyte', 'petabytes']],
    ['data', 'KiB', 1024, ['kib', 'kibibyte', 'kibibytes']],
    ['data', 'MiB', 1024 ** 2, ['mib', 'mebibyte', 'mebibytes']],
    ['data', 'GiB', 1024 ** 3, ['gib', 'gibibyte', 'gibibytes']],
    ['data', 'TiB', 1024 ** 4, ['tib', 'tebibyte', 'tebibytes']],
    ['data', 'PiB', 1024 ** 5, ['pib', 'pebibyte', 'pebibytes']],

    ['speed', 'm/s', 1, ['m/s', 'mps', 'metres per second', 'meters per second']],
    ['speed', 'km/h', 1 / 3.6, ['km/h', 'kmh', 'kph', 'kmph', 'kilometres per hour', 'kilometers per hour']],
    ['speed', 'mph', 0.44704, ['mph', 'mi/h', 'miles per hour']],
    ['speed', 'kn', 1852 / 3600, ['kn', 'kt', 'knot', 'knots']],
    ['speed', 'ft/s', 0.3048, ['ft/s', 'fps']],

    ['time', 'ns', 1e-9, ['ns', 'nanosecond', 'nanoseconds']],
    ['time', 'µs', 1e-6, ['us', 'µs', 'μs', 'microsecond', 'microseconds']],
    ['time', 'ms', 1e-3, ['ms', 'millisecond', 'milliseconds']],
    ['time', 's', 1, ['s', 'sec', 'secs', 'second', 'seconds']],
    ['time', 'min', 60, ['min', 'mins', 'minute', 'minutes']],
    ['time', 'h', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']],
    ['time', 'd', 86400, ['d', 'day', 'days']],
    ['time', 'wk', 604800, ['wk', 'wks', 'week', 'weeks']],
    ['time', 'yr', 31557600, ['yr', 'yrs', 'year', 'years']],
];

// Temperature offsets in kelvin: base = value * factor + offset.
const OFFSETS: Record<string, number> = {'°C': 273.15, '°F': 273.15 - 160 / 9, 'K': 0};

const UNITS = new Map<string, Unit>();
for (const [category, symbol, factor, names] of TABLE) {
    const unit: Unit = {symbol, category, factor, offset: category === 'temperature' ? OFFSETS[symbol] : 0};
    for (const n of names) {
        if (UNITS.has(n))
            throw new Error(`duplicate unit spelling ${n}`);
        UNITS.set(n, unit);
    }
}

export function findUnit(name: string): Unit | null {
    const key = name.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
    return UNITS.get(key) ?? null;
}

export function convert(value: number, from: Unit, to: Unit): number {
    return (value * from.factor + from.offset - to.offset) / to.factor;
}

const SEPARATOR = /\s+(?:in|to|as|into)(?=\s)|\s*(?:=|->|→)/gi;

/**
 * Split "<lhs> <sep> <rhs>" at every separator candidate in turn (the word "in" is also the inch) and return
 * the first split where the left side is "<number> <unit>" and the right side a unit of the same category.
 */
export function convertText(text: string): Conversion | null {
    const input = text.trim();
    if (!input || input.length > MAX_LENGTH)
        return null;
    for (const m of input.matchAll(SEPARATOR)) {
        const left = input.slice(0, m.index).trim();
        const right = input.slice(m.index + m[0].length).trim();
        const to = right ? findUnit(right) : null;
        if (!to || !left)
            continue;
        const split = splitQuantity(left);
        if (!split || split.unit.category !== to.category)
            continue;
        const value = convert(split.value, split.unit, to);
        if (!Number.isFinite(value))
            return null;
        const num = formatNumber(value, DIGITS);
        return {value, unit: to.symbol, text: `${num} ${to.symbol}`, from: `${formatNumber(split.value, DIGITS)} ${split.unit.symbol}`};
    }
    return null;
}

/** "5 km" / "2*3 km" / "5km" -> {5, km}; the unit is the shortest suffix that is one, the rest must evaluate. */
function splitQuantity(left: string): {value: number; unit: Unit} | null {
    for (let i = 1; i < left.length; i++) {
        const c = left[i];
        // A unit starts at a letter or degree sign that follows a digit, space, ')' or '.'.
        if (!/[\p{L}°µμ]/u.test(c) || !/[\d\s).]/.test(left[i - 1]))
            continue;
        const unit = findUnit(left.slice(i));
        if (!unit)
            continue;
        const value = evaluate(left.slice(0, i));
        if (value === null)
            continue;
        return {value, unit};
    }
    return null;
}
