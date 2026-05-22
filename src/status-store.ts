import * as vscode from 'vscode';
import { openStream, sendRpc, type Subscription, type StreamFrame } from './socket-client.js';

export type { ServiceSnapshot, ProjectInfo, ProxyInfo, ServiceStats, SystemStats, ConnectionState } from './types.js';
import type { ServiceSnapshot, ProjectInfo, ProxyInfo, ServiceStats, SystemStats, ConnectionState } from './types.js';

/** Single source of truth for service state. Consumes `status.follow` from the
 *  daemon (replacing the previous 3 s polling) and fans out change events to
 *  the status bar, tree view, and any future consumers. Auto-reconnects when
 *  the daemon comes back up. */
export class StatusStore implements vscode.Disposable {
  private readonly services = new Map<string, ServiceSnapshot>();
  private info: ProjectInfo = { project: '', profiles: {} };
  private proxy: ProxyInfo | null = null;
  private readonly serviceStats = new Map<string, ServiceStats>();
  private systemStats: SystemStats | null = null;
  private subscription: Subscription | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = 'connecting';
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposed = false;

  constructor(private readonly socketPath: string) {}

  start(): void {
    void this.connect();
  }

  getAll(): ServiceSnapshot[] { return [...this.services.values()]; }
  getState(): ConnectionState { return this.state; }
  getInfo(): ProjectInfo { return this.info; }
  getProxy(): ProxyInfo | null { return this.proxy; }
  getServiceStats(name: string): ServiceStats | null { return this.serviceStats.get(name) ?? null; }
  getSystemStats(): SystemStats | null { return this.systemStats; }

  private async connect(): Promise<void> {
    if (this.disposed) return;
    this.state = 'connecting';
    this.emitter.fire();

    // Probe with a quick `status` call first — gives us the snapshot synchronously
    // and surfaces errors before opening the streaming subscription.
    try {
      const [snapshot, infoResult] = await Promise.all([
        sendRpc(this.socketPath, 'status', {}, { timeoutMs: 2000 }) as Promise<{ services: ServiceSnapshot[]; proxy: ProxyInfo | null }>,
        sendRpc(this.socketPath, 'info', {}, { timeoutMs: 2000 }).catch(() => null) as Promise<ProjectInfo | null>,
      ]);
      this.services.clear();
      for (const s of snapshot.services ?? []) this.services.set(s.name, s);
      this.proxy = snapshot.proxy ?? null;
      if (infoResult) this.info = infoResult;
      this.state = 'connected';
      this.emitter.fire();
      this.startStatsPolling();
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

  private startStatsPolling(): void {
    this.stopStatsPolling();
    const poll = async () => {
      if (this.state !== 'connected') return;
      try {
        const result = await sendRpc(this.socketPath, 'stats', {}, { timeoutMs: 3000 }) as {
          services: Record<string, ServiceStats>;
          system: SystemStats;
        };
        this.serviceStats.clear();
        for (const [name, s] of Object.entries(result.services ?? {})) {
          this.serviceStats.set(name, s);
        }
        this.systemStats = result.system ?? null;
        this.emitter.fire();
      } catch { /* core < 0.10.0 or transient — degrade gracefully */ }
    };
    void poll();
    this.statsTimer = setInterval(() => void poll(), 3000);
  }

  private stopStatsPolling(): void {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    this.serviceStats.clear();
    this.systemStats = null;
  }

  private onConnectionLost(): void {
    if (this.disposed) return;
    this.subscription = null;
    this.state = 'unreachable';
    this.services.clear();
    this.proxy = null;
    this.stopStatsPolling();
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
    this.stopStatsPolling();
    this.subscription?.close();
    this.emitter.dispose();
  }
}
