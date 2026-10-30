// The WebKit App host (tickets 110, 112): a WKWebView under Chromium's compositor per web App, with its scripts, cookies,
// input and self-test. Built into the same addon as mpv_embed.mm; it shares the window's view order only through
// window_order.h and the N-API helpers in napi_util.h.
#import <objc/message.h>
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#include <map>
#include <vector>
#include <string>
#include <node_api.h>
#include <memory>
#include "napi_util.h"
#include "window_order.h"
#include "input_policy.h"
#include "webkit_host.h"

// ---- WebKit App views (ticket 110): a WKWebView under Chromium's compositor, kept there by the Keeper's app role. ----
// Events reach JS as (kind, a, b): message(name, json), loaded(url), navigated(url), failed(error).
struct WkEvent { std::string kind, a, b; };
static void CallWkEvent(napi_env env, napi_value jsCb, void *, void *data) {
  WkEvent *e = (WkEvent *)data;
  if (env && jsCb) {
    napi_value args[3], undef;
    napi_get_undefined(env, &undef);
    napi_create_string_utf8(env, e->kind.c_str(), NAPI_AUTO_LENGTH, &args[0]);
    napi_create_string_utf8(env, e->a.c_str(), NAPI_AUTO_LENGTH, &args[1]);
    napi_create_string_utf8(env, e->b.c_str(), NAPI_AUTO_LENGTH, &args[2]);
    napi_call_function(env, undef, jsCb, 3, args, NULL);
  }
  delete e;
}
static void CallWkResult(napi_env env, napi_value jsCb, void *, void *data) {
  WkEvent *e = (WkEvent *)data;  // kind = error ("" for none), a = json
  if (env && jsCb) {
    napi_value args[2], undef;
    napi_get_undefined(env, &undef);
    if (e->kind.empty()) napi_get_null(env, &args[0]); else napi_create_string_utf8(env, e->kind.c_str(), NAPI_AUTO_LENGTH, &args[0]);
    napi_create_string_utf8(env, e->a.c_str(), NAPI_AUTO_LENGTH, &args[1]);
    napi_call_function(env, undef, jsCb, 2, args, NULL);
  }
  delete e;
}
static std::string toStd(NSString *s) { return s ? std::string([s UTF8String]) : std::string(); }
// JSON.stringify([value]): any value (a primitive too) round-trips as the first element; unsupported values become null.
static NSString *wkJson(id v) {
  if (!v) v = [NSNull null];
  if (![NSJSONSerialization isValidJSONObject:@[v]]) v = [NSNull null];
  NSData *d = [NSJSONSerialization dataWithJSONObject:@[v] options:0 error:nil];
  return d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"[null]";
}

@class CouchWebKit;
// The input rules (input_policy.h) with this view's side: real keys and mouse events delivered to its WKWebView.
struct WkKeyHost : inputpolicy::KeyHost {
  __unsafe_unretained CouchWebKit *wk;
  explicit WkKeyHost(CouchWebKit *w) : wk(w) {}
  bool post(int id, const inputpolicy::Key &k) override;
  void deliver(const inputpolicy::Key &k) override;
  void log(const char *m) override { NSLog(@"%s", m); }
};
struct WkPointerHost : inputpolicy::PointerHost {
  __unsafe_unretained CouchWebKit *wk;
  NSEvent *event = nil;  // the event being routed
  NSPoint last = NSZeroPoint;
  explicit WkPointerHost(CouchWebKit *w) : wk(w) {}
  void deliver(inputpolicy::Kind kind, int button) override;
  void cancel(int button) override;
};

@interface CouchWebKit : NSObject <WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate> {
 @public
  // Per view, so a press and the keys held belong to the view that took them.
  std::unique_ptr<WkKeyHost> keyHost;
  std::unique_ptr<inputpolicy::KeyHold> keys;
  std::unique_ptr<WkPointerHost> pointerHost;
  std::unique_ptr<inputpolicy::PointerOwner> pointer;
}
@property(nonatomic) WKWebView *web;
@property(nonatomic) napi_threadsafe_function events;
@property(nonatomic) NSWindow *offscreen;
// Every user script in registration order: {slot (or NSNull), src, page}. A slot's script can be replaced, which rebuilds the controller's list.
@property(nonatomic) NSMutableArray<NSDictionary *> *scripts;
- (void)post:(const char *)kind a:(NSString *)a b:(NSString *)b;
- (BOOL)postChecked:(const char *)kind a:(NSString *)a b:(NSString *)b;
@end
@implementation CouchWebKit
- (void)post:(const char *)kind a:(NSString *)a b:(NSString *)b { [self postChecked:kind a:a b:b]; }
// NO when the host could not be reached (no callback, or the queue refused it).
- (BOOL)postChecked:(const char *)kind a:(NSString *)a b:(NSString *)b {
  if (!self.events) return NO;
  WkEvent *e = new WkEvent{kind, toStd(a), toStd(b)};
  if (napi_call_threadsafe_function(self.events, e, napi_tsfn_nonblocking) != napi_ok) { delete e; return NO; }
  return YES;
}
- (void)userContentController:(WKUserContentController *)c didReceiveScriptMessage:(WKScriptMessage *)m {
  // The frame is WebKit's own report of where the message came from; the host drops anything that isn't the App's main frame.
  WKSecurityOrigin *o = m.frameInfo.securityOrigin;
  NSString *origin = o.host.length ? [NSString stringWithFormat:@"%@://%@%@", o.protocol, o.host, o.port ? [NSString stringWithFormat:@":%ld", (long)o.port] : @""] : @"";
  id body = m.body;
  if (!body || ![NSJSONSerialization isValidJSONObject:@[body]]) body = [NSNull null];
  NSDictionary *envelope = @{@"body": body, @"frame": @{@"isMainFrame": @(m.frameInfo.isMainFrame), @"origin": origin}};
  NSData *d = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
  [self post:"message" a:m.name b:d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"{}"];
}
- (void)webView:(WKWebView *)w didFinishNavigation:(WKNavigation *)n { [self post:"loaded" a:w.URL.absoluteString b:nil]; }
- (void)webView:(WKWebView *)w didFailNavigation:(WKNavigation *)n withError:(NSError *)e {
  if (e.code != NSURLErrorCancelled) [self post:"failed" a:e.localizedDescription b:nil];
}
- (void)webView:(WKWebView *)w didFailProvisionalNavigation:(WKNavigation *)n withError:(NSError *)e {
  if (e.code != NSURLErrorCancelled) [self post:"failed" a:e.localizedDescription b:nil];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)w { [self post:"failed" a:@"The page's process stopped" b:nil]; }
