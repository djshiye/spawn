// Minimal ambient types for gi://GMenu (libgnome-menu). @girs ships no package for it, so
// only the members AppIndex uses are declared.
declare module 'gi://GMenu' {
    import type Gio from 'gi://Gio';

    namespace GMenu {
        enum TreeItemType {
            INVALID = 0,
            ENTRY = 2,
            DIRECTORY = 1,
            SEPARATOR = 3,
            HEADER = 4,
            ALIAS = 5,
        }

        enum TreeFlags {
            NONE = 0,
            INCLUDE_EXCLUDED = 1,
            SHOW_EMPTY = 2,
            INCLUDE_NODISPLAY = 4,
            SHOW_ALL_SEPARATORS = 8,
            SORT_DISPLAY_NAME = 65536,
        }

        class TreeEntry {
            get_desktop_file_id(): string;
            get_app_info(): Gio.DesktopAppInfo;
        }

        class TreeDirectory {
            get_menu_id(): string | null;
            get_name(): string;
            get_icon(): Gio.Icon | null;
            get_is_nodisplay(): boolean;
            iter(): TreeIter;
        }

        class TreeIter {
            next(): TreeItemType;
            get_entry(): TreeEntry;
            get_directory(): TreeDirectory;
        }

        class Tree {
            constructor(properties: {menu_basename: string; flags?: TreeFlags});
            load_sync(): boolean;
            get_root_directory(): TreeDirectory | null;
            connect(signal: 'changed', callback: () => void): number;
            connect(signal: string, callback: (...args: any[]) => any): number;
            disconnect(id: number): void;
        }
    }

    export default GMenu;
}
