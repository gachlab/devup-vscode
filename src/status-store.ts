import * as vscode from 'vscode';
import { openStream, sendRpc, type Subscription, type StreamFrame } from './socket-client.js';
import { StatsCache, type StatsResult } from './stats-cache.js';
import { Backoff, reconnectDelay } from './backoff.js';

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
  private readonly stats = new StatsCache();
  private readonly backoff = new Backoff();
  /** Epoch millis until which reconnects retry at a fixed short delay. Set by
   *  `expectRestart()`; 0 means the backoff decides on its own. */
  private fastRetryUntil = 0;
  /** A socket path change that arrived while a connect was in flight. */
  private pendingRestart = false;
  private subscription: Subscription | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = 'connecting';
  /** True while `connect()` is between its first await and opening the stream.
   *  `refresh()` can be pressed at any moment, including then, and a second
   *  concurrent connect would open a second `status.follow` and drop the first
   *  subscription on the floor without closing it. */
  private connecting = false;
  /** A refresh that arrived while a connect was in flight. Dropping it would
   *  make the button do nothing at all for the ~2 s of the probe — the one
   *  moment someone is most likely to press it twice. */
  private refreshPending = false;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposed = false;

  constructor(private socketPath: string) {}

  start(): void {
    void this.connect();
  }

  getAll(): ServiceSnapshot[] { return [...this.services.values()]; }
  getState(): ConnectionState { return this.state; }
  getInfo(): ProjectInfo { return this.info; }
  getProxy(): ProxyInfo | null { return this.proxy; }
  getServiceStats(name: string): ServiceStats | null { return this.stats.get(name); }
  getSystemStats(): SystemStats | null { return this.stats.getSystem(); }

  private async connect(): Promise<void> {
    if (this.disposed || this.connecting) return;
    this.connecting = true;
    try {
      await this.doConnect();
    } finally {
      this.connecting = false;
    }
    if (this.disposed) return;
    // Order matters: a path change supersedes a refresh, since the refresh was
    // aimed at a daemon we are no longer talking to.
    if (this.pendingRestart) {
      this.pendingRestart = false;
      this.refreshPending = false;
      this.restart();
      return;
    }
    if (this.refreshPending) {
      this.refreshPending = false;
      this.refresh();
    }
  }

  /** Point the store at a different daemon.
   *
   *  Discovery re-runs whenever `devup.config.*` or the overriding settings
   *  change, and renaming a project moves its socket — so this is the normal
   *  way a rename is picked up, rather than the window reload it used to
   *  need (issue #38). */
  setSocketPath(path: string): void {
    if (this.disposed || path === this.socketPath) return;
    this.socketPath = path;
    // A connect in flight is probing the old path and would open its stream on
    // the new one; let it finish and restart cleanly instead.
    if (this.connecting) { this.pendingRestart = true; return; }
    this.restart();
  }

  getSocketPath(): string { return this.socketPath; }

  private restart(): void {
    this.subscription?.close();
    this.subscription = null;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopStatsPolling();
    this.backoff.reset();
    this.services.clear();
    this.proxy = null;
    this.state = 'connecting';
    this.emitter.fire();
    void this.connect();
  }

  private async doConnect(): Promise<void> {
    this.state = 'connecting';
    this.emitter.fire();

    // Probe with a quick `status` call first — gives us the snapshot synchronously
    // and surfaces errors before opening the streaming subscription.
    try {
      const [snapshot, infoResult] = await Promise.all([
        sendRpc(this.socketPath, 'status', {}, { timeoutMs: 2000 }) as Promise<{ services: ServiceSnapshot[]; proxy: ProxyInfo | null }>,
        sendRpc(this.socketPath, 'info', {}, { timeoutMs: 2000 }).catch(() => null) as Promise<ProjectInfo | null>,
      ]);
      // dispose() can land during the probe above; without this the poll
      // interval and the stream below outlive the extension, and nothing is
      // left holding a reference to clear them.
      if (this.disposed) return;
      // `onConnectionLost()` can have run while the probe was in flight — a
      // late close from the previous socket — arming a reconnect. Left armed,
      // it fires against this healthy connection: the state flickers back
      // through 'connecting', the tree empties, and the live subscription is
      // replaced without being closed.
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.services.clear();
      for (const s of snapshot.services ?? []) this.services.set(s.name, s);
      this.proxy = snapshot.proxy ?? null;
      if (infoResult) this.info = infoResult;
      this.state = 'connected';
      // Before the event, not after: this drops stats left over from the
      // previous connection, and firing first would render them once more.
      this.startStatsPolling();
      this.emitter.fire();
    } catch {
      this.state = 'unreachable';
      this.services.clear();
      this.emitter.fire();
      this.scheduleReconnect();
      return;
    }

    // Belt and braces with the timer clear above: never overwrite a live
    // subscription, or its socket stays open for the life of the window,
    // writing into `services` and firing events from a stream nobody owns.
    this.subscription?.close();
    this.subscription = openStream(
      this.socketPath, 'status.follow', {},
      (frame: StreamFrame) => {
        // Reset here rather than after the `status` probe: one-shot RPCs can
        // succeed against a daemon whose `status.follow` then fails or drops
        // immediately, and resetting on the probe turns that into a flat 3 s
        // connect/fail loop — the retry storm the backoff exists to stop. A
        // delivered frame is proof the subscription works.
        this.backoff.reset();
        if (frame.event !== 'status' || !Array.isArray(frame.data)) return;
        const prevNames = new Set(this.services.keys());
        for (const s of frame.data as ServiceSnapshot[]) {
          this.services.set(s.name, s);
        }
        this.detectReloadChanges(prevNames);
        this.emitter.fire();
      },
      () => this.onConnectionLost(),
      () => this.onConnectionLost(),
    );
  }

  /** What `devup: Refresh services` does — the view-title button and the
   *  Command Palette entry. It used to be a no-op justified by "reconnect
   *  happens in <= 3 s anyway", which stopped being true the moment the delay
   *  started doubling: without this, starting the daemon and asking for a
   *  refresh means waiting out up to 30 s of a backoff you cannot see. */
  refresh(): void {
    if (this.disposed) return;
    if (this.connecting) { this.refreshPending = true; return; }
    if (this.state === 'connected') {
      // Nothing to reconnect. Re-poll the stats, which the stream does not
      // carry, and redraw.
      void this.pollStats();
      this.emitter.fire();
      return;
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.backoff.reset();
    void this.connect();
  }

  private async pollStats(): Promise<void> {
    if (this.state !== 'connected') return;
    try {
      const result = await sendRpc(this.socketPath, 'stats', {}, { timeoutMs: 3000 }) as StatsResult;
      // The stream can drop while this RPC is in flight, in which case the
      // disconnect has already cleared the cache — repopulating it now would
      // leave the status bar showing host memory for a daemon that is gone.
      if (this.disposed || this.state !== 'connected') return;
      // Only when a number actually moved: this poll runs every 3 s forever,
      // and every subscriber recomputes on each event (issue #40).
      if (this.stats.update(result)) this.emitter.fire();
    } catch { /* core < 0.10.0 or transient — degrade gracefully */ }
  }

  private startStatsPolling(): void {
    this.stopStatsPolling();
    void this.pollStats();
    this.statsTimer = setInterval(() => void this.pollStats(), 3000);
  }

  private stopStatsPolling(): void {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    // Callers fire their own event around this, so the return is not needed.
    this.stats.clear();
  }

  private detectReloadChanges(prevNames: Set<string>): void {
    if (!vscode.workspace.getConfiguration('devup.notifications').get<boolean>('configReload', true)) return;
    const currentNames = new Set(this.services.keys());
    const added = [...currentNames].filter(n => !prevNames.has(n));
    const removed = [...prevNames].filter(n => !currentNames.has(n));
    if (!added.length && !removed.length) return;
    const parts: string[] = [];
    if (added.length) parts.push(`added: ${added.join(', ')}`);
    if (removed.length) parts.push(`removed: ${removed.join(', ')}`);
    void vscode.window.showInformationMessage(`devup: config reloaded — ${parts.join('; ')}`);
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

  /** The daemon has just been asked to start or restart, so a disconnect is
   *  expected and so is a quick recovery. Retry every couple of seconds for
   *  the window, rather than leaving the user watching "not running" for half
   *  a minute after their stack is up. */
  expectRestart(windowMs = 60_000): void {
    if (this.disposed) return;
    this.fastRetryUntil = Date.now() + windowMs;
    this.refresh();
  }

  /** Called when the user stops the daemon: retrying hard against something
   *  they have just asked to go away helps nobody. */
  cancelExpectedRestart(): void {
    this.fastRetryUntil = 0;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    const delay = reconnectDelay(this.backoff, this.fastRetryUntil, Date.now());
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopStatsPolling();
    this.subscription?.close();
    this.emitter.dispose();
  }
}