- (WKWebView *)webView:(WKWebView *)w createWebViewWithConfiguration:(WKWebViewConfiguration *)c forNavigationAction:(WKNavigationAction *)a windowFeatures:(WKWindowFeatures *)f {
  if (!a.targetFrame) [w loadRequest:a.request];
  return nil;
}
- (void)webView:(WKWebView *)w requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)o initiatedByFrame:(WKFrameInfo *)f type:(WKMediaCaptureType)t decisionHandler:(void (^)(WKPermissionDecision))d {
  d(WKPermissionDecisionDeny);
}
- (void)observeValueForKeyPath:(NSString *)k ofObject:(id)o change:(NSDictionary *)c context:(void *)x {
  if ([k isEqualToString:@"URL"] && self.web.URL) [self post:"navigated" a:self.web.URL.absoluteString b:nil];
}
// Runs once, in `world`. "expression": `(script)` is awaited; "body": the script is a function body. The mode is the caller's
// decision: a script that throws is never run again as something else.
- (void)evaluate:(NSString *)script isBody:(BOOL)isBody world:(WKContentWorld *)world done:(void (^)(NSString *error, NSString *json))done {
  NSString *body = isBody ? script : [NSString stringWithFormat:@"return await (%@\n);", script];
  [self.web callAsyncJavaScript:body arguments:@{} inFrame:nil inContentWorld:world completionHandler:^(id r, NSError *e) {
    if (!e) return done(nil, wkJson(r));
    done(e.userInfo[@"WKJavaScriptExceptionMessage"] ?: e.localizedDescription, @"[null]");
  }];
}
@end

// Couch's own scripts and its message handler live in this world; the page (Netflix's world) can't see them.
static WKContentWorld *couchWorld() { return [WKContentWorld worldWithName:@"couch"]; }
static std::map<int, CouchWebKit *> webkits;
static int nextWebkit = 1;

static bool webkitAvailable() {
  if (@available(macOS 14.0, *)) return NSClassFromString(@"WKWebView") != nil;
  return false;
}
static std::string safariUserAgent() {
  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfFile:@"/Applications/Safari.app/Contents/Info.plist"];
  NSString *v = plist[@"CFBundleShortVersionString"] ?: @"17.0";
  return toStd([NSString stringWithFormat:@"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/%@ Safari/605.1.15", v]);
}
static napi_value makeString(napi_env env, const std::string &s) {
  napi_value out; napi_create_string_utf8(env, s.c_str(), NAPI_AUTO_LENGTH, &out); return out;
}
static napi_threadsafe_function makeTsfn(napi_env env, napi_value cb, const char *name, napi_threadsafe_function_call_js call) {
  napi_threadsafe_function fn = NULL;
  napi_value n; napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &n);
  if (napi_create_threadsafe_function(env, cb, NULL, n, 0, 1, NULL, NULL, NULL, call, &fn) != napi_ok) return NULL;
  napi_unref_threadsafe_function(env, fn);
  return fn;
}
static CouchWebKit *newWebKit(NSString *storeId, NSString *ua) API_AVAILABLE(macos(14.0)) {
  CouchWebKit *wk = [CouchWebKit new];
  WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
  if (storeId.length) cfg.websiteDataStore = [WKWebsiteDataStore dataStoreForIdentifier:[[NSUUID alloc] initWithUUIDString:storeId]];
  else cfg.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
  cfg.preferences.elementFullscreenEnabled = YES;
  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 1280, 720) configuration:cfg];
  if (ua.length) web.customUserAgent = ua;
  web.navigationDelegate = wk;
  web.UIDelegate = wk;
  wk.web = web;
  wk->keyHost = std::make_unique<WkKeyHost>(wk);
  wk->keys = std::make_unique<inputpolicy::KeyHold>(*wk->keyHost);
  wk->pointerHost = std::make_unique<WkPointerHost>(wk);
  wk->pointer = std::make_unique<inputpolicy::PointerOwner>(*wk->pointerHost);
  return wk;
}
static void destroyWebKit(CouchWebKit *wk) {
  if (!wk) return;
  if (wk.events) { napi_release_threadsafe_function(wk.events, napi_tsfn_release); wk.events = NULL; }
  [wk.web removeObserver:wk forKeyPath:@"URL"];
  wk.web.navigationDelegate = nil;
  wk.web.UIDelegate = nil;
  [wk.web.configuration.userContentController removeAllScriptMessageHandlersFromContentWorld:couchWorld()];
  [wk.web stopLoading];
  [wk.web removeFromSuperview];
}

static CouchWebKit *routedWk = nil;
static bool routeKeys = false, routePointer = false;
static id inputMonitor = nil;

static void stopInputMonitor() {
  if (inputMonitor) { [NSEvent removeMonitor:inputMonitor]; inputMonitor = nil; }
}

static void releaseInput(CouchWebKit *wk) {
  if (wk->pointer) wk->pointer->cancel();
  if (wk->keys) wk->keys->clear();
}

void disposeWebKits() {
  routedWk = nil; routeKeys = routePointer = false; stopInputMonitor();
  for (auto &kv : webkits) { releaseInput(kv.second); destroyWebKit(kv.second); }
  webkits.clear();
}

