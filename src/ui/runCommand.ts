// Run a command typed in the runner (setting runner-run-commands, off by default). The glue between the pure
// detection (search/command.ts) and the system; used by ui/runner.ts only (the main menu never offers it).
//
// Security: the command is NEVER given to a shell. The argv from GLib.shell_parse_argv (quotes and backslashes
// only; no variables, globs, pipes or redirections) is started directly with GLib.spawn_async and SEARCH_PATH,
// in the home folder, with stdin from /dev/null and stdout / stderr to /dev/null, so the child shares nothing
// with the shell's own streams. The command line is not logged (not at info level, not in errors).
//
// Public API:
//   systemCommandEnv(): CommandEnv           GLib / Gio implementation of the detection's environment
//   detectTypedCommand(query): DetectedCommand | null    detectCommand() with the system environment; never throws
//   runTypedCommand(cmd: DetectedCommand): void           start it; a failure shows a shell notification
//                                                        (“Couldn’t run “x””, with the error message); never throws

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, warn} from '../core/log.js';
import {detectCommand, type CommandEnv, type DetectedCommand} from '../search/command.js';

const TITLE_MAX = 60;

export function systemCommandEnv(): CommandEnv {
    return {
        parseArgv: line => {
            try {
                const [ok, argv] = GLib.shell_parse_argv(line);
                return ok ? argv : null;
            } catch {
                return null;
            }
        },
        findProgram: name => GLib.find_program_in_path(name),
        isExecutableFile: path => {
            try {
                const info = Gio.File.new_for_path(path).query_info(
                    'standard::type,access::can-execute', Gio.FileQueryInfoFlags.NONE, null);
                return info.get_file_type() === Gio.FileType.REGULAR && info.get_attribute_boolean('access::can-execute');
            } catch {
                return false;
            }
        },
        home: GLib.get_home_dir(),
    };
}

export function detectTypedCommand(query: string): DetectedCommand | null {
    try {
        return detectCommand(query, systemCommandEnv());
    } catch (e) {
        error('detecting a typed command failed', e);
        return null;
    }
}

function shorten(line: string): string {
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

export function runTypedCommand(cmd: DetectedCommand): void {
    try {
        const [ok, pid] = GLib.spawn_async(
            GLib.get_home_dir(), cmd.argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.STDOUT_TO_DEV_NULL | GLib.SpawnFlags.STDERR_TO_DEV_NULL,
            null);
        if (!ok || pid === null)
            throw new Error(_('The program did not start'));
        // DO_NOT_REAP_CHILD: reap it ourselves so it does not stay a zombie
        const child = pid;
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, child, () => GLib.spawn_close_pid(child));
    } catch (e) {
        warn('could not run a typed command');
        try {
            const message = e instanceof Error ? e.message : String(e);
            Main.notifyError(_('Couldn’t run “%s”').replace('%s', shorten(cmd.line)), message);
        } catch (e2) {
            error('showing the failure of a typed command failed', e2);
        }
    }
}
