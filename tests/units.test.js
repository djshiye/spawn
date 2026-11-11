import {convert, convertText, findUnit} from '../build/search/units.js';
import {assert, assertEquals, run, test} from './harness.js';

const t = s => convertText(s)?.text ?? null;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('the examples', () => {
    assertEquals(t('5 km in miles'), '3.106856 mi');
    assertEquals(t('5km to mi'), '3.106856 mi');
    assertEquals(t('100 f in c'), '37.777778 °C');
    assertEquals(t('3 ft to cm'), '91.44 cm');
    assertEquals(t('2 gb in mb'), '2000 MB');
    assertEquals(t('1 kg in lb'), '2.2046226 lb');
    assertEquals(t('60 mph in km/h'), '96.56064 km/h');
});

test('the result carries the value, target symbol and input side', () => {
    const c = convertText('5 km in miles');
    assert(near(c.value, 3.1068559611866697));
    assertEquals(c.unit, 'mi');
    assertEquals(c.from, '5 km');
});

test('temperature uses offsets', () => {
    assertEquals(t('0 c to f'), '32 °F');
    assertEquals(t('100 c to f'), '212 °F');
    assertEquals(t('-40 f to c'), '-40 °C');
    assertEquals(t('0 c in k'), '273.15 K');
    assertEquals(t('0 k in c'), '-273.15 °C');
    assertEquals(t('32 °F in °C'), '0 °C');
    assertEquals(t('37 celsius to fahrenheit'), '98.6 °F');
});

test('data: decimal and binary, "gb" is decimal', () => {
    assertEquals(t('1 gb in mb'), '1000 MB');
    assertEquals(t('1 gib in mib'), '1024 MiB');
    assertEquals(t('1 gb in gib'), '0.93132257 GiB');
    assertEquals(t('1 kb in b'), '1000 B');
    assertEquals(t('1 kib in b'), '1024 B');
    assertEquals(t('1 tb in gb'), '1000 GB');
    assertEquals(t('8 bits in bytes'), '1 B');
    assertEquals(t('1.5 GiB to MB'), '1610.6127 MB');
});

test('expressions on the left use the calculator', () => {
    assertEquals(t('2*3 km in m'), '6000 m');
    assertEquals(t('(1+1) km to m'), '2000 m');
    assertEquals(t('10/4 kg in g'), '2500 g');
    assertEquals(t('-5 c in f'), '23 °F');
    assertEquals(t('1e3 m to km'), '1 km');
    assertEquals(t('2^3 l in ml'), '8000 ml');
});

test('length, mass, volume, speed, time', () => {
    assertEquals(t('1 mi in ft'), '5280 ft');
    assertEquals(t('1 in to mm'), '25.4 mm');
    assertEquals(t('10 in in cm'), '25.4 cm'); // "in" as the separator AND as the inch
    assertEquals(t('5 cm in in'), '1.9685039 in');
    assertEquals(t('1 yd in m'), '0.9144 m');
    assertEquals(t('1 lb to oz'), '16 oz');
    assertEquals(t('1 st in lb'), '14 lb');
    assertEquals(t('1 t in kg'), '1000 kg');
    assertEquals(t('1 gal in l'), '3.785411784 l'.replace('3.785411784', '3.7854118'));
    assertEquals(t('1 l in ml'), '1000 ml');
    assertEquals(t('1 cup in ml').startsWith('236.58824'), true);
    assertEquals(t('1 imperial gallon in gal').startsWith('1.2009499'), true);
    assertEquals(t('36 km/h in m/s'), '10 m/s');
    assertEquals(t('1 kn in km/h'), '1.852 km/h');
    assertEquals(t('1 h in min'), '60 min');
    assertEquals(t('2 days in hours'), '48 h');
    assertEquals(t('1 week to d'), '7 d');
    assertEquals(t('1 year in days'), '365.25 d');
    assertEquals(t('1500 ms in s'), '1.5 s');
});

test('round trips come back to the start', () => {
    const names = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'mg', 'g', 'kg', 'oz', 'lb', 'c', 'f', 'k', 'ml', 'l', 'gal', 'pt',
        'kb', 'mib', 'gb', 'm/s', 'km/h', 'mph', 's', 'min', 'h', 'd'];
    for (const a of names) {
        const ua = findUnit(a);
        for (const b of names) {
            const ub = findUnit(b);
            if (ua.category !== ub.category)
                continue;
            const there = convert(123.456, ua, ub);
            assert(near(convert(there, ub, ua), 123.456, 1e-9), `${a} <-> ${b}`);
        }
    }
});

test('mismatched, unknown and ambiguous units are not conversions', () => {
    for (const bad of ['5 km in kg', '5 kg in c', '5 mb in mph', '1 ton in kg', '1 month in days', '5 km in', 'km in miles', '5 in', 'in cm',
        '5 xyz in abc', '5 km miles', 'firefox in chrome', 'hello to world', '5 km in miles in ft', '1e999 km in m', '']) {
        assertEquals(t(bad), null, JSON.stringify(bad));
    }
    assertEquals(t('5 kb in mb'), '0.005 MB'); // kilobytes
});

test('spelling variants and punctuation', () => {
    assertEquals(t('5 KM IN MILES'), '3.106856 mi');
    assertEquals(t('5 Kilometres to Miles'), '3.106856 mi');
    assertEquals(t('5 km = mi'), '3.106856 mi');
    assertEquals(t('5 km -> mi'), '3.106856 mi');
    assertEquals(t('5 km → mi'), '3.106856 mi');
    assertEquals(t('  5   km   in   mi  '), '3.106856 mi');
    assertEquals(t('5 km in mi.'), '3.106856 mi');
});

run();
