// Queries for the ranking snapshot (tests/rank-snapshot.test.js): every tier, separators, multi-word,
// cross-key, description, diacritics, punctuation and no-match cases.
export const SNAPSHOT_QUERIES = [
    'f', 'fi', 'fir', 'fire', 'firefox', 'FireFox', 'vsc', 'vscode', 'code', 'term', 'terminal', 'set', 'st', 'zz', 'doc',
    'file manager', 'files', 'libre writer', 'writer', 'lo', 'minecraft', 'prism mine', 'ff', 'tt', 'ss', 'xyzq', 'gnome',
    'office', 'sys mon', 'system-monitor', 'system_monitor', 'sys.mon', 'calc', 'calcul', 'café', 'cafe', 'édit', 'edit',
    'pdf', 'image', 'img', 'web browser', 'browse the web', 'chat', 'voice chat', 'the', 'and', 'for the', 'a', 'z', '1', '12',
    'pro', 'studio 3', 'deep lab', 'nova', 'sync', 'kit', 'org', 'desktop', 'example', 'heroic', 'hgl', 'epic', 'gog',
    'wine', 'bottles', 'claude', 'ai', 'weather', 'forecast', 'disk', 'disks', 'smart', 'monitor', 'gimp', 'inkscape', 'svg',
    'mail', 'thunder', 'thb', 'spot', 'music', 'vlc', 'media', 'viewer', 'loupe', 'pap', 'extension', 'ext man', 'em',
    'flatseal', 'flat', 'seal', 'permission', 'software', 'store', 'install', 'steam', 'discord', 'disc', 'obs', 'notes',
    'slack', 'zoom', 'meeting', 'tool', 'easy', 'quick manager', 'smart board', 'data', 'cloud', 'sound mixer',
    '-', '.', '  fire  ', 'f i r e', 'gnome-tool', 'kde_kit', 'qwertyuiopasdfghjkl', 'aaaaaaaaaa', 'e', 'ee', 'ie',
];
