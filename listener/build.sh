#!/bin/sh
# Builds the Couch Listener into out/couch-listener.
set -e
cd "$(dirname "$0")/.."
mkdir -p out
swiftc -O -swift-version 5 listener/*.swift -o out/couch-listener
