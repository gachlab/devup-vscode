import * as vscode from 'vscode';
import { openStream, sendRpc, type Subscription, type StreamFrame } from './socket-client.js';

export interface ServiceSnapshot {
  name: string;
  status: string;
  health: string;
  port: number;
  type: string;
  phase: number;
  pid: number | null;
  errors: number;
  restarts: number;
}

export interface ProjectInfo {
  project: string;
  profiles: Record<string, string[]>;
}

export type ConnectionState = 'connecting' | 'connected' | 'unreachable';

/** Single source of truth for service state. Consumes `status.follow` from the
 *  daemon (replacing the previous 3 s polling) and fans out change events to
 *  the status bar, tree view, and any future consumers. Auto-reconnects when
 *  the daemon comes back up. */
export class StatusStore implements vscode.Disposable {
  private readonly services = new Map<string, ServiceSnapshot>();
  private info: ProjectInfo = { project: '', profiles: {} };
  private subscription: Subscription | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = 'connecting';
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposed = false;

  constructor(private readonly socketPath: string) {}

  start(): void {
    void this.connect();
  }

  getAll(): ServiceSnapshot[] {
    return [...this.services.values()];
  }
  getState(): ConnectionState { return this.state; }
  getInfo(): ProjectInfo { return this.info; }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.state = 'connecting';
    this.emitter.fire();

    // Probe with a quick `status` call first — gives us the snapshot synchronously
    // and surfaces errors before opening the streaming subscription.
    try {
      const [snapshot, infoResult] = await Promise.all([
        sendRpc(this.socketPath, 'status', {}, { timeoutMs: 2000 }) as Promise<{ services: ServiceSnapshot[] }>,
        sendRpc(this.socketPath, 'info', {}, { timeoutMs: 2000 }).catch(() => null) as Promise<ProjectInfo | null>,
      ]);
      this.services.clear();
      for (const s of snapshot.services ?? []) this.services.set(s.name, s);
      if (infoResult) this.info = infoResult;
      this.state = 'connected';
      this.emitter.fire();
    } catch {
      this.state = 'unreachable';
      this.services.clear();
      this.emitter.fire();
      this.scheduleReconnect();
      return;
    }

    this.subscription = openStream(
      this.socketPath, 'status.follow', {},
      (frame: StreamFrame) => {
        if (frame.event !== 'status' || !Array.isArray(frame.data)) return;
        for (const s of frame.data as ServiceSnapshot[]) {
          this.services.set(s.name, s);
        }
        this.emitter.fire();
      },
      () => this.onConnectionLost(),
      () => this.onConnectionLost(),
    );
  }

  private onConnectionLost(): void {
    if (this.disposed) return;
    this.subscription = null;
    this.state = 'unreachable';
    this.services.clear();
    this.emitter.fire();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 3000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.subscription?.close();
    this.emitter.dispose();
  }
}