// webkitSupported(): boolean (macOS 14+ for WKWebsiteDataStore(forIdentifier:))
static napi_value WebkitSupported(napi_env env, napi_callback_info) {
  napi_value out; napi_get_boolean(env, webkitAvailable(), &out); return out;
}
static napi_value WebkitUserAgent(napi_env env, napi_callback_info) { return makeString(env, safariUserAgent()); }

// webkitCreate(handle, storeId, userAgent, callback): number. The view starts hidden, under everything else in the window.
static napi_value WebkitCreate(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!webkitAvailable()) return fail(env, "WebKit views need macOS 14");
  NSView *parent = windowParent(env, argv[0]);
  if (!parent) return fail(env, "bad native handle");
  NSString *store = [NSString stringWithUTF8String:str(env, argv[1]).c_str()];
  NSString *ua = [NSString stringWithUTF8String:str(env, argv[2]).c_str()];
  napi_threadsafe_function events = makeTsfn(env, argv[3], "couch-webkit-events", CallWkEvent);
  __block int id = 0;
  onMain(^{
    if (@available(macOS 14.0, *)) {
      CouchWebKit *wk = newWebKit(store, ua);
      wk.events = events;
      wk.web.hidden = YES;
      [wk.web addObserver:wk forKeyPath:@"URL" options:NSKeyValueObservingOptionNew context:NULL];
      id = nextWebkit++;
      webkits[id] = wk;
      wk.web.frame = parent.bounds;
      [parent addSubview:wk.web positioned:NSWindowBelow relativeTo:nil];
      windowOrderAddApp(parent, wk.web);
    }
  });
  napi_value out; napi_create_int32(env, id, &out);
  return out;
}

static CouchWebKit *wkFor(napi_env env, napi_value v) {
  int32_t id = 0; napi_get_value_int32(env, v, &id);
  auto it = webkits.find(id);
  return it == webkits.end() ? nil : it->second;
}

static napi_value WebkitLoad(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:str(env, argv[1]).c_str()]];
  if (wk && url) onMain(^{ [wk.web loadRequest:[NSURLRequest requestWithURL:url]]; });
  return NULL;
}

