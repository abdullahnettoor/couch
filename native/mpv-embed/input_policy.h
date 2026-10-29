// The rules for real input handed to a WebKit view (ticket 112): which physical keys the native side holds back,
// how the host answers for each held key, and who owns a mouse press. No Cocoa here, so a plain C++ program tests it
// with fakes (input_policy_test.cc), like view_order.h.
#pragma once
#include <algorithm>
#include <cstddef>
#include <deque>
#include <map>
#include <string>

namespace inputpolicy {

enum : unsigned { kCommandFlag = 1u << 20, kControlFlag = 1u << 18, kOptionFlag = 1u << 19 };

struct Key {
  bool down = true;
  unsigned code = 0;       // Mac virtual key code
  unsigned flags = 0;      // NSEvent.modifierFlags, device independent
  bool repeat = false;
  std::string chars, charsIgnoring;
};

// What the view takes off Chromium's layer. holdAll: Couch takes every key (it captures typed text, or an overlay such as
// Picture off is up). fieldFocused: a text field in the page has focus, so typing is the page's.
struct Policy {
  bool keys = false, holdAll = false, fieldFocused = false;
};

struct KeyHost {
  virtual ~KeyHost() {}
  // Tells the host about a key. id > 0: it is held and needs an answer; id 0: only a notification. False: the callback failed.
  virtual bool post(int id, const Key &) = 0;
  // Gives the key to the view, as the same key it came in as.
  virtual void deliver(const Key &) = 0;
  virtual void log(const char *) = 0;
};

enum class Verdict { Pass, Swallow };

class KeyHold {
 public:
  static constexpr std::size_t kMaxPending = 16;
  static constexpr double kDeadline = 0.25;  // seconds the host has to answer a held key
  static constexpr double kCooldown = 2.0;   // seconds keys pass straight to the page after a failure
  static constexpr const char *kTimeoutMessage = "couch input: the host did not answer a held key in time; keys pass to the page";
  static constexpr const char *kCallbackMessage = "couch input: the host could not be reached; keys pass to the page";

  explicit KeyHold(KeyHost &host) : host_(host) {}

  void configure(const Policy &p) { policy_ = p; degradedUntil_ = -1; }

  // Quit, Hide, Minimise and Close stay the menu's whatever else is going on.
  static bool menuKey(const Key &k) {
    return (k.flags & kCommandFlag) && (k.code == 12 || k.code == 4 || k.code == 46 || k.code == 13);
  }
  // ⌘F is Couch's find; Escape is Couch's Back even in a field.
  static bool couchOwned(const Key &k) {
    return k.code == 53 || ((k.flags & kCommandFlag) && k.code == 3);
  }
  bool shouldHold(const Key &k) const {
    if (menuKey(k)) return false;
    if (policy_.holdAll) return true;
    if (policy_.fieldFocused) return couchOwned(k);
    return !(k.flags & kCommandFlag) || couchOwned(k);
  }

  Verdict onKey(const Key &k, double now) {
    tick(now);
    if (!policy_.keys) return Verdict::Pass;
    auto it = state_.find(k.code);
    if (!k.down) {
      if (it != state_.end()) {
        State s = it->second;
        state_.erase(it);
        if (s == State::Replayed) { host_.deliver(k); return Verdict::Swallow; }
        if (s == State::Consumed) return Verdict::Swallow;
        return Verdict::Pass;
      }
    } else if (it != state_.end() && k.repeat) {  // a repeat follows what its first press got; a new press starts over
      if (it->second == State::Consumed) return Verdict::Swallow;
      if (it->second == State::Replayed) { host_.deliver(k); return Verdict::Swallow; }
      return Verdict::Pass;
    }
    if (now < degradedUntil_ || !shouldHold(k)) {
      if (k.down) { state_[k.code] = State::Passed; host_.post(0, k); }
      return Verdict::Pass;
    }
    if (pending_.size() >= kMaxPending) {
      pending_.push_back({0, k, now});
      recover(kTimeoutMessage, now);
      return Verdict::Swallow;
    }
    int id = nextId_++;
    if (nextId_ <= 0) nextId_ = 1;
    pending_.push_back({id, k, now + kDeadline});
    if (!host_.post(id, k)) recover(kCallbackMessage, now);
    return Verdict::Swallow;
  }

