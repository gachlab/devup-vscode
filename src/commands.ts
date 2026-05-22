import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import type { StatusStore, ServiceSnapshot } from './status-store.js';
import { buildServiceUrl } from './url-builder.js';
import type { LogChannels } from './log-channels.js';

import { extractSvcName } from './svc-name.js';
export { extractSvcName };

type ServiceArg = string | Record<string, unknown> | undefined;

async function resolveServiceName(arg: ServiceArg, store: StatusStore, prompt: string): Promise<string | null> {
  const name = extractSvcName(arg);
  if (name) return name;
  // Picker fallback.
  const all = store.getAll();
  if (!all.length) {
    void vscode.window.showInformationMessage('devup: no services available.');
    return null;
  }
  const items = all.map(s => ({ label: s.name, description: `:${s.port}  ${s.status}/${s.health}`, svc: s.name }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: prompt });
  return picked?.svc ?? null;
}

export function registerServiceCommands(
  context: vscode.ExtensionContext,
  store: StatusStore,
  logChannels: LogChannels,
  socketPath: string,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.tailLogs', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Tail logs for which service?');
      if (svc) logChannels.tail(svc);
    }),

    vscode.commands.registerCommand('devup.restart', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Restart which service?');
      if (!svc) return;
      try {
        await sendRpc(socketPath, 'restart', { svc });
        void vscode.window.showInformationMessage(`devup: restart sent to "${svc}"`);
      } catch (e) {
        void vscode.window.showErrorMessage(`devup: restart failed — ${rpcMessage(e)}`);
      }
    }),

    vscode.commands.registerCommand('devup.stop', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Stop which service?');
      if (!svc) return;
      try {
        await sendRpc(socketPath, 'stop', { svc });
        void vscode.window.showInformationMessage(`devup: stop sent to "${svc}"`);
      } catch (e) {
        void vscode.window.showErrorMessage(`devup: stop failed — ${rpcMessage(e)}`);
      }
    }),

    vscode.commands.registerCommand('devup.openInBrowser', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Open which service in browser?');
      if (!svc) return;
      const info = store.getAll().find(s => s.name === svc);
      if (!info) {
        void vscode.window.showWarningMessage(`devup: "${svc}" not found.`);
        return;
      }
      const url = buildServiceUrl(svc, info.port, store.getProxy());
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('devup.openTerminal', async (arg?: ServiceArg) => {
      const name = extractSvcName(arg);
      const svcName = name ?? await (async () => {
        const all = store.getAll();
        if (!all.length) return null;
        const picked = await vscode.window.showQuickPick(
          all.map(s => ({ label: s.name, description: s.cwd ?? s.type })),
          { placeHolder: 'Open terminal for which service?' },
        );
        return picked?.label ?? null;
      })();
      if (!svcName) return;
      const svc = store.getAll().find(s => s.name === svcName);
      if (!svc?.cwd) { void vscode.window.showWarningMessage(`devup: cwd not available for "${svcName}"`); return; }
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const fullCwd = svc.cwd.startsWith('/') ? svc.cwd : `${workspaceRoot}/${svc.cwd}`;
      const term = vscode.window.createTerminal({ name: `devup: ${svcName}`, cwd: fullCwd });
      term.show();
    }),

    vscode.commands.registerCommand('devup.refresh', () => {
      // Tree-view refresh button. Store updates flow through onDidChange already;
      // this is a no-op trigger for users to force-feel a refresh after the daemon
      // restarts (reconnect happens in ≤3 s anyway).
      // Nothing to do — the store reconnects autonomously.
    }),
  );
}

function rpcMessage(e: unknown): string {
  if (e instanceof RpcCallError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Aggregate service info, used by status bar fallback when the store is empty. */
export function summarize(services: ServiceSnapshot[]): { up: number; total: number; anyCrashed: boolean } {
  return {
    up: services.filter(s => s.health === 'up').length,
    total: services.length,
    anyCrashed: services.some(s => s.status === 'crashed'),
  };
}
