// Resolution of the `menu-button-icon` setting. Pure, no imports.
//
// Public API:
//   resolveButtonIcon(value, iconDir) -> {kind: 'file', path} | {kind: 'name', name}
//
// `value` is one of:
//   * absolute path                       -> file
//   * bundled file name (no '/', *.svg)   -> file inside `iconDir` (the extension's data/icons)
//   * ArcMenu resource URI (resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/
//     actions/<file>.svg)                 -> the same <file>.svg inside `iconDir`
//   * anything else                       -> themed icon name

export type ResolvedIcon =
    | {kind: 'file'; path: string}
    | {kind: 'name'; name: string};

const ARCMENU_RESOURCE = /^resource:\/\/\/org\/gnome\/shell\/extensions\/arcmenu\/icons\/scalable\/[^/]+\/([^/]+\.svg)$/;

export function resolveButtonIcon(value: string, iconDir: string): ResolvedIcon {
    const arc = ARCMENU_RESOURCE.exec(value);
    if (arc)
        return {kind: 'file', path: `${iconDir}/${arc[1]}`};
    if (value.startsWith('/'))
        return {kind: 'file', path: value};
    if (!value.includes('/') && value.endsWith('.svg'))
        return {kind: 'file', path: `${iconDir}/${value}`};
    return {kind: 'name', name: value};
}
