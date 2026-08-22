import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { discoverWorkspace, type DiscoveryResult } from './discovery.js';
import { describeDiagnosis, diagnose, type Diagnosis } from './diagnosis.js';
import { DevupStatusBar } from './status-bar.js';
import { LogChannels } from './log-channels.js';
import { StatusStore } from './status-store.js';
import { ServicesTreeProvider } from './services-tree.js';
import { registerServiceCommands } from './commands.js';
import { registerDaemonCommands } from './daemon-commands.js';
import { ServiceDetailPanels } from './service-detail.js';
import { ProfilePicker } from './profile-picker.js';
import { PortForwarder } from './port-forward.js';
import { canonicalPort } from './forward-logic.js';

/** Every config file discovery consults, as a watcher glob. */
const CONFIG_GLOB = '**/devup.config.{ts,js,json}';

/** A watcher fires on every save, and under `files.autoSave: afterDelay` a
 *  save lands mid-word. Renaming `Guesthub` would otherwise resolve — and tear
 *  down and reconnect to — a socket for `Guest`, `Guesth`, `Guesthu`…
 *
 *  Read from the editor's own delay rather than hardcoded: a debounce shorter
 *  than the autosave interval debounces nothing, since consecutive saves are
 *  already further apart than the window. */
const REDISCOVER_DEBOUNCE_FLOOR_MS = 1_500;

function rediscoverDebounceMs(): number {
  const files = vscode.workspace.getConfiguration('files');
  const autoSaveDelay = files.get<number>('autoSaveDelay', 1_000);
  const afterDelay = files.get<string>('autoSave', 'off') === 'afterDelay';
  const delay = afterDelay && Number.isFinite(autoSaveDelay) ? autoSaveDelay : 0;
  return Math.max(REDISCOVER_DEBOUNCE_FLOOR_MS, delay + 750);
}

