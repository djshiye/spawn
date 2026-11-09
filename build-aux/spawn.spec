%global uuid spawn@djshiye.github.io
%global extdir %{_datadir}/gnome-shell/extensions/%{uuid}
# Oldest GNOME Shell the package is installable on. Keep in step with "shell-version" in metadata.json.
%global min_shell 49

# The one source of truth for the version is package.json; this line, metadata.json "version-name" and the
# Changelog are kept equal by tools/bump-version.sh (publish.sh and %%check refuse a mismatch).
Name:           spawn
Version:        1.1.3
# tools/publish.sh appends .<commit count> so every build from main is a newer release.
Release:        1%{?release_suffix}%{?dist}
Summary:        Fast, resilient application menu for GNOME Shell (ArcMenu replacement)

License:        GPL-2.0-or-later
URL:            https://github.com/djshiye/spawn
# git archive of the repository PLUS the compiled extension in build/ (tools/build.sh, run by
# tools/publish.sh on the host from the exported tree and `npm ci`). The TypeScript is compiled once, outside
# the container, so every Fedora release ships byte-identical files and the build needs no network.
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch

# Until 1.1.1 the package was called gnome-shell-extension-spawn (Fedora's naming convention for shell extensions). It is
# now just "spawn", which is shorter to type: dnf5 matches install and upgrade against Provides but not remove or info, so
# a Provides alias alone was not enough. The Obsoletes moves existing installs over on their next `dnf upgrade`; the
# Provides keeps the old name working for `dnf install`. No package in Fedora 43-45 or RPM Fusion is called or provides
# "spawn"; publish.sh re-checks that on every release.
Provides:       gnome-shell-extension-spawn = %{version}-%{release}
Obsoletes:      gnome-shell-extension-spawn < %{version}-%{release}


# glib-compile-schemas, for the schema check in %%check
BuildRequires:  glib2

Requires:       gnome-shell >= %{min_shell}
# glib2's file trigger compiles the schema installed below into gschemas.compiled
Requires:       glib2
# spawn-enable is a gjs script
Requires:       gjs

%description
Spawn replaces ArcMenu with a smaller, stricter codebase: a two-pane application menu with pinned apps
and folders (drag and drop), search, a standalone runner, hotkeys, theming that follows the GNOME accent
colour, Dash to Panel support (panel targets are re-resolved on every change instead of being cached),
and a one-click import of ArcMenu settings, pinned apps and pinned folders.

Enable it with the spawn-enable command (a freshly installed system extension is unknown to the running
shell, so `gnome-extensions enable` fails until the next login) and log out and back in.

%prep
%autosetup -n %{name}-%{version}

%build
# Nothing to do: build/ was compiled when the source tarball was made.

%install
install -d %{buildroot}%{extdir}
cp -a build/. %{buildroot}%{extdir}/
# The schema lives in the system schema directory (compiled by glib2's file trigger), not in the extension
# directory: extension.js falls back to the default schema source when there is no schemas/ directory.
# (The ArcMenu schema in data/migration/arcmenu stays; the migration reads it from there.)
rm -rf %{buildroot}%{extdir}/schemas %{buildroot}%{extdir}/.built
find %{buildroot}%{extdir} -name '*.d.ts' -delete
find %{buildroot}%{extdir} -type d -exec chmod 0755 {} +
find %{buildroot}%{extdir} -type f -exec chmod 0644 {} +
install -Dpm 0755 build-aux/spawn-enable %{buildroot}%{_bindir}/spawn-enable
install -Dpm 0644 schemas/org.gnome.shell.extensions.spawn.gschema.xml \
    %{buildroot}%{_datadir}/glib-2.0/schemas/org.gnome.shell.extensions.spawn.gschema.xml

%check
cd %{buildroot}%{extdir}
for f in extension.js prefs.js metadata.json stylesheet.css; do test -f "$f"; done
grep -q '"uuid": "%{uuid}"' metadata.json
grep -q '"version-name": "%{version}"' metadata.json
# no compiled schema for the extension itself, only ArcMenu's (data/migration/arcmenu) for the import
test "$(find . -name gschemas.compiled)" = "./data/migration/arcmenu/gschemas.compiled"
glib-compile-schemas --strict --dry-run %{buildroot}%{_datadir}/glib-2.0/schemas

%files
%license LICENSE
%doc README.md
%{_bindir}/spawn-enable
%{extdir}/
%{_datadir}/glib-2.0/schemas/org.gnome.shell.extensions.spawn.gschema.xml

%changelog
* Mon Nov 09 2026 Dino Klisura <115914552+djshiye@users.noreply.github.com> - 1.1.3-1
- Folder popup: the open folder stays lit above the dimmed menu

* Mon Nov 09 2026 Dino Klisura <115914552+djshiye@users.noreply.github.com> - 1.1.2-1
- Folder popup: one highlight at a time, compact card; package renamed to spawn

* Sun Nov 08 2026 Dino Klisura <115914552+djshiye@users.noreply.github.com> - 1.1.1-1
- Folder popup opens next to its folder, solid and roomier; long app names wrap onto two lines

* Sun Nov 08 2026 Dino Klisura <115914552+djshiye@users.noreply.github.com> - 1.1.0-1
- Hide from Menu, New badges, accessibility pass, signed packages

* Thu Nov 05 2026 Dino Klisura <115914552+djshiye@users.noreply.github.com> - 1.0.0-1
- First RPM, with the spawn-enable command
