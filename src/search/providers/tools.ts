// The ranked offline tools of the search box. Unlike an answer (providers/answers.ts) their trigger is an
// ordinary word, so they compete with apps for the top place (search/bestMatch.ts): "password" still finds an
// app called Passwords first, "password 24" or "uuid" leads with the tool.
//
// QuickToolsProvider ('tools', immediate): search/answers/textTools.ts
//   "password", "password 24", "pin 6", "uuid", "md5 text", "sha256 text", "hash text", "base64 text",
//   "base64 decode ...", "url encode ...", "random 1-100", "roll 2d6", "flip a coin", "uppercase text", "count text"
//   Random values come from the kernel (/dev/urandom) and never from Math.random; a failed read shows nothing
//   rather than a weaker value. Hashes are GLib's.
// LocalNetworkProvider ('localNetwork'): search/answers/netinfo.ts
//   "my ip", "mac address", "gateway", "dns", "hostname": this computer's own addresses, read from NetworkManager
//   on the local system bus (one GetManagedObjects call, kept for NET_TTL_MS). No internet lookup, so no public
//   address. Without NetworkManager only "hostname" answers.
// CharactersProvider ('characters'): search/answers/characters.ts
//   "emoji smile", "char arrow", "symbol pi", "U+2192": the bundled data/characters.tsv is read (asynchronously,
//   once) the first time such a query is typed and never before; Return copies the character.
//
// All three follow one switch, search-quick-tools (on by default). Return / click copies and closes the menu.
//
// Public API:
//   new QuickToolsProvider(settings)                     implements SearchProvider
//   new LocalNetworkProvider(settings)                   implements SearchProvider
//   new CharactersProvider(settings, dataFile: string)   implements SearchProvider; dataFile: .../data/characters.tsv

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import {type CharEntry, parseCharacters, parseCharQuery, searchCharacters} from '../answers/characters.js';
import {netAnswers, type NetDevice, netQuery, parseNmObjects} from '../answers/netinfo.js';
import {toolAnswers, type ToolDeps} from '../answers/textTools.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {answerResults} from './answers.js';

const NET_TTL_MS = 3000;
const NET_TIMEOUT_MS = 800;

const CHECKSUMS = {
    md5: GLib.ChecksumType.MD5,
    sha1: GLib.ChecksumType.SHA1,
    sha256: GLib.ChecksumType.SHA256,
    sha512: GLib.ChecksumType.SHA512,
};

/** One read of the kernel's generator serves a whole password (dozens of small draws); used bytes are never reused. */
const POOL_BYTES = 512;
let pool: Uint8Array = new Uint8Array(0);
let poolAt = 0;

function readRandom(n: number): Uint8Array {
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    try {
        const bytes = stream.read_bytes(n, null).toArray();
        if (bytes.length !== n)
            throw new Error('short read from /dev/urandom');
        return bytes;
    } finally {
        stream.close(null);
    }
}

const deps: ToolDeps = {
    randomBytes(n: number): Uint8Array {
        if (n > POOL_BYTES)
            return readRandom(n);
        if (poolAt + n > pool.length) {
            pool = readRandom(POOL_BYTES);
            poolAt = 0;
        }
        const out = pool.slice(poolAt, poolAt + n);
        pool.fill(0, poolAt, poolAt + n);
        poolAt += n;
        return out;
    },
    checksum(algorithm, text): string {
        const digest = GLib.compute_checksum_for_bytes(CHECKSUMS[algorithm], new GLib.Bytes(new TextEncoder().encode(text)));
        if (!digest)
            throw new Error(`no ${algorithm} digest`);
        return digest;
    },
};

export class QuickToolsProvider implements SearchProvider {
    readonly id = 'tools';
    readonly title = _('Tools');
    readonly immediate = true;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-quick-tools');
    }

    search(query: string, _token: CancelToken): SearchResult[] {
        return answerResults(this.id, toolAnswers(query.trim(), deps));
    }
}

export class LocalNetworkProvider implements SearchProvider {
    readonly id = 'localNetwork';
    readonly title = _('This computer');
    readonly immediate = true;

    private _devices: NetDevice[] | null = null;
    private _readAt = 0;
    private _reading: Promise<NetDevice[] | null> | null = null;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-quick-tools');
    }

    clear(): void {
        this._readAt = 0;
    }

    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        const q = netQuery(query.trim());
        if (!q)
            return [];
        const build = (devices: NetDevice[] | null): SearchResult[] => {
            if (token.cancelled || (devices === null && q.kind !== 'hostname'))
                return [];
            return answerResults(this.id, netAnswers(q.kind, devices ?? [], GLib.get_host_name(), q.score));
        };
        if (q.kind === 'hostname')
            return build(null);
        if (GLib.get_monotonic_time() / 1000 - this._readAt < NET_TTL_MS)
            return build(this._devices);
        return this._read().then(build);
    }

    /** NetworkManager's objects, or null without NetworkManager. Never rejects. */
    private _read(): Promise<NetDevice[] | null> {
        this._reading ??= new Promise<NetDevice[] | null>(resolve => {
            try {
                Gio.DBus.system.call('org.freedesktop.NetworkManager', '/org/freedesktop', 'org.freedesktop.DBus.ObjectManager',
                    'GetManagedObjects', null, null, Gio.DBusCallFlags.NO_AUTO_START, NET_TIMEOUT_MS, null, (bus, res) => {
                        try {
                            const reply = (bus as Gio.DBusConnection).call_finish(res);
                            resolve(parseNmObjects((reply.recursiveUnpack() as [unknown])[0]));
                        } catch {
                            resolve(null);
                        }
                    });
            } catch {
                resolve(null);
            }
        }).then(devices => {
            this._devices = devices;
            this._readAt = GLib.get_monotonic_time() / 1000;
            return devices;
        }).finally(() => {
            this._reading = null;
        });
        return this._reading;
    }
}

export class CharactersProvider implements SearchProvider {
    readonly id = 'characters';
    readonly title = _('Characters');
    readonly immediate = true;

    private _db: CharEntry[] | null = null;
    private _loading: Promise<CharEntry[]> | null = null;

    constructor(private readonly _settings: SpawnSettings, private readonly _dataFile: string) {}

    isEnabled(): boolean {
        return this._settings.get('search-quick-tools');
    }

    /** The menu closed: the table (about 3,500 entries) is not kept around; it is read again when next asked for. */
    clear(): void {
        this._db = null;
    }

    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        const q = parseCharQuery(query.trim());
        if (!q)
            return [];
        const build = (db: CharEntry[]): SearchResult[] =>
            token.cancelled ? [] : answerResults(this.id, searchCharacters(db, q, maxSearchResults(this._settings)));
        return this._db ? build(this._db) : this._load().then(build);
    }

    /** The data file, read once. A failed read is logged and leaves the provider empty (it is tried again later). */
    private _load(): Promise<CharEntry[]> {
        this._loading ??= new Promise<CharEntry[]>(resolve => {
            Gio.File.new_for_path(this._dataFile).load_contents_async(null, (file, res) => {
                try {
                    const [, bytes] = (file as Gio.File).load_contents_finish(res);
                    this._db = parseCharacters(new TextDecoder().decode(bytes));
                    resolve(this._db);
                } catch (e) {
                    error('reading the character data failed', e);
                    resolve([]);
                }
            });
        }).finally(() => {
            this._loading = null;
        });
        return this._loading;
    }
}
