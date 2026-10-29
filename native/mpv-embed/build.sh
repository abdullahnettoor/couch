#!/bin/sh
# Builds mpv_embed.node (N-API, so one binary works for Electron and Node). Needs Xcode CLT, mpv headers (brew install mpv).
set -e
cd "$(dirname "$0")"
NODE_INC="$(dirname "$(dirname "$(command -v node)")")/include/node"
MPV_INC="${MPV_INCLUDE:-$(brew --prefix mpv 2>/dev/null || echo /opt/homebrew)/include}"
[ -d "$MPV_INC/mpv" ] || MPV_INC=/opt/homebrew/include
ARCH="${MPV_EMBED_ARCH:-$(uname -m)}"
clang++ -std=c++17 -fobjc-arc -O2 -arch "$ARCH" -DNAPI_VERSION=8 -DNODE_GYP_MODULE_NAME=mpv_embed \
  -bundle -undefined dynamic_lookup -I"$NODE_INC" -I"$MPV_INC" \
  -framework Cocoa -framework OpenGL -framework QuartzCore -framework WebKit \
  -Wno-deprecated-declarations mpv_embed.mm -o mpv_embed.node
echo "built native/mpv-embed/mpv_embed.node"
