// The Mac's media keys, AirPods and Control Centre controls, through MPRemoteCommandCenter, and Now Playing info through
// MPNowPlayingInfoCenter. Nothing is registered until mediaRemoteStart, and mediaRemoteStop gives the role back. Needs no
// Accessibility permission: it is not an event tap. Only the play, pause, toggle, next and previous commands are enabled.
#import <Cocoa/Cocoa.h>
#import <MediaPlayer/MediaPlayer.h>
#include <node_api.h>
#include <string>
#include <vector>
#include "napi_util.h"
#include <functional>
#include "media_remote.h"
#include "media_policy.h"

struct Press { unsigned generation; std::string name; };

static std::vector<std::pair<MPRemoteCommand *, id>> registered;
// What the registered commands call; the self-test calls it too, so a simulated press takes the same route as a real one.
static std::function<void(const char *)> fireCommand;

static void CallPressJs(napi_env env, napi_value jsCb, void *, void *data);
static mediapolicy::Session &session();

// A press goes through the thread-safe function to JS; when it comes round, Session drops it if Couch has stopped since.
struct TsfnCallback : mediapolicy::Callback {
  napi_threadsafe_function fn = NULL;
  void post(unsigned generation, const std::string &command) override {
    if (fn) napi_call_threadsafe_function(fn, new Press{generation, command}, napi_tsfn_nonblocking);
  }
};
static TsfnCallback tsfnCallback;

struct MacCenter : mediapolicy::Center {
  void registerCommands(std::function<void(const char *)> fire) override {
    fireCommand = fire;
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    struct Entry { MPRemoteCommand *command; const char *name; };
    Entry entries[] = {
      {center.playCommand, "play"}, {center.pauseCommand, "pause"}, {center.togglePlayPauseCommand, "toggle"},
      {center.nextTrackCommand, "next"}, {center.previousTrackCommand, "previous"}};
    for (MPRemoteCommand *c in @[ center.skipForwardCommand, center.skipBackwardCommand, center.seekForwardCommand,
                                   center.seekBackwardCommand, center.changePlaybackPositionCommand ])
      c.enabled = NO;
    for (auto &e : entries) {
      const char *name = e.name;
      id target = [e.command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *) {
        fire(name);
        return MPRemoteCommandHandlerStatusSuccess;
      }];
      e.command.enabled = YES;
      registered.push_back({e.command, target});
    }
  }
  void unregisterCommands() override {
    for (auto &r : registered) {
      [r.first removeTarget:r.second];
      r.first.enabled = NO;
    }
    registered.clear();
    fireCommand = nullptr;
  }
  void clearInfo() override {
    MPNowPlayingInfoCenter *c = MPNowPlayingInfoCenter.defaultCenter;
    c.nowPlayingInfo = nil;
    c.playbackState = MPNowPlayingPlaybackStateStopped;
  }
  void publish(const std::string &t, const std::string &a, double position, double duration, bool paused) override {
    MPNowPlayingInfoCenter *c = MPNowPlayingInfoCenter.defaultCenter;
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[MPMediaItemPropertyTitle] = [NSString stringWithUTF8String:t.c_str()] ?: @"";
    info[MPMediaItemPropertyArtist] = [NSString stringWithUTF8String:a.c_str()] ?: @"";
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
    if (duration > 0) info[MPMediaItemPropertyPlaybackDuration] = @(duration);
    info[MPNowPlayingInfoPropertyPlaybackRate] = @(paused ? 0.0 : 1.0);
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = @1.0;
    c.nowPlayingInfo = info;
    c.playbackState = paused ? MPNowPlayingPlaybackStatePaused : MPNowPlayingPlaybackStatePlaying;
  }
};
static MacCenter macCenter;
static mediapolicy::Session &session() { static mediapolicy::Session s(macCenter); return s; }

static void CallPressJs(napi_env env, napi_value jsCb, void *, void *data) {
  Press *press = (Press *)data;
  if (env && jsCb && session().accept(press->generation)) {
    napi_value arg, undef;
    napi_create_string_utf8(env, press->name.c_str(), NAPI_AUTO_LENGTH, &arg);
    napi_get_undefined(env, &undef);
    napi_call_function(env, undef, jsCb, 1, &arg, NULL);
  }
  delete press;
}

