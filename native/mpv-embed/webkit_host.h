// The WebKit App host, built into the same addon (see webkit_host.mm).
#pragma once
#include <node_api.h>

// Adds the webkit* functions to the addon's exports.
void registerWebKit(napi_env env, napi_value exports);
// Releases every WebKit view and the input monitor; on the main thread. Safe to call twice.
void disposeWebKits();
