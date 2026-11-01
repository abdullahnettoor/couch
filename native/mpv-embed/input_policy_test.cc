// Compiled and run by src/main/mpv/input-policy.test.ts. Plain asserts: prints "ok" or fails with the line.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include "input_policy.h"

#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); std::exit(1); } } while (0)

using namespace inputpolicy;

enum : unsigned { CMD = 1u << 20, CTRL = 1u << 18 };
// Mac virtual key codes
enum : unsigned { KA = 0, KF = 3, KQ = 12, KH = 4, KM = 46, KW = 13, KESC = 53, KRETURN = 36, KSPACE = 49, KV = 9 };

static Key key(unsigned code, bool down = true, unsigned flags = 0) {
  Key k; k.down = down; k.code = code; k.flags = flags; return k;
}

struct FakeKeys : KeyHost {
  std::vector<std::pair<int, Key>> posted;  // id 0 = a notification
  std::vector<Key> delivered;
  std::vector<std::string> logs;
  bool callbackWorks = true;
  bool post(int id, const Key &k) override { posted.push_back({id, k}); return callbackWorks; }
  void deliver(const Key &k) override { delivered.push_back(k); }
  void log(const char *m) override { logs.push_back(m); }
  int lastId() const { return posted.empty() ? -1 : posted.back().first; }
  int count(unsigned code, bool down) const {
    int n = 0;
    for (auto &k : delivered) if (k.code == code && k.down == down) n++;
    return n;
  }
};

static Policy page() { Policy p; p.keys = true; return p; }

static void acknowledgement() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  CHECK(hold.onKey(key(KA), 0) == Verdict::Swallow);
  CHECK(hold.pending() == 1 && h.lastId() > 0);
  hold.answer(h.lastId(), true);  // the page's: replayed once
  CHECK(h.count(KA, true) == 1 && hold.pending() == 0);
  hold.answer(h.lastId(), true);  // a second answer to the same id does nothing
  CHECK(h.count(KA, true) == 1);
  CHECK(hold.onKey(key(KRETURN), 0) == Verdict::Swallow);
  hold.answer(h.lastId(), false);  // Couch's: consumed, never delivered
  CHECK(h.delivered.size() == 1 && hold.pending() == 0);
  hold.tick(10);  // nothing is left to time out
  CHECK(h.logs.empty());
}

static void ids_are_distinct_and_bounded() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  hold.onKey(key(KA), 0); int first = h.lastId();
  hold.onKey(key(KA + 1), 0); CHECK(h.lastId() != first);
  FakeKeys g; KeyHold many(g); many.configure(page());
  for (unsigned i = 0; i < 40; i++) many.onKey(key(100 + i), 0);
  CHECK(many.pending() <= KeyHold::kMaxPending);  // full: it gave up holding rather than grow
  CHECK(g.delivered.size() == KeyHold::kMaxPending + 1);  // every held key was given back once
  CHECK(g.logs.size() == 1);
}

static void timeout_recovers_exactly_once() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  hold.onKey(key(KA), 0); int id = h.lastId();
  hold.onKey(key(KA, false), 0.1);
  hold.tick(0.2);  // before the deadline: still held
  CHECK(hold.pending() == 2 && h.delivered.empty());
  hold.tick(KeyHold::kDeadline + 0.01);
  CHECK(hold.pending() == 0);
  CHECK(h.delivered.size() == 2 && h.delivered[0].down && !h.delivered[1].down);  // in order
  CHECK(h.logs.size() == 1 && h.logs[0] == KeyHold::kTimeoutMessage);
  hold.answer(id, true);  // the host's late answer is ignored: never twice
  hold.tick(5);
  CHECK(h.delivered.size() == 2 && h.logs.size() == 1);
  // While recovering, nothing is intercepted: the key goes straight to the page.
  CHECK(hold.onKey(key(KF), 0.5) == Verdict::Pass);
  // After the cooldown it holds again.
  CHECK(hold.onKey(key(KF, false), 0.5) == Verdict::Pass);
  CHECK(hold.onKey(key(KA + 5), KeyHold::kCooldown + 1) == Verdict::Swallow);
}

