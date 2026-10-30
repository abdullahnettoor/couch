// The Mac's media keys, AirPods and Control Centre controls, through MPRemoteCommandCenter, and Now Playing info through
// MPNowPlayingInfoCenter. Nothing is registered until mediaRemoteStart, and mediaRemoteStop gives the role back. Needs no
// Accessibility permission: it is not an event tap. Only the play, pause, toggle, next and previous commands are enabled.
#import <Cocoa/Cocoa.h>
#import <MediaPlayer/MediaPlayer.h>
#include <node_api.h>
#include <string>
#include <vector>
#include "napi_util.h"
#include "media_remote.h"

static napi_threadsafe_function pressTsfn = NULL;
static std::vector<std::pair<MPRemoteCommand *, id>> registered;

static void CallPressJs(napi_env env, napi_value jsCb, void *, void *data) {
  std::string *name = (std::string *)data;
  if (env && jsCb) {
    napi_value arg, undef;
    napi_create_string_utf8(env, name->c_str(), NAPI_AUTO_LENGTH, &arg);
    napi_get_undefined(env, &undef);
    napi_call_function(env, undef, jsCb, 1, &arg, NULL);
  }
  delete name;
}

static void unregisterCommands() {
  for (auto &r : registered) {
    [r.first removeTarget:r.second];
    r.first.enabled = NO;
  }
  registered.clear();
}

static void clearInfo() {
  MPNowPlayingInfoCenter *c = MPNowPlayingInfoCenter.defaultCenter;
  c.nowPlayingInfo = nil;
  c.playbackState = MPNowPlayingPlaybackStateStopped;
}

static void stopAll() {
  unregisterCommands();
  clearInfo();
  if (pressTsfn) { napi_release_threadsafe_function(pressTsfn, napi_tsfn_release); pressTsfn = NULL; }
}

static void registerCommands(void (^fire)(const char *)) {
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

static void publish(NSString *title, NSString *app, double position, double duration, bool paused) {
  MPNowPlayingInfoCenter *c = MPNowPlayingInfoCenter.defaultCenter;
  NSMutableDictionary *info = [NSMutableDictionary dictionary];
  info[MPMediaItemPropertyTitle] = title;
  info[MPMediaItemPropertyArtist] = app;
  info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
  if (duration > 0) info[MPMediaItemPropertyPlaybackDuration] = @(duration);
  info[MPNowPlayingInfoPropertyPlaybackRate] = @(paused ? 0.0 : 1.0);
  info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = @1.0;
  c.nowPlayingInfo = info;
  c.playbackState = paused ? MPNowPlayingPlaybackStatePaused : MPNowPlayingPlaybackStatePlaying;
}

// mediaRemoteStart(onPress: (command: "play" | "pause" | "toggle" | "next" | "previous") => void)
static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  onMain(^{ stopAll(); });
  napi_value name; napi_create_string_utf8(env, "couch-media-remote", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function fn = NULL;
  if (napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL, CallPressJs, &fn) != napi_ok) return fail(env, "cannot create the media key callback");
  napi_unref_threadsafe_function(env, fn);
  pressTsfn = fn;
  onMain(^{
    registerCommands(^(const char *command) {
      if (pressTsfn == fn) napi_call_threadsafe_function(fn, new std::string(command), napi_tsfn_nonblocking);
    });
  });
  return NULL;
}

// mediaRemoteSetInfo(title, app, position, duration, paused)
static napi_value SetInfo(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 5) return fail(env, "mediaRemoteSetInfo needs five arguments");
  NSString *title = [NSString stringWithUTF8String:str(env, argv[0]).c_str()] ?: @"";
  NSString *app = [NSString stringWithUTF8String:str(env, argv[1]).c_str()] ?: @"";
  double position = 0, duration = 0; bool paused = false;
  napi_get_value_double(env, argv[2], &position);
  napi_get_value_double(env, argv[3], &duration);
  napi_get_value_bool(env, argv[4], &paused);
  onMain(^{ if (!registered.empty()) publish(title, app, position, duration, paused); });
  return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info) {
  onMain(^{ stopAll(); });
  return NULL;
}

// Headless: registers, checks what the command centre now holds, publishes, checks, stops, checks. No window, no input.
static napi_value SelfTest(napi_env env, napi_callback_info) {
  __block NSString *json = nil;
  onMain(^{
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    MPNowPlayingInfoCenter *np = MPNowPlayingInfoCenter.defaultCenter;
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    stopAll();
    out[@"idleInfo"] = @(np.nowPlayingInfo != nil);
    registerCommands(^(const char *) {});
    out[@"registered"] = @(registered.size());
    out[@"enabled"] = @[ @(center.playCommand.enabled), @(center.pauseCommand.enabled), @(center.togglePlayPauseCommand.enabled),
                         @(center.nextTrackCommand.enabled), @(center.previousTrackCommand.enabled) ];
    out[@"othersOff"] = @(!center.skipForwardCommand.enabled && !center.skipBackwardCommand.enabled && !center.seekForwardCommand.enabled && !center.seekBackwardCommand.enabled && !center.changePlaybackPositionCommand.enabled);
    publish(@"Self test", @"Couch", 12, 60, false);
    out[@"title"] = np.nowPlayingInfo[MPMediaItemPropertyTitle] ?: [NSNull null];
    out[@"state"] = @((int)np.playbackState);
    stopAll();
    out[@"enabledAfter"] = @(center.playCommand.enabled || center.pauseCommand.enabled || center.togglePlayPauseCommand.enabled || center.nextTrackCommand.enabled || center.previousTrackCommand.enabled);
    out[@"infoAfter"] = @(np.nowPlayingInfo != nil);
    out[@"stateAfter"] = @((int)np.playbackState);
    json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:out options:0 error:nil] encoding:NSUTF8StringEncoding];
  });
  napi_value result; napi_create_string_utf8(env, json.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}

void disposeMediaRemote() { onMain(^{ stopAll(); }); }

void registerMediaRemote(napi_env env, napi_value exports) {
  napi_property_descriptor d[] = {
    {"mediaRemoteStart", 0, Start, 0, 0, 0, napi_default, 0},
    {"mediaRemoteSetInfo", 0, SetInfo, 0, 0, 0, napi_default, 0},
    {"mediaRemoteStop", 0, Stop, 0, 0, 0, napi_default, 0},
    {"mediaRemoteSelfTest", 0, SelfTest, 0, 0, 0, napi_default, 0},
  };
  napi_define_properties(env, exports, sizeof(d) / sizeof(d[0]), d);
}
