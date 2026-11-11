// Matching "firefox private" to the desktop actions of an app ("New Private Window"). Pure (rank.ts only), so it is
// unit-testable with gjs -m (tests/appActions.test.js); the provider (providers/appActions.ts) supplies the
// apps and their actions.
//
// The query is split at every word boundary into an app part and an action part ("firefox" | "private",
// "visual studio code" | "new window"). The app part must match an app name well (rank.ts, acronym tier or
// better, so a weak fuzzy match never offers actions); the action part must match the action's Name= or its id
// ("new-private-window") as a word prefix or substring (400 or better). Typed in the other order ("private firefox") nothing
// matches. The score is the mean of both parts.
//
// Public API:
//   AppAction                          {id, name}
//   ActionApp                          AppRankable + {actions(): AppAction[]} (read lazily, only for apps that match)
//   matchAppActions(query, apps, limit?): ActionMatch[]     best first
//   ActionMatch                        {app, action, score}

import {normalize, rankApps, scoreNormalized, type AppRankable} from './rank.js';

export interface AppAction {
    id: string;
    name: string;
}

export interface ActionApp extends AppRankable {
    actions(): AppAction[];
}

export interface ActionMatch<T extends ActionApp = ActionApp> {
    app: T;
    action: AppAction;
    score: number;
}

const APP_MIN_SCORE = 540;
const ACTION_MIN_SCORE = 400;
const MAX_TERMS = 6;
const APPS_PER_SPLIT = 4;

export function matchAppActions<T extends ActionApp>(query: string, apps: readonly T[], limit = 5): ActionMatch<T>[] {
    const terms = normalize(query).split(' ').filter(t => t.length > 0);
    if (terms.length < 2 || terms.length > MAX_TERMS)
        return [];
    const best = new Map<string, ActionMatch<T>>();
    for (let k = 1; k < terms.length; k++) {
        const appPart = terms.slice(0, k).join(' ');
        const actionPart = terms.slice(k).join(' ');
        if (actionPart.length < 2)
            continue;
        for (const {item: app, score: appScore} of rankApps(appPart, apps, APPS_PER_SPLIT)) {
            if (appScore < APP_MIN_SCORE)
                continue;
            for (const action of app.actions()) {
                const s = Math.max(
                    scoreNormalized(actionPart, action.name),
                    Math.round(scoreNormalized(actionPart, action.id.replace(/[-_]+/g, ' ')) * 0.9),
                );
                if (s < ACTION_MIN_SCORE)
                    continue;
                const score = Math.round((appScore + s) / 2);
                const key = `${app.id ?? app.name}\0${action.id}`;
                if (score > (best.get(key)?.score ?? 0))
                    best.set(key, {app, action, score});
            }
        }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
