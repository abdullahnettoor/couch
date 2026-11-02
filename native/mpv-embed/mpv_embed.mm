// Renders libmpv into an NSView added on top of an Electron window's content view.
// libmpv is dlopen'ed so the add-on loads (and Couch runs) without it installed.
#import <objc/message.h>
#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#include <locale.h>
#include <map>
#include <vector>
#include <string>
#include <node_api.h>
#include <memory>
#include "view_order.h"
#include "napi_util.h"
#include "window_order.h"
#include "webkit_host.h"
#include "media_remote.h"
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

struct Api {
  mpv_handle *(*create)(void);
  int (*initialize)(mpv_handle *);
  int (*set_option_string)(mpv_handle *, const char *, const char *);
  void (*terminate_destroy)(mpv_handle *);
  const char *(*error_string)(int);
  int (*render_create)(mpv_render_context **, mpv_handle *, mpv_render_param *);
  void (*render_set_cb)(mpv_render_context *, mpv_render_update_fn, void *);
  uint64_t (*render_update)(mpv_render_context *);
  int (*render_render)(mpv_render_context *, mpv_render_param *);
  void (*render_free)(mpv_render_context *);
  int (*command)(mpv_handle *, const char **);
  int (*observe)(mpv_handle *, uint64_t, const char *, mpv_format);
  mpv_event *(*wait_event)(mpv_handle *, double);
  char *(*get_property_string)(mpv_handle *, const char *);
  void (*free_)(void *);
};
static Api api;
static bool apiLoaded = false;
static std::string apiError;

static std::string apiPath;

// `first` are the candidates from JS, in order: COUCH_LIBMPV, then the copy bundled in the app. Homebrew comes last.
static bool loadApi(const std::vector<std::string> &first) {
  if (apiLoaded) return true;
  std::vector<std::string> paths = first;
  paths.push_back("/opt/homebrew/lib/libmpv.2.dylib");
  paths.push_back("/usr/local/lib/libmpv.2.dylib");
  paths.push_back("/opt/homebrew/lib/libmpv.dylib");
  paths.push_back("/usr/local/lib/libmpv.dylib");
  void *h = nullptr;
  for (auto &p : paths) { h = dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL); if (h) break; }
  if (!h) { apiError = "libmpv not found"; return false; }
#define SYM(field, name) if (!(*(void **)&api.field = dlsym(h, name))) { apiError = std::string("missing symbol ") + name; return false; }
  SYM(create, "mpv_create") SYM(initialize, "mpv_initialize")
  SYM(set_option_string, "mpv_set_option_string") SYM(terminate_destroy, "mpv_terminate_destroy")
  SYM(error_string, "mpv_error_string") SYM(render_create, "mpv_render_context_create")
  SYM(render_set_cb, "mpv_render_context_set_update_callback")
  SYM(render_update, "mpv_render_context_update") SYM(render_render, "mpv_render_context_render")
  SYM(render_free, "mpv_render_context_free")
  SYM(command, "mpv_command") SYM(observe, "mpv_observe_property") SYM(wait_event, "mpv_wait_event")
  SYM(get_property_string, "mpv_get_property_string") SYM(free_, "mpv_free")
  Dl_info where;
  if (dladdr((void *)api.create, &where) && where.dli_fname) apiPath = where.dli_fname;
  apiLoaded = true;
  return true;
}

static void *getProc(void *, const char *name) {
  static CFBundleRef gl = CFBundleGetBundleWithIdentifier(CFSTR("com.apple.opengl"));
  CFStringRef s = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingASCII);
  void *p = CFBundleGetFunctionPointerForName(gl, s);
  CFRelease(s);
  return p;
}

@interface MpvLayer : CAOpenGLLayer
@property(nonatomic) mpv_handle *mpv;
@property(nonatomic) mpv_render_context *render;
@property(nonatomic) CGLContextObj cgl;
@property(nonatomic) CFTimeInterval lastSample;
@property(atomic) float r, g, b;
@property(atomic) BOOL hasColor;
// Set by getColor(): only the tinted fallback reads the colour, so only then is the frame sampled.
@property(atomic) BOOL wantsColor;
@end

