// The per-provider result cap (max-search-results), clamped so a hand-edited value (0, negative,
// huge) behaves the same in every provider. The schema range and the prefs spin row stay inside it.
import type {SpawnSettings} from '../core/settings.js';

export const MAX_RESULTS_MIN = 1;
export const MAX_RESULTS_MAX = 50;

export function clampMaxResults(value: unknown): number {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n))
        return MAX_RESULTS_MIN;
    return Math.min(MAX_RESULTS_MAX, Math.max(MAX_RESULTS_MIN, n));
}

export function maxSearchResults(settings: SpawnSettings): number {
    return clampMaxResults(settings.get('max-search-results'));
}
