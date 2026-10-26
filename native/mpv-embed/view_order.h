// Keeps the video and its glass at the bottom of the window's view stack: video < glass < everything else.
// A second role, the drawer's glass, sits directly under the drawer's own view wherever that is, and goes
// with it: it is removed when the drawer is cleared or its view leaves the window.
// Electron reorders its sibling views on its own (a new WebContentsView moved the video above the renderer),
// so the order is enforced on every subview change instead of being set at a few call sites.
// Host-agnostic: mpv_embed.mm adapts NSView, view_order_test.cc uses a fake host.
#pragma once
#include <algorithm>
#include <functional>
#include <vector>

namespace vieworder {

template <class V>
struct Host {
  virtual ~Host() = default;
  virtual std::vector<V> subviews() const = 0;  // bottom to top
  virtual void placeBottom(V v) = 0;
  virtual void placeTop(V v) = 0;
  virtual void placeAbove(V v, V ref) = 0;
  virtual void remove(V v) = 0;
};

// Calls `notify` often enough to catch any host reorder (production: every main run loop turn, before the display commit).
using ChangeSource = std::function<void(std::function<void()> notify)>;

template <class V>
class Keeper {
 public:
  Keeper(Host<V> &host, const ChangeSource &source) : host_(host) {
    source([this] { ensure(); });
  }

  void setVideo(V v, bool below) { video_ = v; below_ = below; has_ = true; ensure(); }
  void setBelow(bool below) { below_ = below; ensure(); }
  void addGlass(V g) {
    if (std::find(glass_.begin(), glass_.end(), g) == glass_.end()) glass_.push_back(g);
    ensure();
  }
  // Ends the video's role (its glass stays in the host for the caller to remove); the drawer's glass is untouched.
  void release() { has_ = false; glass_.clear(); }

  // `anchor` is the drawer's view; `glass` is kept directly under it until clearDrawer or the anchor leaves.
  void setDrawer(V glass, V anchor) {
    bool swap = drawerOn_ && !(drawerGlass_ == glass);
    V old = drawerGlass_;
    drawerGlass_ = glass; anchor_ = anchor; drawerOn_ = true;
    if (swap) host_.remove(old);
    ensure();
  }
  // Safe to call any time, any number of times.
  void clearDrawer() {
    if (!drawerOn_) return;
    drawerOn_ = false;
    host_.remove(drawerGlass_);
  }

  // Idempotent. Only the video and glass views are ever moved; the host's other views keep their order.
  void ensure() {
    if (busy_) return;
    busy_ = true;
    if (has_ && !ordered(host_.subviews())) placeVideo();
    placeDrawer();
    busy_ = false;
  }

 private:
  void placeVideo() {
    if (below_) {
      host_.placeBottom(video_);
    } else {
      host_.placeTop(video_);
    }
    V prev = video_;
    for (V g : glass_) { host_.placeAbove(g, prev); prev = g; }
  }

  void placeDrawer() {
    if (!drawerOn_) return;
    std::vector<V> s = host_.subviews();
    auto a = std::find(s.begin(), s.end(), anchor_);
    if (a == s.end()) { drawerOn_ = false; host_.remove(drawerGlass_); return; }
    size_t ai = a - s.begin();
    if (ai > 0 && s[ai - 1] == drawerGlass_) return;
    bool found = false;
    V under{};
    for (size_t i = 0; i < ai; i++) if (!(s[i] == drawerGlass_)) { under = s[i]; found = true; }
    if (found) host_.placeAbove(drawerGlass_, under); else host_.placeBottom(drawerGlass_);
  }

  bool ordered(const std::vector<V> &s) const {
    std::vector<V> mine{video_};
    mine.insert(mine.end(), glass_.begin(), glass_.end());
    size_t n = s.size(), m = mine.size();
    if (n < m) return false;
    size_t start = below_ ? 0 : n - m;
    for (size_t i = 0; i < m; i++) if (s[start + i] != mine[i]) return false;
    return true;
  }

  Host<V> &host_;
  V video_{};
  V drawerGlass_{}, anchor_{};
  bool below_ = true, has_ = false, busy_ = false, drawerOn_ = false;
  std::vector<V> glass_;
};

}  // namespace vieworder
