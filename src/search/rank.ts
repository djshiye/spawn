// Pure ranking functions for app/window/file search.
// No imports, so it is unit-testable with gjs -m (tests/rank.test.js).
//
// Tiers (higher score wins), each in its own band so the short-name bonus never lets a
// lower tier overtake a higher one:
//   exact                         1000
//   name prefix                   850..900
//   word prefix                   700..755   (word starts: after space - _ . / ( etc. and
//                                             camelCase humps, e.g. "office" in LibreOffice)
//   acronym                       540..620   ("vsc" -> Visual Studio Code, "vscode" too)
//   doubled initial (2 letters)   470..497   ("ff" -> Firefox; display names only, see scoreInitials)
//   substring                     400..460
//   subsequence (fuzzy)           100..300
// Score 0 means "no match". Within a tier shorter candidates (higher query/candidate
// length ratio) and earlier matches score slightly higher.
//
// Multi-word queries: the whole phrase is tried as a contiguous match first; otherwise every
// term must match on its own (AND) and the worst term decides, discounted by 10 %.
// The query separators - _ . count as spaces too: when a candidate scores below the substring
// band with the query as typed, it is rescored with them replaced by spaces ("fl-studio",
// "proton-up", "fl_studio").
//
// Public API:
//   normalize(s): string                  lower-case + fold diacritics + collapse whitespace
//   scoreMatch(query, candidate): number  0..1000, 0 = no match. Both args are normalised
//                                          internally (idempotent); pass the RAW candidate to
//                                          get camelCase word boundaries.
//   rankItems<T>(query, items, keysOf, limit?): Ranked<T>[]  stable, best first;
//                                          `keysOf(item)` returns strings, the best score over
//                                          the keys is used
//   rankItemsBy<T>(query, items, scoreOf, limit?): Ranked<T>[]  same, but `scoreOf(item, q)`
//                                          computes the score from the normalised query `q`
//                                          (use scoreNormalized for weighted keys)
//   scoreNormalized(q, candidate, initials?): number  q must already be normalize()d; `initials`
//                                          (default false) enables the 2-letter doubled-initial tier
//   scoreKeys(q, name, keys, keyWeight): number  best of `name` (raw, full weight) and `keys`
//                                          (already normalised, scaled by keyWeight)
//   scoreDescription(q, text): number     word-level match of a (normalised) description:
//                                          every term of q (>= 3 chars; stop words such as
//                                          "the" / "and" / "for" are ignored, a query of only
//                                          stop words matches nothing) must be a whole word,
//                                          word prefix or substring of a word; never acronym /
//                                          fuzzy. Result is already scaled by DESCRIPTION_WEIGHT,
//                                          so it stays <= 380, below the name-substring band
//   scoreApp(q, name, keys, keyWeight, description): number  scoreKeys combined with the description;
//                                          a multi-word query that no single key matches is
//                                          retried with every term matched over name + keys
//                                          (worst term * 0.8, "file manager", "minecraft launcher")
//   applyRelativeCutoff(ranked, strong?, ratio?): Ranked<T>[]  when the best score is >= 800, drop
//                                          results scoring below 25 % of it (fuzzy junk behind a
//                                          strong match); never applied when the best is weak;
//                                          always keeps the first result
//   rankApps(query, items, limit?, usageOf?)  rankItemsBy + scoreApp (APP_KEY_WEIGHT) + the cutoff
//                                          + usage tie-break: what AppsProvider runs; items need
//                                          {name, keys, description} (+ id for usageOf)
//   prepareApps(items)                   precompute what rankApps caches per item (folded / lower-cased
//                                          name and keys, word boundaries); optional, rankApps does it
//                                          lazily. The cache is a WeakMap keyed by the item object, so a
//                                          rebuilt index simply replaces it
//   applyUsageBoost(ranked, usageOf)      adds up to USAGE_BOOST_MAX (6) points by usage (usageOf(id)
//                                          in 0..1, 0 = unknown), clamped to the item's own tier
//                                          (the TIER_FLOORS below), so a better text match in a higher
//                                          tier always wins and no usage at all changes nothing
//   hasAlnum(query): boolean              false for punctuation-only queries ("." "-"), which
//                                          providers should not rank at all