static void stopAll() {
  session().stop();
  if (tsfnCallback.fn) { napi_release_threadsafe_function(tsfnCallback.fn, napi_tsfn_release); tsfnCallback.fn = NULL; }
}

// mediaRemoteStart(onPress: (command: "play" | "pause" | "toggle" | "next" | "previous") => void)
static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_value name; napi_create_string_utf8(env, "couch-media-remote", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function fn = NULL;
  if (napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, CallPressJs, &fn) != napi_ok) return fail(env, "cannot create the media key callback");
  napi_unref_threadsafe_function(env, fn);
  onMain(^{
    stopAll();
    tsfnCallback.fn = fn;
    session().start(tsfnCallback);
  });
  return NULL;
}

// mediaRemoteSetInfo(title, app, position, duration, paused)
static napi_value SetInfo(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 5) return fail(env, "mediaRemoteSetInfo needs five arguments");
  std::string title = str(env, argv[0]), app = str(env, argv[1]);
  double position = 0, duration = 0; bool paused = false;
  napi_get_value_double(env, argv[2], &position);
  napi_get_value_double(env, argv[3], &duration);
  napi_get_value_bool(env, argv[4], &paused);
  onMain(^{ session().setInfo(title, app, position, duration, paused); });
  return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info) {
  onMain(^{ stopAll(); });
  return NULL;
}

// Headless, for scripts/media-remote-selftest.mts. mediaRemoteSelfTest() reports what the command centre holds right now
// (after a real mediaRemoteStart / SetInfo / Stop from JS); mediaRemoteSelfPress(name) takes the route a real press takes:
// the registered command's handler, then Start's thread-safe callback. No window, no input.
static napi_value SelfTest(napi_env env, napi_callback_info) {
  __block NSString *json = nil;
  onMain(^{
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    MPNowPlayingInfoCenter *np = MPNowPlayingInfoCenter.defaultCenter;
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    out[@"registered"] = @(registered.size());
    out[@"enabled"] = @[ @(center.playCommand.enabled), @(center.pauseCommand.enabled), @(center.togglePlayPauseCommand.enabled),
                         @(center.nextTrackCommand.enabled), @(center.previousTrackCommand.enabled) ];
    out[@"othersOff"] = @(!center.skipForwardCommand.enabled && !center.skipBackwardCommand.enabled && !center.seekForwardCommand.enabled && !center.seekBackwardCommand.enabled && !center.changePlaybackPositionCommand.enabled);
    out[@"title"] = np.nowPlayingInfo[MPMediaItemPropertyTitle] ?: [NSNull null];
    out[@"state"] = @((int)np.playbackState);
    json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:out options:0 error:nil] encoding:NSUTF8StringEncoding];
  });
  napi_value result; napi_create_string_utf8(env, json.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}

// mediaRemoteSelfPress(name): true when a handler was registered to take it.
static napi_value SelfPress(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  std::string name = str(env, argv[0]);
  __block bool handled = false;
  onMain(^{
    if (!fireCommand) return;
    handled = true;
    fireCommand(name.c_str());
  });
  napi_value result; napi_get_boolean(env, handled, &result);
  return result;
}

void disposeMediaRemote() { onMain(^{ stopAll(); }); }

void registerMediaRemote(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    {"mediaRemoteStart", 0, Start, 0, 0, 0, napi_default, 0},
    {"mediaRemoteSetInfo", 0, SetInfo, 0, 0, 0, napi_default, 0},
    {"mediaRemoteStop", 0, Stop, 0, 0, 0, napi_default, 0},
    {"mediaRemoteSelfTest", 0, SelfTest, 0, 0, 0, napi_default, 0},
    {"mediaRemoteSelfPress", 0, SelfPress, 0, 0, 0, napi_default, 0},
  };
  napi_define_properties(env, exports, sizeof(d) / sizeof(d[0]), d);
}
