import * as vscode from 'vscode';
import type { StatusStore } from './status-store.js';
import { isPortIgnored, parseForwardMode, selectForwardPorts, type ForwardMode } from './forward-logic.js';

/** Asks the editor to tunnel devup service ports back to the local machine.
 *
 *  VS Code auto-forwards only the ports it observes being opened — typically in
 *  an integrated terminal — and the devup daemon spawns its services detached,
 *  so none of them are ever noticed. `asExternalUri` requests the tunnel
 *  explicitly, which also makes the port appear in the Ports view.
 *
 *  In a local window `asExternalUri` is documented as a no-op, but there is
 *  nothing to forward either, so this class stays idle unless `env.remoteName`
 *  is set. Note that `remoteName` also covers Codespaces and Remote Tunnels,
 *  where the editor publishes the port on a hosted relay rather than binding it
 *  on a local machine — still useful, but the address is whatever the Ports
 *  view reports, not localhost. */
export class PortForwarder implements vscode.Disposable {
  /** The editor owns tunnel lifetime and the user can close one from the Ports
   *  view. No stable API reports that, and the docs warn against caching a
   *  resolved uri, so re-assert on a slow cadence instead of forwarding once. */
  private static readonly REASSERT_MS = 30_000;

  private readonly inFlight = new Set<number>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastWanted = '';
  private disposed = false;
  /** Ports the editor accepted a forward request for, most recently.
   *
   *  This is not the cached uri the docs warn against — that is the thing that
   *  goes stale, and it is still dropped. It is a record of what was asked
   *  for, re-asserted every 30 s, and it is the only thing the extension can
   *  know: there is no stable API to enumerate open tunnels, so the Ports view
   *  remains the source of truth for the address (issue #42). */
  private readonly requested = new Set<number>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when the set of forwarded ports changes. */
  readonly onDidChangeForwarded = this.changeEmitter.event;
  private lastState: string | null = null;

  constructor(private readonly store: StatusStore) {}

  /** Whether a forward has been requested for this port. */
  isForwarded(port: number): boolean {
    return this.requested.has(port);
  }

  get active(): boolean {
    return this.requested.size > 0;
  }

  start(): void {
    // Services appear as the daemon connects and change on hot reload. The
    // store also fires every few seconds for stats, so only react when the set
    // of ports actually changes — the timer covers everything else.
    this.subscriptions.push(this.store.onDidChange(() => {
      this.checkForOutage();
      const wanted = this.wantedPorts().join(',');
      if (wanted === this.lastWanted) return;
      this.lastWanted = wanted;
      void this.sync();
    }));

    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('devup.portForwarding') && !e.affectsConfiguration('remote.portsAttributes')) return;
      this.lastWanted = '';
      void this.sync();
    }));

    this.timer = setInterval(() => void this.sync(), PortForwarder.REASSERT_MS);
    void this.sync();
  }

  /** Stopping the daemon leaves every tunnel open, bound against a remote side
   *  with nothing listening — so a request to one *hangs* rather than failing
   *  fast, which reads as a slow service rather than a dead one. The editor
   *  owns tunnel lifetime and exposes no way to close one programmatically, so
   *  the best available move is to say so and offer the picker. */
  private checkForOutage(): void {
    const state = this.store.getState();
    const previous = this.lastState;
    this.lastState = state;
    if (previous !== 'connected' || state === 'connected') return;
    if (!vscode.env.remoteName || !this.requested.size) return;
    const count = this.requested.size;
    // Whatever was open is now pointing at nothing; stop claiming otherwise.
    this.requested.clear();
    this.lastWanted = '';
    this.changeEmitter.fire();
    void vscode.window.showWarningMessage(
      `devup: the daemon is gone and ${count} forwarded port${count === 1 ? '' : 's'} may still be open. `
      + 'Requests to them hang rather than fail.',
      'Close forwarded ports…',
    ).then(choice => {
      if (choice) void vscode.commands.executeCommand('devup.closeForwardedPorts');
    });
  }

  private mode(): ForwardMode {
    return parseForwardMode(vscode.workspace.getConfiguration('devup').get('portForwarding'));
  }

  private wantedPorts(): number[] {
    // An explicitly requested tunnel bypasses the editor's auto-forward
    // heuristics, so honour the one opt-out a user can express per port:
    // remote.portsAttributes with onAutoForward "ignore".
    const attributes = vscode.workspace.getConfiguration('remote').get('portsAttributes');
    return selectForwardPorts(this.store.getAll(), this.mode())
      .filter(port => !isPortIgnored(port, attributes));
  }

  private async sync(): Promise<void> {
    if (this.disposed || !vscode.env.remoteName) return;
    const wanted = this.wantedPorts();
    let changed = false;
    // A port that is no longer wanted (service gone, mode narrowed) is no
    // longer ours to claim, whatever the editor still has open.
    for (const port of [...this.requested]) {
      if (!wanted.includes(port)) { this.requested.delete(port); changed = true; }
    }
    for (const port of wanted) {
      if (this.disposed) break;
      if (this.inFlight.has(port)) continue;
      this.inFlight.add(port);
      try {
        // Result deliberately dropped rather than cached: the editor may hand
        // back a different local port, and a cached uri goes stale the moment
        // the user closes the tunnel. The Ports view is the source of truth.
        await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port}`));
        if (!this.requested.has(port)) { this.requested.add(port); changed = true; }
      } catch {
        // Transient — port not bound yet, or the resolver is busy mid-reconnect.
        // The next pass retries.
        if (this.requested.delete(port)) changed = true;
      } finally {
        this.inFlight.delete(port);
      }
    }
    if (changed && !this.disposed) this.changeEmitter.fire();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of this.subscriptions) s.dispose();
    this.subscriptions.length = 0;
    this.inFlight.clear();
    this.requested.clear();
    this.changeEmitter.dispose();
  }
}