export interface Ranked<T> {
    item: T;
    score: number;
}

const MARKS = /[̀-ͯ]/g;
const ASCII = /^[ -~]*$/;

export function normalize(s: string): string {
    return s.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fold(s: string): string {
    const t = ASCII.test(s) ? s : s.normalize('NFD').replace(MARKS, '');
    return t.replace(/\s+/g, ' ').trim();
}

const LETTER = /^\p{L}$/u;
const NUMBER = /^\p{N}$/u;
const ALNUM_ANYWHERE = /[\p{L}\p{N}]/u;

/** Any letter, including uncased scripts (CJK, Thai, Arabic, Hebrew). */
function isLetter(c: string): boolean {
    if (c < '\x80')
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    return LETTER.test(c);
}

function isDigit(c: string): boolean {
    if (c < '\x80')
        return c >= '0' && c <= '9';
    return NUMBER.test(c);
}

function isAlnum(c: string): boolean {
    return isLetter(c) || isDigit(c);
}

/** Does the query contain a letter or digit? Punctuation-only queries rank nothing. */
export function hasAlnum(query: string): boolean {
    return ALNUM_ANYWHERE.test(query);
}

/** boundary[i] is true when a word starts at index i of `folded` (case preserved). */
function wordBoundaries(folded: string): boolean[] {
    const out: boolean[] = new Array(folded.length).fill(false);
    for (let i = 0; i < folded.length; i++) {
        const c = folded[i];
        if (!isAlnum(c))
            continue;
        if (i === 0) {
            out[i] = true;
            continue;
        }
        const p = folded[i - 1];
        if (!isAlnum(p)) {
            out[i] = true;
        } else if (isLetter(p) && isLetter(c)) {
            const pUpper = p !== p.toLowerCase();
            const cUpper = c !== c.toLowerCase();
            if (!pUpper && cUpper) {
                out[i] = true; // fooBar
            } else if (pUpper && cUpper && i + 1 < folded.length) {
                const n = folded[i + 1];
                if (isLetter(n) && n === n.toLowerCase())
                    out[i] = true; // HTMLParser -> HTML|Parser
            }
        }
    }
    return out;
}

function wordsOf(lower: string, boundary: boolean[]): string[] {
    const words: string[] = [];
    let start = -1;
    for (let i = 0; i <= lower.length; i++) {
        const atEnd = i === lower.length;
        const isStart = !atEnd && boundary[i];
        const isAlnumHere = !atEnd && isAlnum(lower[i]);
        if (start >= 0 && (atEnd || isStart || !isAlnumHere)) {
            words.push(lower.slice(start, i));
            start = -1;
        }
        if (isStart)
            start = i;
    }
    return words;
}

/** Can `q` be consumed as non-empty prefixes of consecutive words (skip = may skip words)? */
function acronymMatch(q: string, words: string[], skip: boolean): boolean {
    const failed = new Set<number>();
    const walk = (qi: number, wi: number): boolean => {
        if (qi === q.length)
            return true;
        if (wi >= words.length)
            return false;
        const key = qi * 64 + wi;
        if (failed.has(key))
            return false;
        const w = words[wi];
        let k = 0;
        while (k < w.length && qi + k < q.length && q[qi + k] === w[k]) {
            k++;
            if (walk(qi + k, wi + 1))
                return true;
        }
        if (skip && walk(qi, wi + 1))
            return true;
        failed.add(key);
        return false;
    };
    return walk(0, 0);
}

function subsequenceSpan(q: string, c: string): number {
    let qi = 0;
    let first = -1;
    let last = -1;
    for (let i = 0; i < c.length && qi < q.length; i++) {
        if (c[i] === q[qi]) {
            if (first < 0)
                first = i;
            last = i;
            qi++;
        }
    }
    return qi === q.length ? last - first + 1 : 0;
}

const INITIALS_BAND = 470;
const INITIALS_WINDOW = 4;

/**
 * Two identical letters, the first at a word start and the second a few letters later in the same
 * word ("ff" -> Fire|fox, "tt" -> Text Editor). Deliberately narrow: any "first letter of a word +
 * another letter of it" rule matches a large share of all apps for most 2-letter queries (measured
 * on a real app list), while the doubled letter is what makes "ff" mean Firefox. The general
 * subsequence match still needs >= 3 letters.
 */
function scoreInitials(q: string, lower: string, boundary: boolean[]): number {
    if (q[0] !== q[1])
        return 0;
    for (let i = 0; i < lower.length; i++) {
        if (!boundary[i] || lower[i] !== q[0])
            continue;
        const end = Math.min(lower.length, i + 1 + INITIALS_WINDOW);
        for (let j = i + 2; j < end && isAlnum(lower[j]) && !boundary[j]; j++) {
            if (lower[j] === q[1])
                return INITIALS_BAND;
        }
    }
    return 0;
}

/** Everything about a candidate string that does not depend on the query, computed once. */
interface Prepared {
    folded: string;
    lower: string;
    /** boundary[i]: a word starts at index i (case-derived, so computed from the raw-case text). */
    boundary: boolean[];
    /** Lower-case words (see wordsOf); filled on first use, most candidates never need them. */
    words: string[] | null;
}

/** null when nothing is left to match (empty / whitespace-only). */
function prepare(candidate: string): Prepared | null {
    if (!candidate)
        return null;
    const folded = fold(candidate);
    if (!folded)
        return null;
    let lower = folded.toLowerCase();
    if (lower.length !== folded.length)
        lower = folded; // exotic case mapping changed the length; give up on camelCase
    return {folded, lower, boundary: wordBoundaries(folded), words: null};
}

/** Is `q` a subsequence of `c`? Every non-zero scoreOne result consumes the characters of q in order. */
function isSubsequence(q: string, c: string): boolean {
    let qi = 0;
    for (let i = 0; i < c.length && qi < q.length; i++) {
        if (c[i] === q[qi])
            qi++;
    }
    return qi === q.length;
}

/** Score a single term (no spaces) or a contiguous phrase. */
function scoreOne(q: string, p: Prepared, phrase: boolean, initials: boolean): number {
    const {folded, lower, boundary} = p;
    const ratio = q.length / lower.length;
    if (lower === q)
        return 1000;
    if (lower.startsWith(q))
        return Math.round(850 + 50 * ratio);
    // Exact, prefix, word prefix, acronym, doubled initial, substring and fuzzy all consume q in order.
    if (!isSubsequence(q, lower))
        return 0;

    // Word prefix: first occurrence of q starting on a word boundary.
    const firstSub = lower.indexOf(q);
    let idx = firstSub;
    while (idx >= 0) {
        if (boundary[idx]) {
            let wordIdx = 0;
            for (let i = 1; i <= idx; i++) {
                if (boundary[i])
                    wordIdx++;
            }
            return Math.round(700 + 40 * ratio + Math.max(0, 20 - 5 * wordIdx));
        }
        idx = lower.indexOf(q, idx + 1);
    }

    if (!phrase && q.length >= 2 && folded.length <= 80) {
        if (!p.words)
            p.words = wordsOf(lower, boundary);
        const words = p.words;
        if (words.length >= 2) {
            if (acronymMatch(q, words, false))
                return Math.round(600 + 20 * (q.length / words.reduce((n, w) => n + w.length, 0)));
            if (acronymMatch(q, words, true))
                return Math.round(540 + 20 * ratio);
        }
    }

    if (initials && !phrase && q.length === 2) {
        const band = scoreInitials(q, lower, boundary);
        if (band > 0)
            return Math.round(band + 40 * ratio);
    }

    if (firstSub >= 0)
        return Math.round(400 + 50 * ratio + Math.max(0, 10 - firstSub));

    if (!phrase && q.length >= 3) {
        const span = subsequenceSpan(q, lower);
        if (span > 0) {
            const compact = q.length / span;
            if (compact >= 0.3)
                return Math.round(100 + 150 * compact + 50 * ratio);
        }
    }
    return 0;
}

const SEPARATORS = /[-_.]/;
const SEPARATORS_ALL = /[-_.]+/g;
const SUBSTRING_BAND = 400;
const FUZZY_MAX = 300;
const ACROSS_KEYS_FACTOR = 0.8;
/** Weight of every non-name key (generic name, keywords, executable, id) against the display name. */
export const APP_KEY_WEIGHT = 0.6;

/** `q` with the separators - _ . turned into spaces (and collapsed); '' when nothing is left. */
function spaceSeparators(q: string): string {
    return q.replace(SEPARATORS_ALL, ' ').replace(/\s+/g, ' ').trim();
}

/** A normalised query with its per-query work (term split, separator-free variant) done once. */
interface PreparedQuery {
    q: string;
    /** The space-separated terms; null for a single term. */
    terms: string[] | null;
    /** The query with its separators - _ . turned into spaces, when that differs from `q`. */
    spaced: PreparedQuery | null;
}

function prepareQuery(q: string, withSpaced = true): PreparedQuery {
    let spaced: PreparedQuery | null = null;
    if (withSpaced && SEPARATORS.test(q)) {
        const t = spaceSeparators(q);
        if (t && t !== q)
            spaced = prepareQuery(t, false);
    }
    return {q, terms: q.includes(' ') ? q.split(' ') : null, spaced};
}

/** `q` must already be normalised; `candidate` may be raw (case gives camelCase boundaries). */
export function scoreNormalized(q: string, candidate: string, initials = false): number {
    const p = prepare(candidate);
    return p && q ? scoreCandidate(prepareQuery(q), p, initials) : 0;
}

function scoreCandidate(pq: PreparedQuery, p: Prepared | null, initials: boolean): number {
    if (!p)
        return 0;
    const s = scoreAsTyped(pq, p, initials);
    if (s >= SUBSTRING_BAND || !pq.spaced)
        return s;
    return Math.max(s, scoreAsTyped(pq.spaced, p, initials));
}

function scoreAsTyped(pq: PreparedQuery, p: Prepared, initials: boolean): number {
    if (!pq.q)
        return 0;
    if (!pq.terms)
        return scoreOne(pq.q, p, false, initials);

    const phrase = scoreOne(pq.q, p, true, initials);
    let terms = Infinity;
    for (const term of pq.terms) {
        const s = scoreOne(term, p, false, initials);
        if (s === 0) {
            terms = 0;
            break;
        }
        terms = Math.min(terms, s);
    }
    return Math.max(phrase, Math.round(terms * 0.9));
}

export const DESCRIPTION_WEIGHT = 0.38;
const MIN_DESCRIPTION_TERM = 3;
const STOP_WORDS = new Set(['the', 'and', 'for', 'a', 'an', 'of', 'to', 'in', 'with', 'your', 'you']);

/** Word-level score of one term against the words of a description (raw 0..1000). */
function scoreTermInWords(term: string, words: readonly string[]): number {
    let best = 0;
    for (const w of words) {
        let s = 0;
        if (w === term)
            s = 1000;
        else if (w.startsWith(term))
            s = 850;
        else if (w.includes(term))
            s = 600;
        if (s > best)
            best = s;
    }
    return best;
}

/** The description terms of a query that count (stop words dropped); null when the description cannot match. */
function descriptionTerms(q: string): string[] | null {
    const terms = q.split(' ').filter(t => t.length > 0 && !STOP_WORDS.has(t));
    return terms.length === 0 || terms.some(t => t.length < MIN_DESCRIPTION_TERM) ? null : terms;
}

function splitWords(description: string): string[] {
    return description.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 0);
}

