#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <MediaPlayer/MediaPlayer.h>
#include <dlfcn.h>
// usage: probe <variant> ; variants: default, shim, prefs
static NSString *shim = @"(function(){var real=navigator.mediaSession;var md=null,st='none',h={};var f={get metadata(){return md},set metadata(v){md=v},get playbackState(){return st},set playbackState(v){st=v},setActionHandler:function(a,fn){h[a]=fn},setPositionState:function(){},setCameraActive:function(){},setMicrophoneActive:function(){}};Object.defineProperty(navigator,'mediaSession',{get:function(){return f},configurable:true});})();";
int main(int argc, char **argv) { @autoreleasepool {
  NSString *variant = argc > 1 ? @(argv[1]) : @"default";
  NSApplication *app = [NSApplication sharedApplication];
  [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
  WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
  cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
  if ([variant hasPrefix:@"shim"]) [cfg.userContentController addUserScript:[[WKUserScript alloc] initWithSource:shim injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO]];
  if ([variant isEqual:@"prefs"]) {
    for (NSString *k in @[@"mediaSessionEnabled", @"mediaSessionCoordinatorEnabled", @"remoteCommandsEnabled"]) {
      @try { [cfg.preferences setValue:@NO forKey:k]; printf("set %s ok\n", k.UTF8String); } @catch (id e) { printf("set %s failed\n", k.UTF8String); }
    }
  }
  if ([variant isEqual:@"control"]) { MPRemoteCommandCenter *r = MPRemoteCommandCenter.sharedCommandCenter; [r.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *e){return MPRemoteCommandHandlerStatusSuccess;}]; MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = @{MPMediaItemPropertyTitle:@"Control"}; MPNowPlayingInfoCenter.defaultCenter.playbackState = MPNowPlayingPlaybackStatePlaying; }
  WKWebView *wv = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,100,100) configuration:cfg];
  NSWindow *win = [[NSWindow alloc] initWithContentRect:NSMakeRect(-5000,-5000,100,100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  win.alphaValue = 0; win.ignoresMouseEvents = YES; win.contentView = wv; if ([variant hasSuffix:@"+front"]) [win orderFrontRegardless]; // never ordered front: no visible window
  NSString *dir = @(argv[2]);
  [wv loadFileURL:[NSURL fileURLWithPath:[dir stringByAppendingString:@"/p.html"]] allowingReadAccessToURL:[NSURL fileURLWithPath:dir]];
  __block NSString *meta = @"?";
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [wv evaluateJavaScript:@"(document.getElementById('a').play(),'started')" completionHandler:^(id r, NSError *e){ printf("play: %s\n", [[r description] UTF8String] ?: e.description.UTF8String); }];
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [wv evaluateJavaScript:@"(navigator.mediaSession.metadata||{}).title||'none'" completionHandler:^(id r, NSError *e){
      [wv evaluateJavaScript:@"document.getElementById('a').paused+' t='+document.getElementById('a').currentTime" completionHandler:^(id q, NSError *e2){ printf("audio paused/time: %s\n", [[q description] UTF8String]); }];
      meta = [r description] ?: @"err";
      MPNowPlayingInfoCenter *c = MPNowPlayingInfoCenter.defaultCenter;
      MPRemoteCommandCenter *rc = MPRemoteCommandCenter.sharedCommandCenter;
      printf("variant=%s pageMetadata=%s inProcessInfo=%s state=%d play/pause/toggle/next/prev enabled=%d%d%d%d%d\n", variant.UTF8String, meta.UTF8String, [[c.nowPlayingInfo description] UTF8String] ?: "nil", (int)c.playbackState, rc.playCommand.enabled, rc.pauseCommand.enabled, rc.togglePlayPauseCommand.enabled, rc.nextTrackCommand.enabled, rc.previousTrackCommand.enabled);
      void *h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
      typedef void (*Get)(dispatch_queue_t, void (^)(CFDictionaryRef));
      Get get = h ? (Get)dlsym(h, "MRMediaRemoteGetNowPlayingInfo") : NULL;
      if (!get) { printf("system now playing: unavailable\n"); exit(0); }
      get(dispatch_get_main_queue(), ^(CFDictionaryRef d){ printf("system now playing: %s\n", d ? [[(__bridge NSDictionary *)d description] UTF8String] : "nil"); exit(0); });
    }];
  });
  [app run];
}}