static void onUpdate(void *ctx) {
  MpvLayer *layer = (__bridge MpvLayer *)ctx;
  dispatch_async(dispatch_get_main_queue(), ^{ [layer setNeedsDisplay]; });
}

@implementation MpvLayer
- (instancetype)init {
  if ((self = [super init])) {
    self.asynchronous = NO;
    self.opaque = YES;
    self.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    self.contentsScale = NSScreen.mainScreen.backingScaleFactor;
  }
  return self;
}
- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask {
  CGLPixelFormatAttribute attrs[] = {kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
    kCGLPFADoubleBuffer, kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers, (CGLPixelFormatAttribute)0};
  CGLPixelFormatObj pf; GLint n;
  CGLChoosePixelFormat(attrs, &pf, &n);
  return pf;
}
- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf {
  CGLContextObj ctx;
  CGLCreateContext(pf, NULL, &ctx);
  self.cgl = ctx;
  GLint one = 1;
  CGLSetParameter(ctx, kCGLCPSwapInterval, &one);
  return ctx;
}
- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf forLayerTime:(CFTimeInterval)t displayTime:(const CVTimeStamp *)ts {
  return self.mpv != NULL;
}
- (void)drawInCGLContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf forLayerTime:(CFTimeInterval)t displayTime:(const CVTimeStamp *)ts {
  CGLSetCurrentContext(ctx);
  if (!self.mpv) return;
  if (!self.render) {
    mpv_opengl_init_params gl = {getProc, NULL};
    int adv = 1;
    mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl},
      {MPV_RENDER_PARAM_ADVANCED_CONTROL, &adv},
      {MPV_RENDER_PARAM_INVALID, NULL}};
    mpv_render_context *rc = NULL;
    int e = api.render_create(&rc, self.mpv, params); if (e < 0) return;
    self.render = rc;
    api.render_set_cb(rc, onUpdate, (__bridge void *)self);
  }
  api.render_update(self.render);
  GLint fbo = 0;
  glGetIntegerv(GL_FRAMEBUFFER_BINDING, &fbo);
  CGSize size = self.bounds.size;
  CGFloat s = self.contentsScale;
  mpv_opengl_fbo f = {(int)fbo, (int)(size.width * s), (int)(size.height * s), 0};
  int flip = 1, block = 0;
  mpv_render_param params[] = {
    {MPV_RENDER_PARAM_OPENGL_FBO, &f}, {MPV_RENDER_PARAM_FLIP_Y, &flip},
    {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block}, {MPV_RENDER_PARAM_INVALID, NULL}};
  api.render_render(self.render, params);
  CFTimeInterval now = CACurrentMediaTime();
  if (self.wantsColor && now - self.lastSample > 0.9) {
    // Average an 8x8 grid of pixels: the video's main colour, for the tinted fallback.
    self.lastSample = now;
    int w = f.w, h = f.h; double sr = 0, sg = 0, sb = 0; int n = 0;
    for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
      GLubyte px[4];
      glReadPixels((w * (2 * i + 1)) / 16, (h * (2 * j + 1)) / 16, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
      sr += px[0]; sg += px[1]; sb += px[2]; n++;
    }
    self.r = sr / n; self.g = sg / n; self.b = sb / n; self.hasColor = YES;
  }
  [super drawInCGLContext:ctx pixelFormat:pf forLayerTime:t displayTime:ts];
}
- (void)shutdown {
  if (self.render) {
    if (self.cgl) CGLSetCurrentContext(self.cgl);
    api.render_set_cb(self.render, NULL, NULL);
    api.render_free(self.render);
    self.render = NULL;
  }
  if (self.mpv) { api.terminate_destroy(self.mpv); self.mpv = NULL; }
}
@end

