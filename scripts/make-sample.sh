#!/bin/sh
# Generates a 20 s H.264/AAC MKV test pattern at .dev/sample.mkv (needs ffmpeg).
set -e
mkdir -p .dev
ffmpeg -v error -y -f lavfi -i testsrc2=size=1280x720:rate=30:duration=20 \
  -f lavfi -i sine=frequency=440:duration=20 \
  -c:v libx264 -g 30 -pix_fmt yuv420p -c:a aac -shortest .dev/sample.mkv
echo "wrote .dev/sample.mkv"
