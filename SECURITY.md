# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not in a public issue or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab, choose **Report a vulnerability**,
and describe the problem. Include the Spawn and GNOME Shell versions, the steps to reproduce it, and what an attacker
could achieve. A proof of concept helps but is not required.

You can expect an acknowledgement within about a week. This is a small project maintained in spare time, so fixes are
prioritised by impact; please allow a reasonable period for a fix before disclosing details publicly. Credit in the
release notes is given if you want it.

## Supported versions

Only the latest release receives security fixes. Spawn is distributed as an RPM from its own DNF repository
(<https://djshiye.github.io/spawn/>); upgrade to the newest build before reporting.

## What is in scope

- The extension code that runs inside GNOME Shell: the menu, search, the runner, the Dash to Panel integration and the
  D-Bus interfaces it exports.
- The preferences window, including the ArcMenu settings import and any handling of files or paths that a user imports.
- Launching applications and files from the menu (for example command or argument injection).
- The build and packaging scripts, the RPM, and the DNF repository (including the integrity of what is published).
- The GitHub Actions workflows and their dependencies in this repository.

## What is out of scope

- Vulnerabilities in GNOME Shell, Dash to Panel, ArcMenu, Fedora or other software that Spawn merely runs alongside.
  Please report those upstream.
- Issues that need an attacker who already controls the user's session or can write to the user's own configuration
  (the extension runs with the user's privileges by design).
- The headless test harness under `tools/` when run on a developer's machine, unless it can affect the real session.
- Denial of service that needs a very large number of installed applications or an unrealistic configuration.

Packages are currently unsigned (see `ROADMAP.md`, item 4); a report about that gap is already known and does not need
to be filed.
