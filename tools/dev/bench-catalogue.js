// Realistic synthetic app catalogue for the pure-JS search benchmark and the ranking snapshot test.
// Uses the real appKeys()/descriptionKey(), so entries look exactly like AppIndex.searchEntries().
import {appKeys, descriptionKey} from '../../build/model/appKeys.js';

export const BASE = [
    ['Files', 'org.gnome.Nautilus.desktop', 'File Manager', ['folder', 'manager', 'explore', 'disk', 'filesystem'], '/usr/bin/nautilus', 'Access and organize files'],
    ['Firefox', 'org.mozilla.firefox.desktop', 'Web Browser', ['internet', 'www', 'browser', 'web', 'explorer'], 'firefox', 'Browse the World Wide Web'],
    ['Visual Studio Code', 'code.desktop', 'Text Editor', ['vscode'], '/usr/share/code/code', 'Code Editing. Redefined.'],
    ['Settings', 'org.gnome.Settings.desktop', null, ['preferences', 'settings'], 'gnome-control-center', 'Utility to configure the GNOME desktop'],
    ['Terminal', 'org.gnome.Ptyxis.desktop', 'Terminal', ['shell', 'prompt', 'command', 'commandline', 'cmd'], 'ptyxis', 'Use the command line'],
    ['Steam', 'steam.desktop', null, ['games'], 'steam', 'Application for managing and playing games on Steam'],
    ['Discord', 'com.discordapp.Discord.desktop', 'Internet Messenger', ['chat', 'voice'], '/usr/bin/flatpak', 'All-in-one voice and text chat for gamers'],
    ['LibreOffice Writer', 'libreoffice-writer.desktop', 'Word Processor', ['text', 'letter', 'fax', 'document', 'odt', 'doc', 'docx'], 'libreoffice', 'Create and edit text and graphics in letters, reports, documents and Web pages'],
    ['Text Editor', 'org.gnome.TextEditor.desktop', 'Text Editor', ['text', 'editor', 'plaintext', 'write'], 'gnome-text-editor', 'Edit text files'],
    ['Calculator', 'org.gnome.Calculator.desktop', 'Calculator', ['calculation', 'arithmetic', 'scientific', 'financial'], 'gnome-calculator', 'Perform arithmetic, scientific or financial calculations'],
    ['Software', 'org.gnome.Software.desktop', 'App Center', ['updates', 'upgrade', 'sources', 'repositories', 'install', 'uninstall', 'program', 'software', 'store'], 'gnome-software', 'Add, remove or update software on this computer'],
    ['Obsidian', 'obsidian.desktop', null, ['notes', 'markdown'], 'obsidian', 'Obsidian is a powerful knowledge base'],
    ['Slack', 'slack.desktop', null, ['chat', 'team'], '/usr/bin/slack', 'Slack Desktop'],
    ['Zoom', 'Zoom.desktop', null, ['meeting', 'video'], '/usr/bin/zoom', 'Zoom Video Conference'],
    ['Flatseal', 'com.github.tchx84.Flatseal.desktop', null, ['seal', 'sandbox', 'override', 'permission'], 'flatpak', 'Manage Flatpak permissions'],
    ['Extension Manager', 'com.mattjakeman.ExtensionManager.desktop', null, ['extensions', 'gnome'], 'extension-manager', 'Manage GNOME Shell Extensions'],
    ['Heroic Games Launcher', 'com.heroicgameslauncher.hgl.desktop', null, ['epic', 'gog', 'games'], 'heroic', 'An Open Source GOG and Epic Games Launcher'],
    ['Bottles', 'com.usebottles.bottles.desktop', null, ['wine', 'windows'], 'bottles', 'Run Windows Software'],
    ['Prism Launcher', 'org.prismlauncher.PrismLauncher.desktop', null, ['minecraft', 'mods'], 'prismlauncher', 'A custom launcher for Minecraft'],
    ['Disks', 'org.gnome.DiskUtility.desktop', null, ['disk', 'drive', 'volume', 'partition', 'iso', 'raid', 'smart'], 'gnome-disks', 'Manage Drives and Media'],
    ['System Monitor', 'org.gnome.SystemMonitor.desktop', 'Task Manager', ['monitor', 'system', 'process', 'cpu', 'memory', 'network', 'history', 'usage', 'performance', 'task', 'manager', 'activity'], 'gnome-system-monitor', 'View current processes and monitor system state'],
    ['GIMP', 'gimp.desktop', 'Image Editor', ['gimp', 'graphic', 'design', 'illustration', 'painting'], 'gimp', 'Create images and edit photographs'],
    ['Inkscape', 'org.inkscape.Inkscape.desktop', 'Vector Graphics Editor', ['image', 'editor', 'vector', 'drawing', 'svg'], 'inkscape', 'Create and edit Scalable Vector Graphics images'],
    ['Thunderbird', 'org.mozilla.Thunderbird.desktop', 'Mail Client', ['email', 'mail', 'news', 'calendar'], 'thunderbird', 'Send and receive mail with Thunderbird'],
    ['Spotify', 'com.spotify.Client.desktop', 'Music Player', ['music', 'player', 'streaming'], 'spotify', 'Music for every moment'],
    ['VLC media player', 'vlc.desktop', 'Media player', ['player', 'capture', 'dvd', 'audio', 'video', 'stream', 'mp3', 'mp4'], '/usr/bin/vlc', 'Read, capture, broadcast your multimedia streams'],
    ['Document Viewer', 'org.gnome.Papers.desktop', 'Document Viewer', ['pdf', 'ps', 'postscript', 'dvi', 'xps', 'djvu', 'tiff', 'document', 'presentation', 'viewer'], 'papers', 'View, search or annotate documents in many different formats'],
    ['Image Viewer', 'org.gnome.Loupe.desktop', 'Image Viewer', ['picture', 'photo', 'graphics'], 'loupe', 'View images'],
    ['Claude', 'com.anthropic.Claude.desktop', null, ['ai', 'assistant'], 'claude', 'Claude desktop'],
    ['Weather', 'org.gnome.Weather.desktop', null, ['forecast', 'temperature'], 'gnome-weather', 'Show weather conditions and forecast'],
];
const WORDS = ['Studio', 'Pro', 'Tool', 'Manager', 'Viewer', 'Editor', 'Player', 'Launcher', 'Center', 'Lab', 'Builder', 'Monitor', 'Tracker', 'Browser', 'Mixer', 'Sync', 'Notes', 'Board', 'Desk', 'Kit'];
const PREFIX = ['Gnome', 'Kde', 'Open', 'Libre', 'Quick', 'Smart', 'Super', 'Easy', 'Deep', 'Nova', 'Zen', 'Astra', 'Pixel', 'Data', 'Cloud', 'Sound'];

function entry(name, id, generic, keywords, exec, description) {
    return {
        id, name,
        description: descriptionKey(description),
        keys: appKeys({name, id, genericName: generic, keywords, executable: exec, fullName: null}),
    };
}

export function catalogue(n = 400) {
    const out = BASE.map(a => entry(...a));
    let k = 0;
    while (out.length < n) {
        const p = PREFIX[k % PREFIX.length];
        const w = WORDS[Math.floor(k / PREFIX.length) % WORDS.length];
        const name = `${p} ${w}${k >= PREFIX.length * WORDS.length ? ` ${k}` : ''}`;
        const id = `org.example.${p}${w}${k}.desktop`;
        out.push(entry(name, id, `${w} application`, [p.toLowerCase(), w.toLowerCase(), 'utility'], `${p.toLowerCase()}-${w.toLowerCase()}`,
            `A ${w.toLowerCase()} for ${p} users to organize files, documents and media`));
        k++;
    }
    return out;
}