static void callback_failure_recovers() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  h.callbackWorks = false;
  CHECK(hold.onKey(key(KA), 0) == Verdict::Swallow);  // held, then given back at once
  CHECK(hold.pending() == 0 && h.count(KA, true) == 1);
  CHECK(h.logs.size() == 1 && h.logs[0] == KeyHold::kCallbackMessage);
  CHECK(hold.onKey(key(KA, false), 0.01) == Verdict::Swallow);  // its up pairs with the replayed down
  CHECK(h.count(KA, false) == 1);
}

static void key_up_pairing() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  // Replayed down: its up is replayed at once, without asking the host.
  hold.onKey(key(KA), 0); hold.answer(h.lastId(), true);
  size_t asked = h.posted.size();
  CHECK(hold.onKey(key(KA, false), 0) == Verdict::Swallow);
  CHECK(h.count(KA, true) == 1 && h.count(KA, false) == 1 && h.posted.size() == asked);
  // Consumed down: its up is consumed too, the page never saw the down.
  hold.onKey(key(KRETURN), 0); hold.answer(h.lastId(), false);
  CHECK(hold.onKey(key(KRETURN, false), 0) == Verdict::Swallow);
  CHECK(h.count(KRETURN, false) == 0 && h.posted.size() == asked + 1);
  // A repeat of a consumed key is consumed without asking again.
  hold.onKey(key(KRETURN), 0); hold.answer(h.lastId(), false);
  size_t asked2 = h.posted.size();
  Key rep = key(KRETURN); rep.repeat = true;
  CHECK(hold.onKey(rep, 0) == Verdict::Swallow && h.posted.size() == asked2);
  hold.onKey(key(KRETURN, false), 0);
  // A down that passed natively: the up passes even if the policy now holds everything.
  Policy p = page(); p.fieldFocused = true; hold.configure(p);
  CHECK(hold.onKey(key(KA + 20), 0) == Verdict::Pass);
  p.holdAll = true; hold.configure(p);
  CHECK(hold.onKey(key(KA + 20, false), 0) == Verdict::Pass);
  // An up held while its down is still waiting is answered on its own id.
  Policy q = page(); hold.configure(q);
  hold.onKey(key(KSPACE), 0); int down = h.lastId();
  hold.onKey(key(KSPACE, false), 0.01); int up = h.lastId();
  hold.answer(up, true); hold.answer(down, true);
  CHECK(h.count(KSPACE, true) == 1 && h.count(KSPACE, false) == 1);
}

static void what_is_held() {
  FakeKeys h; KeyHold hold(h);
  // A page with no field: everything but Command combinations; ⌘F is Couch's; menu keys never.
  hold.configure(page());
  CHECK(hold.onKey(key(KA), 0) == Verdict::Swallow);
  CHECK(hold.onKey(key(KF, true, CMD), 0) == Verdict::Swallow);  // held back before WebKit sees it
  CHECK(hold.onKey(key(KV, true, CMD), 0) == Verdict::Pass);     // the page's own ⌘V
  for (unsigned c : {KQ, KH, KM, KW}) CHECK(hold.onKey(key(c, true, CMD), 0) == Verdict::Pass);
  // A focused page field: typing reaches WebKit directly (IME and dead keys work); only Esc and ⌘F are held.
  Policy f = page(); f.fieldFocused = true; hold.configure(f);
  CHECK(hold.onKey(key(KA + 30), 0) == Verdict::Pass);
  CHECK(hold.onKey(key(KSPACE), 0) == Verdict::Pass);
  CHECK(hold.onKey(key(KESC), 0) == Verdict::Swallow);
  CHECK(hold.onKey(key(KF, true, CMD), 0) == Verdict::Swallow);
  // Couch captures typed text, or an overlay (the picture-off gate): everything but the menu keys.
  Policy c = f; c.holdAll = true; hold.configure(c);
  CHECK(hold.onKey(key(KA + 31), 0) == Verdict::Swallow);
  CHECK(hold.onKey(key(KV, true, CMD), 0) == Verdict::Swallow);
  CHECK(hold.onKey(key(KQ, true, CMD), 0) == Verdict::Pass);
  // Keys off: nothing is touched.
  Policy off; hold.configure(off);
  CHECK(hold.onKey(key(KA + 40), 0) == Verdict::Pass);
}