@interface MpvView : NSView
@end
@implementation MpvView
- (CALayer *)makeBackingLayer { return [MpvLayer new]; }
- (BOOL)wantsUpdateLayer { return YES; }
- (BOOL)acceptsFirstResponder { return NO; }
- (NSView *)hitTest:(NSPoint)p { return nil; }
- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  self.layer.contentsScale = self.window.backingScaleFactor;
}
- (void)setFrameSize:(NSSize)s { [super setFrameSize:s]; [self.layer setNeedsDisplay]; }
@end

// Keeps video < glass < everything else; see view_order.h.
struct NSViewHost : vieworder::Host<NSView *> {
  NSView *parent;
  explicit NSViewHost(NSView *p) : parent(p) {}
  std::vector<NSView *> subviews() const override {
    std::vector<NSView *> out;
    for (NSView *v in parent.subviews) out.push_back(v);
    return out;
  }
  void placeBottom(NSView *v) override { [parent addSubview:v positioned:NSWindowBelow relativeTo:nil]; }
  void placeTop(NSView *v) override { [parent addSubview:v positioned:NSWindowAbove relativeTo:nil]; }
  void placeAbove(NSView *v, NSView *ref) override { [parent addSubview:v positioned:NSWindowAbove relativeTo:ref]; }
  void remove(NSView *v) override { [v removeFromSuperview]; }
  // Chromium's compositor view draws every WebContentsView's pixels (their own layers are empty).
  bool drawsWebContent(NSView *v) const override { return [NSStringFromClass([v class]) isEqualToString:@"ViewsCompositorSuperview"]; }
};

struct PlayerOrder {
  NSViewHost host;
  CFRunLoopObserverRef observer = NULL;
  vieworder::Keeper<NSView *> keeper;
  // AppKit gives no notification when Electron reorders siblings (KVO on `subviews` never fires), so the
  // check runs at the start of every main run loop turn's sleep, before Core Animation commits (order 2000000).
  explicit PlayerOrder(NSView *parent)
      : host(parent), keeper(host, [this](std::function<void()> notify) {
          observer = CFRunLoopObserverCreateWithHandler(kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 0,
                                                        ^(CFRunLoopObserverRef, CFRunLoopActivity) { notify(); });
          CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        }) {}
  ~PlayerOrder() {
    if (observer) { CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes); CFRelease(observer); }
  }
};
// One keeper per window orders the video, the player's glass and the drawer's glass.
static PlayerOrder *winOrder = NULL;
static int videoId = 0;
static PlayerOrder *orderFor(NSView *parent) {
  if (winOrder && winOrder->host.parent != parent) { delete winOrder; winOrder = NULL; }
  if (!winOrder) winOrder = new PlayerOrder(parent);
  return winOrder;
}
// The WebKit host (webkit_host.mm) keeps its App views in order through these two; it never sees the Keeper.
void windowOrderAddApp(NSView *parent, NSView *view) { orderFor(parent)->keeper.addApp(view); }
void windowOrderRemoveApp(NSView *view) {
  if (winOrder) winOrder->keeper.removeApp(view);
}
static NSView *drawerGlass = nil;
static std::map<int, NSView *> glass; // key: id * 16 + slot, glass sits between the video and the web contents

static std::map<int, MpvView *> views;
// The video sits under the window's web contents so Couch's own UI (a transparent page) draws over it.
static std::map<int, bool> below;
static int nextId = 1;


// Accepts one path or an array of paths; anything else is ignored.
static std::vector<std::string> pathList(napi_env env, napi_value v) {
  std::vector<std::string> out;
  bool isArray = false; napi_is_array(env, v, &isArray);
  if (isArray) {
    uint32_t n = 0; napi_get_array_length(env, v, &n);
    for (uint32_t i = 0; i < n; i++) {
      napi_value el; napi_valuetype t;
      napi_get_element(env, v, i, &el); napi_typeof(env, el, &t);
      if (t == napi_string) out.push_back(str(env, el));
    }
  } else {
    napi_valuetype t; napi_typeof(env, v, &t);
    if (t == napi_string) out.push_back(str(env, v));
  }
  return out;
}

