import * as vscode from 'vscode';
import { discover } from './discovery.js';
import { DevupStatusBar } from './status-bar.js';
import { LogChannels } from './log-channels.js';
import { sendRpc, RpcCallError } from './socket-client.js';

interface ServiceSnapshot {
  name: string;
  status: string;
  health: string;
  type: string;
  port: number;
}

let statusBar: DevupStatusBar | null = null;
let logChannels: LogChannels | null = null;

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

  logChannels = new LogChannels(discovery.socketPath);
  context.subscriptions.push(logChannels);

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

    vscode.commands.registerCommand('devup.tailLogs', async () => {
      const services = await fetchServices(discovery.socketPath);
      if (!services) return;
      if (!services.length) {
        void vscode.window.showInformationMessage('devup: no services registered yet.');
        return;
      }
      const items = services.map(s => ({
        label: `$(${statusIcon(s)}) ${s.name}`,
        description: `:${s.port}  ${s.status}/${s.health}`,
        svc: s.name,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Tail logs for which service? (${services.length} total)`,
        matchOnDescription: true,
      });
      if (!picked) return;
      logChannels!.tail(picked.svc);
    }),
  );
}

async function fetchServices(socketPath: string): Promise<ServiceSnapshot[] | null> {
  try {
    const result = await sendRpc(socketPath, 'status', {}, { timeoutMs: 2000 }) as { services: ServiceSnapshot[] };
    return result.services ?? [];
  } catch (e) {
    const reason = e instanceof RpcCallError ? e.message : String(e);
    const choice = await vscode.window.showWarningMessage(
      `devup is not running (${reason}).`,
      'Start it (devup up -d)',
    );
    if (choice === 'Start it (devup up -d)') {
      const term = vscode.window.createTerminal({ name: 'devup' });
      term.show();
      term.sendText('devup up -d');
    }
    return null;
  }
}

function statusIcon(s: ServiceSnapshot): string {
  if (s.status === 'crashed') return 'error';
  if (s.health === 'up') return 'check';
  if (s.status === 'idle') return 'circle-outline';
  return 'sync~spin';
}

export function deactivate(): void {
  statusBar?.dispose();
  statusBar = null;
  logChannels?.dispose();
  logChannels = null;
}
