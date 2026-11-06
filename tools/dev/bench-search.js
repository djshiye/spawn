// Pure-JS search benchmark (no GNOME Shell needed): `gjs -m tools/dev/bench-search.js` after `npx tsc`.
// Builds a realistic 400-app catalogue with the real appKeys()/descriptionKey() and times rankApps()
// for the in-shell benchmark's queries plus typical typing sequences. Prints JSON.
/* global ARGV, print */
import GLib from 'gi://GLib';

import * as rank from '../../build/search/rank.js';
import {catalogue} from './bench-catalogue.js';

const nowMs = () => GLib.get_monotonic_time() / 1000;
const QUERIES = ['f', 'fi', 'fir', 'fire', 'vsc', 'term', 'set', 'st', 'zz', 'doc', 'file manager', 'libre writer', 'minecraft', 'ff', 'xyzq'];

function median(v) {
    const s = [...v].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const n = Number(ARGV[0] ?? 400);
const items = catalogue(n);
const t0 = nowMs();
rank.rankApps('fi', items, 10, () => 0); // the first search of a fresh index (pays any per-app preparation)
const firstSearchMs = nowMs() - t0;
const prepared = items;
const usage = () => 0;
for (let i = 0; i < 20; i++) // warm-up (JIT)
    for (const q of QUERIES)
        rank.rankApps(q, prepared, 10, usage);

const REPS = 40;
const perQuery = {};
const all = [];
const tops = {};
for (const q of QUERIES) {
    const times = [];
    for (let i = 0; i < REPS; i++) {
        const s = nowMs();
        const r = rank.rankApps(q, prepared, 10, usage);
        times.push(nowMs() - s);
        if (i === 0)
            tops[q] = r.slice(0, 3).map(x => `${x.item.name}:${x.score}`);
    }
    perQuery[q] = Math.round(median(times) * 1000) / 1000;
    all.push(...times);
}
print(JSON.stringify({apps: items.length, firstSearchMs: Math.round(firstSearchMs * 1000) / 1000, medianMs: Math.round(median(all) * 1000) / 1000, perQueryMedianMs: perQuery, top3: tops}, null, 1));
