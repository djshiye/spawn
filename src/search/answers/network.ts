// Network answers for the search box: subnet maths, address classification, IPv6, MAC addresses.
// Pure (imports only the Answer type); unit-testable with gjs -m (tests/network.test.js).
//
// Text forms (case-insensitive):
//   192.168.1.0/24, 192.168.1.130/26, 10.0.0.5 255.255.255.0, 10.0.0.5 mask 255.255.255.0, 10.0.0.5/255.255.255.0
//                                     network, usable range, mask, broadcast, usable hosts, wildcard (RFC 3021 /31, /32)
//   /26, cidr 26, prefix 26           mask, hosts, wildcard, address count
//   netmask 255.255.240.0, mask ..., or a bare mask starting 255 ("255.255.240.0")      prefix length, hosts, wildcard
//   192.168.1.0/24 into /26 (to, split, split into)    the subnets (the first 7 and a summary when there are many)
//   192.168.1.10                      address type (private, loopback...), integer, hex, binary, reverse DNS name
//   is 10.1.2.3 in 10.0.0.0/8 | 10.1.2.3 in 10.0.0.0/8      containment, IPv4 and IPv6
//   2001:db8::/48, fe80::1/64         IPv6 network, first, last, address count, expanded form
//   2001:db8::1, ::1, ::ffff:192.0.2.1   IPv6 address type, compressed, expanded, ip6.arpa name
//   aa:bb:cc:dd:ee:ff, AA-BB-CC-DD-EE-FF, aabb.ccdd.eeff     MAC address in the other formats and its kind
// URLs, "host:port", version numbers and anything incomplete are not answers.
//
// Public API:
//   networkAnswers(query): Answer[]
//   parseIPv4(text): number | null       unsigned 32-bit value of a dotted quad (no leading zeros)
//   formatIPv4(n): string
//   maskToPrefix(mask): number | null    null unless the mask is contiguous ones then zeros
//   prefixToMask(prefix): number         0..32
//   parseIPv6(text): bigint | null       any RFC 4291 text form, including "::" and an embedded IPv4
//   compressIPv6(value): string          RFC 5952 (lower case, longest zero run as "::")

import type {Answer} from './types.js';

const ICON = 'network-wired-symbolic';
const MAX_LENGTH = 120;
const THIN = ' ';
const DASH = '–';

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers (IPv4 as unsigned 32-bit numbers, IPv6 as BigInt)

const OCTET = /^(?:0|[1-9]\d{0,2})$/;

export function parseIPv4(text: string): number | null {
    const parts = text.split('.');
    if (parts.length !== 4)
        return null;
    let n = 0;
    for (let i = 0; i < 4; i++) {
        if (!OCTET.test(parts[i]))
            return null;
        const v = parseInt(parts[i], 10);
        if (v > 255)
            return null;
        n = n * 256 + v;
    }
    return n;
}

