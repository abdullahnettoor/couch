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

  std::printf("ok\n");
  return 0;
}
