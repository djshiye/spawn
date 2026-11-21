// Time zones for the search box: the current time somewhere, or a clock time converted between two places.
// Fully offline: only Date and Intl (the system's ICU time zone data). Imports only the Answer type;
// unit-testable with gjs -m (tests/timezones.test.js).
//
// Text forms (case-insensitive, extra spaces tolerated):
//   current time   "time in tokyo", "time tokyo", "tokyo time", "now in nyc", "current time in new york",
//                  "what time is it in london"                         -> "09:27 Tokyo"
//   conversion     "3pm london in tokyo", "15:30 utc to sarajevo", "3:30 pm new york in berlin"
//                  "3pm in tokyo"       3 pm here (local zone) -> Tokyo
//                  "3pm tokyo"          3 pm Tokyo -> here        ("3pm tokyo in local" / "here" too)
//   times          3pm, 3 pm, 3:30pm, 15:30, noon, midnight, now. The conversion uses today's date in the source
//                  zone, so daylight saving time is right for that date.
//   places         built-in table of world cities and single-zone countries (diacritics ignored: "zurich"),
//                  abbreviations (utc, gmt, cet, est, pst, ist, jst ...), every IANA zone by full name
//                  ("europe/sarajevo") or city part ("ho chi minh"), fixed offsets ("utc+2", "gmt-5", "utc+5:30"),
//                  and "local" / "here" for the local zone.
//
// Output: exactly one Answer (id "time", icon preferences-system-time-symbolic), or [] unless the whole text is
// recognised. Current time: title "09:27 Tokyo", copy "09:27", description
// "Saturday 21 November · JST, UTC+9 · 8 hours ahead" (half-hour zones: "8 h 30 min ahead").
// Conversion: title "00:00 Tokyo", copy "00:00", description "15:00 London → Tokyo · next day".
//
// Public API:
//   timeAnswers(query, opts?: {now?, hour12?, localZone?}): Answer[]
//   listPlaces(): Array<{name, zone}>      the built-in city / country table (for tests and tooling)

import type {Answer} from './types.js';

const MAX_LENGTH = 120;
const ICON = 'preferences-system-time-symbolic';

