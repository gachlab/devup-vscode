import * as vscode from 'vscode';
import { discover } from './discovery.js';
import { DevupStatusBar } from './status-bar.js';
import { LogChannels } from './log-channels.js';
import { StatusStore } from './status-store.js';
import { ServicesTreeProvider } from './services-tree.js';
import { registerServiceCommands } from './commands.js';
import { registerDaemonCommands } from './daemon-commands.js';

let statusBar: DevupStatusBar | null = null;
let logChannels: LogChannels | null = null;
let store: StatusStore | null = null;
let tree: ServicesTreeProvider | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const discovery = discover(folder);
  if (!discovery) return;

  // Single source of truth for service state, fed by `status.follow`.
  store = new StatusStore(discovery.socketPath);
  store.start();
  context.subscriptions.push(store);

  // Live log streaming per service.
  logChannels = new LogChannels(discovery.socketPath);
  context.subscriptions.push(logChannels);

  // Status bar — derives from the store.
  statusBar = new DevupStatusBar(discovery, store);
  context.subscriptions.push(statusBar);

  // Sidebar tree view — also derives from the store.
  tree = new ServicesTreeProvider(store);
  const treeView = vscode.window.createTreeView('devupServices', { treeDataProvider: tree });
  context.subscriptions.push(treeView);

  // Crash badge on the activity bar icon — count of crashed services.
  // Cleared automatically when none are crashed.
  const updateBadge = () => {
    const crashed = store!.getAll().filter(s => s.status === 'crashed');
    treeView.badge = crashed.length
      ? { value: crashed.length, tooltip: `${crashed.length} service${crashed.length === 1 ? '' : 's'} crashed` }
      : undefined;
  };
  context.subscriptions.push(store.onDidChange(updateBadge));
  updateBadge();

  // Maintain a context key that menu `when` clauses can branch on.
  // Updated whenever the store's connection state changes.
  const updateContext = () => {
    void vscode.commands.executeCommand('setContext', 'devup.daemonReachable', store!.getState() === 'connected');
  };
  context.subscriptions.push(store.onDidChange(updateContext));
  updateContext();

  // Per-service commands (tailLogs / restart / stop / openInBrowser / refresh).
  registerServiceCommands(context, store, logChannels, discovery.socketPath);

  // Daemon-level commands (start / stop / restart).
  registerDaemonCommands(context, folder.uri.fsPath);

  // Show-status notification command (legacy entry point).
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.showStatus', async () => {
      const state = store!.getState();
      if (state !== 'connected') {
        const choice = await vscode.window.showWarningMessage(
          `devup is not running for "${discovery.projectName}".`,
          'Start it (devup up -d)',
        );
        if (choice === 'Start it (devup up -d)') {
          const term = vscode.window.createTerminal({ name: 'devup' });
          term.show();
          term.sendText('devup up -d');
        }
        return;
      }
      const all = store!.getAll();
      const up = all.filter(s => s.health === 'up').length;
      const crashed = all.some(s => s.status === 'crashed');
      void vscode.window.showInformationMessage(
        `devup: ${up}/${all.length} services up` + (crashed ? ' — some crashed' : ''),
      );
    }),
  );
}

export function deactivate(): void {
  // Disposal is handled via context.subscriptions; null out our refs.
  statusBar = null;
  logChannels = null;
  store = null;
  tree = null;
}