static void clearing_forgets() {
  FakeKeys h; KeyHold hold(h); hold.configure(page());
  hold.onKey(key(KA), 0);
  hold.clear();
  CHECK(hold.pending() == 0);
  hold.answer(h.lastId(), true);
  hold.tick(10);
  CHECK(h.delivered.empty() && h.logs.empty());
}

// ---- pointer ----
struct FakePointer : PointerHost {
  std::vector<std::string> log;
  static const char *name(Kind k) { return k == Kind::Down ? "down" : k == Kind::Up ? "up" : k == Kind::Drag ? "drag" : k == Kind::Move ? "move" : "wheel"; }
  void deliver(Kind k, int b) override { log.push_back(std::string(name(k)) + std::to_string(b)); }
  void cancel(int b) override { log.push_back("cancel" + std::to_string(b)); }
};

static void pointer_ownership() {
  FakePointer h; PointerOwner p(h);
  CHECK(p.route(Kind::Down, 0, true, true) == Route::View);
  // An overlay opens in between: the drag and the release still belong to the view.
  CHECK(p.route(Kind::Drag, 0, true, false) == Route::View);
  CHECK(p.route(Kind::Drag, 0, false, false) == Route::View);
  CHECK(p.route(Kind::Up, 0, false, false) == Route::View);
  CHECK(!p.anyPressed());
  // After the release, with the overlay still up, the pointer is Chromium's.
  CHECK(p.route(Kind::Down, 0, true, false) == Route::Chromium);
  CHECK(p.route(Kind::Up, 0, true, false) == Route::Chromium);
  // A press that began on Chromium (an overlay's) is never the view's, even over the view: its drag is only a move to the page.
  CHECK(p.route(Kind::Drag, 0, true, true) == Route::ViewAndChromium);
  CHECK(p.route(Kind::Up, 0, true, true) == Route::Chromium);
  CHECK(h.log == (std::vector<std::string>{"down0", "drag0", "drag0", "up0", "move0"}));
}

static void pointer_buttons_are_separate() {
  FakePointer h; PointerOwner p(h);
  p.route(Kind::Down, 0, true, true);
  CHECK(p.route(Kind::Up, 1, true, true) == Route::Chromium);  // the right button was never pressed here
  CHECK(p.route(Kind::Down, 1, true, true) == Route::View);
  CHECK(p.route(Kind::Up, 0, true, true) == Route::View);
  CHECK(p.anyPressed());
  CHECK(p.route(Kind::Up, 1, true, true) == Route::View);
  CHECK(!p.anyPressed());
}

static void pointer_move_and_wheel() {
  FakePointer h; PointerOwner p(h);
  CHECK(p.route(Kind::Move, 0, true, true) == Route::ViewAndChromium);
  CHECK(p.route(Kind::Move, 0, false, true) == Route::Chromium);
  CHECK(p.route(Kind::Move, 0, true, false) == Route::Chromium);
  CHECK(p.route(Kind::Wheel, 0, true, true) == Route::View);
  CHECK(p.route(Kind::Wheel, 0, true, false) == Route::Chromium);
}