function scoreTerms(terms: readonly string[], words: readonly string[]): number {
    let worst = 1000;
    for (const t of terms) {
        const s = scoreTermInWords(t, words);
        if (s === 0)
            return 0;
        worst = Math.min(worst, s);
    }
    return Math.round(worst * DESCRIPTION_WEIGHT * (terms.length > 1 ? 0.9 : 1));
}

export function scoreDescription(q: string, description: string): number {
    if (!description)
        return 0;
    const terms = descriptionTerms(q);
    return terms ? scoreTerms(terms, splitWords(description)) : 0;
}

/** An app's name, keys and description with the query-independent work done once. */
interface PreparedApp {
    name: string;
    keys: readonly string[];
    description: string;
    pname: Prepared | null;
    pkeys: Array<Prepared | null>;
    /** The description split into words; filled on first use. */
    words: string[] | null;
}

function prepareApp(name: string, keys: readonly string[], description: string): PreparedApp {
    return {name, keys, description, pname: prepare(name), pkeys: keys.map(prepare), words: null};
}

/** A query with what scoreApp needs beyond PreparedQuery. */
interface AppQuery {
    pq: PreparedQuery;
    /** Terms of the cross-key match; null when the query does not qualify (see scoreAcrossKeys). */
    across: PreparedQuery[] | null;
    descTerms: string[] | null;
}

