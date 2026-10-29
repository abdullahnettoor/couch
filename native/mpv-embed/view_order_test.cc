// Compiled and run by src/main/mpv/view-order.test.ts. Plain asserts: prints "ok" or fails with the line.
#include <cstdio>
#include <cstdlib>
#include <string>
#include "view_order.h"

#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); std::exit(1); } } while (0)

// A window whose Electron side can reorder and add views at will; every mutation notifies like KVO does.
struct FakeWindow : vieworder::Host<std::string> {
  std::vector<std::string> stack;
  std::function<void()> notify;
  // The real Electron window (ticket 104): every web view's pixels are drawn by the one compositor view.
  bool compositorDraws = false;
  bool drawsWebContent(std::string v) const override { return compositorDraws && v == "compositor"; }
  std::vector<std::string> subviews() const override { return stack; }
  void erase(const std::string &v) { stack.erase(std::find(stack.begin(), stack.end(), v)); }
  void placeBottom(std::string v) override { if (has(v)) erase(v); stack.insert(stack.begin(), v); changed(); }
  void placeTop(std::string v) override { if (has(v)) erase(v); stack.push_back(v); changed(); }
  void placeAbove(std::string v, std::string ref) override {
    if (has(v)) erase(v);
    stack.insert(std::find(stack.begin(), stack.end(), ref) + 1, v);
    changed();
  }
  void remove(std::string v) override { if (has(v)) erase(v); changed(); }
  bool has(const std::string &v) const { return std::find(stack.begin(), stack.end(), v) != stack.end(); }
  void changed() { if (notify) notify(); }
  // What Electron does: its own views come and go, and the video can end up above them.
  void electronAdds(const std::string &v) { stack.push_back(v); changed(); }
  void electronRaises(const std::string &v) { erase(v); stack.push_back(v); changed(); }
  int at(const std::string &v) const { return int(std::find(stack.begin(), stack.end(), v) - stack.begin()); }
  bool videoGlassWeb(const std::vector<std::string> &glass) const {
    int prev = at("video");
    for (auto &g : glass) { if (!(has(g) && at(g) > prev)) return false; prev = at(g); }
    for (auto &w : stack) if (w.rfind("web", 0) == 0 && at(w) < prev) return false;
    return true;
  }
};