  // The host's answer for a held key: replay it to the view, or consume it (Couch's). A late or repeated answer does nothing.
  void answer(int id, bool replay) {
    auto it = std::find_if(pending_.begin(), pending_.end(), [id](const Held &h) { return h.id == id; });
    if (it == pending_.end()) return;
    Key k = it->key;
    pending_.erase(it);
    if (replay) host_.deliver(k);
    if (k.down) state_[k.code] = replay ? State::Replayed : State::Consumed;
    else state_.erase(k.code);
  }

  void tick(double now) {
    if (!pending_.empty() && pending_.front().deadline <= now) recover(kTimeoutMessage, now);
  }

  // The earliest moment a held key times out, or -1.
  double nextDeadline() const { return pending_.empty() ? -1 : pending_.front().deadline; }
  std::size_t pending() const { return pending_.size(); }

  // Hide, destroy, a routing change: forget everything held (nothing is delivered).
  void clear() { pending_.clear(); state_.clear(); degradedUntil_ = -1; }

 private:
  enum class State { Passed, Replayed, Consumed };
  struct Held { int id; Key key; double deadline; };

  // Stop intercepting for a while and give back, once and in order, every key held.
  void recover(const char *message, double now) {
    degradedUntil_ = now + kCooldown;
    std::deque<Held> held;
    held.swap(pending_);
    for (const Held &h : held) {
      host_.deliver(h.key);
      if (h.key.down) state_[h.key.code] = State::Replayed; else state_.erase(h.key.code);
    }
    host_.log(message);
  }

  KeyHost &host_;
  Policy policy_;
  std::deque<Held> pending_;
  std::map<unsigned, State> state_;
  int nextId_ = 1;
  double degradedUntil_ = -1;
};

// ---- the mouse ----

enum class Kind { Move, Down, Drag, Up, Wheel };
enum class Route { Chromium, View, ViewAndChromium };

struct PointerHost {
  virtual ~PointerHost() {}
  virtual void deliver(Kind, int button) = 0;
  // Ends a press the view still holds (a synthesized release).
  virtual void cancel(int button) = 0;
};

// Per view: the view that got a mouse-down owns the press until its mouse-up, even if an overlay takes the pointer in between.
class PointerOwner {
 public:
  explicit PointerOwner(PointerHost &host) : host_(host) {}

  Route route(Kind kind, int button, bool inside, bool routing) {
    unsigned bit = 1u << (button & 7);
    switch (kind) {
      case Kind::Move:
        if (!(routing && inside)) return Route::Chromium;
        host_.deliver(kind, button);
        return Route::ViewAndChromium;
      case Kind::Wheel:
        if (!(routing && inside)) return Route::Chromium;
        host_.deliver(kind, button);
        return Route::View;
      case Kind::Down:
        if (!(routing && inside)) return Route::Chromium;
        pressed_ |= bit;
        host_.deliver(kind, button);
        return Route::View;
      case Kind::Drag:
        if (!(pressed_ & bit)) {
          if (!(routing && inside)) return Route::Chromium;
          host_.deliver(Kind::Move, button);
          return Route::ViewAndChromium;
        }
        host_.deliver(kind, button);
        return Route::View;
      case Kind::Up:
        if (!(pressed_ & bit)) return Route::Chromium;
        pressed_ &= ~bit;
        host_.deliver(kind, button);
        return Route::View;
    }
    return Route::Chromium;
  }

  bool anyPressed() const { return pressed_ != 0; }

  // Hide, destroy, or another view being routed: end what is still pressed, once.
  void cancel() {
    unsigned p = pressed_;
    pressed_ = 0;
    for (int b = 0; b < 8; b++) if (p & (1u << b)) host_.cancel(b);
  }

 private:
  PointerHost &host_;
  unsigned pressed_ = 0;
};

}  // namespace inputpolicy
