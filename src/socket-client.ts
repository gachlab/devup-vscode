/** Minimal JSON-RPC client for the devup control plane (Unix socket).
 *  Mirrors the protocol implemented by @gachlab/devup ≥ 0.6.0:
 *  newline-delimited JSON, single connection per request for one-shot
 *  calls, persistent connection for streaming.
 *
 *  We do not import @gachlab/devup as a runtime dep — the protocol is the
 *  contract, and a small in-tree client lets the extension stay independent. */
import { createConnection, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

export interface RpcError {
  code: number;
  message: string;
}

export class RpcCallError extends Error {
  constructor(message: string, public readonly socketPath: string, public readonly rpcCode?: number) {
    super(message);
    this.name = 'RpcCallError';
  }
}

/** Send a single RPC and return the result, or throw RpcCallError. */
export function sendRpc(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  return new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) {
      reject(new RpcCallError(`socket not found: ${socketPath}`, socketPath));
      return;
    }
    const c = createConnection(socketPath);
    const timer = setTimeout(() => {
      c.destroy();
      reject(new RpcCallError(`timed out after ${timeoutMs}ms`, socketPath));
    }, timeoutMs);

    c.on('error', err => {
      clearTimeout(timer);
      reject(new RpcCallError(err.message, socketPath));
    });

    const rl = createInterface({ input: c });
    rl.once('line', line => {
      clearTimeout(timer);
      c.end();
      try {
        const msg = JSON.parse(line) as { result?: unknown; error?: RpcError };
        if (msg.error) reject(new RpcCallError(msg.error.message, socketPath, msg.error.code));
        else resolve(msg.result);
      } catch (e) {
        reject(new RpcCallError(`malformed response: ${(e as Error).message}`, socketPath));
      }
    });
    c.write(JSON.stringify({ id: 1, method, params }) + '\n');
  });
}

export interface StreamFrame {
  event: string;
  data: unknown;
  svc?: string;
}

export interface Subscription {
  /** Stop receiving frames and close the underlying socket. */
  close(): void;
}

/** Open a streaming RPC (logs.follow / status.follow). The callback receives
 *  each event frame until close() is called, the socket closes naturally, or
 *  the server returns an error before the ack. */
export function openStream(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  onFrame: (frame: StreamFrame) => void,
  onError?: (err: RpcCallError) => void,
  onClose?: () => void,
): Subscription {
  if (!existsSync(socketPath)) {
    queueMicrotask(() => onError?.(new RpcCallError(`socket not found: ${socketPath}`, socketPath)));
    return { close: () => {} };
  }
  const c: Socket = createConnection(socketPath);
  const rl = createInterface({ input: c });
  let ackDone = false;
  let closed = false;

  c.on('error', (err: Error) => {
    if (closed) return;
    onError?.(new RpcCallError(err.message, socketPath));
  });
  c.on('close', () => { closed = true; onClose?.(); });

  rl.on('line', (line: string) => {
    try {
      const msg = JSON.parse(line) as { result?: unknown; error?: RpcError; event?: string; data?: unknown; svc?: string };
      if (!ackDone) {
        ackDone = true;
        if (msg.error) { onError?.(new RpcCallError(msg.error.message, socketPath, msg.error.code)); c.destroy(); }
        return;
      }
      if (msg.event) onFrame({ event: msg.event, data: msg.data, svc: msg.svc });
    } catch { /* skip malformed frames */ }
  });

  c.write(JSON.stringify({ id: 1, method, params }) + '\n');

  return {
    close: () => {
      closed = true;
      c.destroy();
    },
  };
}