// loadLibmpv(libraryPaths?: string | string[]): string  (loads libmpv without a window; returns the file it loaded)
static napi_value LoadLibmpv(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!loadApi(argc > 0 ? pathList(env, argv[0]) : std::vector<std::string>())) return fail(env, apiError);
  napi_value out; napi_create_string_utf8(env, apiPath.c_str(), NAPI_AUTO_LENGTH, &out);
  return out;
}


static std::string jsonQuote(const std::string &s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o + "\"";
}

static std::string prop(mpv_handle *mpv, const std::string &name) {
  char *v = api.get_property_string(mpv, name.c_str());
  std::string s = v ? v : "";
  if (v) api.free_(v);
  return s;
}

// probePlayback(libraryPaths: string | string[], file: string, options: Record<string,string>, timeoutMs: number): string
// Test-only: creates a windowless mpv (the caller passes vo=null, ao=null...), plays `file` to its end and returns
// a JSON report: whether it loaded, the decoders, the tracks, the subtitle lines seen, and how it ended.
static napi_value ProbePlayback(napi_env env, napi_callback_info info) {
  size_t argc = 4; napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 4) return fail(env, "probePlayback(libraryPaths, file, options, timeoutMs)");
  if (!loadApi(pathList(env, argv[0]))) return fail(env, apiError);
  std::string file = str(env, argv[1]);
  double timeoutMs = 0; napi_get_value_double(env, argv[3], &timeoutMs);
  setlocale(LC_NUMERIC, "C");
  mpv_handle *mpv = api.create();
  if (!mpv) return fail(env, "mpv_create failed");
  napi_value keys; napi_get_property_names(env, argv[2], &keys);
  uint32_t n; napi_get_array_length(env, keys, &n);
  for (uint32_t i = 0; i < n; i++) {
    napi_value k, v; napi_get_element(env, keys, i, &k);
    napi_get_property(env, argv[2], k, &v);
    api.set_option_string(mpv, str(env, k).c_str(), str(env, v).c_str());
  }
  int rc = api.initialize(mpv);
  if (rc < 0) { api.terminate_destroy(mpv); return fail(env, std::string("mpv_initialize: ") + api.error_string(rc)); }
  api.observe(mpv, 1, "sub-text", MPV_FORMAT_STRING);
  const char *cmd[] = {"loadfile", file.c_str(), NULL};
  rc = api.command(mpv, cmd);
  bool loaded = false, ended = false;
  int endReason = -1; std::string endError, videoCodec, audioCodec, tracks = "[", subLines = "[";
  CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + timeoutMs / 1000.0;
  while (rc >= 0 && !ended && CFAbsoluteTimeGetCurrent() < deadline) {
    mpv_event *e = api.wait_event(mpv, 0.2);
    if (e->event_id == MPV_EVENT_FILE_LOADED) {
      loaded = true;
      videoCodec = prop(mpv, "video-codec");
      audioCodec = prop(mpv, "audio-codec");
      int count = atoi(prop(mpv, "track-list/count").c_str());
      for (int i = 0; i < count; i++) {
        std::string p = "track-list/" + std::to_string(i) + "/";
        if (i) tracks += ",";
        tracks += "{\"type\":" + jsonQuote(prop(mpv, p + "type")) + ",\"codec\":" + jsonQuote(prop(mpv, p + "codec")) +
                  ",\"selected\":" + (prop(mpv, p + "selected") == "yes" ? "true" : "false") + "}";
      }
    } else if (e->event_id == MPV_EVENT_PROPERTY_CHANGE && e->data) {
      mpv_event_property *pr = (mpv_event_property *)e->data;
      if (pr->format == MPV_FORMAT_STRING && pr->data) {
        const char *t = *(const char **)pr->data;
        if (t && *t) { if (subLines.size() > 1) subLines += ","; subLines += jsonQuote(t); }
      }
    } else if (e->event_id == MPV_EVENT_END_FILE && e->data) {
      mpv_event_end_file *ef = (mpv_event_end_file *)e->data;
      endReason = ef->reason;
      if (ef->error < 0) endError = api.error_string(ef->error);
      ended = true;
    }
  }
  api.terminate_destroy(mpv);
  std::string json = "{\"commandError\":" + std::string(rc < 0 ? jsonQuote(api.error_string(rc)) : "null") +
    ",\"loaded\":" + (loaded ? "true" : "false") + ",\"ended\":" + (ended ? "true" : "false") +
    ",\"endReason\":" + std::to_string(endReason) + ",\"endError\":" + jsonQuote(endError) +
    ",\"videoCodec\":" + jsonQuote(videoCodec) + ",\"audioCodec\":" + jsonQuote(audioCodec) +
    ",\"tracks\":" + tracks + "],\"subtitleLines\":" + subLines + "]}";
  napi_value out; napi_create_string_utf8(env, json.c_str(), NAPI_AUTO_LENGTH, &out);
  return out;
}

