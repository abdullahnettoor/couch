export interface BeforeRequestDetails {
  url: string;
}
export interface HeadersDetails {
  url: string;
  requestHeaders: Record<string, string>;
}
/** A handler may block or redirect; returning nothing lets the request go on to the next handler. */
export type BeforeRequestHandler = (
  details: BeforeRequestDetails,
) => { cancel?: boolean; redirectURL?: string } | undefined | void;
/** Receives the headers so far and returns the headers to send (the next handler sees these). */
export type HeadersHandler = (details: HeadersDetails) => Record<string, string>;

export interface HookSession {
  webRequest: {
    onBeforeRequest(listener: (details: any, callback: (response: any) => void) => void): void;
    onBeforeSendHeaders(listener: (details: any, callback: (response: any) => void) => void): void;
  };
}

/**
 * The one place that listens to a session's webRequest events (Electron allows a single listener
 * per event). Handlers run in the order they were added; the identity is added first.
 */
export class RequestHooks {
  #before: BeforeRequestHandler[] = [];
  #headers: HeadersHandler[] = [];

  constructor(ses: HookSession) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      for (const handler of [...this.#before]) {
        const result = handler({ url: details.url });
        if (result && (result.cancel || result.redirectURL)) return callback(result);
      }
      callback({});
    });
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      let requestHeaders: Record<string, string> = details.requestHeaders;
      for (const handler of [...this.#headers]) {
        requestHeaders = handler({ url: details.url, requestHeaders });
      }
      callback({ requestHeaders });
    });
  }

  onBeforeRequest(handler: BeforeRequestHandler): () => void {
    this.#before.push(handler);
    return () => void (this.#before = this.#before.filter((h) => h !== handler));
  }

  onBeforeSendHeaders(handler: HeadersHandler): () => void {
    this.#headers.push(handler);
    return () => void (this.#headers = this.#headers.filter((h) => h !== handler));
  }
}

const hooks = new WeakMap<object, RequestHooks>();

/** The session's hooks; the first call installs the listeners, later calls share them. */
export function requestHooksFor(ses: HookSession): RequestHooks {
  let found = hooks.get(ses);
  if (!found) hooks.set(ses, (found = new RequestHooks(ses)));
  return found;
}