export function formatIPv4(n: number): string {
    return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

export function prefixToMask(prefix: number): number {
    if (prefix <= 0)
        return 0;
    if (prefix >= 32)
        return 0xffffffff;
    return (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask: number): number | null {
    const inv = (~mask) >>> 0;
    // Ones then zeros means the inverted mask is 2^k - 1.
    if (((inv & (inv + 1)) >>> 0) !== 0)
        return null;
    return Math.clz32(inv);
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/;

export function parseIPv6(text: string): bigint | null {
    let s = text.toLowerCase();
    if (s.length < 2 || s.length > 45)
        return null;
    const lastColon = s.lastIndexOf(':');
    if (lastColon < 0)
        return null;
    if (s.indexOf('.') >= 0) {
        const v4 = parseIPv4(s.slice(lastColon + 1));
        if (v4 === null)
            return null;
        s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
    }
    const dc = s.indexOf('::');
    let groups: string[];
    if (dc >= 0) {
        if (s.indexOf('::', dc + 1) >= 0)
            return null;
        const left = dc === 0 ? [] : s.slice(0, dc).split(':');
        const rest = s.slice(dc + 2);
        const right = rest === '' ? [] : rest.split(':');
        if (left.length + right.length > 7)
            return null;
        groups = left.concat(new Array<string>(8 - left.length - right.length).fill('0'), right);
    } else {
        groups = s.split(':');
        if (groups.length !== 8)
            return null;
    }
    let value = 0n;
    for (const g of groups) {
        if (!HEX_GROUP.test(g))
            return null;
        value = (value << 16n) | BigInt(parseInt(g, 16));
    }
    return value;
}

function ipv6Groups(value: bigint): string[] {
    const out: string[] = [];
    for (let i = 7; i >= 0; i--)
        out.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16));
    return out;
}

export function compressIPv6(value: bigint): string {
    const g = ipv6Groups(value);
    let bestStart = -1, bestLen = 0;
    for (let i = 0; i < 8;) {
        if (g[i] !== '0') {
            i++;
            continue;
        }
        let j = i;
        while (j < 8 && g[j] === '0')
            j++;
        if (j - i > bestLen) {
            bestStart = i;
            bestLen = j - i;
        }
        i = j;
    }
    if (bestLen < 2)
        return g.join(':');
    return `${g.slice(0, bestStart).join(':')}::${g.slice(bestStart + bestLen).join(':')}`;
}

function expandIPv6(value: bigint): string {
    return ipv6Groups(value).map(x => x.padStart(4, '0')).join(':');
}

function groupDigits(digits: string): string {
    return digits.replace(/\B(?=(\d{3})+$)/g, THIN);
}

/** Digits grouped in threes with a no-break space from `threshold` upwards. */
function fmt(n: number | string, threshold = 10000): string {
    const s = String(n);
    return Number(n) >= threshold ? groupDigits(s) : s;
}

function row(id: string, title: string, description: string, copy = title): Answer {
    return {id, title, copy, description, icon: ICON};
}

// ---------------------------------------------------------------------------------------------------------------
// IPv4

function hostCount(prefix: number): number {
    return prefix >= 32 ? 1 : prefix === 31 ? 2 : 2 ** (32 - prefix) - 2;
}

function hostsRow(prefix: number): Answer {
    const h = hostCount(prefix);
    return row('hosts', fmt(h), 'Usable hosts', String(h));
}

function blockRows(ip: number, prefix: number): Answer[] {
    const mask = prefixToMask(prefix);
    const net = (ip & mask) >>> 0;
    const wild = (~mask) >>> 0;
    const bcast = (net | wild) >>> 0;
    const out: Answer[] = [row('network', `${formatIPv4(net)}/${prefix}`, 'Network')];
    if (prefix === 32) {
        out.push(row('range', formatIPv4(net), 'Single host'));
    } else if (prefix === 31) {
        out.push(row('range', `${formatIPv4(net)} ${DASH} ${formatIPv4(bcast)}`, 'Usable host range',
            `${formatIPv4(net)}-${formatIPv4(bcast)}`));
    } else {
        out.push(row('range', `${formatIPv4(net + 1)} ${DASH} ${formatIPv4(bcast - 1)}`, 'Usable host range',
            `${formatIPv4(net + 1)}-${formatIPv4(bcast - 1)}`));
    }
    out.push(row('netmask', formatIPv4(mask), 'Subnet mask'));
    if (prefix < 31)
        out.push(row('broadcast', formatIPv4(bcast), 'Broadcast address'));
    out.push(hostsRow(prefix));
    out.push(row('wildcard', formatIPv4(wild), 'Wildcard mask'));
    return out;
}

function prefixRows(prefix: number): Answer[] {
    const mask = prefixToMask(prefix);
    const total = 2 ** (32 - prefix);
    return [
        row('netmask', formatIPv4(mask), 'Subnet mask'),
        hostsRow(prefix),
        row('wildcard', formatIPv4((~mask) >>> 0), 'Wildcard mask'),
        row('addresses', fmt(total), 'Addresses', String(total)),
    ];
}

function maskRows(prefix: number): Answer[] {
    const mask = prefixToMask(prefix);
    return [
        row('prefix', `/${prefix}`, 'Prefix length'),
        hostsRow(prefix),
        row('wildcard', formatIPv4((~mask) >>> 0), 'Wildcard mask'),
    ];
}

function subnetRange(net: number, prefix: number): string {
    const last = (net + 2 ** (32 - prefix) - 1);
    if (prefix === 32)
        return formatIPv4(net);
    if (prefix === 31)
        return `${formatIPv4(net)} ${DASH} ${formatIPv4(last)}`;
    return `${formatIPv4(net + 1)} ${DASH} ${formatIPv4(last - 1)}`;
}

function subnetRows(ip: number, prefix: number, newPrefix: number): Answer[] {
    if (newPrefix <= prefix || newPrefix > 32)
        return [];
    const net = (ip & prefixToMask(prefix)) >>> 0;
    const count = 2 ** (newPrefix - prefix);
    const size = 2 ** (32 - newPrefix);
    const shown = count > 8 ? 7 : count;
    const out: Answer[] = [];
    for (let i = 0; i < shown; i++) {
        const start = net + i * size;
        out.push(row(`subnet${i}`, `${formatIPv4(start)}/${newPrefix}`,
            `Subnet ${i + 1} of ${fmt(count, 1000)} · ${subnetRange(start, newPrefix)}`));
    }
    if (count > 8) {
        out.push(row('more', `${fmt(count, 1000)} subnets`,
            `Showing the first 7 · ${fmt(hostCount(newPrefix))} usable hosts each`, String(count)));
    }
    return out;
}

// [network, prefix, type, description]
type Block4 = [string, number, string, string];
const BLOCKS4: Block4[] = [
    ['255.255.255.255', 32, 'Broadcast address', '255.255.255.255/32 · RFC 919'],
    ['0.0.0.0', 8, 'Reserved address', '0.0.0.0/8 · RFC 1122'],
    ['10.0.0.0', 8, 'Private address', '10.0.0.0/8 · RFC 1918'],
    ['100.64.0.0', 10, 'Carrier-grade NAT address', '100.64.0.0/10 · RFC 6598'],
    ['127.0.0.0', 8, 'Loopback address', '127.0.0.0/8 · RFC 1122'],
    ['169.254.0.0', 16, 'Link-local address', '169.254.0.0/16 · RFC 3927'],
    ['172.16.0.0', 12, 'Private address', '172.16.0.0/12 · RFC 1918'],
    ['192.0.0.0', 24, 'Reserved address', '192.0.0.0/24 · RFC 6890'],
    ['192.0.2.0', 24, 'Documentation address', '192.0.2.0/24 · RFC 5737'],
    ['192.168.0.0', 16, 'Private address', '192.168.0.0/16 · RFC 1918'],
    ['198.18.0.0', 15, 'Reserved address', '198.18.0.0/15 · RFC 2544'],
    ['198.51.100.0', 24, 'Documentation address', '198.51.100.0/24 · RFC 5737'],
    ['203.0.113.0', 24, 'Documentation address', '203.0.113.0/24 · RFC 5737'],
    ['224.0.0.0', 4, 'Multicast address', '224.0.0.0/4 · RFC 5771'],
    ['240.0.0.0', 4, 'Reserved address', '240.0.0.0/4 · RFC 1112'],
];
type Table4 = Array<[number, number, string, string]>;
let blocks4: Table4 | null = null;

function classify4(ip: number): [string, string] {
    if (!blocks4)
        blocks4 = BLOCKS4.map((b): Table4[number] => [parseIPv4(b[0]) as number, prefixToMask(b[1]), b[2], b[3]]);
    for (const [net, mask, type, desc] of blocks4)
        if (((ip & mask) >>> 0) === net)
            return [type, desc];
    return ['Public address', 'IPv4'];
}

function addressRows(ip: number): Answer[] {
    const text = formatIPv4(ip);
    const [type, desc] = classify4(ip);
    const octets = text.split('.');
    const binary = octets.map(o => parseInt(o, 10).toString(2).padStart(8, '0')).join('.');
    return [
        row('type', type, desc, text),
        row('int', String(ip), 'Integer'),
        row('hex', `0x${ip.toString(16).toUpperCase().padStart(8, '0')}`, 'Hexadecimal'),
        row('binary', binary, 'Binary'),
        row('ptr', `${octets.reverse().join('.')}.in-addr.arpa`, 'Reverse DNS name'),
    ];
}

interface Block {
    ip: number;
    prefix: number;
}

const PREFIX_TEXT = /^\d{1,2}$/;

function parseMaskOrPrefix(text: string): number | null {
    if (PREFIX_TEXT.test(text)) {
        const p = parseInt(text, 10);
        return p <= 32 ? p : null;
    }
    const m = parseIPv4(text);
    return m === null ? null : maskToPrefix(m);
}

const SLASH_BLOCK = /^([0-9.]+)\/([0-9.]+)$/;
const SPACE_BLOCK = /^([0-9.]+) +(?:(?:net)?mask +)?([0-9.]+)$/;

function parseBlock(text: string): Block | null {
    const m = SLASH_BLOCK.exec(text);
    if (m) {
        const ip = parseIPv4(m[1]);
        const prefix = parseMaskOrPrefix(m[2]);
        return ip === null || prefix === null ? null : {ip, prefix};
    }
    const s = SPACE_BLOCK.exec(text);
    if (s) {
        const ip = parseIPv4(s[1]);
        const mask = parseIPv4(s[2]);
        const prefix = mask === null ? null : maskToPrefix(mask);
        return ip === null || prefix === null ? null : {ip, prefix};
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// IPv6

type Block6 = [string, number, string, string];
const BLOCKS6: Block6[] = [
    ['::', 128, 'Unspecified address', '::/128 · RFC 4291'],
    ['::1', 128, 'Loopback address', '::1/128 · RFC 4291'],
    ['::ffff:0:0', 96, 'IPv4-mapped address', '::ffff:0:0/96 · RFC 4291'],
    ['ff00::', 8, 'Multicast address', 'ff00::/8 · RFC 4291'],
    ['fe80::', 10, 'Link-local address', 'fe80::/10 · RFC 4291'],
    ['fc00::', 7, 'Unique local address', 'fc00::/7 · RFC 4193'],
    ['2001:db8::', 32, 'Documentation address', '2001:db8::/32 · RFC 3849'],
    ['3fff::', 20, 'Documentation address', '3fff::/20 · RFC 9637'],
    ['2000::', 3, 'Global unicast address', '2000::/3 · RFC 4291'],
];
type Table6 = Array<[bigint, bigint, string, string]>;
let blocks6: Table6 | null = null;
const ALL6 = (1n << 128n) - 1n;

function mask6(prefix: number): bigint {
    return ALL6 ^ ((1n << BigInt(128 - prefix)) - 1n);
}

function classify6(value: bigint): [string, string] {
    if (!blocks6)
        blocks6 = BLOCKS6.map((b): Table6[number] => [parseIPv6(b[0]) as bigint, mask6(b[1]), b[2], b[3]]);
    for (const [net, mask, type, desc] of blocks6)
        if ((value & mask) === net)
            return [type, desc];
    return ['Reserved address', 'IPv6 · IETF reserved'];
}

function ptr6(value: bigint): string {
    return `${value.toString(16).padStart(32, '0').split('').reverse().join('.')}.ip6.arpa`;
}

function mantissa(power: number): string {
    const x = power * Math.log10(2);
    let e = Math.floor(x);
    let m = Math.pow(10, x - e);
    if (m.toFixed(1) === '10.0') {
        m = 1;
        e++;
    }
    return `${m.toFixed(1)} × 10^${e}`;
}

function block6Rows(value: bigint, prefix: number): Answer[] {
    const host = (1n << BigInt(128 - prefix)) - 1n;
    const net = value & ~host & ALL6;
    const last = net | host;
    const k = 128 - prefix;
    const count = (1n << BigInt(k)).toString();
    const addresses = k < 53
        ? row('addresses', fmt(Number(count)), 'Addresses', count)
        : row('addresses', `2^${k}`, `Addresses (about ${mantissa(k)})`, count);
    return [
        row('network', `${compressIPv6(net)}/${prefix}`, 'Network'),
        row('first', compressIPv6(net), 'First address'),
        row('last', compressIPv6(last), 'Last address'),
        addresses,
        row('expanded', expandIPv6(net), 'Expanded'),
    ];
}

function address6Rows(value: bigint): Answer[] {
    const [type, desc] = classify6(value);
    const c = compressIPv6(value);
    return [
        row('type', type, desc, c),
        row('compressed', c, 'Compressed'),
        row('expanded', expandIPv6(value), 'Expanded'),
        row('ptr', ptr6(value), 'Reverse DNS name'),
    ];
}

const V6_BLOCK = /^([0-9a-f:.]+)\/(\d{1,3})$/;
const V6_TEXT = /^[0-9a-f:.]+$/;

function parseBlock6(text: string): {value: bigint; prefix: number} | null {
    const m = V6_BLOCK.exec(text);
    if (!m)
        return null;
    const prefix = parseInt(m[2], 10);
    const value = parseIPv6(m[1]);
    return value === null || prefix > 128 ? null : {value, prefix};
}

function answers6(q: string): Answer[] {
    if (q === '::' || !V6_TEXT.test(q.indexOf('/') < 0 ? q : q.slice(0, q.indexOf('/'))))
        return [];
    const b = parseBlock6(q);
    if (b)
        return block6Rows(b.value, b.prefix);
    const v = parseIPv6(q);
    return v === null ? [] : address6Rows(v);
}

// ---------------------------------------------------------------------------------------------------------------
// MAC addresses

const MAC_SEP = /^[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}$/i;
const MAC_CISCO = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;

function macAnswers(raw: string): Answer[] | null {
    if (!MAC_SEP.test(raw) && !MAC_CISCO.test(raw))
        return null;
    const h = raw.replace(/[:.-]/g, '').toLowerCase();
    const pairs = h.match(/.{2}/g) as string[];
    const colon = pairs.join(':');
    const dash = pairs.join('-').toUpperCase();
    const cisco = `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8)}`;
    const first = parseInt(pairs[0], 16);
    let kind: string;
    if (h === 'ffffffffffff')
        kind = 'Broadcast';
    else
        kind = `${first & 2 ? 'Locally administered' : 'Globally unique'}, ${first & 1 ? 'multicast' : 'unicast'}`;
    const out = [row('colon', colon, 'Colon format'), row('dash', dash, 'Hyphen format'),
        row('cisco', cisco, 'Cisco format')].filter(r => r.title !== raw);
    out.push(row('kind', kind, 'Address type'));
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Query dispatch

const CONTAINS = /^(?:is +)?(\S+) +in +(\S+)$/;
const SUBNET = /^(\S+\/\S+) +(?:split +(?:into +)?|into +|to +|in +)\/?(\d{1,2})$/;
const PREFIX_ONLY = /^(?:\/|(?:cidr|prefix) *\/?)(\d{1,3})$/;
const MASK_WORD = /^(?:net)?mask +(\S+)$/;

function contains(a: string, b: string): Answer[] {
    let inside: boolean;
    const b4 = parseBlock(b);
    const ip4 = parseIPv4(a);
    if (b4 && ip4 !== null) {
        const mask = prefixToMask(b4.prefix);
        inside = ((ip4 & mask) >>> 0) === ((b4.ip & mask) >>> 0);
    } else {
        const b6 = parseBlock6(b);
        const ip6 = V6_TEXT.test(a) ? parseIPv6(a) : null;
        if (!b6 || ip6 === null)
            return [];
        const mask = mask6(b6.prefix);
        inside = (ip6 & mask) === (b6.value & mask);
    }
    const title = inside ? 'Yes' : 'No';
    return [row('contains', title, `${a} is ${inside ? 'inside' : 'outside'} ${b}`)];
}

function dispatch(q: string): Answer[] {
    const colon = q.indexOf(':') >= 0;
    if (q.indexOf(' in ') > 0 && (colon || q.indexOf('.') >= 0)) {
        const m = CONTAINS.exec(q);
        if (m) {
            const r = contains(m[1], m[2]);
            if (r.length)
                return r;
        }
    }
    if (colon && q.indexOf(' ') < 0)
        return answers6(q);

    const sub = SUBNET.exec(q);
    if (sub) {
        const b = parseBlock(sub[1]);
        return b ? subnetRows(b.ip, b.prefix, parseInt(sub[2], 10)) : [];
    }
    const po = PREFIX_ONLY.exec(q);
    if (po) {
        const p = parseInt(po[1], 10);
        return p <= 32 ? prefixRows(p) : [];
    }
    const mw = MASK_WORD.exec(q);
    if (mw) {
        const m = parseIPv4(mw[1]);
        const p = m === null ? null : maskToPrefix(m);
        return p === null ? [] : maskRows(p);
    }
    if (q.indexOf(' ') < 0 && q.indexOf('/') < 0) {
        const ip = parseIPv4(q);
        if (ip === null)
            return [];
        // A bare value is a mask only when it starts with 255 (prefix 8 to 31). Shorter masks such as
        // 224.0.0.0 are much more often typed as addresses; "mask 224.0.0.0" still answers as a mask.
        const p = maskToPrefix(ip);
        if (p !== null && p >= 8 && ip !== 0xffffffff)
            return maskRows(p);
        // Something like 255.0.255.0 is a broken mask, not an address.
        if (ip >>> 24 === 255 && ip !== 0xffffffff)
            return [];
        return addressRows(ip);
    }
    const b = parseBlock(q);
    return b ? blockRows(b.ip, b.prefix) : [];
}

export function networkAnswers(query: string): Answer[] {
    if (query.length > MAX_LENGTH || query.length < 2)
        return [];
    const raw = query.trim();
    const len = raw.length;
    // Cheap reject: every form has a "." ":" or "/", is a MAC with "-", or starts with a keyword letter.
    if (raw.indexOf('.') < 0 && raw.indexOf(':') < 0 && raw.indexOf('/') < 0 && len !== 17) {
        const c = raw.charCodeAt(0) | 32;
        if (c !== 99 && c !== 112 && c !== 109 && c !== 110)
            return [];
    }
    try {
        if (len === 17 || len === 14) {
            const mac = macAnswers(raw);
            if (mac)
                return mac;
        }
        return dispatch(raw.toLowerCase().replace(/\s+/g, ' '));
    } catch {
        return [];
    }
}
