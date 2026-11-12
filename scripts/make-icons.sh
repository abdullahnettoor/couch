#!/bin/sh
# Derives every icon size from the masters in build/ (macOS sips and iconutil; the Couch mark also needs ffmpeg).
#   build/icon.png        1024 px, tile on Apple's grid with transparent corners
#   build/icon-touch.png  1024 px, full bleed (phones round the corners themselves)
#   build/couch-mark.svg  the Couch mark's outline, cut out of build/icon.png
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

# The Couch mark (the sofa without the square): the Remote's tab icon and off screen, and the README's header.
node scripts/make-mark.mts
