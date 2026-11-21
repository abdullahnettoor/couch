export interface BeforeRequestDetails {
  url: string;
}
export interface HeadersDetails {
  url: string;
  requestHeaders: Record<string, string>;
}
export interface ResponseHeadersDetails {
  url: string;
  responseHeaders: Record<string, string[]>;
}
/** A handler may block or redirect; returning nothing lets the request go on to the next handler. */
export type BeforeRequestHandler = (
  details: BeforeRequestDetails,
) => { cancel?: boolean; redirectURL?: string } | undefined | void;
/** Receives the headers so far and returns the headers to send (the next handler sees these). */
export type HeadersHandler = (details: HeadersDetails) => Record<string, string>;

/** Receives the response headers so far and returns the headers the page sees (the next handler sees these). */
export type ResponseHeadersHandler = (details: ResponseHeadersDetails) => Record<string, string[]>;

export interface HookSession {
  webRequest: {
    onBeforeRequest(
      listener: ((details: any, callback: (response: any) => void) => void) | null,
    ): void;
    onBeforeSendHeaders(
      listener: ((details: any, callback: (response: any) => void) => void) | null,
    ): void;
    onHeadersReceived(
      listener: ((details: any, callback: (response: any) => void) => void) | null,
    ): void;
  };
}

const warned = new WeakSet<object>();
function warnOnce(handler: object, error: unknown): void {
  if (warned.has(handler)) return;
  warned.add(handler);
  console.warn("[couch] request hook failed:", error);
}

/**
 * The one place that listens to a session's webRequest events (Electron allows a single listener
 * per event). Handlers run in the order they were added; the identity is added first.
 */
export class RequestHooks {
  #before: BeforeRequestHandler[] = [];
  #headers: HeadersHandler[] = [];
  #responses: ResponseHeadersHandler[] = [];

  #ses: HookSession;

  constructor(ses: HookSession) {
    this.#ses = ses;
    ses.webRequest.onBeforeRequest((details, callback) => {
      for (const handler of [...this.#before]) {
        let result;
        try {
          result = handler({ url: details.url });
        } catch (e) {
          warnOnce(handler, e);
          continue;
        }
        if (result && (result.cancel || result.redirectURL)) return callback(result);
      }
      callback({});
    });
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      let requestHeaders: Record<string, string> = details.requestHeaders;
      for (const handler of [...this.#headers]) {
        try {
          requestHeaders = handler({ url: details.url, requestHeaders });
        } catch (e) {
          warnOnce(handler, e);
        }
      }
      callback({ requestHeaders });
    });
    ses.webRequest.onHeadersReceived((details, callback) => {
      if (this.#responses.length === 0) return callback({});
      let responseHeaders: Record<string, string[]> = details.responseHeaders ?? {};
      for (const handler of this.#responses) {
        try {
          responseHeaders = handler({ url: details.url, responseHeaders });
        } catch (e) {
          warnOnce(handler, e);
        }
      }
      callback({ responseHeaders });
    });
  }

  get empty(): boolean {
    return this.#before.length === 0 && this.#headers.length === 0 && this.#responses.length === 0;
  }

  /** Takes this object's listeners off the session. */
  detach(): void {
    this.#ses.webRequest.onBeforeRequest(null);
    this.#ses.webRequest.onBeforeSendHeaders(null);
    this.#ses.webRequest.onHeadersReceived(null);
  }

  onBeforeRequest(handler: BeforeRequestHandler): () => void {
    this.#before.push(handler);
    return () => void (this.#before = this.#before.filter((h) => h !== handler));
  }

  onBeforeSendHeaders(handler: HeadersHandler): () => void {
    this.#headers.push(handler);
    return () => void (this.#headers = this.#headers.filter((h) => h !== handler));
  }

  onHeadersReceived(handler: ResponseHeadersHandler): () => void {
    this.#responses.push(handler);
    return () => void (this.#responses = this.#responses.filter((h) => h !== handler));
  }
}

const hooks = new WeakMap<object, RequestHooks>();

/** The session's hooks; the first call installs the listeners, later calls share them. */
export function requestHooksFor(ses: HookSession): RequestHooks {
  let found = hooks.get(ses);
  if (!found) hooks.set(ses, (found = new RequestHooks(ses)));
  return found;
}

/** The host is going: when no handler is left on the session, its listeners come off too (a later host hooks it afresh). */
export function releaseRequestHooks(ses: HookSession): void {
  const found = hooks.get(ses);
  if (!found?.empty) return;
  found.detach();
  hooks.delete(ses);
}
