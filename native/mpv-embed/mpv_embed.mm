// Renders libmpv into an NSView added on top of an Electron window's content view.
// libmpv is dlopen'ed so the add-on loads (and Couch runs) without it installed.
#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#include <locale.h>
#include <map>
#include <vector>
#include <string>
#include <node_api.h>
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
};
static Api api;
static bool apiLoaded = false;
static std::string apiError;

static bool loadApi(const char *explicitPath) {
  if (apiLoaded) return true;
  std::vector<std::string> paths;
  if (explicitPath && *explicitPath) paths.push_back(explicitPath);
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
  if (now - self.lastSample > 0.9) {
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

static std::map<int, MpvView *> views;
// The video sits under the window's web contents so Couch's own UI (a transparent page) draws over it.
static std::map<int, bool> below;
static int nextId = 1;

static napi_value fail(napi_env env, const std::string &msg) {
  napi_throw_error(env, NULL, msg.c_str());
  return NULL;
}
static std::string str(napi_env env, napi_value v) {
  size_t n = 0;
  napi_get_value_string_utf8(env, v, NULL, 0, &n);
  std::string s(n, '\0');
  napi_get_value_string_utf8(env, v, &s[0], n + 1, &n);
  return s;
}

// create(nsViewHandle: Buffer, options: Record<string,string>, libraryPath?: string): number
static napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  std::string lib;
  if (argc > 2) { napi_valuetype t; napi_typeof(env, argv[2], &t); if (t == napi_string) lib = str(env, argv[2]); }
  if (!loadApi(lib.c_str())) return fail(env, apiError);
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
  [parent addSubview:view positioned:NSWindowBelow relativeTo:nil];
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
    NSView *parent = v.superview;
    [parent addSubview:v positioned:(below[id] ? NSWindowBelow : NSWindowAbove) relativeTo:nil];
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
  MpvView *v = views[id];
  if (v) [v.superview addSubview:v positioned:(b ? NSWindowBelow : NSWindowAbove) relativeTo:nil];
  return NULL;
}

// Glass sits between the video and the web contents. Only exists on macOS 26+.
static std::map<int, NSView *> glass; // key: id * 16 + slot
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
  if (g.superview != parent) [parent addSubview:g positioned:NSWindowAbove relativeTo:v];
  CGFloat H = parent.bounds.size.height;
  NSRect r = NSMakeRect(d[0], parent.isFlipped ? d[1] : H - d[1] - d[3], d[2], d[3]);
  g.frame = r;
  [g setValue:@(d[4]) forKey:@"cornerRadius"];
  g.hidden = d[5] < 0.01 || r.size.width < 1 || r.size.height < 1;
  g.alphaValue = d[5];
  [CATransaction commit];
  return NULL;
}

// getColor(id): [r, g, b] (0-255) of the video's average colour, sampled about once a second, or null.
static napi_value GetColor(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id; napi_get_value_int32(env, argv[0], &id);
  MpvView *v = views[id];
  napi_value out;
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
    [(MpvLayer *)v.layer shutdown];
    [v removeFromSuperview];
  }
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    {"create", 0, Create, 0, 0, 0, napi_default, 0},
    {"setVisible", 0, SetVisible, 0, 0, 0, napi_default, 0},
    {"setPlacement", 0, SetPlacement, 0, 0, 0, napi_default, 0},
    {"setGlass", 0, SetGlass, 0, 0, 0, napi_default, 0},
    {"getColor", 0, GetColor, 0, 0, 0, napi_default, 0},
    {"glassSupported", 0, GlassSupported, 0, 0, 0, napi_default, 0},
    {"destroy", 0, Destroy, 0, 0, 0, napi_default, 0}};
  napi_define_properties(env, exports, 7, d);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
