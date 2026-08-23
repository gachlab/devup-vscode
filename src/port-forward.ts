import * as vscode from 'vscode';
import type { StatusStore } from './status-store.js';
import { canonicalPort, describeRemap, isPortIgnored, parseForwardMode, reactToState, selectForwardPorts, type ForwardMode } from './forward-logic.js';

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
  /** Ports already reported as remapped. The warning is worth saying once, not
   *  every 30 s. Cleared when the daemon comes back, since the port set — and
   *  what the editor could bind — may be different by then. */
  private readonly remapWarned = new Set<number>();
  /** Set by `devup: Close forwarded ports…`. The editor's picker is the only
   *  way to close a tunnel, and it does not tell us which ones went — so
   *  re-asserting on the 30 s timer would silently re-open everything the user
   *  had just closed. Forwarding resumes when the daemon next connects, or
   *  when `devup.portForwarding` changes. */
  private paused = false;

  constructor(private readonly store: StatusStore) {}

  /** Stop re-asserting until the daemon next connects.
   *
   *  Deliberately keeps the record of what was requested. The picker gives no
   *  result back, so a user who cancels it — or closes one port of five —
   *  leaves tunnels open; forgetting them here would disarm the outage warning
   *  for exactly the ports it exists for. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.lastWanted = '';
    this.changeEmitter.fire();
  }

  /** Undo a pause that turned out not to be wanted. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastWanted = '';
    void this.sync();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Whether a forward has been requested for this port. */
  isForwarded(port: number): boolean {
    return this.requested.has(port);
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
      // An explicit change of intent resumes forwarding.
      this.paused = false;
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
    const reaction = reactToState({
      previous,
      next: state,
      paused: this.paused,
      restartExpected: this.store.isRestartExpected(),
      remote: !!vscode.env.remoteName,
      hasRequested: this.requested.size > 0,
    });
    if (reaction === 'resume') { this.resume(); return; }
    if (reaction !== 'warn') return;
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

  /** An app that hardcodes `http://localhost:<port>` — which is how a frontend
   *  usually calls its API — reaches nothing when the editor had to bind a
   *  different port, and nothing on screen says so. The Ports view knows; it
   *  is just not where anyone is looking. */
  private reportRemap(port: number, resolved: vscode.Uri): void {
    if (this.remapWarned.has(port)) return;
    const what = describeRemap(port, resolved);
    if (!what) return;
    this.remapWarned.add(port);
    const services = this.store.getAll()
      .filter(s => canonicalPort(s) === port)
      .map(s => `"${s.name}"`)
      .join(', ');
    void vscode.window.showWarningMessage(
      `devup: ${services || `port ${port}`} ${what}. `
      + 'Anything calling the original port directly — a frontend hardcoding its API URL — will not reach it.',
      'Show Ports',
    ).then(choice => {
      if (choice) void vscode.commands.executeCommand('workbench.view.remote.tunnelPanel.focus');
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
    if (this.disposed || this.paused || !vscode.env.remoteName) return;
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
        const resolved = await vscode.env.asExternalUri(vscode.Uri.parse(`http://localhost:${port}`));
        // Read, not cached: what goes stale is the uri, and it is still
        // dropped. What is kept is the answer to "did the port survive?".
        this.reportRemap(port, resolved);
        if (!this.requested.has(port)) { this.requested.add(port); changed = true; }
      } catch {
        // Transient — port not bound yet, or the resolver is busy mid-reconnect.
        // The next pass retries. Deliberately does *not* drop the port from
        // `requested`: whatever the editor already opened is still open, and
        // forgetting it would flicker the tree marker and, on the last pass
        // before a daemon dies, suppress the outage warning entirely.
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
