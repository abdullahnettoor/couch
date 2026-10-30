// The rules for the Mac's remote command centre (ticket 121): what Start registers, how a press reaches JS through the
// thread-safe callback, and that presses from before a stop (or a restart) are dropped. No Cocoa here, so a plain C++
// program tests it with a fake centre (media_policy_test.cc), like input_policy.h.
#pragma once
#include <atomic>
#include <functional>
#include <string>

namespace mediapolicy {

// MPRemoteCommandCenter and MPNowPlayingInfoCenter, or a fake.
struct Center {
  virtual ~Center() {}
  // Enables the five commands; `fire` is what each command's target calls (on any thread) with its name.
  virtual void registerCommands(std::function<void(const char *)> fire) = 0;
  virtual void unregisterCommands() = 0;
  virtual void clearInfo() = 0;
  virtual void publish(const std::string &title, const std::string &app, double position, double duration, bool paused) = 0;
};

// Hands a press to JS: `post` queues it (napi_call_threadsafe_function), and the queued call later runs `deliver`.
struct Callback {
  virtual ~Callback() {}
  virtual void post(unsigned generation, const std::string &command) = 0;
};

class Session {
 public:
  explicit Session(Center &c) : center_(c) {}

  // Takes the Now Playing role. A second Start replaces the first: its queued presses are dropped.
  void start(Callback &cb) {
    stop();
    unsigned g = ++generation_;
    active_ = true;
    registered_ = true;
    center_.registerCommands([this, &cb, g](const char *command) { fire(cb, g, command); });
  }

  void setInfo(const std::string &title, const std::string &app, double position, double duration, bool paused) {
    if (registered_) center_.publish(title, app, position, duration, paused);
  }

  // Gives the role back. Presses still queued, or fired by a stale command, no longer reach JS.
  void stop() {
    active_ = false;
    ++generation_;
    if (registered_) center_.unregisterCommands();
    registered_ = false;
    center_.clearInfo();
  }

  // The queued call has come round on the JS side: true when it should run (no stop or restart since it was posted).
  bool accept(unsigned generation) const { return active_ && generation == generation_; }

 private:
  void fire(Callback &cb, unsigned g, const char *command) {
    if (accept(g)) cb.post(g, command);
  }
  Center &center_;
  std::atomic<unsigned> generation_{0};
  std::atomic<bool> active_{false};
  bool registered_ = false;
};

}  // namespace mediapolicy
