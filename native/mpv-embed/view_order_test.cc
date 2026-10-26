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

  std::printf("ok\n");
  return 0;
}
