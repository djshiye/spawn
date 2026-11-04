#!/usr/bin/env bash
# Build the extension into build/ and pack dist/<uuid>.shell-extension.zip.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

uuid="$(node -p "require('./metadata.json').uuid")"

rm -rf build
mkdir -p build dist

npx tsc -p tsconfig.json

cp metadata.json stylesheet.css build/
mkdir -p build/schemas
cp schemas/*.gschema.xml build/schemas/
glib-compile-schemas --strict build/schemas
cp -r data build/data

rm -f "dist/${uuid}.shell-extension.zip"
(cd build && zip -qr "../dist/${uuid}.shell-extension.zip" . -x '*.d.ts')

echo "built build/ and dist/${uuid}.shell-extension.zip"
