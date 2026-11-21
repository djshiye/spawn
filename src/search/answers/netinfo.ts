// This computer's own network details for the search box: "my ip", "mac address", "hostname", "gateway", "dns".
// Pure (no gi imports; unit-testable with gjs -m, tests/netinfo.test.js). Nothing here talks to the network: the
// provider (search/providers/tools.ts) asks NetworkManager on the local system bus for the objects it already
// keeps and hands them to parseNmObjects(). A public ("what the internet sees") address needs an internet
// lookup, so it is deliberately not offered.
//
// Text forms (the whole query, case-insensitive):
//   ip        "my ip", "my ip address", "local ip", "ip address", "what is my ip", "my ipv4", "my ipv6", "ip"
//   mac       "my mac", "mac address", "my mac address"
//   hostname  "hostname", "my hostname", "host name", "computer name"
//   gateway   "gateway", "default gateway", "my gateway", "router ip"
//   dns       "dns", "dns server", "dns servers", "my dns"
//
// Public API:
//   netQuery(query): {kind: NetKind, score: number} | null     fast: one Map lookup on short text
//   parseNmObjects(objects): NetDevice[]       `objects` is the unpacked a{oa{sa{sv}}} of
//                                              org.freedesktop.DBus.ObjectManager.GetManagedObjects (NetworkManager)
//   hasWifi(devices): boolean
//   netAnswers(kind, devices, hostname, limit = 8): Answer[]   scores are the query's (see netQuery)

import type {Answer} from './types.js';

export type NetKind = 'ip' | 'mac' | 'hostname' | 'gateway' | 'dns';

export interface NetAddress {
    address: string;
    prefix: number;
}

export interface NetDevice {
    iface: string;
    /** "Ethernet", "Wi-Fi", "VPN"... ('' when the type has no friendly name). */
    kind: string;
    wifi: boolean;
    mac: string;
    /** NetworkManager's "activated" state. */
    connected: boolean;
    ipv4: NetAddress[];
    ipv6: NetAddress[];
    gateway4: string;
    gateway6: string;
    dns: string[];
}

const ICON = 'network-wired-symbolic';
const MAX_QUERY = 24;

/** Phrase -> [kind, score]. A phrase that says "my" / "local" is unmistakable (1000); a bare word competes with apps. */
const PHRASES: Array<[NetKind, number, string[]]> = [
    ['ip', 1000, ['my ip', 'my ip address', 'my ip addresses', 'local ip', 'local ip address', 'my local ip', 'what is my ip', 'whats my ip',
        'what\'s my ip', 'my ipv4', 'my ipv6', 'my address']],
    ['ip', 900, ['ip address', 'ip addresses']],
    ['ip', 840, ['ip']],
    ['mac', 1000, ['my mac', 'my mac address', 'local mac']],
    ['mac', 900, ['mac address', 'mac addresses']],
    ['hostname', 1000, ['my hostname', 'my host name', 'my computer name']],
    ['hostname', 840, ['hostname', 'host name', 'computer name']],
    ['gateway', 1000, ['my gateway', 'default gateway', 'my router', 'router ip']],
    ['gateway', 840, ['gateway']],
    ['dns', 1000, ['my dns', 'my dns server', 'my dns servers']],
    ['dns', 900, ['dns server', 'dns servers']],
    ['dns', 840, ['dns']],
];

let phrases: Map<string, {kind: NetKind; score: number}> | null = null;

export function netQuery(query: string): {kind: NetKind; score: number} | null {
    if (query.length > MAX_QUERY)
        return null;
    const c = query.charCodeAt(0) | 0x20;
    // every phrase starts with one of: m l i w h c d g r
    if (c !== 109 && c !== 108 && c !== 105 && c !== 119 && c !== 104 && c !== 99 && c !== 100 && c !== 103 && c !== 114)
        return null;
    if (!phrases) {
        phrases = new Map();
        for (const [kind, score, list] of PHRASES) {
            for (const p of list)
                phrases.set(p, {kind, score});
        }
    }
    return phrases.get(query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\?$/, '')) ?? null;
}

const DEVICE = 'org.freedesktop.NetworkManager.Device';
const IP4 = 'org.freedesktop.NetworkManager.IP4Config';
const IP6 = 'org.freedesktop.NetworkManager.IP6Config';
const ACTIVATED = 100;
const TYPE_WIFI = 2;
const TYPE_LOOPBACK = 32;

// NMDeviceType values with a name a person recognises.
const KINDS: Record<number, string> = {
    1: 'Ethernet',
    2: 'Wi-Fi',
    5: 'Bluetooth',
    8: 'Mobile broadband',
    10: 'Bond',
    11: 'VLAN',
    13: 'Bridge',
    16: 'VPN',
    29: 'WireGuard',
};