function prepareAppQuery(q: string): AppQuery {
    const terms = spaceSeparators(q).split(' ');
    const across = terms.length < 2 || terms.some(t => t.length < 2) ? null : terms.map(t => prepareQuery(t));
    return {pq: prepareQuery(q), across, descTerms: descriptionTerms(q)};
}

/** Name (raw) at full weight, other keys at `keyWeight`, description word by word at DESCRIPTION_WEIGHT. */
export function scoreApp(q: string, name: string, keys: readonly string[], keyWeight: number, description: string): number {
    return scoreAppPrepared(prepareAppQuery(q), prepareApp(name, keys, description), keyWeight);
}

function scoreAppPrepared(aq: AppQuery, app: PreparedApp, keyWeight: number): number {
    let s = scoreKeysPrepared(aq.pq, app, keyWeight);
    if (s < SUBSTRING_BAND)
        s = Math.max(s, scoreAcrossKeys(aq, app, keyWeight));
    if (!aq.descTerms || !app.description)
        return s;
    if (!app.words)
        app.words = splitWords(app.description);
    return Math.max(s, scoreTerms(aq.descTerms, app.words));
}

/**
 * Multi-word query whose terms are spread over different keys (name "Prism Launcher" + keyword
 * "minecraft"): every term (>= 2 chars) must match name or a key above the fuzzy band; the worst
 * decides. A lone letter matches too much to be a cross-key term ("fl s" is a plain name match).
 */
