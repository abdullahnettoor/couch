import { connect, type Socket } from "node:net";

export type MpvEvent = { event: string; [key: string]: unknown };

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

export interface ConnectOptions {
  timeoutMs?: number;
  retryMs?: number;
}

/** Small client for mpv's JSON IPC socket. One persistent connection (observers die with it). */
export class MpvIpcClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private eventListeners = new Set<(event: MpvEvent) => void>();
  private closeListeners = new Set<() => void>();
  private closed = false;

  private socket: Socket;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", () => {});
  }

  static async connect(path: string, options: ConnectOptions = {}): Promise<MpvIpcClient> {
    const { timeoutMs = 5000, retryMs = 50 } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const s = connect(path);
          s.once("connect", () => resolve(s));
          s.once("error", reject);
        });
        return new MpvIpcClient(socket);
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((r) => setTimeout(r, retryMs));
      }
    }
  }

  command(args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("mpv connection closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ command: args, request_id: id }) + "\n");
    });
  }

  onEvent(listener: (event: MpvEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let i;
    while ((i = this.buffer.indexOf(10)) >= 0) {
      // toString replaces invalid UTF-8 with U+FFFD, so JSON.parse never sees raw bad bytes.
      const line = this.buffer.subarray(0, i).toString("utf8");
      this.buffer = this.buffer.subarray(i + 1);
      if (line.trim()) this.onMessage(line);
    }
  }

  private onMessage(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.request_id === "number") {
      const pending = this.pending.get(message.request_id);
      if (!pending) return;
      this.pending.delete(message.request_id);
      if (message.error === "success") pending.resolve(message.data);
      else if (message.error === undefined) pending.resolve(message.data);
      else
        pending.reject(
          new Error(typeof message.error === "string" ? message.error : "mpv command failed"),
        );
    } else if (typeof message.event === "string") {
      for (const listener of this.eventListeners) listener(message as MpvEvent);
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("mpv connection closed"));
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }
}