type Props = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function addresses(v: unknown): NetAddress[] {
    if (!Array.isArray(v))
        return [];
    const out: NetAddress[] = [];
    for (const item of v) {
        const address = str((item as Props | null)?.address);
        const prefix = Number((item as Props | null)?.prefix);
        if (address && Number.isInteger(prefix))
            out.push({address, prefix});
    }
    return out;
}

function nameservers(v: unknown): string[] {
    if (!Array.isArray(v))
        return [];
    return v.map(item => str((item as Props | null)?.address)).filter(Boolean);
}

export function parseNmObjects(objects: unknown): NetDevice[] {
    if (!objects || typeof objects !== 'object')
        return [];
    const all = objects as Record<string, Record<string, Props> | undefined>;
    const devices: NetDevice[] = [];
    for (const path of Object.keys(all)) {
        const dev = all[path]?.[DEVICE];
        if (!dev)
            continue;
        const type = Number(dev.DeviceType);
        const iface = str(dev.Interface);
        if (!iface || type === TYPE_LOOPBACK || iface === 'lo')
            continue;
        const ip4 = all[str(dev.Ip4Config)]?.[IP4];
        const ip6 = all[str(dev.Ip6Config)]?.[IP6];
        devices.push({
            iface,
            kind: KINDS[type] ?? '',
            wifi: type === TYPE_WIFI,
            mac: str(dev.HwAddress).toLowerCase(),
            connected: Number(dev.State) === ACTIVATED,
            ipv4: addresses(ip4?.AddressData),
            ipv6: addresses(ip6?.AddressData),
            gateway4: str(ip4?.Gateway),
            gateway6: str(ip6?.Gateway),
            dns: [...nameservers(ip4?.NameserverData), ...nameservers(ip6?.NameserverData)],
        });
    }
    // The connection that reaches the rest of the network first, then by name: a stable order while typing.
    const rank = (d: NetDevice): number => (d.connected ? 0 : 2) + (d.gateway4 || d.gateway6 ? 0 : 1);
    return devices.sort((a, b) => rank(a) - rank(b) || (a.iface < b.iface ? -1 : a.iface > b.iface ? 1 : 0));
}

export function hasWifi(devices: readonly NetDevice[]): boolean {
    return devices.some(d => d.wifi);
}

function where(d: NetDevice): string {
    return d.kind ? `${d.kind} (${d.iface})` : d.iface;
}

function isLinkLocal6(address: string): boolean {
    return /^fe[89ab]/i.test(address);
}

export function netAnswers(kind: NetKind, devices: readonly NetDevice[], hostname: string, score: number, limit = 8): Answer[] {
    const out: Answer[] = [];
    const add = (id: string, title: string, description: string): void => {
        if (title && !out.some(a => a.title === title && a.description === description))
            out.push({id, title, copy: title, description, icon: ICON, score});
    };
    if (kind === 'hostname') {
        add('hostname', hostname, 'Name of this computer');
        return out;
    }
    const up = devices.filter(d => d.connected);
    if (kind === 'mac') {
        // Every real interface, connected or not: a MAC address is asked for before a connection works, too.
        for (const d of devices)
            add(`mac-${d.iface}`, d.mac, `MAC address · ${where(d)}`);
    } else if (kind === 'gateway') {
        for (const d of up) {
            add(`gw4-${d.iface}`, d.gateway4, `Default gateway · ${where(d)}`);
            add(`gw6-${d.iface}`, d.gateway6, `Default gateway (IPv6) · ${where(d)}`);
        }
    } else if (kind === 'dns') {
        for (const d of up)
            d.dns.forEach((server, i) => add(`dns-${d.iface}-${i}`, server, `DNS server · ${where(d)}`));
    } else {
        for (const d of up) {
            for (const a of d.ipv4)
                add(`ip4-${d.iface}-${a.address}`, a.address, `Local IPv4 address · ${where(d)} · /${a.prefix}`);
        }
        for (const d of up) {
            for (const a of d.ipv6) {
                if (!isLinkLocal6(a.address))
                    add(`ip6-${d.iface}-${a.address}`, a.address, `Local IPv6 address · ${where(d)} · /${a.prefix}`);
            }
        }
        for (const d of up)
            add(`gw4-${d.iface}`, d.gateway4, `Default gateway · ${where(d)}`);
    }
    if (out.length === 0) {
        const none = kind === 'mac' ? 'No network interface found' : 'Not connected to a network';
        return [{id: 'none', title: none, copy: '', description: 'Nothing to copy', icon: 'network-offline-symbolic', score}];
    }
    return out.slice(0, Math.max(1, limit));
}