function scoreAcrossKeys(aq: AppQuery, app: PreparedApp, keyWeight: number): number {
    if (!aq.across)
        return 0;
    let worst = Infinity;
    for (const term of aq.across) {
        const s = scoreKeysPrepared(term, app, keyWeight);
        if (s <= FUZZY_MAX)
            return 0;
        worst = Math.min(worst, s);
    }
    return Math.round(worst * ACROSS_KEYS_FACTOR);
}

/** Best score of the display name (full weight) and secondary keys (scaled by `keyWeight`). */
export function scoreKeys(q: string, name: string, keys: readonly string[], keyWeight: number): number {
    return scoreKeysPrepared(prepareQuery(q), prepareApp(name, keys, ''), keyWeight);
}

function scoreKeysPrepared(pq: PreparedQuery, app: PreparedApp, keyWeight: number): number {
    let best = scoreCandidate(pq, app.pname, true);
    for (const key of app.pkeys) {
        const s = Math.round(scoreCandidate(pq, key, false) * keyWeight);
        if (s > best)
            best = s;
    }
    return best;
}

export function scoreMatch(query: string, candidate: string): number {
    return scoreNormalized(normalize(query), candidate);
}

export function rankItemsBy<T>(query: string, items: readonly T[], scoreOf: (item: T, q: string) => number, limit?: number): Ranked<T>[] {
    const q = normalize(query);
    if (!q)
        return [];
    const scored: Array<Ranked<T> & {index: number}> = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const score = scoreOf(item, q);
        if (score > 0)
            scored.push({item, score, index});
    }
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const top = limit !== undefined && limit >= 0 ? scored.slice(0, limit) : scored;
    return top.map(({item, score}) => ({item, score}));
}