// A move with a button held that the view does not own (the press began on Chromium, e.g. a drag out of a drawer) still moves
// the pointer over the view: the page tracks hover from it as a plain move, and Chromium keeps the drag.
static void pointer_drags_the_view_does_not_own_are_moves() {
  FakePointer h; PointerOwner p(h);
  CHECK(p.route(Kind::Drag, 0, true, true) == Route::ViewAndChromium);
  CHECK(h.log == (std::vector<std::string>{"move0"}));
  CHECK(p.route(Kind::Drag, 0, false, true) == Route::Chromium);  // off the view
  CHECK(p.route(Kind::Drag, 0, true, false) == Route::Chromium);  // an overlay has the pointer
  CHECK(h.log.size() == 1);
  // A press the view owns is still the view's alone.
  p.route(Kind::Down, 0, true, true);
  h.log.clear();
  CHECK(p.route(Kind::Drag, 0, true, true) == Route::View);
  CHECK(h.log == (std::vector<std::string>{"drag0"}));
}

static void pointer_cancel_on_hide_destroy_or_routing_change() {
  FakePointer h; PointerOwner p(h);
  p.route(Kind::Down, 0, true, true); p.route(Kind::Down, 2, true, true);
  h.log.clear();
  p.cancel();  // hide, destroy, and a different view being routed all call this
  CHECK(h.log == (std::vector<std::string>{"cancel0", "cancel2"}));
  CHECK(!p.anyPressed());
  p.cancel();
  CHECK(h.log.size() == 2);  // exactly once
  CHECK(p.route(Kind::Up, 0, true, true) == Route::Chromium);
  // Each view keeps its own state.
  FakePointer h2; PointerOwner other(h2);
  p.route(Kind::Down, 0, true, true);
  CHECK(!other.anyPressed() && other.route(Kind::Drag, 0, true, true) != Route::View);
}

static void pointer_title_bar_and_inactive() {
  FakePointer h; PointerOwner p(h);
  // Over the title bar (traffic lights) or while Couch is not the active, key window, a down is Chromium's: the window gets it.
  CHECK(p.route(Kind::Down, 0, true, true, Where::TitleBar) == Route::Chromium);
  CHECK(p.route(Kind::Down, 0, true, true, Where::Inactive) == Route::Chromium);
  CHECK(!p.anyPressed() && h.log.empty());
  CHECK(p.route(Kind::Up, 0, true, true, Where::TitleBar) == Route::Chromium);
  // Moves and wheel over the title bar are not the view's.
  CHECK(p.route(Kind::Move, 0, true, true, Where::TitleBar) == Route::Chromium);
  CHECK(p.route(Kind::Wheel, 0, true, true, Where::TitleBar) == Route::Chromium);
  CHECK(p.route(Kind::Drag, 0, true, true, Where::TitleBar) == Route::Chromium);
  CHECK(h.log.empty());
  // A press that started in the view still ends in it, over the title bar or after Couch went inactive.
  CHECK(p.route(Kind::Down, 0, true, true) == Route::View);
  CHECK(p.route(Kind::Drag, 0, true, true, Where::TitleBar) == Route::View);
  CHECK(p.route(Kind::Up, 0, true, true, Where::TitleBar) == Route::View);
  CHECK(!p.anyPressed());
  CHECK(p.route(Kind::Down, 0, true, true) == Route::View);
  CHECK(p.route(Kind::Up, 0, true, true, Where::Inactive) == Route::View);
  // Active and in the content, as before.
  CHECK(p.route(Kind::Down, 0, true, true, Where::Content) == Route::View);
}

int main() {
  acknowledgement();
  ids_are_distinct_and_bounded();
  timeout_recovers_exactly_once();
  callback_failure_recovers();
  key_up_pairing();
  what_is_held();
  clearing_forgets();
  pointer_ownership();
  pointer_buttons_are_separate();
  pointer_move_and_wheel();
  pointer_drags_the_view_does_not_own_are_moves();
  pointer_title_bar_and_inactive();
  pointer_cancel_on_hide_destroy_or_routing_change();
  std::printf("ok\n");
}