int main() {
  FakeWindow w;
  w.stack = {"compositor", "web:renderer"};
  vieworder::Keeper<std::string> keeper(w, [&](std::function<void()> n) { w.notify = n; });
  std::vector<std::string> glass = {"glass0", "glass1"};

  keeper.setVideo("video", true);
  for (auto &g : glass) keeper.addGlass(g);
  CHECK(w.videoGlassWeb(glass));

  // Electron adds the App views after the video exists, and the video lands above the renderer.
  w.electronAdds("web:youtube");
  w.electronRaises("video");
  CHECK(w.videoGlassWeb(glass));

  // The first open: glass created while the video was above, then visibility toggles with unchanged rects.
  keeper.setVideo("video", true);
  keeper.ensure();
  CHECK(w.videoGlassWeb(glass));

  // Resize: the host only changes frames; a spurious notification must not disturb a correct stack.
  auto before = w.stack;
  w.changed();
  CHECK(w.stack == before);

  // Picture-off's cover is a new web view added last.
  w.electronAdds("web:cover");
  CHECK(w.videoGlassWeb(glass));
  CHECK(w.at("web:cover") == int(w.stack.size()) - 1);

  // The glass itself pushed above by Electron is repaired too.
  w.electronRaises("glass0");
  CHECK(w.videoGlassWeb(glass));

  // Other views keep their relative order.
  CHECK(w.at("compositor") < w.at("web:renderer") && w.at("web:renderer") < w.at("web:youtube") &&
        w.at("web:youtube") < w.at("web:cover"));

  // Above placement: video and glass on top, still in video < glass order.
  keeper.setBelow(false);
  CHECK(w.stack[w.stack.size() - 3] == "video" && w.stack[w.stack.size() - 2] == "glass0" && w.stack.back() == "glass1");
  keeper.setBelow(true);
  CHECK(w.videoGlassWeb(glass));

  // After release nothing is touched.
  keeper.release();
  w.electronRaises("video");
  CHECK(w.stack.back() == "video");

  // ---- The drawer's glass: a separate role, directly under the drawer's own view. ----
  FakeWindow d;
  d.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> dk(d, [&](std::function<void()> n) { d.notify = n; });
  // The explicit registration TS drives: snapshot, the drawer's view is added, then the one new view is the drawer's.
  auto openDrawer = [&](FakeWindow &win, vieworder::Keeper<std::string> &k, const std::string &g, const std::string &view) {
    k.beginDrawerRegistration();
    win.electronAdds(view);
    CHECK(k.endDrawerRegistration());
    CHECK(k.setDrawer(g));
  };
  auto directlyUnder = [&](FakeWindow &win, const std::string &g, const std::string &a) {
    return win.has(g) && win.has(a) && win.at(g) == win.at(a) - 1;
  };

  // Opening over a web App: the drawer's view is added last, then the glass goes right under it.
  openDrawer(d, dk, "dglass", "web:drawer");
  CHECK(directlyUnder(d, "dglass", "web:drawer"));
  CHECK(d.at("web:youtube") < d.at("dglass") && d.at("web:renderer") < d.at("dglass"));
  CHECK(d.stack.back() == "web:drawer");

  // A new web view added while it's open lands on top; the drawer is lifted back (as TopView does) and the glass follows.
  d.electronAdds("web:netflix");
  CHECK(d.at("dglass") < d.at("web:netflix"));  // the glass never moves past a view that isn't the drawer
  d.electronRaises("web:drawer");
  CHECK(directlyUnder(d, "dglass", "web:drawer"));
  CHECK(d.at("web:netflix") < d.at("dglass"));

  // Picture off's cover is underneath the drawer: glass stays above it.
  d.electronAdds("web:cover");
  d.electronRaises("web:drawer");
  CHECK(directlyUnder(d, "dglass", "web:drawer"));
  CHECK(d.at("web:cover") < d.at("dglass"));

  // The glass itself pushed to the top by Electron is repaired.
  d.electronRaises("dglass");
  CHECK(directlyUnder(d, "dglass", "web:drawer"));

  // Closing: the glass is removed and nothing is left; closing twice (mid-animation) is harmless.
  dk.clearDrawer();
  CHECK(!d.has("dglass"));
  dk.clearDrawer();
  d.electronAdds("web:other");
  CHECK(!d.has("dglass"));

  // The drawer's view leaves first (removed mid-slide): the glass goes with it on the next check.
  openDrawer(d, dk, "dglass2", "web:drawer2");
  CHECK(directlyUnder(d, "dglass2", "web:drawer2"));
  d.erase("web:drawer2");
  d.changed();
  CHECK(!d.has("dglass2"));

  // Reopening after that works.
  openDrawer(d, dk, "dglass3", "web:drawer3");
  CHECK(directlyUnder(d, "dglass3", "web:drawer3"));
  dk.clearDrawer();

  // Together with the player: video < glass < everything, drawer glass under the drawer's view, above the cover.
  FakeWindow p;
  p.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> pk(p, [&](std::function<void()> n) { p.notify = n; });
  pk.setVideo("video", true);
  pk.addGlass("glass0");
  p.electronAdds("web:cover");
  openDrawer(p, pk, "dglass", "web:drawer");
  CHECK(p.videoGlassWeb({"glass0"}));
  CHECK(directlyUnder(p, "dglass", "web:drawer"));
  CHECK(p.at("web:cover") < p.at("dglass"));
  p.electronRaises("video");
  CHECK(p.videoGlassWeb({"glass0"}));
  CHECK(directlyUnder(p, "dglass", "web:drawer"));
  // The player ends while the drawer is open: the drawer's glass stays.
  pk.release();
  CHECK(directlyUnder(p, "dglass", "web:drawer"));
  p.electronAdds("web:x");
  p.electronRaises("web:drawer");
  CHECK(directlyUnder(p, "dglass", "web:drawer"));
  pk.clearDrawer();
  CHECK(!p.has("dglass"));

  // ---- Anchor identity: registered once, never inferred from the stacking order. ----
  FakeWindow a;
  a.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> ak(a, [&](std::function<void()> n) { a.notify = n; });
  openDrawer(a, ak, "dglass", "web:drawer");
  // Another sibling lands above the drawer later (and is not lifted back): the glass stays under the drawer.
  a.electronAdds("web:late");
  CHECK(a.at("dglass") == a.at("web:drawer") - 1);
  CHECK(a.at("web:late") > a.at("web:drawer"));
  // A geometry update (resize) calls setDrawer again: it still resolves to the drawer, not the topmost view.
  CHECK(ak.setDrawer("dglass"));
  CHECK(a.at("dglass") == a.at("web:drawer") - 1);
  a.electronAdds("web:later");
  a.electronRaises("dglass");
  CHECK(a.at("dglass") == a.at("web:drawer") - 1);
  ak.clearDrawer();

  // Registration is ambiguous when two views appear in between: no anchor, no glass.
  FakeWindow amb;
  amb.stack = {"compositor", "web:renderer"};
  vieworder::Keeper<std::string> bk(amb, [&](std::function<void()> n) { amb.notify = n; });
  bk.beginDrawerRegistration();
  amb.electronAdds("web:drawer");
  amb.electronAdds("web:intruder");
  CHECK(!bk.endDrawerRegistration());
  CHECK(!bk.setDrawer("dglass"));
  CHECK(!amb.has("dglass"));
  // No anchor registered at all: nothing is placed.
  vieworder::Keeper<std::string> nk(amb, [&](std::function<void()> n) { amb.notify = n; });
  CHECK(!nk.setDrawer("dglass"));

  // The same view lifted back (nothing new): the registered anchor is kept.
  FakeWindow lift;
  lift.stack = {"compositor", "web:renderer"};
  vieworder::Keeper<std::string> lk(lift, [&](std::function<void()> n) { lift.notify = n; });
  openDrawer(lift, lk, "dglass", "web:drawer");
  lk.beginDrawerRegistration();
  lift.electronRaises("web:drawer");
  CHECK(!lk.endDrawerRegistration());
  CHECK(lk.setDrawer("dglass"));
  CHECK(lift.at("dglass") == lift.at("web:drawer") - 1);

  // The anchor leaving forgets it: a stale anchor can't be reused.
  lift.erase("web:drawer");
  lift.changed();
  CHECK(!lift.has("dglass"));
  CHECK(!lk.setDrawer("dglass"));

  // ---- Destroying the player vs disposing the window. ----
  FakeWindow pl;
  pl.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> plk(pl, [&](std::function<void()> n) { pl.notify = n; });
  plk.setVideo("video", true);
  plk.addGlass("glass0");
  openDrawer(pl, plk, "dglass", "web:drawer");
  // Destroy the player (as Destroy does: its glass leaves, the keeper releases) with the drawer open.
  pl.remove("glass0");
  plk.release();
  pl.remove("video");
  pl.electronAdds("web:later");
  CHECK(pl.at("dglass") == pl.at("web:drawer") - 1);
  CHECK(plk.setDrawer("dglass"));
  CHECK(pl.at("dglass") == pl.at("web:drawer") - 1);
  // Disposing the window: the drawer's glass leaves the host, and nothing is placed afterwards.
  plk.dispose();
  CHECK(!pl.has("dglass"));
  auto afterDispose = pl.stack;
  pl.electronRaises("web:youtube");
  CHECK(pl.stack.back() == "web:youtube" && pl.stack.size() == afterDispose.size());
  CHECK(!plk.setDrawer("dglass"));
  CHECK(!pl.has("dglass"));
  plk.dispose();  // twice is harmless

  // Disposing also releases the video's role: a later Electron reorder isn't repaired.
  FakeWindow dv;
  dv.stack = {"compositor", "web:renderer"};
  vieworder::Keeper<std::string> dvk(dv, [&](std::function<void()> n) { dv.notify = n; });
  dvk.setVideo("video", true);
  dvk.addGlass("glass0");
  dvk.dispose();
  dv.electronRaises("video");
  CHECK(dv.stack.back() == "video");

  // ---- Ticket 104: the real tree. Logged on a real Mac with the drawer open over Home: ----
  //   [0] MpvView  [1] ViewsCompositorSuperview (layer-hosted; draws the renderer, the Apps AND the drawer's page)
  //   [2] WebContentsViewCocoa renderer  [3],[4] hidden App views  [5] NSGlassEffectView  [6] WebContentsViewCocoa drawer
  // The web views' own layers are empty; their pixels come from [1]. A glass "directly under the drawer" (above [1])
  // is therefore drawn over the drawer's rows. No place above the compositor is under the drawer's pixels, and
  // below it the glass is behind every opaque web page, so the keeper must refuse rather than blur the rows.
  FakeWindow real;
  real.compositorDraws = true;
  real.stack = {"video", "compositor", "web:renderer", "web:youtube", "web:netflix"};
  vieworder::Keeper<std::string> rk(real, [&](std::function<void()> n) { real.notify = n; });
  rk.setVideo("video", true);
  rk.beginDrawerRegistration();
  real.electronAdds("web:drawer");
  CHECK(rk.endDrawerRegistration());
  CHECK(!rk.setDrawer("dglass"));
  CHECK(!real.has("dglass"));
  real.electronAdds("web:later");
  rk.ensure();
  CHECK(!real.has("dglass"));
  rk.clearDrawer();

  // ---- Ticket 110: a WebKit App view. Role order: video < glass < WebKit app view < everything else (the compositor). ----
  auto appOver = [&](FakeWindow &win, const std::vector<std::string> &glass) {
    int prev = win.at("video");
    for (auto &g : glass) { if (!(win.has(g) && win.at(g) > prev)) return false; prev = win.at(g); }
    if (!(win.has("webkit") && win.at("webkit") > prev)) return false;
    for (auto &w : win.stack) if (w != "video" && w != "webkit" && w.rfind("glass", 0) != 0 && win.at(w) < win.at("webkit")) return false;
    return true;
  };
  FakeWindow wk;
  wk.compositorDraws = true;
  wk.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> wkk(wk, [&](std::function<void()> n) { wk.notify = n; });
  // With no video at all, the WebKit view goes to the very bottom, under the compositor that draws Couch's screen.
  wkk.addApp("webkit");
  CHECK(wk.at("webkit") == 0 && wk.at("compositor") == 1);
  // Electron adds views and raises the WebKit view: it is put back under all of them.
  wk.electronAdds("web:cover");
  wk.electronRaises("webkit");
  CHECK(wk.at("webkit") == 0);
  // Other views keep their order.
  CHECK(wk.at("compositor") < wk.at("web:renderer") && wk.at("web:renderer") < wk.at("web:youtube") &&
        wk.at("web:youtube") < wk.at("web:cover"));
  // The video arrives later: video < glass < webkit < the rest.
  wkk.setVideo("video", true);
  wkk.addGlass("glass0");
  wkk.addGlass("glass1");
  CHECK(appOver(wk, {"glass0", "glass1"}));
  wk.electronRaises("video");
  CHECK(appOver(wk, {"glass0", "glass1"}));
  wk.electronRaises("webkit");
  CHECK(appOver(wk, {"glass0", "glass1"}));
  wk.electronRaises("glass0");
  CHECK(appOver(wk, {"glass0", "glass1"}));
  CHECK(wk.at("compositor") > wk.at("webkit"));
  // A spurious notification leaves a correct stack alone.
  auto wkBefore = wk.stack;
  wk.changed();
  CHECK(wk.stack == wkBefore);
  // The drawer's glass stays refused over the compositor even with a WebKit view (ticket 104).
  wkk.beginDrawerRegistration();
  wk.electronAdds("web:drawer");
  CHECK(wkk.endDrawerRegistration());
  CHECK(!wkk.setDrawer("dglass"));
  CHECK(!wk.has("dglass"));
  CHECK(appOver(wk, {"glass0", "glass1"}));
  // The video's role ends: the WebKit view stays at the bottom.
  wk.remove("glass0"); wk.remove("glass1");
  wkk.release();
  wk.remove("video");
  wk.electronRaises("webkit");
  CHECK(wk.at("webkit") == 0);
  // The video above the web contents (Library player placement) never lifts the WebKit view above anything.
  wkk.setVideo("video", false);
  CHECK(wk.stack.back() == "video" && wk.at("webkit") == 0);
  wkk.release();
  // Removing the role stops it being kept; disposing too.
  wkk.removeApp("webkit");
  wk.electronRaises("webkit");
  CHECK(wk.stack.back() == "webkit");
  wkk.addApp("webkit");
  CHECK(wk.at("webkit") == 0);
  wkk.dispose();
  wk.electronRaises("webkit");
  CHECK(wk.stack.back() == "webkit");


  // ---- Ticket 111: Couch's screen over a WebKit App. The stack is video < glass < webkit < compositor < renderer < covers < drawer. ----
  auto layered = [&](FakeWindow &win, const std::vector<std::string> &want) {
    int prev = -1;
    for (auto &v : want) { if (!win.has(v) || win.at(v) < prev) return false; prev = win.at(v); }
    return true;
  };
  FakeWindow lay;
  lay.compositorDraws = true;
  lay.stack = {"compositor", "web:renderer", "web:youtube"};
  vieworder::Keeper<std::string> lk2(lay, [&](std::function<void()> n) { lay.notify = n; });
  lk2.addApp("webkit");
  // A new WebContentsView (the Picture off cover, a later App) lands above everything and the WebKit view stays at the bottom.
  lay.electronAdds("web:cover");
  CHECK(lay.at("webkit") == 0 && lay.at("web:cover") == lay.stack.size() - 1);
  // Picture off over a playing WebKit App: the cover comes and goes, is lifted back to the top, and never touches the WebKit view.
  for (int i = 0; i < 3; i++) {
    lay.erase("web:cover"); lay.changed();
    CHECK(lay.at("webkit") == 0);
    lay.electronAdds("web:cover");
    lay.electronRaises("web:youtube");
    lay.electronRaises("web:cover");
    CHECK(lay.at("webkit") == 0 && lay.at("compositor") == 1);
  }
  // The drawer opens over the cover and the WebKit App: its view is the anchor; the glass is refused over the compositor,
  // and the WebKit view is not moved by any of it.
  lk2.beginDrawerRegistration();
  lay.electronAdds("web:drawer");
  CHECK(lk2.endDrawerRegistration());
  CHECK(!lk2.setDrawer("dglass"));
  CHECK(!lay.has("dglass") && lay.at("webkit") == 0);
  // Resize: the host only changes frames, so there is no stack change; a spurious notify is harmless.
  auto layBefore = lay.stack;
  lay.changed();
  CHECK(lay.stack == layBefore);
  // Full screen: AppKit re-parents the window's views in its own order, with the WebKit view and compositor swapped around.
  lay.stack = {"web:youtube", "compositor", "web:renderer", "webkit", "web:cover", "web:drawer"};
  lay.changed();
  CHECK(lay.at("webkit") == 0);
  CHECK(layered(lay, {"webkit", "web:youtube", "compositor", "web:renderer", "web:cover", "web:drawer"}));
  lay.stack = {"web:drawer", "web:cover", "web:renderer", "compositor", "web:youtube", "webkit"};
  lay.changed();
  CHECK(lay.at("webkit") == 0 && lay.stack.size() == 6);
  lk2.clearDrawer();
  // Leaving full screen again, with a second WebKit App view: both stay under the compositor, in the order they were added.
  lk2.addApp("webkit2");
  lay.electronRaises("webkit");
  lay.electronRaises("webkit2");
  CHECK(lay.at("webkit") == 0 && lay.at("webkit2") == 1 && lay.at("webkit2") < lay.at("compositor"));
  lk2.removeApp("webkit2");
  lay.erase("webkit2"); lay.changed();
  CHECK(lay.at("webkit") == 0);

  // The whole stack at once: a playing Library video with its glass, the WebKit view, the compositor, the cover and the drawer
  // (with a host where the drawer's glass can sit, as the fake does by default).
  FakeWindow all;
  all.stack = {"compositor", "web:renderer"};
  vieworder::Keeper<std::string> ak2(all, [&](std::function<void()> n) { all.notify = n; });
  ak2.setVideo("video", true);
  ak2.addGlass("glass0");
  ak2.addApp("webkit");
  all.electronAdds("web:cover");
  ak2.beginDrawerRegistration();
  all.electronAdds("web:drawer");
  CHECK(ak2.endDrawerRegistration());
  CHECK(ak2.setDrawer("dglass"));
  CHECK(layered(all, {"video", "glass0", "webkit", "compositor", "web:renderer", "web:cover", "dglass", "web:drawer"}));
  CHECK(all.at("dglass") == all.at("web:drawer") - 1);
  // A WebContentsView added while everything is up, then the window re-orders: the same order comes back.
  all.electronAdds("web:late");
  all.electronRaises("video");
  all.electronRaises("webkit");
  all.electronRaises("web:cover");
  CHECK(layered(all, {"video", "glass0", "webkit", "compositor", "web:renderer"}));
  CHECK(all.at("dglass") == all.at("web:drawer") - 1);
  // The WebKit App is unloaded (its view leaves) while the cover and drawer are up: nothing above it moves.
  ak2.removeApp("webkit");
  all.erase("webkit"); all.changed();
  CHECK(layered(all, {"video", "glass0", "compositor", "web:renderer"}));
  CHECK(all.at("dglass") == all.at("web:drawer") - 1);
  // It is created again: the new view goes back under everything.
  ak2.addApp("webkit");
  all.electronAdds("webkit");
  CHECK(layered(all, {"video", "glass0", "webkit", "compositor", "web:renderer"}));

  std::printf("ok\n");
  return 0;
}
