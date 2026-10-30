// The Mac's media keys and Now Playing (MPRemoteCommandCenter, MPNowPlayingInfoCenter), built into the same addon (see media_remote.mm).
#pragma once
#include <node_api.h>

// Adds the mediaRemote* functions to the addon's exports.
void registerMediaRemote(napi_env env, napi_value exports);
// Unregisters the commands and clears Now Playing; on any thread. Safe to call twice.
void disposeMediaRemote();
