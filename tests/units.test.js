import {convert, convertText, duplicateSpellings, findUnit} from '../build/search/units.js';
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
    for (const bad of ['5 km in kg', '5 kg in c', '5 mb in mph', '1 ton in kg', '5 km in', '5 in', 'in cm',
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

const c = s => convertText(s);

test('no spelling is claimed twice', () => {
    assertEquals(duplicateSpellings(), []);
});

test('area', () => {
    assertEquals(t('1 ha in m2'), '10000 m²');
    assertEquals(t('1 acre in m²'), '4046.8564 m²');
    assertEquals(t('1 acre in sq ft'), '43560 ft²');
    assertEquals(t('1 sq mi in acres'), '640 acre');
    assertEquals(t('100 sqft in sqm'), '9.290304 m²');
    assertEquals(t('1 square kilometre in hectares'), '100 ha');
    assertEquals(t('1 m2 in cm2'), '10000 cm²');
    assertEquals(t('1 ft² to in²'), '144 in²');
});

test('pressure', () => {
    assertEquals(t('1 atm in kpa'), '101.325 kPa');
    assertEquals(t('1 bar in psi'), '14.503774 psi');
    assertEquals(t('1 atm in mmhg'), '759.99989 mmHg');
    assertEquals(t('760 torr in atm'), '1 atm');
    assertEquals(t('1 bar in mbar'), '1000 mbar');
    assertEquals(t('1 mpa in bar'), '10 bar');
    assertEquals(t('29.92 inhg in hpa'), '1013.2075 hPa');
    assertEquals(t('1 pa in hpa'), '0.01 hPa');
});

test('energy, power, force, torque', () => {
    assertEquals(t('1 kwh in mj'), '3.6 MJ');
    assertEquals(t('1 kcal in kj'), '4.184 kJ');
    assertEquals(t('1 btu in j'), '1055.0559 J');
    assertEquals(t('1 wh in j'), '3600 J');
    assertEquals(t('1 ev in j'), '1.6021766e-19 J');
    assertEquals(t('1 ft lb in j'), '1.3558179 J');
    assertEquals(t('1 foot pound in ftlbf'), '1 ft·lbf');
    assertEquals(t('1 hp in w'), '745.69987 W');
    assertEquals(t('1 hp in ps'), '1.0138697 PS');
    assertEquals(t('1 kw in hp'), '1.3410221 hp');
    assertEquals(t('1000 btu/h in w'), '293.07107 W');
    assertEquals(t('1 kgf in n'), '9.80665 N');
    assertEquals(t('1 lbf in n'), '4.4482216 N');
    assertEquals(t('1 n in dyn'), '100000 dyn');
    assertEquals(t('1 kilonewton in n'), '1000 N');
    assertEquals(t('100 n m in lb ft'), '73.756215 lbf·ft');
    assertEquals(t('100 newton metres in kgf m').startsWith('10.19716'), true);
    assertEquals(t('1 nm in m'), '1e-9 m'); // nanometre
    assertEquals(t('1 n·m in n m'), '1 N·m');
});

test('angle and frequency', () => {
    assertEquals(t('180 deg in rad'), '3.1415927 rad');
    assertEquals(t('90° in grad'), '100 grad');
    assertEquals(t('1 turn in degrees'), '360 deg');
    assertEquals(t('1 rev in rad'), '6.2831853 rad');
    assertEquals(t('1 deg in arcmin'), '60 arcmin');
    assertEquals(t('1 arcmin in arcsec'), '60 arcsec');
    assertEquals(t('1 ghz in mhz'), '1000 MHz');
    assertEquals(t('60 rpm in hz'), '1 Hz');
    assertEquals(t('1 min in arcmin'), null);
    assertEquals(t('90 minutes in s'), '5400 s');
});

test('data rate', () => {
    assertEquals(t('100 mbps in mb/s'), '12.5 MB/s');
    assertEquals(t('100 mb/s in mbps'), '800 Mbit/s');
    assertEquals(t('1 gbps in mbit/s'), '1000 Mbit/s');
    assertEquals(t('1 gbit/s in mb/s'), '125 MB/s');
    assertEquals(t('8 megabits per second in megabytes per second'), '1 MB/s');
    assertEquals(t('1 gib/s in mib/s'), '1024 MiB/s');
    assertEquals(t('1 kbps in bps'), '1000 bit/s');
    assertEquals(t('1 mb/s in mb'), null);
});

test('fuel economy, with the reciprocal l/100km', () => {
    assertEquals(t('30 mpg in l/100km'), '7.8404861 l/100km');
    assert(t('5 l/100km in mpg uk').startsWith('56.496'));
    assertEquals(t('8 l/100km in km/l'), '12.5 km/l');
    assertEquals(t('12.5 km/l in l/100km'), '8 l/100km');
    assertEquals(t('10 km/l in mpg').startsWith('23.5214'), true);
    assertEquals(t('30 mpg in mpg uk').startsWith('36.0'), true);
    assertEquals(t('30 uk mpg in mpg').startsWith('24.9'), true);
    assertEquals(t('6 litres per 100 km in miles per gallon').startsWith('39.2'), true);
    assertEquals(t('0 l/100km in mpg'), null);
    assertEquals(t('-5 l/100km in mpg'), null);
    assertEquals(t('0 mpg in l/100km'), null);
    assertEquals(t('0 km/l in l/100km'), null);
    assertEquals(t('7 l/100 km in km/l'), '14.285714 km/l');
});

test('more length, mass, volume, time, speed, temperature, data', () => {
    assertEquals(t('1 mm in um'), '1000 µm');
    assertEquals(t('1000 nm in um'), '1 µm');
    assertEquals(t('1 dm in cm'), '10 cm');
    assertEquals(t('1000 mil in in'), '1 in');
    assertEquals(t('1 thou in um'), '25.4 µm');
    assertEquals(t('1 furlong in yd'), '220 yd');
    assertEquals(t('1 fathom in ft'), '6 ft');
    assertEquals(t('1 chain in ft'), '66 ft');
    assertEquals(t('1 au in km'), '149597870 km');
    assertEquals(t('1 light year in km'), '9460730500000 km');
    assertEquals(t('1 pc in ly'), '3.2615638 ly');
    assertEquals(t('1 mg in ug'), '1000 µg');
    assertEquals(t('1 carat in mg'), '200 mg');
    assertEquals(t('1 gr in mg'), '64.79891 mg');
    assertEquals(t('1 g in gr').startsWith('15.4323'), true);
    assertEquals(t('1 short ton in kg'), '907.18474 kg');
    assertEquals(t('1 long ton in kg'), '1016.0469 kg');
    assertEquals(t('1 uk ton in lb'), '2240 lb');
    assertEquals(t('1 us ton in lb'), '2000 lb');
    assertEquals(t('1 cc in ml'), '1 ml');
    assertEquals(t('1 l in cm3'), '1000 cm³');
    assertEquals(t('1 ft3 in l'), '28.316847 l');
    assertEquals(t('1 yd³ in ft³'), '27 ft³');
    assertEquals(t('1 in3 in ml'), '16.387064 ml');
    assertEquals(t('1 hl in l'), '100 l');
    assertEquals(t('1 dl in ml'), '100 ml');
    assert(t('1 imp fl oz in ml').startsWith('28.41306'));
    assertEquals(t('1 uk qt in uk pt'), '2 imp pt');
    assertEquals(t('1 uk quart in l'), '1.1365225 l');
    assertEquals(t('1 barrel in gal'), '42 gal');
    assertEquals(t('1 pt in uk pt').startsWith('0.8326'), true);
    assertEquals(t('1 fortnight in days'), '14 d');
    assertEquals(t('1 month in days'), '30.4375 d');
    assertEquals(t('12 months in years'), '1 yr');
    assertEquals(t('1 decade in years'), '10 yr');
    assertEquals(t('1 century in decades'), '10 decade');
    assertEquals(t('1 millennium in centuries'), '10 century');
    assertEquals(t('1 mach in m/s'), '343 m/s');
    assertEquals(t('1 speed of light in km/h'), '1079252800 km/h');
    assertEquals(t('1 lightspeed in m/s'), '299792460 m/s');
    assertEquals(t('0 rankine in k'), '0 K');
    assertEquals(t('491.67 °r in c'), '0 °C');
    assertEquals(t('32 f in degr'), '491.67 °R');
    assertEquals(t('1 eb in tb'), '1000000 TB');
    assertEquals(t('1 eib in pib'), '1024 PiB');
    assertEquals(t('1 kbit in bits'), '1000 bit');
    assertEquals(t('1 mbit in kbit'), '1000 kbit');
    assertEquals(t('1 gbit in mb'), '125 MB');
    assertEquals(t('1 km per hour in m/s'), '0.27777778 m/s');
    assertEquals(t('10 metres per second in km per hour'), '36 km/h');
});

test('compound quantities are summed', () => {
    const x = c('5 ft 10 in in cm');
    assertEquals(x.text, '177.8 cm');
    assertEquals(x.from, '5 ft 10 in');
    assertEquals(t('1 h 30 min in s'), '5400 s');
    assertEquals(t('2 lb 3 oz in g'), '992.23331 g');
    assertEquals(t('1 m 20 cm to cm'), '120 cm');
    assertEquals(t('1 h 30 min in c'), null);
    assertEquals(t('5 ft 10 kg in cm'), null);
    assertEquals(t('5 ft 10 in in kg'), null);
    assertEquals(t('1 l 50 ml in ml'), '1050 ml');
});

test('how many ... in ...', () => {
    assertEquals(t('how many cm in 2 in'), '5.08 cm');
    assertEquals(t('how many feet in a mile'), '5280 ft');
    assertEquals(t('how many seconds in a day'), '86400 s');
    assertEquals(t('How many hours in an week'), '168 h');
    assertEquals(t('how many days in one year'), '365.25 d');
    assertEquals(t('how many feet are in 2 miles'), '10560 ft');
    assertEquals(t('how many mm in 3 in'), '76.2 mm');
    assertEquals(t('how many m in a km'), '1000 m');
    assertEquals(t('how many grams in 2 lb 3 oz'), '992.23331 g');
    assertEquals(t('how many in in a foot'), '12 in');
    assertEquals(t('how many kg in a mile'), null);
    assertEquals(t('how many pizzas in a day'), null);
});

test('a missing number means one, for spellings of two or more characters', () => {
    const x = c('km in miles');
    assertEquals(x.text, '0.62137119 mi');
    assertEquals(x.from, '1 km');
    assertEquals(t('mile to km'), '1.609344 km');
    assertEquals(t('ft in m'), '0.3048 m');
    assertEquals(t('c in f'), null);
    assertEquals(t('k in c'), null);
    assertEquals(t('m in km'), null);
    assertEquals(t('in in cm'), null);
});

test('category and note', () => {
    assertEquals(c('5 km in mi').category, 'length');
    assertEquals(c('1 atm in bar').category, 'pressure');
    assertEquals(c('30 mpg in l/100km').category, 'fuel economy');
    assertEquals(c('5 km in mi').note, undefined);
    assertEquals(c('177.8 cm in ft').note, '5 ft 10 in');
    assertEquals(c('180 cm in ft').note, '5 ft 10.9 in');
    assertEquals(c('6 ft in ft').note, undefined);
    assertEquals(c('11 stone 4 lb in st').note, '11 st 4 lb');
    assertEquals(c('72 kg in st').note, '11 st 4.7 lb');
    assertEquals(c('72 kg in st').text, '11.338059 st');
    assertEquals(c('1 st in st').note, undefined);
    assertEquals(c('1 kg in lb').note, '2 lb 3.3 oz');
    assertEquals(c('2 lb in lb').note, undefined);
    assertEquals(c('0.4 kg in lb').note, undefined); // below 1 lb
    assertEquals(c('90 min in h').note, '1 h 30 min');
    assertEquals(c('2 h in h').note, undefined);
    assertEquals(c('30 min in h').note, undefined);
    assertEquals(c('1.999 ft in ft').note, undefined); // 11.988 in rounds up to a whole foot
    assertEquals(c('5 ft in cm').note, undefined);
});

test('false positives stay null', () => {
    for (const bad of ['firefox', 'log in', 'sign in to', 'plug in', '2048', 'word to pdf', 'pdf to word', 'in', 'to', 'back in time',
        'how many', 'time in tokyo', '3pm london in tokyo', '255 in hex', '255 in binary', '0xff in decimal', 'today in 3 weeks', 'c in f',
        'term', 'settings', 'files', 'gnome text editor', 'steam', 'c', 'calc', 'how many things', 'as', 'into', '=', '->', ' in ']) {
        assertEquals(t(bad), null, JSON.stringify(bad));
    }
});

test('ambiguous spellings keep their meaning', () => {
    assertEquals(findUnit('nm').symbol, 'nm');
    assertEquals(findUnit('pc').symbol, 'pc');
    assertEquals(findUnit('g').symbol, 'g');
    assertEquals(findUnit('gr').symbol, 'gr');
    assertEquals(findUnit('mil').symbol, 'thou');
    assertEquals(findUnit('pt').symbol, 'pt');
    assertEquals(findUnit('min').symbol, 'min');
    assertEquals(findUnit('b').symbol, 'B');
    assertEquals(findUnit('c').symbol, '°C');
    assertEquals(findUnit('kn').symbol, 'kn');
    assertEquals(findUnit('ps').symbol, 'PS');
    assertEquals(findUnit('ton'), null);
    assertEquals(findUnit('t').symbol, 't');
    assertEquals(findUnit('mbps').symbol, 'Mbit/s');
    assertEquals(findUnit('MB/s').symbol, 'MB/s');
    assertEquals(findUnit('kb').symbol, 'kB');
});

run();
