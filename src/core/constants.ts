// Shared constants. Pure data, no imports.

export const UUID = 'spawn@djshiye.github.io';
export const STATUS_AREA_ROLE = 'spawn';
export const DBUS_NAME = 'io.github.djshiye.Spawn';
export const DBUS_PATH = '/io/github/djshiye/Spawn';

export const DTP_UUID = 'dash-to-panel@jderose9.github.com';
export const AZ_TASKBAR_UUID = 'aztaskbar@aztaskbar.gitlab.com';

/** Ids stored in `power-options` (a(ib)); identical to ArcMenu's PowerType. */
export const PowerType = {
    LOGOUT: 0,
    LOCK: 1,
    RESTART: 2,
    POWER_OFF: 3,
    SUSPEND: 4,
    HYBRID_SLEEP: 5,
    HIBERNATE: 6,
    SWITCH_USER: 7,
} as const;

/** Built-in ids used in directory-shortcuts / application-shortcuts / pinned-apps entries. */
export const ShortcutId = {
    HOME: 'Spawn_Home',
    DOCUMENTS: 'Spawn_Documents',
    DOWNLOADS: 'Spawn_Downloads',
    MUSIC: 'Spawn_Music',
    PICTURES: 'Spawn_Pictures',
    VIDEOS: 'Spawn_Videos',
    COMPUTER: 'Spawn_Computer',
    NETWORK: 'Spawn_Network',
    RECENT: 'Spawn_Recent',
    FOLDER: 'Spawn_Folder',
    SOFTWARE: 'Spawn_Software',
    ACTIVITIES_OVERVIEW: 'Spawn_ActivitiesOverview',
    SHOW_ALL_APPS: 'Spawn_ShowAllApplications',
    RUN_COMMAND: 'Spawn_RunCommand',
    SHOW_DESKTOP: 'Spawn_ShowDesktop',
    SEPARATOR: 'Spawn_Separator',
    SPACER: 'Spawn_Spacer',
    POWER_OPTIONS: 'Spawn_PowerOptions',
    SUSPEND: 'Spawn_Suspend',
    LOG_OUT: 'Spawn_LogOut',
    POWER_OFF: 'Spawn_PowerOff',
    LOCK: 'Spawn_Lock',
    RESTART: 'Spawn_Restart',
    HYBRID_SLEEP: 'Spawn_HybridSleep',
    HIBERNATE: 'Spawn_Hibernate',
    SWITCH_USER: 'Spawn_SwitchUser',
} as const;

/**
 * Ids only the panel button context menu (`context-menu-items`) understands. Deliberately NOT part
 * of ShortcutId: the right-pane shortcut lists reject them (migration drops them there).
 */
export const ContextMenuId = {
    SETTINGS: 'Spawn_Settings',
    PANEL_EXTENSION_SETTINGS: 'Spawn_PanelExtensionSettings',
} as const;

/** Icon value of a context-menu entry that stands for the configured panel button icon. */
export const SPAWN_ICON = 'Spawn_SpawnIcon';

/** Prefix ArcMenu uses for the same built-in ids (rewritten by migrate/arcmenu.ts). */
export const ARCMENU_ID_PREFIX = 'ArcMenu_';
export const SPAWN_ID_PREFIX = 'Spawn_';
