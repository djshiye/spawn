// Logging helpers. Every message is prefixed with "[spawn-menu]".
//
// Public API:
//   log(...args)    informational (console.log)
//   warn(...args)   console.warn
//   error(msg, err?) console.error; when err is an Error its stack is appended
//   debug(...args)  console.debug
//
// This module has no imports so it is usable from unit tests under gjs -m.

const PREFIX = '[spawn-menu]';

function describe(err: unknown): string {
    if (err instanceof Error)
        return `${err.message}${err.stack ? `\n${err.stack}` : ''}`;
    return String(err);
}

export function log(...args: unknown[]): void {
    console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
}

export function debug(...args: unknown[]): void {
    console.debug(PREFIX, ...args);
}

export function error(message: string, err?: unknown): void {
    if (err === undefined)
        console.error(PREFIX, message);
    else
        console.error(PREFIX, `${message}: ${describe(err)}`);
}
