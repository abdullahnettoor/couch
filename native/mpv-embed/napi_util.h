// N-API and main-thread helpers shared by the addon's translation units (mpv_embed.mm and webkit_host.mm).
#pragma once
#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include <string>

static inline napi_value fail(napi_env env, const std::string &msg) {
  napi_throw_error(env, NULL, msg.c_str());
  return NULL;
}
static inline std::string str(napi_env env, napi_value v) {
  size_t n = 0;
  napi_get_value_string_utf8(env, v, NULL, 0, &n);
  std::string s(n, '\0');
  napi_get_value_string_utf8(env, v, &s[0], n + 1, &n);
  return s;
}
static inline NSView *windowParent(napi_env env, napi_value handle) {
  void *data; size_t len;
  if (napi_get_buffer_info(env, handle, &data, &len) != napi_ok || len < sizeof(void *)) return nil;
  return (__bridge NSView *)(*(void **)data);
}
static inline void onMain(void (^body)(void)) {
  if ([NSThread isMainThread]) body(); else dispatch_sync(dispatch_get_main_queue(), body);
}
