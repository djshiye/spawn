// Unit conversion for the search box: "5 km in miles", "100 f in c", "2 gb in mb", "60 mph in km/h",
// "5 ft 10 in in cm", "how many seconds in a day", "30 mpg in l/100km".
// Imports only calc.ts (the number on the left may be an expression: "2*3 km in m"); unit-testable with
// gjs -m (tests/units.test.js).
//
// Text forms (separators: in | to | as | into | = | -> | →, the word "in" is also the inch and is tried in turn):
//   <number or expression> <unit> <sep> <unit>        "5 km in miles", "2*3 km in m"
//   <n> <unit> <n> <unit> ... <sep> <unit>            "5 ft 10 in in cm", "1 h 30 min in s" (summed, same category)
//   <unit> <sep> <unit>                               "km in miles", "mile to km" (1; the spelling needs 2+ characters)
//   how many <unit> [are] in <quantity>               "how many cm in 2 in", "how many feet in a mile" (a/an/one = 1)
// "." is the decimal point. Units are matched case-insensitively (except "kN", the kilonewton, which is
// case-sensitive because "kn" is the knot) and must belong to the same category:
//   length       nm µm mm cm dm m km, in ft yd mi nmi, thou (mil) furlong fathom chain au ly pc
//   mass         µg mg g kg t(onne), oz lb st, ct (carat) gr (grain), short ton, long ton ("ton" alone is ambiguous: no)
//   temperature  c f k, Rankine (°R)                                       offsets, not just factors
//   volume       ml cl dl l hl m3 cm3 (cc) mm3 in3 ft3 yd3, tsp tbsp floz cup pt qt gal (US customary),
//                impgal / ukgal / ukpt / ukqt / ukfloz (imperial), bbl (oil barrel)
//   area         mm2 cm2 m2 km2 ha, in2 ft2 yd2 mi2, acre ("sq ft", "square metres", "m²")
//   data         bit(s) b kb mb gb tb pb eb (decimal), kib mib gib tib pib eib (binary), kbit mbit gbit tbit;
//                "kb" is kilobytes, not kilobits
//   data rate    bit/s kbit/s Mbit/s Gbit/s (bps kbps mbps gbps), B/s kB/s MB/s GB/s (mb/s ...), KiB/s MiB/s GiB/s
//   speed        m/s km/h (kmh, kph) mph kn(knot) ft/s, mach, "speed of light" (the bare letter c is Celsius)
//   time         ns us ms s min h d wk fortnight, month (1/12 year), year (365.25 days), decade century millennium
//   pressure     Pa hPa kPa MPa bar mbar psi atm torr mmHg inHg
//   energy       J kJ MJ cal kcal Wh kWh MWh BTU eV ft·lbf
//   power        W kW MW GW hp (mechanical) PS (metric) BTU/h
//   force        N kN (exactly "kN"; "kn"/"KN"/"Kn" stay the knot) lbf kgf dyn
//   torque       N·m ("n m", "newton metres"; "nm" is the nanometre) lbf·ft ("lb ft") kgf·m
//   angle        deg ° rad grad turn (rev) arcmin arcsec
//   frequency    Hz kHz MHz GHz THz rpm
//   fuel economy mpg (US) mpg uk km/l l/100km (the reciprocal of the others; zero or negative -> no answer)
//
// Public API:
//   convertText(text): Conversion | null     null unless the whole text is a valid, finite conversion
//   convert(value, from: Unit, to: Unit): number     NaN when the value is impossible (l/100km <= 0)
//   findUnit(name): Unit | null              lookup by any spelling
//   duplicateSpellings(): string[]           spellings claimed by two units (must be empty; unit-tested)
//   Conversion: {value (number), unit (target symbol), text (e.g. "3.1068559 mi"), from (e.g. "5 km"),
//                category (e.g. "length"), note? (friendlier split for ft, st, lb and h: "5 ft 10 in")}
//   Unit: {symbol, category, factor, offset, inverse?}

import {evaluate, formatNumber} from './calc.js';

export interface Unit {
    symbol: string;
    category: string;
    /** Size in the category's base unit (kelvin for temperature has an offset as well). */
    factor: number;
    offset: number;
    /** Fuel economy in litres per 100 km: the base value (km per litre) is 100 / value. */
    inverse?: boolean;
}