// create(nsViewHandle: Buffer, options: Record<string,string>, libraryPaths?: string | string[]): number
static napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (!loadApi(argc > 2 ? pathList(env, argv[2]) : std::vector<std::string>())) return fail(env, apiError);
  void *data; size_t len;
  if (napi_get_buffer_info(env, argv[0], &data, &len) != napi_ok || len < sizeof(void *)) return fail(env, "bad native handle");
  NSView *parent = (__bridge NSView *)(*(void **)data);
  setlocale(LC_NUMERIC, "C");
  mpv_handle *mpv = api.create();
  if (!mpv) return fail(env, "mpv_create failed");
  api.set_option_string(mpv, "vo", "libmpv");
  napi_value keys; napi_get_property_names(env, argv[1], &keys);
  uint32_t n; napi_get_array_length(env, keys, &n);
  for (uint32_t i = 0; i < n; i++) {
    napi_value k, v; napi_get_element(env, keys, i, &k);
    napi_get_property(env, argv[1], k, &v);
    api.set_option_string(mpv, str(env, k).c_str(), str(env, v).c_str());
  }
  int rc = api.initialize(mpv);
  if (rc < 0) { api.terminate_destroy(mpv); return fail(env, std::string("mpv_initialize: ") + api.error_string(rc)); }
  MpvView *view = [[MpvView alloc] initWithFrame:parent.bounds];
  view.wantsLayer = YES;
  view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  view.layer.opacity = 0;
  MpvLayer *layer = (MpvLayer *)view.layer;
  layer.mpv = mpv;
  [layer display];
  int id = nextId++;
  views[id] = view;
  below[id] = true;
  videoId = id;
  orderFor(parent)->keeper.setVideo(view, true);
  napi_value out; napi_create_int32(env, id, &out);
  return out;
}

static napi_value SetVisible(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; bool vis;
  napi_get_value_int32(env, argv[0], &id); napi_get_value_bool(env, argv[1], &vis);
  MpvView *v = views[id];
  if (v) {
    if (winOrder && videoId == id) winOrder->keeper.ensure();
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    v.layer.opacity = vis ? 1 : 0;
    [CATransaction commit];
    [v.layer setNeedsDisplay];
  }
  return NULL;
}

// setPlacement(id, below: boolean): puts the video under (true) or over (false) the window's web contents.
static napi_value SetPlacement(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; bool b;
  napi_get_value_int32(env, argv[0], &id); napi_get_value_bool(env, argv[1], &b);
  below[id] = b;
  if (winOrder && videoId == id) winOrder->keeper.setBelow(b);
  return NULL;
}

// Glass sits between the video and the web contents. Only exists on macOS 26+.
static bool glassAvailable() { return NSClassFromString(@"NSGlassEffectView") != nil; }

static napi_value GlassSupported(napi_env env, napi_callback_info) {
  napi_value out; napi_get_boolean(env, glassAvailable(), &out);
  return out;
}

