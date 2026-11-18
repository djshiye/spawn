// Run a command typed in the runner (setting runner-run-commands, off by default). The glue between the pure
// detection (search/command.ts) and the system; used by ui/runner.ts only (the main menu never offers it).
//
// Security: the command is NEVER given to a shell. The argv from GLib.shell_parse_argv (quotes and backslashes
// only; no variables, globs, pipes or redirections) is started directly with GLib.spawn_async and SEARCH_PATH,
// in the home folder, with stdin from /dev/null and stdout / stderr to /dev/null, so the child shares nothing
// with the shell's own streams. The command line is not logged (not at info level, not in errors).
//
// Public API:
//   systemCommandEnv(): CommandEnv           GLib / Gio implementation of the detection's environment (synchronous:
//                                            tests and one-off checks)
//   detectTypedCommand(query): DetectedCommand | null | Promise<DetectedCommand | null>
//                                            detectCommand() with the system environment, for every keystroke;
//                                            never throws (the promise never rejects). A path ("/opt/x/run",
//                                            "~/bin/tool") is checked with an asynchronous query (GIO's worker
//                                            threads, PROBE_TIMEOUT_MS deadline: a hung network share can never
//                                            freeze the shell; a check that overran counts as "not executable"),
//                                            remembered for CHECK_TTL_US, so only the first keystroke that
//                                            names a new path waits for it. Program names in $PATH are
//                                            remembered for CHECK_TTL_US as well.
//   runTypedCommand(cmd: DetectedCommand): void           start it; a failure shows a shell notification
//                                                        (“Couldn’t run “x””, with the error message); never throws

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, warn} from '../core/log.js';
import {detectCommand, type CommandEnv, type DetectedCommand} from '../search/command.js';

const TITLE_MAX = 60;
/** How long a check of a path / program name is trusted: the row follows a chmod or an install within seconds. */
const CHECK_TTL_US = 3_000_000;
const PROBE_TIMEOUT_MS = 400;
const CACHE_MAX = 64;

const executables = new Map<string, {exec: boolean; at: number}>();
const programs = new Map<string, {found: string | null; at: number}>();

function fresh<V extends {at: number}>(cache: Map<string, V>, key: string, now: number): V | null {
    const hit = cache.get(key);
    return hit && now - hit.at < CHECK_TTL_US ? hit : null;
}

function remember<V>(cache: Map<string, V>, key: string, value: V): void {
    if (cache.size >= CACHE_MAX)
        cache.clear();
    cache.set(key, value);
}

function isExecutableInfo(info: Gio.FileInfo): boolean {
    return info.get_file_type() === Gio.FileType.REGULAR && info.get_attribute_boolean('access::can-execute');
}

const EXEC_ATTRIBUTES = 'standard::type,access::can-execute';

/** query_info_async with a deadline; false on any error or when it overran. */
function probeExecutable(path: string): Promise<boolean> {
    return new Promise(resolve => {
        const cancellable = new Gio.Cancellable();
        let done = false;
        const finish = (exec: boolean) => {
            if (done)
                return;
            done = true;
            GLib.source_remove(timer);
            resolve(exec);
        };
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROBE_TIMEOUT_MS, () => {
            cancellable.cancel();
            finish(false);
            return GLib.SOURCE_REMOVE;
        });
        try {
            const file = Gio.File.new_for_path(path);
            file.query_info_async(EXEC_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_f, res) => {
                try {
                    finish(isExecutableInfo(file.query_info_finish(res)));
                } catch {
                    finish(false);
                }
            });
        } catch {
            finish(false);
        }
    });
}

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
                return isExecutableInfo(Gio.File.new_for_path(path).query_info(EXEC_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null));
            } catch {
                return false;
            }
        },
        home: GLib.get_home_dir(),
    };
}

export function detectTypedCommand(query: string): DetectedCommand | null | Promise<DetectedCommand | null> {
    const base = systemCommandEnv();
    let unknown: string | null = null;
    const now = GLib.get_monotonic_time();
    const env: CommandEnv = {
        ...base,
        findProgram: name => {
            const hit = fresh(programs, name, now);
            if (hit)
                return hit.found;
            const found = base.findProgram(name);
            remember(programs, name, {found, at: now});
            return found;
        },
        isExecutableFile: path => {
            const hit = fresh(executables, path, now);
            if (hit)
                return hit.exec;
            unknown = path;
            return false;
        },
    };
    let cmd: DetectedCommand | null;
    try {
        cmd = detectCommand(query, env);
    } catch (e) {
        error('detecting a typed command failed', e);
        return null;
    }
    const path: string | null = unknown;
    if (path === null)
        return cmd;
    return probeExecutable(path).then(exec => {
        remember(executables, path, {exec, at: GLib.get_monotonic_time()});
        try {
            return exec ? detectCommand(query, {...env, isExecutableFile: p => p === path}) : null;
        } catch (e) {
            error('detecting a typed command failed', e);
            return null;
        }
    });
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
