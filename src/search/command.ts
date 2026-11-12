// Detecting "a command the user typed" for the runner's Run row. Pure (the environment is injected), unit-testable:
// tests/command.test.js.
//
// The query is split like a shell command line WITHOUT running a shell (GLib.shell_parse_argv: quotes and
// backslashes only, no expansion of $VARS, globs, pipes or redirections: they stay plain characters of an
// argument). It counts as a command when the first word is an executable: a name found in the PATH, or an
// absolute path (a leading `~` / `~/` is expanded to the home folder) of an executable regular file. A relative
// path (`./x`, `x/y`) is not offered. Nothing here starts anything.
//
// Public API:
//   interface CommandEnv {parseArgv(s): string[] | null; findProgram(name): string | null; isExecutableFile(path): boolean; home: string}
//   detectCommand(query, env): {argv: string[], line: string} | null
//        `argv`: the words (a `~` first word expanded), `line`: the trimmed query as typed (for the row's label)
//   expandHome(path, home): string                 "~" and "~/x" only ("~user" stays as typed)

export interface CommandEnv {
    /** GLib.shell_parse_argv; null for an unbalanced quote or an empty line. */
    parseArgv(line: string): string[] | null;
    /** GLib.find_program_in_path */
    findProgram(name: string): string | null;
    /** An existing regular file that this user may execute. */
    isExecutableFile(path: string): boolean;
    home: string;
}

export interface DetectedCommand {
    argv: string[];
    line: string;
}

export function expandHome(path: string, home: string): string {
    if (path === '~')
        return home;
    if (path.startsWith('~/'))
        return home.replace(/\/+$/, '') + path.slice(1);
    return path;
}

export function detectCommand(query: string, env: CommandEnv): DetectedCommand | null {
    const line = query.trim();
    if (!line || line.includes('\0'))
        return null;
    const argv = env.parseArgv(line);
    if (!argv || argv.length === 0 || !argv[0])
        return null;
    const first = expandHome(argv[0], env.home);
    if (first.includes('/')) {
        if (!first.startsWith('/') || !env.isExecutableFile(first))
            return null;
    } else if (!env.findProgram(first)) {
        return null;
    }
    return {argv: [first, ...argv.slice(1)], line};
}
