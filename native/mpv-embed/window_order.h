// The window's one view order (the Keeper in view_order.h, owned by mpv_embed.mm) as the WebKit host sees it: it can only
// register and release its App views. Where they sit (above the video and its glass, under everything else) is the Keeper's rule.
#pragma once
#import <Cocoa/Cocoa.h>

void windowOrderAddApp(NSView *parent, NSView *view);
void windowOrderRemoveApp(NSView *view);