// setGlass(id, slot, x, y, w, h, radius, alpha): rect in window content coordinates, top-left origin, points. alpha 0 hides.
static napi_value SetGlass(napi_env env, napi_callback_info info) {
  size_t argc = 8; napi_value argv[8];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id, slot; double d[6];
  napi_get_value_int32(env, argv[0], &id);
  napi_get_value_int32(env, argv[1], &slot);
  for (int i = 0; i < 6; i++) napi_get_value_double(env, argv[i + 2], &d[i]);
  int key = id * 16 + slot;
  MpvView *v = views[id];
  if (!v || !glassAvailable()) return NULL;
  NSView *g = glass[key];
  NSView *parent = v.superview;
  if (!g) {
    g = [[NSClassFromString(@"NSGlassEffectView") alloc] init];
    g.wantsLayer = YES;
    glass[key] = g;
  }
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  if (!g.superview && winOrder && videoId == id) winOrder->keeper.addGlass(g);
  CGFloat H = parent.bounds.size.height;
  NSRect r = NSMakeRect(d[0], parent.isFlipped ? d[1] : H - d[1] - d[3], d[2], d[3]);
  g.frame = r;
  [g setValue:@(d[4]) forKey:@"cornerRadius"];
  g.hidden = d[5] < 0.01 || r.size.width < 1 || r.size.height < 1;
  g.alphaValue = d[5];
  [CATransaction commit];
  return NULL;
}

// Bumped by every drawer glass change that must outrun an older animation's completion (and by window disposal).
static int drawerGen = 0;
static void stopDrawerAnimation(NSView *g) {
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) { ctx.duration = 0; g.animator.frame = g.frame; }];
}

// beginDrawerRegistration(handle) / endDrawerRegistration(handle): the drawer's view is never inferred from the stacking
// order. Call begin just before the drawer's WebContentsView is added to the window and end just after: the one new
// subview is the drawer's and is kept as the glass's anchor until it leaves the window (view_order.h).
static napi_value BeginDrawerRegistration(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *parent = windowParent(env, argv[0]);
  if (!parent || !glassAvailable()) return NULL;
  onMain(^{ orderFor(parent)->keeper.beginDrawerRegistration(); });
  return NULL;
}
static napi_value EndDrawerRegistration(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *parent = windowParent(env, argv[0]);
  __block bool ok = false;
  if (parent && glassAvailable()) onMain(^{ ok = orderFor(parent)->keeper.endDrawerRegistration(); });
  napi_value out; napi_get_boolean(env, ok, &out);
  return out;
}

static void removeDrawerGlass() {
  NSView *g = drawerGlass;
  drawerGlass = nil;
  drawerGen++;
  if (winOrder) winOrder->keeper.clearDrawer();
  [g removeFromSuperview];
}

// setDrawerGlass(handle, open, x, y, w, h, radius, ms): the Quick settings drawer's glass, directly under the drawer's
// registered view. Rect in window content points, top-left origin. open=true slides it in from the right edge over `ms`
// (ms=0 puts it at the rectangle at once and shows it); the page calls this only when its own slide has started, with
// the same travel (panel's left edge from the window's right edge to x), duration and easing. open=false slides it out
// and removes it when done (ms=0 removes it at once, the caller's final guarantee). The radius applies on every call.
static napi_value SetDrawerGlass(napi_env env, napi_callback_info info) {
  size_t argc = 8; napi_value argv[8];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView *parent = windowParent(env, argv[0]);
  if (!parent) return fail(env, "bad native handle");
  bool open; napi_get_value_bool(env, argv[1], &open);
  double d[6];
  for (int i = 0; i < 6; i++) napi_get_value_double(env, argv[i + 2], &d[i]);
  if (!glassAvailable()) return NULL;
  std::vector<double> v(d, d + 6);
  onMain(^{
    double seconds = v[5] / 1000.0;
    auto slide = ^(NSView *g, NSRect to, void (^done)(void)) {
      [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
        ctx.duration = seconds;
        ctx.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.16 :1 :0.3 :1];
        g.animator.frame = to;
      } completionHandler:done];
    };
    if (!open) {
      NSView *g = drawerGlass;
      if (!g) return;
      if (v[5] < 1) { removeDrawerGlass(); return; }
      int gen = ++drawerGen;
      slide(g, NSMakeRect(parent.bounds.size.width, g.frame.origin.y, g.frame.size.width, g.frame.size.height), ^{
        if (drawerGen != gen || drawerGlass != g) return; // reopened, hidden or disposed since
        removeDrawerGlass();
      });
      return;
    }
    PlayerOrder *po = orderFor(parent);
    CGFloat H = parent.bounds.size.height, W = parent.bounds.size.width;
    // Wider than the panel by its radius so the glass's right-hand corners fall outside the window.
    NSRect end = NSMakeRect(v[0], parent.isFlipped ? v[1] : H - v[1] - v[3], v[2] + v[4], v[3]);
    bool fresh = !drawerGlass;
    NSView *g = drawerGlass;
    if (fresh) {
      g = [[NSClassFromString(@"NSGlassEffectView") alloc] init];
      g.wantsLayer = YES;
    }
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    [g setValue:@(v[4]) forKey:@"cornerRadius"];
    if (fresh) g.frame = NSMakeRect(W, end.origin.y, end.size.width, end.size.height);
    // Placed only under the registered anchor; without one nothing is shown.
    bool placed = po->keeper.setDrawer(g);
    [CATransaction commit];
    if (!placed) return;
    drawerGlass = g;
    int gen = ++drawerGen;
    g.hidden = NO;
    if (v[5] < 1) { stopDrawerAnimation(g); g.frame = end; return; }
    slide(g, end, ^{ (void)gen; });
  });
  return NULL;
}

