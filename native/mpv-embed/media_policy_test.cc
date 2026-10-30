// Compiled and run by src/main/mpv/media-policy.test.ts. Plain asserts: prints "ok" or fails with the line.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>
#include "media_policy.h"

#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); std::exit(1); } } while (0)

using namespace mediapolicy;

struct FakeCenter : Center {
  std::function<void(const char *)> fire;
  bool registered = false, info = false;
  int registrations = 0;
  std::string title;
  void registerCommands(std::function<void(const char *)> f) override { fire = f; registered = true; registrations++; }
  void unregisterCommands() override { registered = false; }  // the real centre drops its targets; the old closure may still be held
  void clearInfo() override { info = false; title.clear(); }
  void publish(const std::string &t, const std::string &, double, double, bool) override { info = true; title = t; }
};

// Stands in for the thread-safe function: posts queue up, drain() runs them on "the JS side" through Session::accept.
struct FakeJs : Callback {
  Session *session = nullptr;
  std::vector<std::pair<unsigned, std::string>> queue;
  std::vector<std::string> received;
  void post(unsigned g, const std::string &c) override { queue.push_back({g, c}); }
  void drain() {
    for (auto &q : queue) if (session->accept(q.first)) received.push_back(q.second);
    queue.clear();
  }
};

int main() {
  {  // nothing registered until Start; a press reaches JS through the callback
    FakeCenter c; Session s(c); FakeJs js; js.session = &s;
    CHECK(!c.registered);
    s.setInfo("ignored", "App", 0, 0, false);
    CHECK(!c.info);
    s.start(js);
    CHECK(c.registered);
    s.setInfo("Title", "App", 1, 2, false);
    CHECK(c.info && c.title == "Title");
    c.fire("toggle"); c.fire("next");
    js.drain();
    CHECK(js.received.size() == 2 && js.received[0] == "toggle" && js.received[1] == "next");
  }
  {  // stop releases the commands and Now Playing; presses after, and presses already queued, are dropped
    FakeCenter c; Session s(c); FakeJs js; js.session = &s;
    s.start(js);
    s.setInfo("T", "A", 0, 0, true);
    c.fire("play");
    auto stale = c.fire;
    s.stop();
    CHECK(!c.registered && !c.info);
    stale("pause");  // a handler the Mac still held
    js.drain();
    CHECK(js.received.empty());
    CHECK(js.queue.empty());
    s.stop();  // twice is safe
    CHECK(!c.registered);
  }
  {  // restart: the new session delivers, the old session's queued and late presses do not
    FakeCenter c; Session s(c); FakeJs js; js.session = &s;
    s.start(js);
    auto old = c.fire;
    old("play");
    s.stop();
    s.start(js);
    CHECK(c.registrations == 2 && c.registered);
    old("pause");
    c.fire("toggle");
    js.drain();
    CHECK(js.received.size() == 1 && js.received[0] == "toggle");
    s.start(js);  // start while started replaces it
    CHECK(c.registrations == 3);
  }
  std::printf("ok\n");
  return 0;
}