export interface Conversion {
    value: number;
    unit: string;
    /** Value and unit symbol, ready to show and copy: "3.1068559 mi". */
    text: string;
    /** The input side: "5 km", or "5 ft 10 in" for a compound quantity. */
    from: string;
    /** The category name of both sides: "length", "pressure", "fuel economy"... */
    category: string;
    /** A friendlier split of the answer ("5 ft 10 in", "11 st 4.2 lb", "2 lb 3.3 oz", "1 h 30 min"), only when it differs from `text`. */
    note?: string;
}

const DIGITS = 8;
const MAX_LENGTH = 120;
const GAL = 3.785411784; // US gallon in litres
const AU = 149597870700; // metres (IAU 2012)
const LBF = 4.4482216152605; // newtons (0.45359237 kg * 9.80665 m/s²)
const MMHG = 133.322387415; // pascals, conventional (13595.1 kg/m³ * 9.80665 m/s² * 1 mm)
const BTU = 1055.05585262; // joules, international table
const FTLBF = LBF * 0.3048; // joules

type Row = [string, string, number, string[]];

// [category, symbol, factor to the base unit, spellings (lower case)].
// Base units: m, kg, K, l, m², B, B/s, m/s, s, Pa, J, W, N, N·m, deg, Hz, km/l.
function buildTable(): Row[] {
    return [
        ['length', 'nm', 1e-9, ['nm', 'nanometre', 'nanometres', 'nanometer', 'nanometers']],
        ['length', 'µm', 1e-6, ['um', 'µm', 'μm', 'micron', 'microns', 'micrometre', 'micrometres', 'micrometer', 'micrometers']],
        ['length', 'mm', 0.001, ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters']],
        ['length', 'cm', 0.01, ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters']],
        ['length', 'dm', 0.1, ['dm', 'decimetre', 'decimetres', 'decimeter', 'decimeters']],
        ['length', 'm', 1, ['m', 'metre', 'metres', 'meter', 'meters']],
        ['length', 'km', 1000, ['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers']],
        ['length', 'thou', 0.0000254, ['thou', 'thous', 'mil', 'mils']], // 1/1000 inch; "mil" is never a mile
        ['length', 'in', 0.0254, ['in', 'inch', 'inches']],
        ['length', 'ft', 0.3048, ['ft', 'foot', 'feet']],
        ['length', 'yd', 0.9144, ['yd', 'yds', 'yard', 'yards']],
        ['length', 'chain', 20.1168, ['chain', 'chains']], // 22 yards
        ['length', 'furlong', 201.168, ['furlong', 'furlongs']], // 220 yards
        ['length', 'fathom', 1.8288, ['fathom', 'fathoms']], // 2 yards
        ['length', 'mi', 1609.344, ['mi', 'mile', 'miles']],
        ['length', 'nmi', 1852, ['nmi', 'nautical mile', 'nautical miles']],
        ['length', 'au', AU, ['au', 'astronomical unit', 'astronomical units']],
        ['length', 'ly', 299792458 * 31557600, ['ly', 'light year', 'light years', 'lightyear', 'lightyears', 'light-year', 'light-years']], // c * 365.25 days
        ['length', 'pc', (648000 / Math.PI) * AU, ['pc', 'parsec', 'parsecs']], // 648000/π au

        ['mass', 'µg', 1e-9, ['ug', 'µg', 'μg', 'mcg', 'microgram', 'micrograms']],
        ['mass', 'mg', 1e-6, ['mg', 'milligram', 'milligrams']],
        ['mass', 'ct', 2e-4, ['ct', 'carat', 'carats']], // metric carat, 200 mg
        ['mass', 'gr', 6.479891e-5, ['gr', 'grain', 'grains']], // 64.79891 mg
        ['mass', 'g', 0.001, ['g', 'gram', 'grams', 'gramme', 'grammes']],
        ['mass', 'kg', 1, ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos']],
        ['mass', 't', 1000, ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons']],
        ['mass', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces']],
        ['mass', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']],
        ['mass', 'st', 6.35029318, ['st', 'stone', 'stones']],
        ['mass', 'short ton', 907.18474, ['us ton', 'us tons', 'short ton', 'short tons']], // 2000 lb
        ['mass', 'long ton', 1016.0469088, ['uk ton', 'uk tons', 'imperial ton', 'imperial tons', 'long ton', 'long tons']], // 2240 lb

        ['temperature', '°C', 1, ['c', '°c', 'celsius', 'degc', 'deg c', 'degrees celsius']],
        ['temperature', '°F', 5 / 9, ['f', '°f', 'fahrenheit', 'degf', 'deg f', 'degrees fahrenheit']],
        ['temperature', 'K', 1, ['k', 'kelvin']],
        ['temperature', '°R', 5 / 9, ['°r', 'rankine', 'degr', 'deg r', 'degrees rankine']],

        ['volume', 'mm³', 1e-6, ['mm3', 'mm³', 'cubic millimetre', 'cubic millimetres', 'cubic millimeter', 'cubic millimeters']],
        ['volume', 'cm³', 0.001, ['cm3', 'cm³', 'cc', 'cubic centimetre', 'cubic centimetres', 'cubic centimeter', 'cubic centimeters']],
        ['volume', 'ml', 0.001, ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters']],
        ['volume', 'cl', 0.01, ['cl', 'centilitre', 'centilitres', 'centiliter', 'centiliters']],
        ['volume', 'dl', 0.1, ['dl', 'decilitre', 'decilitres', 'deciliter', 'deciliters']],
        ['volume', 'l', 1, ['l', 'litre', 'litres', 'liter', 'liters']],
        ['volume', 'hl', 100, ['hl', 'hectolitre', 'hectolitres', 'hectoliter', 'hectoliters']],
        ['volume', 'm³', 1000, ['m3', 'm³', 'cubic metre', 'cubic metres', 'cubic meter', 'cubic meters']],
        ['volume', 'in³', 0.016387064, ['in3', 'in³', 'cubic inch', 'cubic inches']],
        ['volume', 'ft³', 28.316846592, ['ft3', 'ft³', 'cubic foot', 'cubic feet']],
        ['volume', 'yd³', 764.554857984, ['yd3', 'yd³', 'cubic yard', 'cubic yards']],
        ['volume', 'tsp', 0.00492892159375, ['tsp', 'teaspoon', 'teaspoons']],
        ['volume', 'tbsp', 0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons']],
        ['volume', 'fl oz', 0.0295735295625, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']],
        ['volume', 'cup', 0.2365882365, ['cup', 'cups']],
        ['volume', 'pt', 0.473176473, ['pt', 'pint', 'pints']],
        ['volume', 'qt', 0.946352946, ['qt', 'quart', 'quarts']],
        ['volume', 'gal', GAL, ['gal', 'gallon', 'gallons']],
        ['volume', 'imp fl oz', 0.0284130625, ['ukfloz', 'impfloz', 'uk fl oz', 'imp fl oz', 'imperial fluid ounce', 'imperial fluid ounces']],
        ['volume', 'imp pt', 0.56826125, ['ukpt', 'imppt', 'uk pt', 'imp pt', 'uk pint', 'uk pints', 'imperial pint', 'imperial pints']],
        ['volume', 'imp qt', 1.1365225, ['ukqt', 'impqt', 'uk qt', 'imp qt', 'uk quart', 'uk quarts', 'imperial quart', 'imperial quarts']],
        ['volume', 'imp gal', 4.54609, ['ukgal', 'impgal', 'uk gal', 'imp gal', 'uk gallon', 'uk gallons', 'imperial gallon', 'imperial gallons']],
        ['volume', 'bbl', 158.987294928, ['bbl', 'barrel', 'barrels', 'oil barrel', 'oil barrels']], // 42 US gallons

        ['area', 'mm²', 1e-6, ['mm2', 'mm²', 'sq mm', 'sqmm', 'square millimetre', 'square millimetres', 'square millimeter', 'square millimeters']],
        ['area', 'cm²', 1e-4, ['cm2', 'cm²', 'sq cm', 'sqcm', 'square centimetre', 'square centimetres', 'square centimeter', 'square centimeters']],
        ['area', 'm²', 1, ['m2', 'm²', 'sq m', 'sqm', 'sq metre', 'sq metres', 'sq meter', 'sq meters', 'square metre', 'square metres', 'square meter', 'square meters']],
        ['area', 'km²', 1e6, ['km2', 'km²', 'sq km', 'sqkm', 'square kilometre', 'square kilometres', 'square kilometer', 'square kilometers']],
        ['area', 'ha', 1e4, ['ha', 'hectare', 'hectares']],
        ['area', 'in²', 0.00064516, ['in2', 'in²', 'sq in', 'sqin', 'square inch', 'square inches']],
        ['area', 'ft²', 0.09290304, ['ft2', 'ft²', 'sq ft', 'sqft', 'square foot', 'square feet']],
        ['area', 'yd²', 0.83612736, ['yd2', 'yd²', 'sq yd', 'sqyd', 'square yard', 'square yards']],
        ['area', 'mi²', 2589988.110336, ['mi2', 'mi²', 'sq mi', 'sqmi', 'square mile', 'square miles']],
        ['area', 'acre', 4046.8564224, ['acre', 'acres']], // 4840 square yards

        ['data', 'bit', 0.125, ['bit', 'bits']],
        ['data', 'kbit', 125, ['kbit', 'kbits', 'kilobit', 'kilobits']],
        ['data', 'Mbit', 125e3, ['mbit', 'mbits', 'megabit', 'megabits']],
        ['data', 'Gbit', 125e6, ['gbit', 'gbits', 'gigabit', 'gigabits']],
        ['data', 'Tbit', 125e9, ['tbit', 'tbits', 'terabit', 'terabits']],
        ['data', 'B', 1, ['b', 'byte', 'bytes']],
        ['data', 'kB', 1e3, ['kb', 'kilobyte', 'kilobytes']],
        ['data', 'MB', 1e6, ['mb', 'megabyte', 'megabytes']],
        ['data', 'GB', 1e9, ['gb', 'gigabyte', 'gigabytes']],
        ['data', 'TB', 1e12, ['tb', 'terabyte', 'terabytes']],
        ['data', 'PB', 1e15, ['pb', 'petabyte', 'petabytes']],
        ['data', 'EB', 1e18, ['eb', 'exabyte', 'exabytes']],
        ['data', 'KiB', 1024, ['kib', 'kibibyte', 'kibibytes']],
        ['data', 'MiB', 1024 ** 2, ['mib', 'mebibyte', 'mebibytes']],
        ['data', 'GiB', 1024 ** 3, ['gib', 'gibibyte', 'gibibytes']],
        ['data', 'TiB', 1024 ** 4, ['tib', 'tebibyte', 'tebibytes']],
        ['data', 'PiB', 1024 ** 5, ['pib', 'pebibyte', 'pebibytes']],
        ['data', 'EiB', 1024 ** 6, ['eib', 'exbibyte', 'exbibytes']],

        // "mbps" and "mbit/s" are megaBITS per second; "mb/s" and "mbyte/s" megaBYTES per second.
        ['data rate', 'bit/s', 0.125, ['bit/s', 'bits/s', 'bps', 'bit per second', 'bits per second']],
        ['data rate', 'kbit/s', 125, ['kbit/s', 'kbits/s', 'kbps', 'kilobit/s', 'kilobit per second', 'kilobits per second']],
        ['data rate', 'Mbit/s', 125e3, ['mbit/s', 'mbits/s', 'mbps', 'megabit/s', 'megabit per second', 'megabits per second']],
        ['data rate', 'Gbit/s', 125e6, ['gbit/s', 'gbits/s', 'gbps', 'gigabit/s', 'gigabit per second', 'gigabits per second']],
        ['data rate', 'B/s', 1, ['b/s', 'byte/s', 'bytes/s', 'byte per second', 'bytes per second']],
        ['data rate', 'kB/s', 1e3, ['kb/s', 'kbyte/s', 'kilobyte/s', 'kilobyte per second', 'kilobytes per second']],
        ['data rate', 'MB/s', 1e6, ['mb/s', 'mbyte/s', 'megabyte/s', 'megabyte per second', 'megabytes per second']],
        ['data rate', 'GB/s', 1e9, ['gb/s', 'gbyte/s', 'gigabyte/s', 'gigabyte per second', 'gigabytes per second']],
        ['data rate', 'KiB/s', 1024, ['kib/s', 'kibibyte/s', 'kibibytes per second']],
        ['data rate', 'MiB/s', 1024 ** 2, ['mib/s', 'mebibyte/s', 'mebibytes per second']],
        ['data rate', 'GiB/s', 1024 ** 3, ['gib/s', 'gibibyte/s', 'gibibytes per second']],

        ['speed', 'm/s', 1, ['m/s', 'mps', 'metres per second', 'meters per second', 'metre per second', 'meter per second']],
        ['speed', 'km/h', 1 / 3.6, ['km/h', 'kmh', 'kph', 'kmph', 'kilometres per hour', 'kilometers per hour', 'kilometre per hour', 'kilometer per hour', 'km per hour']],
        ['speed', 'mph', 0.44704, ['mph', 'mi/h', 'miles per hour', 'mile per hour']],
        ['speed', 'kn', 1852 / 3600, ['kn', 'kt', 'knot', 'knots']],
        ['speed', 'ft/s', 0.3048, ['ft/s', 'fps', 'feet per second', 'foot per second']],
        ['speed', 'Mach', 343, ['mach']], // speed of sound in dry air at 20 °C
        ['speed', 'c', 299792458, ['speed of light', 'lightspeed', 'light speed']], // exact; never the bare letter c

        ['time', 'ns', 1e-9, ['ns', 'nanosecond', 'nanoseconds']],
        ['time', 'µs', 1e-6, ['us', 'µs', 'μs', 'microsecond', 'microseconds']],
        ['time', 'ms', 1e-3, ['ms', 'millisecond', 'milliseconds']],
        ['time', 's', 1, ['s', 'sec', 'secs', 'second', 'seconds']],
        ['time', 'min', 60, ['min', 'mins', 'minute', 'minutes']],
        ['time', 'h', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']],
        ['time', 'd', 86400, ['d', 'day', 'days']],
        ['time', 'wk', 604800, ['wk', 'wks', 'week', 'weeks']],
        ['time', 'fortnight', 1209600, ['fortnight', 'fortnights']],
        ['time', 'month', 2629800, ['month', 'months']], // average month: 1/12 of the 365.25-day year
        ['time', 'yr', 31557600, ['yr', 'yrs', 'year', 'years']],
        ['time', 'decade', 315576000, ['decade', 'decades']],
        ['time', 'century', 3155760000, ['century', 'centuries']],
        ['time', 'millennium', 31557600000, ['millennium', 'millennia', 'millenniums']],

        ['pressure', 'Pa', 1, ['pa', 'pascal', 'pascals']],
        ['pressure', 'hPa', 100, ['hpa', 'hectopascal', 'hectopascals']],
        ['pressure', 'kPa', 1e3, ['kpa', 'kilopascal', 'kilopascals']],
        ['pressure', 'MPa', 1e6, ['mpa', 'megapascal', 'megapascals']],
        ['pressure', 'bar', 1e5, ['bar', 'bars']],
        ['pressure', 'mbar', 100, ['mbar', 'millibar', 'millibars']],
        ['pressure', 'psi', (0.45359237 * 9.80665) / 0.00064516, ['psi', 'pounds per square inch']], // lbf / in²
        ['pressure', 'atm', 101325, ['atm', 'atmosphere', 'atmospheres']], // standard atmosphere
        ['pressure', 'torr', 101325 / 760, ['torr']],
        ['pressure', 'mmHg', MMHG, ['mmhg', 'mm hg', 'millimetre of mercury', 'millimetres of mercury', 'millimeter of mercury', 'millimeters of mercury']],
        ['pressure', 'inHg', MMHG * 25.4, ['inhg', 'in hg', 'inch of mercury', 'inches of mercury']],

        ['energy', 'J', 1, ['j', 'joule', 'joules']],
        ['energy', 'kJ', 1e3, ['kj', 'kilojoule', 'kilojoules']],
        ['energy', 'MJ', 1e6, ['mj', 'megajoule', 'megajoules']],
        ['energy', 'cal', 4.184, ['cal', 'cals', 'calorie', 'calories']], // thermochemical (small) calorie
        ['energy', 'kcal', 4184, ['kcal', 'kilocalorie', 'kilocalories']],
        ['energy', 'Wh', 3600, ['wh', 'watt hour', 'watt hours', 'watt-hour', 'watt-hours']],
        ['energy', 'kWh', 3.6e6, ['kwh', 'kilowatt hour', 'kilowatt hours', 'kilowatt-hour', 'kilowatt-hours']],
        ['energy', 'MWh', 3.6e9, ['mwh', 'megawatt hour', 'megawatt hours', 'megawatt-hour', 'megawatt-hours']],
        ['energy', 'BTU', BTU, ['btu', 'btus', 'british thermal unit', 'british thermal units']],
        ['energy', 'eV', 1.602176634e-19, ['ev', 'electronvolt', 'electronvolts', 'electron volt', 'electron volts']],
        ['energy', 'ft·lbf', FTLBF, ['ft·lbf', 'ft-lbf', 'ftlbf', 'ftlb', 'ft lbf', 'ft lb', 'foot pound', 'foot pounds', 'foot-pound', 'foot-pounds']],

        ['power', 'W', 1, ['w', 'watt', 'watts']],
        ['power', 'kW', 1e3, ['kw', 'kilowatt', 'kilowatts']],
        ['power', 'MW', 1e6, ['mw', 'megawatt', 'megawatts']],
        ['power', 'GW', 1e9, ['gw', 'gigawatt', 'gigawatts']],
        ['power', 'hp', 745.699872, ['hp', 'horsepower', 'mechanical horsepower']], // 33000 ft·lbf/min
        ['power', 'PS', 735.49875, ['ps', 'metric horsepower', 'metric hp']], // 75 kgf·m/s
        ['power', 'BTU/h', BTU / 3600, ['btu/h', 'btu/hr', 'btuh', 'btu per hour']],

        ['force', 'N', 1, ['n', 'newton', 'newtons']],
        ['force', 'kN', 1e3, ['kilonewton', 'kilonewtons']], // exactly "kN" (see CASED); "kn" is the knot
        ['force', 'lbf', LBF, ['lbf', 'pound force', 'pounds force', 'pound-force']],
        ['force', 'kgf', 9.80665, ['kgf', 'kilogram force', 'kilograms force', 'kilogram-force']],
        ['force', 'dyn', 1e-5, ['dyn', 'dyne', 'dynes']],

        ['torque', 'N·m', 1, ['n·m', 'n m', 'n-m', 'newton metre', 'newton metres', 'newton meter', 'newton meters', 'newton-metre', 'newton-metres']],
        ['torque', 'lbf·ft', FTLBF, ['lbf·ft', 'lbf ft', 'lbf-ft', 'lb ft', 'lb-ft', 'lbft', 'pound foot', 'pound feet', 'pound-foot', 'pound-feet']],
        ['torque', 'kgf·m', 9.80665, ['kgf·m', 'kgf m', 'kgf-m', 'kgfm']],

        ['angle', 'deg', 1, ['deg', 'degs', '°', 'degree', 'degrees']],
        ['angle', 'rad', 180 / Math.PI, ['rad', 'rads', 'radian', 'radians']],
        ['angle', 'grad', 0.9, ['grad', 'grads', 'gon', 'gradian', 'gradians']],
        ['angle', 'turn', 360, ['turn', 'turns', 'rev', 'revs', 'revolution', 'revolutions']],
        ['angle', 'arcmin', 1 / 60, ['arcmin', 'arcmins', 'arcminute', 'arcminutes', 'arc minute', 'arc minutes']],
        ['angle', 'arcsec', 1 / 3600, ['arcsec', 'arcsecs', 'arcsecond', 'arcseconds', 'arc second', 'arc seconds']],

        ['frequency', 'Hz', 1, ['hz', 'hertz']],
        ['frequency', 'kHz', 1e3, ['khz', 'kilohertz']],
        ['frequency', 'MHz', 1e6, ['mhz', 'megahertz']],
        ['frequency', 'GHz', 1e9, ['ghz', 'gigahertz']],
        ['frequency', 'THz', 1e12, ['thz', 'terahertz']],
        ['frequency', 'rpm', 1 / 60, ['rpm', 'rev/min', 'revolutions per minute']],

        // Base unit km per litre; litres per 100 km is the reciprocal (see `inverse`).
        ['fuel economy', 'mpg', 1.609344 / GAL, ['mpg', 'mpg us', 'us mpg', 'miles per gallon', 'miles per us gallon']],
        ['fuel economy', 'mpg uk', 1.609344 / 4.54609, ['mpg uk', 'uk mpg', 'mpg imp', 'imp mpg', 'miles per imperial gallon', 'miles per uk gallon']],
        ['fuel economy', 'km/l', 1, ['km/l', 'kmpl', 'km per litre', 'km per liter', 'kilometres per litre', 'kilometers per liter']],
        ['fuel economy', 'l/100km', 1, ['l/100km', 'l/100 km', 'l per 100km', 'l per 100 km', 'litres per 100 km', 'litres per 100 kilometres', 'liters per 100 km', 'liters per 100 kilometers']],
    ];
}

// Temperature offsets in kelvin: base = value * factor + offset.
const OFFSETS: Record<string, number> = {'°C': 273.15, '°F': 273.15 - 160 / 9};

// Built on first use: the table is only needed once a query looks like a conversion.
let units: Map<string, Unit> | null = null;
const duplicates: string[] = [];

function lookup(): Map<string, Unit> {
    if (units)
        return units;
    const map = new Map<string, Unit>();
    for (const [category, symbol, factor, names] of buildTable()) {
        const unit: Unit = {symbol, category, factor, offset: OFFSETS[symbol] ?? 0};
        if (symbol === 'l/100km')
            unit.inverse = true;
        for (const n of names) {
            if (map.has(n))
                duplicates.push(n);
            else
                map.set(n, unit);
        }
    }
    units = map;
    return map;
}

/** Spellings claimed by more than one unit (the first claim wins); must be empty. */
export function duplicateSpellings(): string[] {
    lookup();
    return duplicates.slice();
}

// Exact-case spellings that would clash once lower-cased: "kN" is the kilonewton, "kn" (any other case) the knot.
const CASED = new Map([['kN', 'kilonewton']]);

export function findUnit(name: string): Unit | null {
    const trimmed = name.trim().replace(/\.$/, '').replace(/\s+/g, ' ');
    const map = lookup();
    const cased = CASED.get(trimmed);
    if (cased)
        return map.get(cased) ?? null;
    return map.get(trimmed.toLowerCase()) ?? null;
}

function toBase(value: number, unit: Unit): number {
    if (unit.inverse)
        return value > 0 ? 100 / value : NaN;
    return value * unit.factor + unit.offset;
}

export function convert(value: number, from: Unit, to: Unit): number {
    return fromBase(toBase(value, from), to);
}

function fromBase(base: number, to: Unit): number {
    if (to.inverse)
        return base > 0 ? 100 / base : NaN;
    const d = base - to.offset;
    // Cancelling offsets leave float dust ("491.67 °R in °C"): snap it to an exact zero.
    return to.offset && Math.abs(d) < 1e-12 * Math.abs(base) ? 0 : d / to.factor;
}

// Cheap gate: a separator candidate (" in ", " to ", " as ", " into ", "=", "->", "→") or "how many".
const QUICK = /\s(?:in|to|as|into)\s|[=→]|->|^\s*how many/i;
const SEPARATOR = /\s+(?:in|to|as|into)(?=\s)|\s*(?:=|->|→)/gi;
const HOW_MANY = /^\s*how many\s+(.+?)\s+(?:are\s+(?:there\s+)?)?in\s+(.+)$/i;
const SEGMENT = /\s*(\d+(?:\.\d+)?)\s*([\p{L}°µμ][^\d]*?)(?=\s+\d|\s*$)/uy;

/**
 * Split "<lhs> <sep> <rhs>" at every separator candidate in turn (the word "in" is also the inch) and return
 * the first split where the left side is a quantity and the right side a unit of the same category.
 */
export function convertText(text: string): Conversion | null {
    if (text.length > MAX_LENGTH + 40 || !QUICK.test(text))
        return null;
    const input = text.trim();
    if (!input || input.length > MAX_LENGTH)
        return null;
    const many = HOW_MANY.exec(input);
    if (many) {
        const to = findUnit(many[1]);
        return to ? convertQuantity(many[2].replace(/^(?:an?|one)\s+/i, '1 '), to) : null;
    }
    for (const m of input.matchAll(SEPARATOR)) {
        const left = input.slice(0, m.index).trim();
        const right = input.slice(m.index + m[0].length).trim();
        const to = right ? findUnit(right) : null;
        if (!to || !left)
            continue;
        const result = convertQuantity(left, to);
        if (result)
            return result;
    }
    return null;
}

function convertQuantity(left: string, to: Unit): Conversion | null {
    const q = parseQuantity(left, to.category);
    if (!q)
        return null;
    const value = fromBase(q.base, to);
    if (!Number.isFinite(value))
        return null;
    const text = `${formatNumber(value, DIGITS)} ${to.symbol}`;
    const result: Conversion = {value, unit: to.symbol, text, from: q.from, category: to.category};
    const note = friendly(value, to.symbol);
    if (note && note !== text)
        result.note = note;
    return result;
}

interface Quantity {
    base: number;
    from: string;
}

/** "5 km" / "2*3 km" / "5km" / "mile" (1) / "5 ft 10 in" (summed) in the given category, as a base-unit value. */
function parseQuantity(left: string, category: string): Quantity | null {
    // A bare unit means one of it, but only for spellings of two or more characters ("c in f" is not a question).
    if (left.length >= 2 && left.toLowerCase() !== 'in') {
        const unit = findUnit(left);
        if (unit?.category === category)
            return {base: toBase(1, unit), from: `1 ${unit.symbol}`};
    }
    const single = splitQuantity(left, category);
    if (single)
        return single;
    return compound(left, category);
}

function splitQuantity(left: string, category: string): Quantity | null {
    for (let i = 1; i < left.length; i++) {
        const c = left[i];
        // A unit starts at a letter or degree sign that follows a digit, space, ')' or '.'.
        if (!/[\p{L}°µμ]/u.test(c) || !/[\d\s).]/.test(left[i - 1]))
            continue;
        const unit = findUnit(left.slice(i));
        if (!unit || unit.category !== category)
            continue;
        const value = evaluate(left.slice(0, i));
        if (value === null)
            continue;
        const base = toBase(value, unit);
        if (!Number.isFinite(base))
            continue;
        return {base, from: `${formatNumber(value, DIGITS)} ${unit.symbol}`};
    }
    return null;
}

/** "5 ft 10 in", "1 h 30 min": two or more "<number> <unit>" parts of one additive category, summed. */
function compound(left: string, category: string): Quantity | null {
    if (category === 'temperature' || category === 'fuel economy' || !/^\s*\d/.test(left))
        return null;
    SEGMENT.lastIndex = 0;
    let base = 0;
    let end = 0;
    const parts: string[] = [];
    while (end < left.length) {
        SEGMENT.lastIndex = end;
        const m = SEGMENT.exec(left);
        if (!m)
            return null;
        const unit = findUnit(m[2]);
        if (!unit || unit.category !== category)
            return null;
        const n = Number(m[1]);
        base += n * unit.factor;
        parts.push(`${formatNumber(n, DIGITS)} ${unit.symbol}`);
        end = SEGMENT.lastIndex;
    }
    return parts.length >= 2 && Number.isFinite(base) ? {base, from: parts.join(' ')} : null;
}

const trim1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
const isWhole = (x: number) => Math.abs(x - Math.round(x)) < 1e-9;

/** The friendlier split for feet, stones, pounds and hours; null for every other target or a plain value. */
function friendly(value: number, symbol: string): string | null {
    if (!(value >= 1) || !Number.isFinite(value))
        return null;
    if (symbol === 'ft') {
        let whole = Math.floor(value + 1e-9);
        let inches = Math.round((value - whole) * 120) / 10;
        if (inches >= 12) {
            whole++;
            inches = 0;
        }
        return inches === 0 ? null : `${whole} ft ${trim1(inches)} in`;
    }
    if (symbol === 'st' || symbol === 'lb') {
        if (isWhole(value))
            return null;
        const [big, small, per] = symbol === 'st' ? ['st', 'lb', 14] as const : ['lb', 'oz', 16] as const;
        let whole = Math.floor(value);
        let rest = Math.round((value - whole) * per * 10) / 10;
        if (rest >= per) {
            whole++;
            rest = 0;
        }
        return rest === 0 ? null : `${whole} ${big} ${trim1(rest)} ${small}`;
    }
    if (symbol === 'h') {
        if (isWhole(value))
            return null;
        let hours = Math.floor(value);
        let minutes = Math.round((value - hours) * 60);
        if (minutes >= 60) {
            hours++;
            minutes = 0;
        }
        return minutes === 0 ? null : `${hours} h ${minutes} min`;
    }
    return null;
}