export function activate(context: vscode.ExtensionContext): void {
  const initial = discoverWorkspace();
  if (!initial) {
    // No folder open. The view is contributed statically, so it is reachable
    // from the activity bar; without this the welcome clauses all evaluate
    // false and it renders blank.
    void vscode.commands.executeCommand('setContext', 'devup.diagnosis', 'noWorkspace');
    return;
  }

  // Not const: discovery re-runs when the config file or the overriding
  // settings change, and everything below reads it through a closure rather
  // than capturing a path that a rename would invalidate (issue #38).
  let discovery: DiscoveryResult = initial;
  const socketPath = () => discovery.socketPath;
  const folderPath = () => discovery.folder.uri.fsPath;

  // Single source of truth for service state, fed by `status.follow`.
  const activeStore = new StatusStore(discovery.socketPath);
  activeStore.start();
  context.subscriptions.push(activeStore);

  // Tunnel service ports back to the local machine when attached to a remote
  // host — the daemon spawns services detached, so VS Code never auto-detects
  // them. No-op in a local window.
  const portForwarder = new PortForwarder(activeStore);
  portForwarder.start();
  context.subscriptions.push(portForwarder);

  // Live log streaming per service.
  const activeLogChannels = new LogChannels(socketPath);
  context.subscriptions.push(activeLogChannels);

  // Status bar — derives from the store.
  const activeStatusBar = new DevupStatusBar(discovery, activeStore);
  context.subscriptions.push(activeStatusBar);

  // Sidebar tree view — also derives from the store.
  const tree = new ServicesTreeProvider(activeStore);
  const treeView = vscode.window.createTreeView('devupServices', { treeDataProvider: tree });
  context.subscriptions.push(treeView, tree);

  // Crash badge on the activity bar icon — count of crashed services.
  // Cleared automatically when none are crashed.
  const updateBadge = () => {
    const crashed = activeStore.getAll().filter(s => s.status === 'crashed');
    treeView.badge = crashed.length
      ? { value: crashed.length, tooltip: `${crashed.length} service${crashed.length === 1 ? '' : 's'} crashed` }
      : undefined;
  };

  /** Why the daemon cannot be reached, from what discovery already knows. */
  const currentDiagnosis = (): Diagnosis => diagnose({
    state: activeStore.getState(),
    configFile: discovery.configFile,
    source: discovery.source,
    socketExists: existsSync(discovery.socketPath),
  });

  // Context keys the menus and the welcome view branch on. `devup.diagnosis`
  // carries the same value `diagnose()` returns, so the four cases the welcome
  // view distinguishes cannot drift from the four this computes (issue #46).
  const updateContext = () => {
    void vscode.commands.executeCommand('setContext', 'devup.daemonReachable', activeStore.getState() === 'connected');
    void vscode.commands.executeCommand('setContext', 'devup.diagnosis', currentDiagnosis());
  };

  context.subscriptions.push(activeStore.onDidChange(() => { updateBadge(); updateContext(); }));
  updateBadge();
  updateContext();

  // Per-service commands (tailLogs / restart / stop / openInBrowser / refresh).
  registerServiceCommands(context, activeStore, activeLogChannels, socketPath, folderPath);

  // Service detail webview panels.
  const activeDetailPanels = new ServiceDetailPanels(activeStore, socketPath);
  context.subscriptions.push(activeDetailPanels);
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.openServiceDetail', async (arg?: string | Record<string, unknown>) => {
      let svcName: string | undefined;
      if (typeof arg === 'string') {
        svcName = arg;
      } else if (arg && typeof arg === 'object') {
        // Tree node: { kind: 'service', svc: ServiceSnapshot }
        if (arg['kind'] === 'service' && arg['svc'] && typeof (arg['svc'] as Record<string, unknown>)['name'] === 'string') {
          svcName = (arg['svc'] as Record<string, unknown>)['name'] as string;
        } else if (typeof arg['svc'] === 'string') {
          svcName = arg['svc'];
        } else if (typeof arg['name'] === 'string') {
          svcName = arg['name'];
        }
      }
      if (!svcName) {
        const all = activeStore.getAll();
        if (!all.length) { void vscode.window.showInformationMessage('devup: no services available.'); return; }
        const picked = await vscode.window.showQuickPick(
          all.map(s => ({ label: s.name, description: `:${canonicalPort(s)}  ${s.status}/${s.health}`, svc: s.name })),
          { placeHolder: 'Open detail panel for which service?' },
        );
        svcName = picked?.svc;
      }
      if (svcName) activeDetailPanels.open(svcName);
    }),
  );

  // Profile picker status bar item.
  context.subscriptions.push(new ProfilePicker(activeStore, context));

  // Daemon-level commands (start / stop / restart).
  registerDaemonCommands(context, folderPath, activeStore);

  // ── Re-discovery ─────────────────────────────────────────────────────────
  // Discovery used to run once, at activation, so renaming a project moved its
  // socket and the extension went quiet until the window was reloaded.
  // Log streams and detail panels are retargeted when the *store* next
  // connects, not when the path moves. At the moment of a rename the daemon is
  // still running under the old name, so the new socket does not exist yet:
  // re-opening a stream there fails immediately and, unlike the store, a log
  // stream has no backoff — the channel would print "socket not found" and
  // stay dead for the rest of the session.
  let retargetOnConnect = false;
  context.subscriptions.push(activeStore.onDidChange(() => {
    if (!retargetOnConnect || activeStore.getState() !== 'connected') return;
    retargetOnConnect = false;
    activeLogChannels.retarget();
    activeDetailPanels.retarget();
  }));

  const rediscover = () => {
    const next = discoverWorkspace();
    // Every folder closed. Keep talking to the daemon we know about rather
    // than tearing everything down for a workspace that no longer exists.
    if (!next) return;
    const moved = next.socketPath !== discovery.socketPath;
    discovery = next;
    activeStatusBar.setDiscovery(next);
    updateContext();
    if (!moved) return;
    retargetOnConnect = true;
    activeStore.setSocketPath(next.socketPath);
  };

  let rediscoverTimer: NodeJS.Timeout | null = null;
  const rediscoverSoon = () => {
    if (rediscoverTimer) clearTimeout(rediscoverTimer);
    rediscoverTimer = setTimeout(() => { rediscoverTimer = null; rediscover(); }, rediscoverDebounceMs());
  };

  const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
  context.subscriptions.push(
    watcher,
    { dispose: () => { if (rediscoverTimer) clearTimeout(rediscoverTimer); } },
    watcher.onDidCreate(rediscoverSoon),
    watcher.onDidChange(rediscoverSoon),
    watcher.onDidDelete(rediscoverSoon),
    // The activation event fires on a config in any folder, so which folder is
    // the devup one can change as folders are added or removed.
    // These two are deliberate acts rather than a stream of saves, so they
    // take effect at once.
    vscode.workspace.onDidChangeWorkspaceFolders(rediscover),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devup.socketPath') || e.affectsConfiguration('devup.projectName')) rediscover();
    }),
  );

  // ── Diagnostics ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.diagnostics', async () => {
      const d = currentDiagnosis();
      const detail = describeDiagnosis(d, {
        projectName: discovery.projectName,
        socketPath: discovery.socketPath,
        source: discovery.source,
        configFile: discovery.configFile,
        socketExists: existsSync(discovery.socketPath),
      });
      const actions: string[] = [];
      if (d === 'socketMissing') actions.push('Start daemon');
      if (d === 'noAnswer') actions.push('Restart daemon');
      if (d === 'guessedName' || d === 'noConfig') actions.push('Set project name…');
      actions.push('Copy socket path');
      const choice = await vscode.window.showInformationMessage(
        'devup: connection details', { modal: true, detail }, ...actions,
      );
      switch (choice) {
        case 'Start daemon':       void vscode.commands.executeCommand('devup.daemon.start'); break;
        case 'Restart daemon':     void vscode.commands.executeCommand('devup.daemon.restart'); break;
        case 'Set project name…':  void vscode.commands.executeCommand('devup.setProjectName'); break;
        case 'Copy socket path':   await vscode.env.clipboard.writeText(discovery.socketPath); break;
      }
    }),

    vscode.commands.registerCommand('devup.setProjectName', async () => {
      const current = discovery.source === 'projectName setting' ? discovery.projectName : '';
      const value = await vscode.window.showInputBox({
        title: 'devup: project name',
        prompt: 'The `name` from your devup config. The socket is ~/.devup/sock-<name>.sock.',
        value: current,
        placeHolder: discovery.projectName,
      });
      if (value === undefined) return; // dismissed
      // `devup.projectName` is window-scoped, so Workspace is the narrowest
      // target it accepts; the configuration listener above re-runs discovery.
      await vscode.workspace.getConfiguration('devup', discovery.folder)
        .update('projectName', value.trim(), vscode.ConfigurationTarget.Workspace);
    }),
  );

  // Show-status notification command (legacy entry point).
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.showStatus', async () => {
      const state = activeStore.getState();
      if (state !== 'connected') {
        const choice = await vscode.window.showWarningMessage(
          `devup is not running for "${discovery.projectName}".`,
          'Start it (devup up -d)',
          'Why?',
        );
        if (choice === 'Start it (devup up -d)') void vscode.commands.executeCommand('devup.daemon.start');
        if (choice === 'Why?') void vscode.commands.executeCommand('devup.diagnostics');
        return;
      }
      const all = activeStore.getAll();
      const up = all.filter(s => s.health === 'up').length;
      const crashed = all.some(s => s.status === 'crashed');
      void vscode.window.showInformationMessage(
        `devup: ${up}/${all.length} services up` + (crashed ? ' — some crashed' : ''),
      );
    }),
  );
}

export function deactivate(): void {
  // Nothing to do: everything with a lifetime is registered on
  // context.subscriptions, which the editor disposes for us. The module-level
  // references this used to null out were write-only.
}
