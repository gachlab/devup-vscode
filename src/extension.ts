import * as vscode from 'vscode';
import { discover } from './discovery.js';
import { DevupStatusBar } from './status-bar.js';

let statusBar: DevupStatusBar | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    // No workspace open — extension simply stays dormant.
    return;
  }
  const discovery = discover(folder);
  if (!discovery) return;

  statusBar = new DevupStatusBar(discovery);
  statusBar.start();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('devup.showStatus', async () => {
      const agg = await statusBar?.refresh();
      if (!agg) return;
      if (agg.kind === 'unreachable') {
        const choice = await vscode.window.showWarningMessage(
          `devup is not running for "${discovery.projectName}".`,
          'Start it (devup up -d)', 'Open project setting',
        );
        if (choice === 'Start it (devup up -d)') {
          const term = vscode.window.createTerminal({ name: 'devup' });
          term.show();
          term.sendText('devup up -d');
        } else if (choice === 'Open project setting') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'devup.projectName');
        }
      } else {
        void vscode.window.showInformationMessage(
          `devup: ${agg.up}/${agg.total} services up` + (agg.anyCrashed ? ' — some crashed' : ''),
        );
      }
    }),
  );
}

export function deactivate(): void {
  statusBar?.dispose();
  statusBar = null;
}