export function rankItems<T>(query: string, items: readonly T[], keysOf: (item: T) => readonly string[], limit?: number): Ranked<T>[] {
    return rankItemsBy(query, items, (item, q) => {
        let best = 0;
        for (const key of keysOf(item)) {
            const s = scoreNormalized(q, key);
            if (s > best)
                best = s;
        }
        return best;
    }, limit);
}

const STRONG_SCORE = 800;
const CUTOFF_RATIO = 0.25;

/** `ranked` must be sorted best first (rankItemsBy). See the header. */
export function applyRelativeCutoff<T>(ranked: Ranked<T>[], strong = STRONG_SCORE, ratio = CUTOFF_RATIO): Ranked<T>[] {
    if (ranked.length < 2 || ranked[0].score < strong)
        return ranked;
    const floor = ranked[0].score * ratio;
    let n = 1;
    while (n < ranked.length && ranked[n].score >= floor)
        n++;
    return n === ranked.length ? ranked : ranked.slice(0, n);
}

export interface AppRankable {
    /** Desktop id; only needed with a `usageOf` function. */
    id?: string;
    name: string;
    keys: readonly string[];
    description: string;
}

/** Usage of an app: 0 = unknown / never used, up to 1 = the most used app. */
export type UsageOf = (id: string) => number;

/** Most points usage can add to a text score. */
export const USAGE_BOOST_MAX = 6;
/** Lower edge of every score tier (see the header). Usage never lifts a score into the next tier. */
const TIER_FLOORS = [1000, 850, 700, 540, 470, 400, 100];

function tierCeiling(score: number): number {
    let ceiling = Infinity;
    for (const floor of TIER_FLOORS) {
        if (floor > score && floor - 1 < ceiling)
            ceiling = floor - 1;
    }
    return ceiling;
}

/**
 * Usage as a tie-break: up to USAGE_BOOST_MAX points for the most used app, clamped to the tier
 * the text score is in, so a better text match in a higher tier always wins. Stable; with no usage
 * at all (every usageOf is 0) the order is untouched. `ranked` must be sorted best first.
 */
export function applyUsageBoost<T extends {id?: string}>(ranked: Ranked<T>[], usageOf: UsageOf): Ranked<T>[] {
    let any = false;
    const boosted = ranked.map(({item, score}, index) => {
        const usage = item.id ? usageOf(item.id) : 0;
        if (usage > 0)
            any = true;
        const boost = usage > 0 ? Math.max(1, Math.round(USAGE_BOOST_MAX * Math.min(1, usage))) : 0;
        return {item, score: Math.min(score + boost, tierCeiling(score)), index};
    });
    if (!any)
        return ranked;
    boosted.sort((a, b) => b.score - a.score || a.index - b.index);
    return boosted.map(({item, score}) => ({item, score}));
}

/** Prepared apps by item; items are replaced wholesale on an index rebuild, so stale entries are collected. */
const PREPARED_APPS = new WeakMap<object, PreparedApp>();

function preparedApp(item: AppRankable): PreparedApp {
    let app = PREPARED_APPS.get(item);
    if (!app || app.name !== item.name || app.keys !== item.keys || app.pkeys.length !== item.keys.length || app.description !== item.description) {
        app = prepareApp(item.name, item.keys, item.description);
        PREPARED_APPS.set(item, app);
    }
    return app;
}

/** Does the query-independent work of rankApps for `items` now (e.g. on an idle), so the first search does not. */
export function prepareApps(items: readonly AppRankable[]): void {
    for (const item of items)
        preparedApp(item);
}

export function rankApps<T extends AppRankable>(query: string, items: readonly T[], limit?: number, usageOf?: UsageOf): Ranked<T>[] {
    let aq: AppQuery | null = null;
    let aqFor = '';
    const ranked = rankItemsBy(query, items, (item, q) => {
        if (!aq || aqFor !== q) {
            aq = prepareAppQuery(q);
            aqFor = q;
        }
        return scoreAppPrepared(aq, preparedApp(item), APP_KEY_WEIGHT);
    });
    const cut = applyRelativeCutoff(ranked);
    const ordered = usageOf ? applyUsageBoost(cut, usageOf) : cut;
    return limit !== undefined && limit >= 0 ? ordered.slice(0, limit) : ordered;
}