// hideDrawerGlass(): hides the glass where it is and stops its slide (a resize during a slide); setDrawerGlass shows it again.
static napi_value HideDrawerGlass(napi_env env, napi_callback_info info) {
  onMain(^{
    drawerGen++;
    if (!drawerGlass) return;
    stopDrawerAnimation(drawerGlass);
    drawerGlass.hidden = YES;
  });
  return NULL;
}

// disposeWindow(): the Screen window is closing. Pending animation completions are invalidated, the drawer's glass and
// the keeper (with its run-loop observer) go, and the globals reset, all on the main thread. Safe to call twice.
static napi_value DisposeWindow(napi_env env, napi_callback_info info) {
  onMain(^{
    drawerGen++;
    if (winOrder) winOrder->keeper.dispose();
    [drawerGlass removeFromSuperview];
    drawerGlass = nil;
    for (auto &kv : glass) [kv.second removeFromSuperview];
    glass.clear();
    disposeWebKits();
    delete winOrder;
    winOrder = NULL;
    videoId = 0;
  });
  return NULL;
}

// getColor(id): [r, g, b] (0-255) of the video's average colour, sampled about once a second, or null.
static napi_value GetColor(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; napi_get_value_int32(env, argv[0], &id);
  MpvView *v = views[id];
  napi_value out;
  if (v) ((MpvLayer *)v.layer).wantsColor = YES;
  if (!v || !((MpvLayer *)v.layer).hasColor) { napi_get_null(env, &out); return out; }
  MpvLayer *l = (MpvLayer *)v.layer;
  napi_create_array_with_length(env, 3, &out);
  float c[3] = {l.r, l.g, l.b};
  for (int i = 0; i < 3; i++) { napi_value n; napi_create_double(env, c[i], &n); napi_set_element(env, out, i, n); }
  return out;
}

static napi_value Destroy(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; napi_get_value_int32(env, argv[0], &id);
  MpvView *v = views[id];
  if (v) {
    views.erase(id);
    for (int k = 0; k < 16; k++) if (glass.count(id * 16 + k)) { [glass[id * 16 + k] removeFromSuperview]; glass.erase(id * 16 + k); }
    if (winOrder && videoId == id) { winOrder->keeper.release(); videoId = 0; }
    [(MpvLayer *)v.layer shutdown];
    [v removeFromSuperview];
  }
  return NULL;
}

// Hides the Mac cursor until the mouse moves (or until shown again), whichever view is under it.
// Only works while Couch is the active app, so showing is idempotent and also happens by itself
// when Couch resigns active. No [NSCursor hide]/[NSCursor unhide] pairs are used, so nothing can
// become unbalanced.
static void ShowCursor() { [NSCursor setHiddenUntilMouseMoves:NO]; }