// webkitEvaluate(id, script, kind "expression"|"body", callback(error|null, json)): in the "couch" world, once.
static napi_value WebkitEvaluate(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSString *script = [NSString stringWithUTF8String:str(env, argv[1]).c_str()];
  BOOL isBody = str(env, argv[2]) == "body";
  napi_threadsafe_function fn = makeTsfn(env, argv[3], "couch-webkit-result", CallWkResult);
  auto reply = ^(NSString *error, NSString *json) {
    napi_call_threadsafe_function(fn, new WkEvent{toStd(error), toStd(json), ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(fn, napi_tsfn_release);
  };
  if (!wk) { reply(@"no such view", @"[null]"); return NULL; }
  onMain(^{ [wk evaluate:script isBody:isBody world:couchWorld() done:reply]; });
  return NULL;
}

// webkitSetCookies(id, json, callback(error|null)): cookies into the view's WKHTTPCookieStore. Values are never logged.
// All or nothing: if any cookie can't be built, none is set and the error is a fixed text that holds no values.
// Optional "sameSite": "lax" or "strict" becomes NSHTTPCookieSameSitePolicy; "none" (or absent) sets no policy, and
// anything else rejects the operation.
static napi_value WebkitSetCookies(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSData *json = [[NSString stringWithUTF8String:str(env, argv[1]).c_str()] dataUsingEncoding:NSUTF8StringEncoding];
  napi_threadsafe_function fn = makeTsfn(env, argv[2], "couch-webkit-cookies", CallWkResult);
  auto reply = ^(NSString *error) {
    napi_call_threadsafe_function(fn, new WkEvent{toStd(error), "[null]", ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(fn, napi_tsfn_release);
  };
  NSArray *list = [NSJSONSerialization JSONObjectWithData:json options:0 error:nil];
  if (!wk || ![list isKindOfClass:[NSArray class]]) { reply(@"no such view or bad cookies"); return NULL; }
  onMain(^{
    NSMutableArray<NSHTTPCookie *> *cookies = [NSMutableArray array];
    for (id item in list) {
      NSHTTPCookie *c = nil;
      if ([item isKindOfClass:[NSDictionary class]]) {
        NSDictionary *d = item;
        id domain = d[@"domain"], name = d[@"name"], path = d[@"path"], value = d[@"value"];
        if ([domain isKindOfClass:[NSString class]] && [domain length] && [name isKindOfClass:[NSString class]] && [name length] && [value isKindOfClass:[NSString class]]) {
          NSMutableDictionary *p = [NSMutableDictionary dictionary];
          p[NSHTTPCookieDomain] = domain;
          p[NSHTTPCookieName] = name;
          p[NSHTTPCookiePath] = [path isKindOfClass:[NSString class]] && [path length] ? path : @"/";
          p[NSHTTPCookieValue] = value;
          if ([d[@"secure"] boolValue]) p[NSHTTPCookieSecure] = @"TRUE";
          if ([d[@"httpOnly"] boolValue]) p[@"HttpOnly"] = @"TRUE";
          if ([d[@"expires"] isKindOfClass:[NSNumber class]]) p[NSHTTPCookieExpires] = [NSDate dateWithTimeIntervalSince1970:[d[@"expires"] doubleValue] / 1000.0];
          id same = d[@"sameSite"];
          BOOL sameOk = YES;
          if (same == nil || same == [NSNull null] || [same isEqual:@"none"]) {}
          else if ([same isEqual:@"lax"]) p[NSHTTPCookieSameSitePolicy] = NSHTTPCookieSameSiteLax;
          else if ([same isEqual:@"strict"]) p[NSHTTPCookieSameSitePolicy] = NSHTTPCookieSameSiteStrict;
          else sameOk = NO;
          if (sameOk) c = [NSHTTPCookie cookieWithProperties:p];
        }
      }
      if (!c) { reply(@"a cookie was rejected"); return; }
      [cookies addObject:c];
    }
    WKHTTPCookieStore *store = wk.web.configuration.websiteDataStore.httpCookieStore;
    if (cookies.count == 0) { reply(nil); return; }
    __block NSUInteger left = cookies.count;
    for (NSHTTPCookie *c in cookies) [store setCookie:c completionHandler:^{ if (--left == 0) reply(nil); }];
  });
  return NULL;
}

// webkitListCookies(id, callback(error|null, json)): what the view's store holds, as
// [{domain,name,path,secure,httpOnly,expires (Unix ms or null),sameSite}]. Never the values. For self-tests.
static napi_value WebkitListCookies(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  napi_threadsafe_function fn = makeTsfn(env, argv[1], "couch-webkit-cookie-list", CallWkResult);
  auto reply = ^(NSString *error, NSString *json) {
    napi_call_threadsafe_function(fn, new WkEvent{toStd(error), toStd(json), ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(fn, napi_tsfn_release);
  };
  if (!wk) { reply(@"no such view", @"[null]"); return NULL; }
  onMain(^{
    [wk.web.configuration.websiteDataStore.httpCookieStore getAllCookies:^(NSArray<NSHTTPCookie *> *all) {
      NSMutableArray *out = [NSMutableArray array];
      for (NSHTTPCookie *c in all) {
        NSString *same = c.sameSitePolicy ?: @"default";
        [out addObject:@{
          @"domain": c.domain, @"name": c.name, @"path": c.path,
          @"secure": @(c.isSecure), @"httpOnly": @(c.isHTTPOnly),
          @"expires": c.expiresDate ? @((long long)([c.expiresDate timeIntervalSince1970] * 1000.0)) : [NSNull null],
          @"sameSite": [same lowercaseString]}];
      }
      NSData *data = [NSJSONSerialization dataWithJSONObject:@[out] options:0 error:nil];
      reply(nil, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
    }];
  });
  return NULL;
}

static void rebuildUserScripts(CouchWebKit *wk) {
  WKUserContentController *ucc = wk.web.configuration.userContentController;
  [ucc removeAllUserScripts];
  for (NSDictionary *s in wk.scripts) {
    WKContentWorld *world = [s[@"page"] boolValue] ? WKContentWorld.pageWorld : couchWorld();
    [ucc addUserScript:[[WKUserScript alloc] initWithSource:s[@"src"] injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO inContentWorld:world]];
  }
}

// webkitAddUserScript(id, source, world), webkitSetUserScript(id, slot, source, world): the second replaces the
// script registered under `slot` (or adds it), so a later navigation's document-start script sees the new source.
static void putUserScript(CouchWebKit *wk, id slot, NSString *src, BOOL page) {
  if (!wk.scripts) wk.scripts = [NSMutableArray array];
  NSDictionary *entry = @{@"slot": slot, @"src": src, @"page": @(page)};
  NSUInteger at = NSNotFound;
  if (slot != NSNull.null) at = [wk.scripts indexOfObjectPassingTest:^BOOL(NSDictionary *d, NSUInteger i, BOOL *stop) { return [d[@"slot"] isEqual:slot]; }];
  if (at == NSNotFound) [wk.scripts addObject:entry]; else wk.scripts[at] = entry;
  rebuildUserScripts(wk);
}

static napi_value WebkitAddUserScript(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSString *src = [NSString stringWithUTF8String:str(env, argv[1]).c_str()];
  BOOL page = str(env, argv[2]) == "page";
  if (wk) onMain(^{ putUserScript(wk, NSNull.null, src, page); });
  return NULL;
}

static napi_value WebkitSetUserScript(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSString *slot = [NSString stringWithUTF8String:str(env, argv[1]).c_str()];
  NSString *src = [NSString stringWithUTF8String:str(env, argv[2]).c_str()];
  BOOL page = str(env, argv[3]) == "page";
  if (wk) onMain(^{ putUserScript(wk, slot, src, page); });
  return NULL;
}

static napi_value WebkitAddMessageHandler(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  NSString *name = [NSString stringWithUTF8String:str(env, argv[1]).c_str()];
  if (wk) onMain(^{
    [wk.web.configuration.userContentController removeScriptMessageHandlerForName:name contentWorld:couchWorld()];
    [wk.web.configuration.userContentController addScriptMessageHandler:wk contentWorld:couchWorld() name:name];
  });
  return NULL;
}

// webkitSetFrame(id, x, y, w, h): window content points, top-left origin.
static napi_value WebkitSetFrame(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  double x, y, w, h;
  napi_get_value_double(env, argv[1], &x); napi_get_value_double(env, argv[2], &y);
  napi_get_value_double(env, argv[3], &w); napi_get_value_double(env, argv[4], &h);
  if (wk) onMain(^{
    NSView *parent = wk.web.superview;
    CGFloat H = parent.bounds.size.height;
    wk.web.frame = NSMakeRect(x, parent.isFlipped ? y : H - y - h, w, h);
  });
  return NULL;
}

static napi_value WebkitSetVisible(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  bool v; napi_get_value_bool(env, argv[1], &v);
  if (wk) onMain(^{
    if (!v) releaseInput(wk);
    wk.web.hidden = !v;
  });
  return NULL;
}

static napi_value WebkitFocus(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  if (wk) onMain(^{ [wk.web.window makeFirstResponder:wk.web]; });
  return NULL;
}

// A real NSEvent keyDown/keyUp, delivered to the WKWebView itself (not the system event queue, so no other app sees it).
static bool sendKeyEvent(WKWebView *web, const std::string &name, bool down) {
  struct K { const char *name; unsigned short code; unichar ch; bool arrow; };
  static const K keys[] = {
    {"Up", 126, NSUpArrowFunctionKey, true}, {"Down", 125, NSDownArrowFunctionKey, true},
    {"Left", 123, NSLeftArrowFunctionKey, true}, {"Right", 124, NSRightArrowFunctionKey, true},
    {"Return", 36, '\r', false}, {"Escape", 53, 0x1b, false}, {"Space", 49, ' ', false}};
  for (const K &k : keys) {
    if (name != k.name) continue;
    NSString *chars = [NSString stringWithCharacters:&k.ch length:1];
    NSEvent *e = [NSEvent keyEventWithType:down ? NSEventTypeKeyDown : NSEventTypeKeyUp location:NSZeroPoint
                             modifierFlags:k.arrow ? (NSEventModifierFlagNumericPad | NSEventModifierFlagFunction) : 0
                                 timestamp:[NSProcessInfo processInfo].systemUptime windowNumber:web.window.windowNumber
                                   context:nil characters:chars charactersIgnoringModifiers:chars isARepeat:NO keyCode:k.code];
    if (down) [web keyDown:e]; else [web keyUp:e];
    return true;
  }
  return false;
}

static napi_value WebkitSendKey(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  std::string key = str(env, argv[1]);
  bool down; napi_get_value_bool(env, argv[2], &down);
  if (wk) onMain(^{ sendKeyEvent(wk.web, key, down); });
  return NULL;
}

// ---- Real input (ticket 112). The WKWebView sits under Chromium's transparent layer, so Chromium would take the mouse, and
// the keys would never reach Chromium's rules while the view is the first responder. One local monitor (before the window
// dispatches an event) takes them. The rules are in input_policy.h: a key the host may want (Couch's own, or any key while Couch
// captures) is held with an id and the host answers consume or replay within a deadline, else the key goes to the page; clicks,
// drags and the wheel over the view are handed to it, and the view that got a press owns it until the release. ----

static double uptime() { return [NSProcessInfo processInfo].systemUptime; }

static NSString *keyJson(int id, const inputpolicy::Key &k) {
  NSDictionary *d = @{@"id": @(id), @"down": @(k.down), @"keyCode": @(k.code),
                      @"characters": [NSString stringWithUTF8String:k.chars.c_str()] ?: @"",
                      @"charactersIgnoringModifiers": [NSString stringWithUTF8String:k.charsIgnoring.c_str()] ?: @"",
                      @"flags": @(k.flags), @"repeat": @(k.repeat)};
  NSData *json = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
  return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}

// A key as the same NSEvent it came in as, delivered to the view (not the system queue, so no other app sees it).
static bool deliverKeyEvent(WKWebView *web, const inputpolicy::Key &k) {
  if (!web.window) return false;
  NSString *chars = [NSString stringWithUTF8String:k.chars.c_str()] ?: @"";
  NSString *ignoring = [NSString stringWithUTF8String:k.charsIgnoring.c_str()] ?: @"";
  NSEvent *e = [NSEvent keyEventWithType:k.down ? NSEventTypeKeyDown : NSEventTypeKeyUp location:NSZeroPoint
                           modifierFlags:(NSEventModifierFlags)k.flags
                               timestamp:uptime() windowNumber:web.window.windowNumber
                                 context:nil characters:chars charactersIgnoringModifiers:ignoring
                               isARepeat:k.repeat keyCode:(unsigned short)k.code];
  if (k.down) [web keyDown:e]; else [web keyUp:e];
  return true;
}

bool WkKeyHost::post(int id, const inputpolicy::Key &k) {
  return [wk postChecked:"key" a:@"" b:keyJson(id, k)];
}
void WkKeyHost::deliver(const inputpolicy::Key &k) { deliverKeyEvent(wk.web, k); }

// WKWebView does not implement mouseMoved:/mouseEntered: (WebKit changeset 290743 moved them to the owner of its own tracking
// area), so calling them does nothing and the page never sees a mousemove. _simulateMouseMove: is the entry WebKit's own
// tests use: it takes the move the same way a tracking-area move arrives, as a trusted event at the event's location.
static void sendMouseMoved(WKWebView *web, NSEvent *e) {
  SEL sim = NSSelectorFromString(@"_simulateMouseMove:");
  if ([web respondsToSelector:sim]) ((void (*)(id, SEL, NSEvent *))objc_msgSend)(web, sim, e);
  else [web mouseMoved:e];
}

void WkPointerHost::deliver(inputpolicy::Kind kind, int button) {
  using inputpolicy::Kind;
  WKWebView *web = wk.web;
  NSEvent *e = event;
  if (!e) return;
  last = e.locationInWindow;
  switch (kind) {
    case Kind::Move: sendMouseMoved(web, e); break;
    case Kind::Wheel: [web scrollWheel:e]; break;
    case Kind::Down:
      [web.window makeFirstResponder:web];
      if (button == 0) [web mouseDown:e]; else if (button == 1) [web rightMouseDown:e]; else [web otherMouseDown:e];
      break;
    case Kind::Drag:
      if (button == 0) [web mouseDragged:e]; else if (button == 1) [web rightMouseDragged:e]; else [web otherMouseDragged:e];
      break;
    case Kind::Up:
      if (button == 0) [web mouseUp:e]; else if (button == 1) [web rightMouseUp:e]; else [web otherMouseUp:e];
      break;
  }
}

// A press the view still holds when it is hidden, destroyed or another view is routed: a release at the last place, so the page never sticks.
void WkPointerHost::cancel(int button) {
  WKWebView *web = wk.web;
  if (!web.window) return;
  NSEventType type = button == 0 ? NSEventTypeLeftMouseUp : button == 1 ? NSEventTypeRightMouseUp : NSEventTypeOtherMouseUp;
  NSEvent *e = [NSEvent mouseEventWithType:type location:last modifierFlags:0 timestamp:uptime()
                              windowNumber:web.window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:0];
  if (button == 0) [web mouseUp:e]; else if (button == 1) [web rightMouseUp:e]; else [web otherMouseUp:e];
}

static void scheduleKeyTick(CouchWebKit *wk) {
  double next = wk->keys->nextDeadline();
  if (next < 0) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((next - uptime() + 0.01) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    wk->keys->tick(uptime());
  });
}

static NSEvent *routeInput(NSEvent *e) {
  CouchWebKit *wk = routedWk;
  WKWebView *web = wk.web;
  NSWindow *window = web.window;
  if (!wk || !window || e.window != window || web.hidden) return e;
  switch (e.type) {
    case NSEventTypeKeyDown:
    case NSEventTypeKeyUp: {
      if (!routeKeys) return e;
      NSResponder *r = window.firstResponder;
      if (![r isKindOfClass:[NSView class]] || ![(NSView *)r isDescendantOf:web]) return e;
      inputpolicy::Key k;
      k.down = e.type == NSEventTypeKeyDown;
      k.code = e.keyCode;
      k.flags = (unsigned)(e.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask);
      k.repeat = k.down && e.isARepeat;
      k.chars = toStd(e.characters);
      k.charsIgnoring = toStd(e.charactersIgnoringModifiers);
      inputpolicy::Verdict v = wk->keys->onKey(k, uptime());
      scheduleKeyTick(wk);
      return v == inputpolicy::Verdict::Swallow ? nil : e;
    }
    case NSEventTypeMouseMoved:
    case NSEventTypeLeftMouseDragged:
    case NSEventTypeRightMouseDragged:
    case NSEventTypeOtherMouseDragged:
    case NSEventTypeLeftMouseDown: case NSEventTypeLeftMouseUp:
    case NSEventTypeRightMouseDown: case NSEventTypeRightMouseUp:
    case NSEventTypeOtherMouseDown: case NSEventTypeOtherMouseUp:
    case NSEventTypeScrollWheel: {
      using inputpolicy::Kind;
      Kind kind = Kind::Wheel; int button = 0;
      switch (e.type) {
        case NSEventTypeMouseMoved: kind = Kind::Move; break;
        case NSEventTypeLeftMouseDown: kind = Kind::Down; break;
        case NSEventTypeRightMouseDown: kind = Kind::Down; button = 1; break;
        case NSEventTypeOtherMouseDown: kind = Kind::Down; button = 2; break;
        case NSEventTypeLeftMouseDragged: kind = Kind::Drag; break;
        case NSEventTypeRightMouseDragged: kind = Kind::Drag; button = 1; break;
        case NSEventTypeOtherMouseDragged: kind = Kind::Drag; button = 2; break;
        case NSEventTypeLeftMouseUp: kind = Kind::Up; break;
        case NSEventTypeRightMouseUp: kind = Kind::Up; button = 1; break;
        case NSEventTypeOtherMouseUp: kind = Kind::Up; button = 2; break;
        default: break;
      }
      // Only over the view itself (not the title bar's buttons).
      bool inside = NSPointInRect([web convertPoint:e.locationInWindow fromView:nil], web.bounds);
      wk->pointerHost->event = e;
      inputpolicy::Route route = wk->pointer->route(kind, button, inside, routePointer);
      wk->pointerHost->event = nil;
      return route == inputpolicy::Route::View ? nil : e;
    }
    default: return e;
  }
}

static void startInputMonitor() {
  if (inputMonitor) return;
  NSEventMask mask = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskScrollWheel | NSEventMaskMouseMoved |
    NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged |
    NSEventMaskRightMouseDown | NSEventMaskRightMouseUp | NSEventMaskRightMouseDragged |
    NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp | NSEventMaskOtherMouseDragged;
  inputMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *e) { return routeInput(e); }];
}

// webkitSetInput(id, keys, holdAll, fieldFocused, pointer): what the view takes off Chromium's layer. All off stops the monitor.
static napi_value WebkitSetInput(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  bool keys, hold, field, pointer;
  napi_get_value_bool(env, argv[1], &keys); napi_get_value_bool(env, argv[2], &hold);
  napi_get_value_bool(env, argv[3], &field); napi_get_value_bool(env, argv[4], &pointer);
  if (!wk) return NULL;
  onMain(^{
    if (!(keys || pointer)) {
      if (routedWk == wk) { releaseInput(wk); routedWk = nil; routeKeys = routePointer = false; stopInputMonitor(); }
      return;
    }
    if (routedWk && routedWk != wk) releaseInput(routedWk);
    inputpolicy::Policy p; p.keys = keys; p.holdAll = hold; p.fieldFocused = field;
    wk->keys->configure(p);
    routedWk = wk; routeKeys = keys; routePointer = pointer;
    startInputMonitor();
  });
  return NULL;
}

// The host's answer for a held key: replay it to the view or consume it.
static napi_value WebkitAnswerKey(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  int32_t keyId; bool replay;
  napi_get_value_int32(env, argv[1], &keyId); napi_get_value_bool(env, argv[2], &replay);
  if (wk) onMain(^{ wk->keys->answer(keyId, replay); });
  return NULL;
}

// A real mouse-moved event at a point of the page (client coordinates, top-left origin), for Couch's own wake of a player's bar.
static napi_value WebkitWakePointer(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  CouchWebKit *wk = wkFor(env, argv[0]);
  double x, y;
  napi_get_value_double(env, argv[1], &x); napi_get_value_double(env, argv[2], &y);
  if (!wk) return NULL;
  onMain(^{
    WKWebView *web = wk.web;
    if (!web.window || web.hidden) return;
    NSPoint p = [web convertPoint:NSMakePoint(x, y) toView:nil];
    NSEvent *e = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:p modifierFlags:0 timestamp:uptime()
                                windowNumber:web.window.windowNumber context:nil eventNumber:0 clickCount:0 pressure:0];
    sendMouseMoved(web, e);
  });
  return NULL;
}

// The selftest's "replay:" step: a key as a dictionary.
static bool replayKeyEvent(WKWebView *web, NSDictionary *d) {
  inputpolicy::Key k;
  k.down = [d[@"down"] boolValue];
  k.code = [d[@"keyCode"] unsignedIntValue];
  k.flags = (unsigned)[d[@"flags"] unsignedLongValue];
  k.repeat = [d[@"repeat"] boolValue];
  k.chars = toStd(d[@"characters"] ?: @"");
  k.charsIgnoring = toStd(d[@"charactersIgnoringModifiers"] ?: @"");
  return deliverKeyEvent(web, k);
}

static napi_value WebkitDestroy(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; napi_get_value_int32(env, argv[0], &id);
  auto it = webkits.find(id);
  if (it == webkits.end()) return NULL;
  CouchWebKit *wk = it->second;
  webkits.erase(it);
  onMain(^{
    releaseInput(wk);
    if (routedWk == wk) { routedWk = nil; routeKeys = routePointer = false; stopInputMonitor(); }
    windowOrderRemoveApp(wk.web);
    destroyWebKit(wk);
  });
  return NULL;
}

// webkitRemoveStore(storeId, callback(error|null)): deletes a persistent data store (not allowed while a view uses it).
static napi_value WebkitRemoveStore(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!webkitAvailable()) return fail(env, "WebKit views need macOS 14");
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:[NSString stringWithUTF8String:str(env, argv[0]).c_str()]];
  napi_threadsafe_function fn = makeTsfn(env, argv[1], "couch-webkit-remove", CallWkResult);
  auto reply = ^(NSString *error) {
    napi_call_threadsafe_function(fn, new WkEvent{toStd(error), "[null]", ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(fn, napi_tsfn_release);
  };
  if (!uuid) { reply(@"bad store identifier"); return NULL; }
  onMain(^{
    if (@available(macOS 14.0, *)) {
      [WKWebsiteDataStore removeDataStoreForIdentifier:uuid completionHandler:^(NSError *e) { reply(e ? e.localizedDescription : nil); }];
    }
  });
  return NULL;
}

// webkitSelfTest(script, keys, callback(error|null, json)): a detached WKWebView in a window that is never shown, on a
// secure origin (https://example.com, no network), with a recorder for key events. Sends `keys` through the same NSEvent
// path as webkitSendKey, then runs `script` (an expression, a promise is awaited). Nothing visible, nothing persistent.
// Selftest only: a detached window that reports itself as the key window.
@interface CouchKeyableWindow : NSWindow
@end
@implementation CouchKeyableWindow
// WebKit only dispatches a hover move (a trusted mousemove) to an active window; a window that is never shown is not key, so say it is.
- (BOOL)isKeyWindow { return YES; }
- (BOOL)canBecomeKeyWindow { return YES; }
@end

// An NSEvent made from a CGEvent has no window (the self-test's window is never ordered in, so the window server has no
// record of it), and WebKit drops a wheel event it cannot place in the view's window. Tell this one event which window and
// point it belongs to, as a real event from the input monitor would.
static const void *kEventWindowKey = &kEventWindowKey;
static const void *kEventPointKey = &kEventPointKey;
static void bindEventToWindow(NSEvent *e, NSWindow *w, NSPoint p) {
  Class c = [e class];
  static NSMutableSet *patched = [NSMutableSet new];
  if (![patched containsObject:c]) {
    [patched addObject:c];
    auto origWindow = (NSWindow *(*)(id, SEL))class_getMethodImplementation(c, @selector(window));
    auto origLoc = (NSPoint (*)(id, SEL))class_getMethodImplementation(c, @selector(locationInWindow));
    class_replaceMethod(c, @selector(window), imp_implementationWithBlock(^NSWindow *(NSEvent *self_) {
      NSWindow *bound = objc_getAssociatedObject(self_, kEventWindowKey);
      return bound ?: origWindow(self_, @selector(window));
    }), "@@:");
    class_replaceMethod(c, @selector(locationInWindow), imp_implementationWithBlock(^NSPoint(NSEvent *self_) {
      NSValue *v = objc_getAssociatedObject(self_, kEventPointKey);
      return v ? v.pointValue : origLoc(self_, @selector(locationInWindow));
    }), "{CGPoint=dd}@:");
  }
  objc_setAssociatedObject(e, kEventWindowKey, w, OBJC_ASSOCIATION_RETAIN);
  objc_setAssociatedObject(e, kEventPointKey, [NSValue valueWithPoint:p], OBJC_ASSOCIATION_RETAIN);
}

static napi_value WebkitSelfTest(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!webkitAvailable()) return fail(env, "WebKit views need macOS 14");
  NSString *script = [NSString stringWithUTF8String:str(env, argv[0]).c_str()];
  std::vector<std::string> keys;
  uint32_t n = 0; napi_get_array_length(env, argv[1], &n);
  for (uint32_t i = 0; i < n; i++) { napi_value k; napi_get_element(env, argv[1], i, &k); keys.push_back(str(env, k)); }
  napi_threadsafe_function fn = makeTsfn(env, argv[2], "couch-webkit-selftest", CallWkResult);
  auto reply = ^(NSString *error, NSString *json) {
    napi_call_threadsafe_function(fn, new WkEvent{toStd(error), toStd(json), ""}, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(fn, napi_tsfn_release);
  };
  onMain(^{
    if (@available(macOS 14.0, *)) {
      CouchWebKit *wk = newWebKit(nil, safariUserAgent().c_str() ? [NSString stringWithUTF8String:safariUserAgent().c_str()] : nil);
      NSWindow *w = [[CouchKeyableWindow alloc] initWithContentRect:NSMakeRect(-20000, -20000, 1280, 720) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
      w.releasedWhenClosed = NO;
      [w.contentView addSubview:wk.web];
      static NSMutableArray *keepAlive = [NSMutableArray new];
      [keepAlive addObject:wk]; [keepAlive addObject:w];
      wk.offscreen = w;
      NSString *html = @"<!doctype html><title>t</title><script>window.__keys=[];addEventListener('keydown',function(e){window.__keys.push(e.type+':'+e.key)});addEventListener('keyup',function(e){window.__keys.push(e.type+':'+e.key)});['mousemove','mousedown','mouseup','click','wheel'].forEach(function(n){addEventListener(n,function(e){window.__keys.push(n+':'+(e.isTrusted?'trusted':'untrusted'));if(n=='mousemove')(window.__moves=window.__moves||[]).push([e.clientX,e.clientY])},true)});</script><body>x</body>";
      wk.events = NULL;
      __block NSString *scriptCopy = script;
      __weak CouchWebKit *weak = wk;
      [wk.web loadHTMLString:html baseURL:[NSURL URLWithString:@"https://example.com/"]];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        CouchWebKit *wk2 = weak;
        if (!wk2) return reply(@"gone", @"[null]");
        [[NSNotificationCenter defaultCenter] postNotificationName:NSWindowDidBecomeKeyNotification object:wk2.offscreen];
        [wk2.offscreen makeFirstResponder:wk2.web];
        for (auto &k : keys) {
          // "replay:<keyCode>:<characters>:<flags>" goes through the same path as a Mac key the host hands to the page.
          if (k.rfind("replay:", 0) == 0) {
            NSArray<NSString *> *p = [[NSString stringWithUTF8String:k.c_str()] componentsSeparatedByString:@":"];
            if (p.count < 4) continue;
            for (NSNumber *down in @[@YES, @NO])
              replayKeyEvent(wk2.web, @{@"down": down, @"keyCode": @([p[1] intValue]), @"characters": p[2], @"charactersIgnoringModifiers": [p[2] lowercaseString], @"flags": @([p[3] longLongValue]), @"repeat": @NO});
            continue;
          }
          // "pointer:<x>:<y>" (a point in the window): a move, a press and a release, then a scroll wheel tick, delivered
          // to the view as the input monitor delivers real ones.
          if (k.rfind("pointer:", 0) == 0) {
            NSArray<NSString *> *p = [[NSString stringWithUTF8String:k.c_str()] componentsSeparatedByString:@":"];
            if (p.count < 3) continue;
            NSPoint at = NSMakePoint([p[1] doubleValue], [p[2] doubleValue]);
            wk2.offscreen.acceptsMouseMovedEvents = YES;
            NSInteger num = wk2.offscreen.windowNumber;
            auto mouse = ^NSEvent *(NSEventType t) { return [NSEvent mouseEventWithType:t location:at modifierFlags:0 timestamp:[NSProcessInfo processInfo].systemUptime windowNumber:num context:nil eventNumber:0 clickCount:1 pressure:1]; };
            sendMouseMoved(wk2.web, mouse(NSEventTypeMouseMoved));
            at.x += 5; at.y += 5;
            sendMouseMoved(wk2.web, mouse(NSEventTypeMouseMoved));
            at.x -= 5; at.y -= 5;
            for (int i = 1; i <= 5; i++) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * i * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
              NSPoint q = NSMakePoint(at.x + 20 * i, at.y + 20 * i);
              sendMouseMoved(wk2.web, [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:q modifierFlags:0 timestamp:[NSProcessInfo processInfo].systemUptime windowNumber:num context:nil eventNumber:0 clickCount:0 pressure:0]);
            });
            [wk2.web mouseDown:mouse(NSEventTypeLeftMouseDown)];
            [wk2.web mouseUp:mouse(NSEventTypeLeftMouseUp)];
            CGEventRef cg = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, -3);
            NSEvent *wheel = [NSEvent eventWithCGEvent:cg];
            CFRelease(cg);
            bindEventToWindow(wheel, wk2.offscreen, at);
            [wk2.web scrollWheel:wheel];
            continue;
          }
          sendKeyEvent(wk2.web, k, true); sendKeyEvent(wk2.web, k, false);
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          [wk2 evaluate:scriptCopy isBody:NO world:WKContentWorld.pageWorld done:reply];
        });
      });
    }
  });
  return NULL;
}