// Cheap gate for the many queries that are plain app names (all forms have a space, and either start with a
// digit / time word or end with "time" / "now").
const GATE = /^\d|^(?:noon|midnight|now|time|current|what['’]?s?|local)\b|\b(?:time|now)$/i;
const RX_NOW_A = /^(?:what time is it|what is the time|whats the time|current time|local time|time now|time|now)(?: in| at| for)? (.+)$/;
const RX_NOW_B = /^(.+) (?:local time|time now|time|now)$/;
const RX_TIME = /^(?:(\d{1,2})(?::(\d{2}))?\s?(am|pm)?|(noon)|(midnight)|(now))\s+(.+)$/;
const RX_SPLIT = /^(.+?) (?:in|to|as|->|→) (.+)$/;
const RX_OFFSET = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];

interface Zone {
    /** IANA name, or null for a fixed offset. */
    id: string | null;
    /** Offset in minutes east of UTC (fixed zones only). */
    fixed: number;
    /** Name shown to the user. */
    name: string;
}

interface Wall {
    y: number;
    m: number;
    d: number;
    h: number;
    mi: number;
    wd: number;
}

// Abbreviation -> IANA zone. The abbreviation is shown as the place name.
const ABBREVIATIONS: Record<string, string> = {
    utc: 'UTC', gmt: 'UTC', z: 'UTC', bst: 'Europe/London',
    cet: 'Europe/Berlin', cest: 'Europe/Berlin', eet: 'Europe/Helsinki', eest: 'Europe/Helsinki',
    wet: 'Europe/Lisbon', west: 'Europe/Lisbon',
    est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
    akst: 'America/Anchorage', hst: 'Pacific/Honolulu', ist: 'Asia/Kolkata', jst: 'Asia/Tokyo',
    kst: 'Asia/Seoul', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong', aest: 'Australia/Sydney',
    aedt: 'Australia/Sydney', acst: 'Australia/Adelaide', awst: 'Australia/Perth', nzst: 'Pacific/Auckland',
    nzdt: 'Pacific/Auckland', msk: 'Europe/Moscow', gst: 'Asia/Dubai', pkt: 'Asia/Karachi',
    wib: 'Asia/Jakarta', brt: 'America/Sao_Paulo',
};

// Zones whose short name Intl only gives as "GMT+9": their well-known abbreviation (none observes DST).
const SHORT_NAMES: Record<string, string> = {
    'Asia/Tokyo': 'JST', 'Asia/Seoul': 'KST', 'Asia/Kolkata': 'IST', 'Asia/Singapore': 'SGT',
    'Asia/Hong_Kong': 'HKT', 'Asia/Dubai': 'GST', 'Asia/Karachi': 'PKT', 'Europe/Moscow': 'MSK',
    'Asia/Jakarta': 'WIB', 'America/Sao_Paulo': 'BRT', 'Australia/Perth': 'AWST', 'Australia/Darwin': 'ACST',
    'Africa/Johannesburg': 'SAST', 'Africa/Lagos': 'WAT', 'Africa/Nairobi': 'EAT', 'Asia/Manila': 'PHT',
    'Asia/Shanghai': 'CST', 'Asia/Taipei': 'CST', 'Asia/Bangkok': 'ICT', 'Asia/Ho_Chi_Minh': 'ICT',
    'Asia/Dhaka': 'BST', 'Asia/Kathmandu': 'NPT',
};

// Display|IANA zone|aliases (comma separated). Cities first, then countries that have a single zone.
const PLACES: string[] = [
    // Europe, capitals and a few more
    'London|Europe/London|', 'Dublin|Europe/Dublin|', 'Lisbon|Europe/Lisbon|', 'Madrid|Europe/Madrid|',
    'Paris|Europe/Paris|', 'Brussels|Europe/Brussels|', 'Amsterdam|Europe/Amsterdam|',
    'Luxembourg|Europe/Luxembourg|', 'Berlin|Europe/Berlin|', 'Bern|Europe/Zurich|berne', 'Zurich|Europe/Zurich|',
    'Geneva|Europe/Zurich|', 'Vienna|Europe/Vienna|wien', 'Prague|Europe/Prague|praha', 'Bratislava|Europe/Bratislava|',
    'Budapest|Europe/Budapest|', 'Warsaw|Europe/Warsaw|warszawa', 'Copenhagen|Europe/Copenhagen|',
    'Stockholm|Europe/Stockholm|', 'Oslo|Europe/Oslo|', 'Helsinki|Europe/Helsinki|', 'Reykjavik|Atlantic/Reykjavik|',
    'Tallinn|Europe/Tallinn|', 'Riga|Europe/Riga|', 'Vilnius|Europe/Vilnius|', 'Minsk|Europe/Minsk|',
    'Kyiv|Europe/Kyiv|kiev', 'Chisinau|Europe/Chisinau|', 'Bucharest|Europe/Bucharest|', 'Sofia|Europe/Sofia|',
    'Athens|Europe/Athens|', 'Rome|Europe/Rome|roma', 'Vatican City|Europe/Rome|vatican', 'San Marino|Europe/Rome|',
    'Valletta|Europe/Malta|', 'Monaco|Europe/Monaco|', 'Andorra la Vella|Europe/Andorra|', 'Vaduz|Europe/Vaduz|',
    'Ljubljana|Europe/Ljubljana|', 'Zagreb|Europe/Zagreb|', 'Sarajevo|Europe/Sarajevo|', 'Belgrade|Europe/Belgrade|beograd',
    'Podgorica|Europe/Podgorica|', 'Skopje|Europe/Skopje|', 'Pristina|Europe/Belgrade|prishtina', 'Tirana|Europe/Tirane|',
    'Nicosia|Asia/Nicosia|', 'Moscow|Europe/Moscow|', 'Istanbul|Europe/Istanbul|', 'Ankara|Europe/Istanbul|',
    'Edinburgh|Europe/London|', 'Glasgow|Europe/London|', 'Manchester|Europe/London|', 'Birmingham|Europe/London|',
    'Liverpool|Europe/London|', 'Belfast|Europe/London|', 'Cardiff|Europe/London|', 'Barcelona|Europe/Madrid|',
    'Seville|Europe/Madrid|', 'Porto|Europe/Lisbon|', 'Munich|Europe/Berlin|munchen', 'Frankfurt|Europe/Berlin|',
    'Hamburg|Europe/Berlin|', 'Cologne|Europe/Berlin|koln', 'Milan|Europe/Rome|milano', 'Naples|Europe/Rome|napoli',
    'Venice|Europe/Rome|', 'Marseille|Europe/Paris|', 'Lyon|Europe/Paris|', 'Gothenburg|Europe/Stockholm|',
    'Krakow|Europe/Warsaw|cracow', 'Split|Europe/Zagreb|', 'Banja Luka|Europe/Sarajevo|', 'Mostar|Europe/Sarajevo|',
    'Novi Sad|Europe/Belgrade|', 'Saint Petersburg|Europe/Moscow|st petersburg', 'Kaliningrad|Europe/Kaliningrad|',
    // USA and Canada
    'New York|America/New_York|nyc,new york city,ny', 'Los Angeles|America/Los_Angeles|la', 'San Francisco|America/Los_Angeles|sf,san fran',
    'Chicago|America/Chicago|', 'Houston|America/Chicago|', 'Dallas|America/Chicago|', 'Austin|America/Chicago|',
    'San Antonio|America/Chicago|', 'Denver|America/Denver|', 'Phoenix|America/Phoenix|', 'Seattle|America/Los_Angeles|',
    'Portland|America/Los_Angeles|', 'San Diego|America/Los_Angeles|', 'San Jose|America/Los_Angeles|',
    'Las Vegas|America/Los_Angeles|vegas', 'Miami|America/New_York|', 'Orlando|America/New_York|',
    'Atlanta|America/New_York|', 'Boston|America/New_York|', 'Philadelphia|America/New_York|philly',
    'Washington DC|America/New_York|dc,washington,washington d c', 'Detroit|America/Detroit|',
    'Minneapolis|America/Chicago|', 'New Orleans|America/Chicago|', 'Nashville|America/Chicago|',
    'Salt Lake City|America/Denver|', 'Honolulu|Pacific/Honolulu|hawaii', 'Anchorage|America/Anchorage|alaska',
    'Toronto|America/Toronto|', 'Montreal|America/Toronto|', 'Ottawa|America/Toronto|', 'Vancouver|America/Vancouver|',
    'Calgary|America/Edmonton|', 'Edmonton|America/Edmonton|', 'Winnipeg|America/Winnipeg|', 'Halifax|America/Halifax|',
    "St John's|America/St_Johns|saint johns", 'Mexico City|America/Mexico_City|',
    'Guadalajara|America/Mexico_City|', 'Monterrey|America/Monterrey|', 'Havana|America/Havana|',
    'Panama City|America/Panama|panama', 'San Jose Costa Rica|America/Costa_Rica|', 'Guatemala City|America/Guatemala|',
    'Kingston|America/Jamaica|', 'San Juan|America/Puerto_Rico|', 'Santo Domingo|America/Santo_Domingo|',
    // South America
    'Sao Paulo|America/Sao_Paulo|', 'Rio de Janeiro|America/Sao_Paulo|rio', 'Brasilia|America/Sao_Paulo|',
    'Buenos Aires|America/Argentina/Buenos_Aires|', 'Santiago|America/Santiago|', 'Lima|America/Lima|',
    'Bogota|America/Bogota|', 'Caracas|America/Caracas|', 'Quito|America/Guayaquil|', 'La Paz|America/La_Paz|',
    'Montevideo|America/Montevideo|', 'Asuncion|America/Asuncion|',
    // Asia
    'Tokyo|Asia/Tokyo|', 'Osaka|Asia/Tokyo|', 'Kyoto|Asia/Tokyo|', 'Seoul|Asia/Seoul|', 'Beijing|Asia/Shanghai|peking',
    'Shanghai|Asia/Shanghai|', 'Shenzhen|Asia/Shanghai|', 'Hong Kong|Asia/Hong_Kong|hongkong', 'Macau|Asia/Macau|',
    'Taipei|Asia/Taipei|', 'Singapore|Asia/Singapore|', 'Bangkok|Asia/Bangkok|', 'Hanoi|Asia/Ho_Chi_Minh|',
    'Ho Chi Minh City|Asia/Ho_Chi_Minh|ho chi minh,saigon', 'Jakarta|Asia/Jakarta|', 'Bali|Asia/Makassar|',
    'Kuala Lumpur|Asia/Kuala_Lumpur|kl', 'Manila|Asia/Manila|', 'Delhi|Asia/Kolkata|new delhi', 'Mumbai|Asia/Kolkata|bombay',
    'Bangalore|Asia/Kolkata|bengaluru', 'Chennai|Asia/Kolkata|madras', 'Kolkata|Asia/Kolkata|calcutta',
    'Hyderabad|Asia/Kolkata|', 'Kathmandu|Asia/Kathmandu|', 'Dhaka|Asia/Dhaka|', 'Colombo|Asia/Colombo|',
    'Karachi|Asia/Karachi|', 'Islamabad|Asia/Karachi|', 'Lahore|Asia/Karachi|', 'Kabul|Asia/Kabul|',
    'Tashkent|Asia/Tashkent|', 'Almaty|Asia/Almaty|', 'Baku|Asia/Baku|', 'Tbilisi|Asia/Tbilisi|', 'Yerevan|Asia/Yerevan|',
    'Tehran|Asia/Tehran|', 'Baghdad|Asia/Baghdad|', 'Riyadh|Asia/Riyadh|', 'Jeddah|Asia/Riyadh|', 'Mecca|Asia/Riyadh|',
    'Dubai|Asia/Dubai|', 'Abu Dhabi|Asia/Dubai|', 'Doha|Asia/Qatar|', 'Kuwait City|Asia/Kuwait|', 'Muscat|Asia/Muscat|',
    'Manama|Asia/Bahrain|', 'Amman|Asia/Amman|', 'Beirut|Asia/Beirut|', 'Damascus|Asia/Damascus|',
    'Jerusalem|Asia/Jerusalem|', 'Tel Aviv|Asia/Jerusalem|', 'Ulaanbaatar|Asia/Ulaanbaatar|', 'Yangon|Asia/Yangon|rangoon',
    'Phnom Penh|Asia/Phnom_Penh|', 'Vladivostok|Asia/Vladivostok|', 'Novosibirsk|Asia/Novosibirsk|',
    'Yekaterinburg|Asia/Yekaterinburg|',
    // Africa
    'Cairo|Africa/Cairo|', 'Lagos|Africa/Lagos|', 'Abuja|Africa/Lagos|', 'Nairobi|Africa/Nairobi|',
    'Johannesburg|Africa/Johannesburg|', 'Cape Town|Africa/Johannesburg|', 'Pretoria|Africa/Johannesburg|',
    'Casablanca|Africa/Casablanca|', 'Rabat|Africa/Casablanca|', 'Algiers|Africa/Algiers|', 'Tunis|Africa/Tunis|',
    'Tripoli|Africa/Tripoli|', 'Accra|Africa/Accra|', 'Addis Ababa|Africa/Addis_Ababa|', 'Dar es Salaam|Africa/Dar_es_Salaam|',
    'Kampala|Africa/Kampala|', 'Kinshasa|Africa/Kinshasa|', 'Luanda|Africa/Luanda|', 'Dakar|Africa/Dakar|',
    'Khartoum|Africa/Khartoum|', 'Harare|Africa/Harare|', 'Lusaka|Africa/Lusaka|', 'Maputo|Africa/Maputo|',
    'Abidjan|Africa/Abidjan|', 'Kigali|Africa/Kigali|',
    // Oceania
    'Sydney|Australia/Sydney|', 'Melbourne|Australia/Melbourne|', 'Brisbane|Australia/Brisbane|', 'Perth|Australia/Perth|',
    'Adelaide|Australia/Adelaide|', 'Darwin|Australia/Darwin|', 'Hobart|Australia/Hobart|', 'Canberra|Australia/Sydney|',
    'Auckland|Pacific/Auckland|', 'Wellington|Pacific/Auckland|', 'Christchurch|Pacific/Auckland|', 'Suva|Pacific/Fiji|fiji',
    'Port Moresby|Pacific/Port_Moresby|', 'Guam|Pacific/Guam|', 'Nuuk|America/Nuuk|',
    // Countries with a single time zone
    'UK|Europe/London|united kingdom,britain,great britain,england,scotland,wales,northern ireland',
    'Ireland|Europe/Dublin|', 'Portugal|Europe/Lisbon|', 'Spain|Europe/Madrid|', 'France|Europe/Paris|',
    'Germany|Europe/Berlin|', 'Italy|Europe/Rome|', 'Switzerland|Europe/Zurich|', 'Austria|Europe/Vienna|',
    'Belgium|Europe/Brussels|', 'Netherlands|Europe/Amsterdam|holland', 'Poland|Europe/Warsaw|',
    'Czechia|Europe/Prague|czech republic,czech', 'Slovakia|Europe/Bratislava|', 'Hungary|Europe/Budapest|',
    'Denmark|Europe/Copenhagen|', 'Sweden|Europe/Stockholm|', 'Norway|Europe/Oslo|', 'Finland|Europe/Helsinki|',
    'Iceland|Atlantic/Reykjavik|', 'Estonia|Europe/Tallinn|', 'Latvia|Europe/Riga|', 'Lithuania|Europe/Vilnius|',
    'Belarus|Europe/Minsk|', 'Ukraine|Europe/Kyiv|', 'Moldova|Europe/Chisinau|', 'Romania|Europe/Bucharest|',
    'Bulgaria|Europe/Sofia|', 'Greece|Europe/Athens|', 'Albania|Europe/Tirane|',
    'Bosnia|Europe/Sarajevo|bosnia and herzegovina,bih', 'Croatia|Europe/Zagreb|', 'Serbia|Europe/Belgrade|',
    'Slovenia|Europe/Ljubljana|', 'Montenegro|Europe/Podgorica|', 'North Macedonia|Europe/Skopje|macedonia',
    'Kosovo|Europe/Belgrade|', 'Malta|Europe/Malta|', 'Cyprus|Asia/Nicosia|', 'Turkey|Europe/Istanbul|turkiye',
    'Japan|Asia/Tokyo|', 'South Korea|Asia/Seoul|korea', 'North Korea|Asia/Pyongyang|', 'China|Asia/Shanghai|',
    'Taiwan|Asia/Taipei|', 'Thailand|Asia/Bangkok|', 'Vietnam|Asia/Ho_Chi_Minh|', 'Philippines|Asia/Manila|',
    'Malaysia|Asia/Kuala_Lumpur|', 'India|Asia/Kolkata|', 'Pakistan|Asia/Karachi|', 'Bangladesh|Asia/Dhaka|',
    'Sri Lanka|Asia/Colombo|', 'Nepal|Asia/Kathmandu|', 'Iran|Asia/Tehran|', 'Iraq|Asia/Baghdad|',
    'Saudi Arabia|Asia/Riyadh|saudi', 'UAE|Asia/Dubai|united arab emirates,emirates', 'Qatar|Asia/Qatar|',
    'Kuwait|Asia/Kuwait|', 'Israel|Asia/Jerusalem|', 'Jordan|Asia/Amman|', 'Lebanon|Asia/Beirut|',
    'Egypt|Africa/Cairo|', 'Morocco|Africa/Casablanca|', 'Algeria|Africa/Algiers|', 'Tunisia|Africa/Tunis|',
    'Kenya|Africa/Nairobi|', 'Ethiopia|Africa/Addis_Ababa|', 'Nigeria|Africa/Lagos|', 'Ghana|Africa/Accra|',
    'South Africa|Africa/Johannesburg|', 'New Zealand|Pacific/Auckland|nz', 'Argentina|America/Argentina/Buenos_Aires|',
    'Chile|America/Santiago|', 'Colombia|America/Bogota|', 'Peru|America/Lima|', 'Cuba|America/Havana|',
    'Venezuela|America/Caracas|',
];

let placeTable: Map<string, [string, string]> | null = null;
let ianaTable: Map<string, string> | null = null;
let wallFormatters: Map<string, Intl.DateTimeFormat | null> | null = null;
let nameFormatters: Map<string, Intl.DateTimeFormat | null> | null = null;

/** Lower case, diacritics, dots and apostrophes removed, "_" and "-" as spaces. */
function fold(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ.']/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function places(): Map<string, [string, string]> {
    if (placeTable)
        return placeTable;
    const table = new Map<string, [string, string]>();
    for (const entry of PLACES) {
        const [name, zone, aliases] = entry.split('|');
        const value: [string, string] = [name, zone];
        const key = fold(name);
        if (!table.has(key))
            table.set(key, value);
        if (aliases) {
            for (const alias of aliases.split(',')) {
                const k = fold(alias);
                if (!table.has(k))
                    table.set(k, value);
            }
        }
    }
    placeTable = table;
    return table;
}

function ianaZones(): Map<string, string> {
    if (ianaTable)
        return ianaTable;
    const table = new Map<string, string>();
    try {
        const intl = Intl as unknown as {supportedValuesOf?: (key: string) => string[]};
        const ids = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
        for (const id of ids) {
            table.set(fold(id), id);
            const city = fold(id.slice(id.lastIndexOf('/') + 1));
            if (!table.has(city))
                table.set(city, id);
        }
    } catch {
        // no zone list: only the built-in table and abbreviations are available
    }
    ianaTable = table;
    return table;
}

export function listPlaces(): Array<{name: string; zone: string}> {
    return PLACES.map(entry => {
        const [name, zone] = entry.split('|');
        return {name, zone};
    });
}

function wallFormatter(id: string): Intl.DateTimeFormat | null {
    if (!wallFormatters)
        wallFormatters = new Map();
    let f = wallFormatters.get(id);
    if (f === undefined) {
        try {
            f = new Intl.DateTimeFormat('en-US', {
                timeZone: id, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
                hour: 'numeric', minute: 'numeric', second: 'numeric',
            });
        } catch {
            f = null;
        }
        wallFormatters.set(id, f);
    }
    return f;
}

/** Offset of the zone from UTC at an instant, in milliseconds (NaN if the zone is unusable). */
function offsetMs(zone: Zone, ms: number): number {
    if (zone.id === null)
        return zone.fixed * 60000;
    const f = wallFormatter(zone.id);
    if (!f)
        return NaN;
    const p: Record<string, number> = {};
    for (const part of f.formatToParts(ms)) {
        if (part.type !== 'literal')
            p[part.type] = Number(part.value);
    }
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
}

function wallAt(zone: Zone, ms: number): Wall {
    const dt = new Date(ms + offsetMs(zone, ms));
    return {
        y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
        h: dt.getUTCHours(), mi: dt.getUTCMinutes(), wd: dt.getUTCDay(),
    };
}

/** The instant at which the clock of the zone shows the given date and time. */
function instantOf(zone: Zone, y: number, m: number, d: number, h: number, mi: number): number {
    const naive = Date.UTC(y, m - 1, d, h, mi);
    const first = naive - offsetMs(zone, naive);
    return naive - offsetMs(zone, first);
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function clock(h: number, mi: number, hour12: boolean): string {
    if (hour12)
        return `${h % 12 || 12}:${pad2(mi)} ${h < 12 ? 'am' : 'pm'}`;
    return `${pad2(h)}:${pad2(mi)}`;
}

function offsetName(minutes: number): string {
    if (minutes === 0)
        return 'UTC';
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `UTC${minutes < 0 ? '-' : '+'}${h}${m ? `:${pad2(m)}` : ''}`;
}

/** A real abbreviation ("CET", "EST", "JST") or ''. */
function shortName(zone: Zone, ms: number): string {
    if (zone.id === null)
        return '';
    if (SHORT_NAMES[zone.id])
        return SHORT_NAMES[zone.id];
    if (!nameFormatters)
        nameFormatters = new Map();
    for (const locale of ['en-US', 'en-GB']) {
        const key = `${locale}|${zone.id}`;
        let f = nameFormatters.get(key);
        if (f === undefined) {
            try {
                f = new Intl.DateTimeFormat(locale, {timeZone: zone.id, timeZoneName: 'short'});
            } catch {
                f = null;
            }
            nameFormatters.set(key, f);
        }
        if (!f)
            continue;
        for (const part of f.formatToParts(ms)) {
            if (part.type === 'timeZoneName' && !/^(?:GMT|UTC)[+\-−]/.test(part.value))
                return part.value;
        }
    }
    return '';
}

function cityName(id: string): string {
    return id.slice(id.lastIndexOf('/') + 1).replace(/_/g, ' ');
}

function localZoneOf(id: string): Zone | null {
    return wallFormatter(id) ? {id, fixed: 0, name: 'your time'} : null;
}

function resolvePlace(raw: string, local: Zone): Zone | null {
    const lower = raw.trim();
    if (!lower || lower.length > 40)
        return null;
    if (lower === 'local' || lower === 'here')
        return local;
    const off = RX_OFFSET.exec(lower);
    if (off) {
        const h = Number(off[2]);
        const m = off[3] ? Number(off[3]) : 0;
        const total = h * 60 + m;
        if (m > 59 || total > 14 * 60)
            return null;
        const minutes = off[1] === '-' ? -total : total;
        return {id: null, fixed: minutes, name: offsetName(minutes)};
    }
    const key = fold(lower);
    const abbr = ABBREVIATIONS[key];
    if (abbr !== undefined)
        return wallFormatter(abbr) ? {id: abbr, fixed: 0, name: key === 'z' ? 'UTC' : key.toUpperCase()} : null;
    const hit = places().get(key);
    if (hit)
        return wallFormatter(hit[1]) ? {id: hit[1], fixed: 0, name: hit[0]} : null;
    const iana = ianaZones().get(key);
    if (iana && wallFormatter(iana))
        return {id: iana, fixed: 0, name: cityName(iana)};
    return null;
}

/** The difference to the local zone: "8 hours ahead", "5 h 30 min behind", "same time as here". */
function difference(zone: Zone, local: Zone, ms: number): string {
    const diff = Math.round((offsetMs(zone, ms) - offsetMs(local, ms)) / 60000);
    if (diff === 0)
        return 'same time as here';
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    let text: string;
    if (m === 0)
        text = `${h} ${h === 1 ? 'hour' : 'hours'}`;
    else
        text = h === 0 ? `${m} min` : `${h} h ${m} min`;
    return `${text} ${diff > 0 ? 'ahead' : 'behind'}`;
}

function parseClock(m: RegExpExecArray): {h: number; mi: number} | null | 'now' {
    if (m[6])
        return 'now';
    if (m[4])
        return {h: 12, mi: 0};
    if (m[5])
        return {h: 0, mi: 0};
    let h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (mi > 59)
        return null;
    if (m[3]) {
        if (h < 1 || h > 12)
            return null;
        h = h % 12 + (m[3] === 'pm' ? 12 : 0);
    } else {
        // a bare number ("5 km", "3 weeks") is no time; it needs a colon or am / pm
        if (!m[2] || h > 23)
            return null;
    }
    return {h, mi};
}

function currentTime(placeText: string, now: Date, hour12: boolean, local: Zone): Answer[] | null {
    const zone = resolvePlace(placeText, local);
    if (!zone)
        return null;
    const ms = now.getTime();
    const w = wallAt(zone, ms);
    const abbr = shortName(zone, ms);
    const offset = offsetName(Math.round(offsetMs(zone, ms) / 60000));
    const zoneText = abbr && abbr !== offset ? `${abbr}, ${offset}` : offset;
    const time = clock(w.h, w.mi, hour12);
    return [{
        id: 'time',
        title: `${time} ${zone.name}`,
        copy: time,
        description: `${DAYS[w.wd]} ${w.d} ${MONTHS[w.m - 1]} · ${zoneText} · ${difference(zone, local, ms)}`,
        icon: ICON,
    }];
}

function convertTime(text: string, now: Date, hour12: boolean, local: Zone): Answer[] | null {
    const m = RX_TIME.exec(text);
    if (!m)
        return null;
    const t = parseClock(m);
    if (!t)
        return null;
    const rest = m[7];
    let srcText: string;
    let dstText: string;
    if (rest.startsWith('in ') || rest.startsWith('to ')) {
        srcText = 'local';
        dstText = rest.slice(3);
    } else {
        const s = RX_SPLIT.exec(rest);
        srcText = s ? s[1] : rest;
        dstText = s ? s[2] : 'local';
    }
    const src = resolvePlace(srcText, local);
    const dst = resolvePlace(dstText, local);
    if (!src || !dst)
        return null;
    const nowMs = now.getTime();
    const today = wallAt(src, nowMs);
    let h: number;
    let mi: number;
    if (t === 'now') {
        h = today.h;
        mi = today.mi;
    } else {
        h = t.h;
        mi = t.mi;
    }
    const instant = instantOf(src, today.y, today.m, today.d, h, mi);
    const out = wallAt(dst, instant);
    const srcWall = wallAt(src, instant);
    const dayDiff = Math.round((Date.UTC(out.y, out.m - 1, out.d) - Date.UTC(srcWall.y, srcWall.m - 1, srcWall.d)) / 86400000);
    const time = clock(out.h, out.mi, hour12);
    const shift = dayDiff > 0 ? ' · next day' : dayDiff < 0 ? ' · previous day' : '';
    return [{
        id: 'time',
        title: `${time} ${dst.name}`,
        copy: time,
        description: `${clock(srcWall.h, srcWall.mi, hour12)} ${src.name} → ${dst.name}${shift}`,
        icon: ICON,
    }];
}

export function timeAnswers(query: string, opts: {now?: Date; hour12?: boolean; localZone?: string} = {}): Answer[] {
    query = query.trim();
    if (query.length > MAX_LENGTH || query.indexOf(' ') < 0 || !GATE.test(query))
        return [];
    try {
        const text = query.toLowerCase().replace(/['’?!]/g, '').replace(/\s+/g, ' ').trim();
        const now = opts.now ?? new Date();
        if (isNaN(now.getTime()))
            return [];
        const hour12 = opts.hour12 === true;
        const localId = opts.localZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const local = localId ? localZoneOf(localId) : null;
        if (!local)
            return [];
        for (const rx of [RX_NOW_A, RX_NOW_B]) {
            const m = rx.exec(text);
            if (m) {
                const r = currentTime(m[1], now, hour12, local);
                if (r)
                    return r;
            }
        }
        return convertTime(text, now, hour12, local) ?? [];
    } catch {
        return [];
    }
}
