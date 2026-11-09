// Friendly text for an icon setting value (pure, no GTK): the icon picker and the Button page show
// "Icon apps" instead of "icon-apps-symbolic.svg".
//
// Public API:
//   friendlyIconName(value): string   file name / themed name / absolute path -> short capitalised label

/** 'distro-fedora.svg' -> 'Fedora', 'icon-apps-symbolic' -> 'Icon apps', '/home/me/logo.png' -> 'logo.png'. */
export function friendlyIconName(value: string): string {
    if (value.includes('/'))
        return value.slice(value.lastIndexOf('/') + 1) || value;
    const words = value
        .replace(/\.svg$/i, '')
        .replace(/-symbolic$/, '')
        .replace(/^distro-/, '')
        .replace(/[-_.]+/g, ' ')
        .trim();
    if (words === '')
        return value;
    return words.charAt(0).toUpperCase() + words.slice(1);
}
