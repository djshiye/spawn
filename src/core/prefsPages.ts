// The pages of Spawn's settings window, in order. prefs.ts builds its window from this list and the shell side
// (openPrefs.ts) looks a page up by NAME, so neither has to know an index: `prefs-visible-page` still stores the
// index (an `i` key, unchanged) and both sides translate through here.
//
// Public API:
//   PREFS_PAGE_NAMES                      ['general', 'menu', 'pinned', 'appearance', 'about']
//   type PrefsPageName
//   prefsPageIndex(name): number

export const PREFS_PAGE_NAMES = ['general', 'menu', 'pinned', 'appearance', 'about'] as const;

export type PrefsPageName = (typeof PREFS_PAGE_NAMES)[number];

export function prefsPageIndex(name: PrefsPageName): number {
    return PREFS_PAGE_NAMES.indexOf(name);
}
