import type { AppPlayback, AppSignIn, AppWelcome, WelcomeQuestion } from "../apps/app.ts";
import { copyFromCouchToast } from "../apps/sign-in-text.ts";
import type { Store } from "../ports/store.ts";
import type { Engine } from "./native-front.ts";

const DOC = "apps-welcome";

/**
 * The welcome for an App that has come to WebKit, which has its own sign-in: asked once, and only of someone who
 * already has a sign-in in Couch's Chromium. A new user gets none and lands on the App's own sign-in page. Nothing is
 * copied or switched until an answer says so; any answer (Back included) ends the asking for good.
 */
export function createWebKitWelcome(o: {
  store: Store;
  appId: string;
  label: string;
  engine: () => Engine;
  signIn: () => AppSignIn | undefined;
  playback: AppPlayback;
}): AppWelcome {
  const answered = (): boolean => {
    const doc = o.store.read<unknown>(DOC, {});
    return Boolean(doc && typeof doc === "object" && (doc as Record<string, unknown>)[o.appId]);
  };
  const remember = () => {
    const doc = o.store.read<unknown>(DOC, {});
    o.store.write(DOC, {
      ...(doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {}),
      [o.appId]: true,
    });
  };
  return {
    async question(): Promise<WelcomeQuestion | undefined> {
      if (o.engine() !== "webkit" || answered()) return undefined;
      const copy = o.signIn()?.copyFromCouch;
      const hasCookies = copy ? await copy.available().catch(() => false) : false;
      if (!hasCookies) return undefined;
      return {
        title: `${o.label} now plays in sharper quality`,
        body: "It needs its own sign-in.",
        choices: [
          { id: "copy", label: "Copy sign-in from Couch" },
          { id: "signin", label: `Sign in on ${o.label}` },
          { id: "chromium", label: "Keep using Chromium" },
        ],
        back: "signin",
      };
    },
    async answer(id) {
      if (id !== "copy" && id !== "signin" && id !== "chromium") return undefined;
      remember();
      if (id === "copy") {
        const copy = o.signIn()?.copyFromCouch;
        if (!copy) return undefined;
        const result = await copy.copy().catch(() => ({ ok: false, reason: "failed" }) as const);
        return copyFromCouchToast(o.label, result);
      }
      if (id === "chromium") {
        return o.playback.select("chromium").then(
          () => undefined,
          () => `Couldn't switch ${o.label}'s playback`,
        );
      }
      return undefined;
    },
  };
}
