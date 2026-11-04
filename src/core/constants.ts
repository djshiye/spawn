// Shared constants. Pure data, no imports.

export const UUID = 'spawn-menu@djshiye.github.io';
export const STATUS_AREA_ROLE = 'spawn-menu';
export const DBUS_NAME = 'io.github.djshiye.SpawnMenu';
export const DBUS_PATH = '/io/github/djshiye/SpawnMenu';

export const DTP_UUID = 'dash-to-panel@jderose9.github.com';
export const AZ_TASKBAR_UUID = 'azTaskbar@azaech';

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
    HOME: 'SpawnMenu_Home',
    DOCUMENTS: 'SpawnMenu_Documents',
    DOWNLOADS: 'SpawnMenu_Downloads',
    MUSIC: 'SpawnMenu_Music',
    PICTURES: 'SpawnMenu_Pictures',
    VIDEOS: 'SpawnMenu_Videos',
    COMPUTER: 'SpawnMenu_Computer',
    NETWORK: 'SpawnMenu_Network',
    RECENT: 'SpawnMenu_Recent',
    FOLDER: 'SpawnMenu_Folder',
    SOFTWARE: 'SpawnMenu_Software',
    ACTIVITIES_OVERVIEW: 'SpawnMenu_ActivitiesOverview',
    SHOW_ALL_APPS: 'SpawnMenu_ShowAllApplications',
    RUN_COMMAND: 'SpawnMenu_RunCommand',
    SHOW_DESKTOP: 'SpawnMenu_ShowDesktop',
    SEPARATOR: 'SpawnMenu_Separator',
    SPACER: 'SpawnMenu_Spacer',
    POWER_OPTIONS: 'SpawnMenu_PowerOptions',
    SUSPEND: 'SpawnMenu_Suspend',
    LOG_OUT: 'SpawnMenu_LogOut',
    POWER_OFF: 'SpawnMenu_PowerOff',
    LOCK: 'SpawnMenu_Lock',
    RESTART: 'SpawnMenu_Restart',
    HYBRID_SLEEP: 'SpawnMenu_HybridSleep',
    HIBERNATE: 'SpawnMenu_Hibernate',
    SWITCH_USER: 'SpawnMenu_SwitchUser',
} as const;

/** Prefix ArcMenu uses for the same built-in ids (rewritten by migrate/arcmenu.ts). */
export const ARCMENU_ID_PREFIX = 'ArcMenu_';
export const SPAWN_ID_PREFIX = 'SpawnMenu_';