static napi_value SetCursorHidden(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  bool hidden = false; napi_get_value_bool(env, argv[0], &hidden);
  if (hidden && ![NSApp isActive]) hidden = false;
  [NSCursor setHiddenUntilMouseMoves:hidden];
  return NULL;
}

static napi_threadsafe_function moveTsfn = NULL;
static id moveMonitor = nil;
static id resignObserver = nil;

static void StopMoveWatch() {
  if (moveMonitor) { [NSEvent removeMonitor:moveMonitor]; moveMonitor = nil; }
  if (resignObserver) { [[NSNotificationCenter defaultCenter] removeObserver:resignObserver]; resignObserver = nil; }
  if (moveTsfn) { napi_release_threadsafe_function(moveTsfn, napi_tsfn_release); moveTsfn = NULL; }
}

static void CallMoveJs(napi_env env, napi_value jsCb, void *, void *) {
  if (!env || !jsCb) return;
  napi_value undef; napi_get_undefined(env, &undef);
  napi_call_function(env, undef, jsCb, 0, NULL, NULL);
}

// Every mouse movement over any of Couch's views (mpv, web, cover, renderer) reaches the window.
static napi_value WatchMouseMoves(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  StopMoveWatch();
  napi_value name; napi_create_string_utf8(env, "couch-mouse-moved", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, CallMoveJs, &moveTsfn) != napi_ok) return NULL;
  napi_unref_threadsafe_function(env, moveTsfn);
  napi_threadsafe_function fn = moveTsfn;
  moveMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged)
    handler:^NSEvent *(NSEvent *e) {
      napi_call_threadsafe_function(fn, NULL, napi_tsfn_nonblocking);
      return e;
    }];
  resignObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidResignActiveNotification
    object:nil queue:nil usingBlock:^(NSNotification *) { ShowCursor(); }];
  return NULL;
}

static napi_value UnwatchMouseMoves(napi_env env, napi_callback_info info) {
  StopMoveWatch();
  ShowCursor();
  return NULL;
}



static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    {"create", 0, Create, 0, 0, 0, napi_default, 0},
    {"loadLibmpv", 0, LoadLibmpv, 0, 0, 0, napi_default, 0},
    {"probePlayback", 0, ProbePlayback, 0, 0, 0, napi_default, 0},
    {"setVisible", 0, SetVisible, 0, 0, 0, napi_default, 0},
    {"setPlacement", 0, SetPlacement, 0, 0, 0, napi_default, 0},
    {"setGlass", 0, SetGlass, 0, 0, 0, napi_default, 0},
    {"setDrawerGlass", 0, SetDrawerGlass, 0, 0, 0, napi_default, 0},
    {"beginDrawerRegistration", 0, BeginDrawerRegistration, 0, 0, 0, napi_default, 0},
    {"endDrawerRegistration", 0, EndDrawerRegistration, 0, 0, 0, napi_default, 0},
    {"hideDrawerGlass", 0, HideDrawerGlass, 0, 0, 0, napi_default, 0},
    {"disposeWindow", 0, DisposeWindow, 0, 0, 0, napi_default, 0},
    {"getColor", 0, GetColor, 0, 0, 0, napi_default, 0},
    {"glassSupported", 0, GlassSupported, 0, 0, 0, napi_default, 0},
    {"setCursorHidden", 0, SetCursorHidden, 0, 0, 0, napi_default, 0},
    {"watchMouseMoves", 0, WatchMouseMoves, 0, 0, 0, napi_default, 0},
    {"unwatchMouseMoves", 0, UnwatchMouseMoves, 0, 0, 0, napi_default, 0},
    {"destroy", 0, Destroy, 0, 0, 0, napi_default, 0}};
  napi_define_properties(env, exports, sizeof(d) / sizeof(d[0]), d);
  registerWebKit(env, exports);
  registerMediaRemote(env, exports);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
