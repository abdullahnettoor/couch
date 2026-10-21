#!/bin/sh
# Derives every icon size from the masters in build/ (macOS sips and iconutil only).
#   build/icon.png        1024 px, tile on Apple's grid with transparent corners
#   build/icon-touch.png  1024 px, full bleed (phones round the corners themselves)
set -e
cd "$(dirname "$0")/.."

set="$(mktemp -d)/icon.iconset"
mkdir -p "$set"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" build/icon.png --out "$set/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon.png --out "$set/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o build/icon.icns

# Served with the renderer (Credits) and by the Remote server (tab and home-screen icons).
out=src/renderer/public
mkdir -p "$out"
sips -z 512 512 build/icon.png --out "$out/icon-512.png" >/dev/null
sips -z 192 192 build/icon.png --out "$out/icon-192.png" >/dev/null
sips -z 192 192 build/icon-touch.png --out "$out/touch-icon.png" >/dev/null
echo "Icons written to build/icon.icns and $out/"
