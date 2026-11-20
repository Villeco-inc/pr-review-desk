#!/bin/bash
# Regenerates Resources/AppIcon.icns from public/favicon.svg. Run it again whenever the favicon changes.
# The drawing fills 824 of 1024 px, the content square of the macOS app-icon grid; the margin stays transparent.
set -euo pipefail
cd "$(dirname "$0")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
sips -s format png -z 824 824 ../../public/favicon.svg --out "$WORK/drawing.png" >/dev/null
sips -p 1024 1024 "$WORK/drawing.png" --out "$WORK/icon.png" >/dev/null
mkdir "$WORK/AppIcon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$WORK/icon.png" --out "$WORK/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon.png" --out "$WORK/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/AppIcon.iconset" -o AppIcon.icns