// Adds the webkit* functions to the addon's exports.
void registerWebKit(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    {"webkitSupported", 0, WebkitSupported, 0, 0, 0, napi_default, 0},
    {"webkitUserAgent", 0, WebkitUserAgent, 0, 0, 0, napi_default, 0},
    {"webkitCreate", 0, WebkitCreate, 0, 0, 0, napi_default, 0},
    {"webkitLoad", 0, WebkitLoad, 0, 0, 0, napi_default, 0},
    {"webkitEvaluate", 0, WebkitEvaluate, 0, 0, 0, napi_default, 0},
    {"webkitSetCookies", 0, WebkitSetCookies, 0, 0, 0, napi_default, 0},
    {"webkitListCookies", 0, WebkitListCookies, 0, 0, 0, napi_default, 0},
    {"webkitAddUserScript", 0, WebkitAddUserScript, 0, 0, 0, napi_default, 0},
    {"webkitSetUserScript", 0, WebkitSetUserScript, 0, 0, 0, napi_default, 0},
    {"webkitAddMessageHandler", 0, WebkitAddMessageHandler, 0, 0, 0, napi_default, 0},
    {"webkitSetFrame", 0, WebkitSetFrame, 0, 0, 0, napi_default, 0},
    {"webkitSetVisible", 0, WebkitSetVisible, 0, 0, 0, napi_default, 0},
    {"webkitFocus", 0, WebkitFocus, 0, 0, 0, napi_default, 0},
    {"webkitSendKey", 0, WebkitSendKey, 0, 0, 0, napi_default, 0},
    {"webkitSetInput", 0, WebkitSetInput, 0, 0, 0, napi_default, 0},
    {"webkitAnswerKey", 0, WebkitAnswerKey, 0, 0, 0, napi_default, 0},
    {"webkitWakePointer", 0, WebkitWakePointer, 0, 0, 0, napi_default, 0},
    {"webkitDestroy", 0, WebkitDestroy, 0, 0, 0, napi_default, 0},
    {"webkitRemoveStore", 0, WebkitRemoveStore, 0, 0, 0, napi_default, 0},
    {"webkitSelfTest", 0, WebkitSelfTest, 0, 0, 0, napi_default, 0},
  };
  napi_define_properties(env, exports, sizeof(d) / sizeof(d[0]), d);
}
