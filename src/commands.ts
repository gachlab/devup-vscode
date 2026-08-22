import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import { logDirFor, logFileFor } from './log-paths.js';
import type { StatusStore, ServiceSnapshot } from './status-store.js';
import { buildServiceUrl } from './url-builder.js';
import { canonicalPort } from './forward-logic.js';
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
  const items = all.map(s => ({ label: s.name, description: `:${canonicalPort(s)}  ${s.status}/${s.health}`, svc: s.name }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: prompt });
  return picked?.svc ?? null;
}

export function registerServiceCommands(
  context: vscode.ExtensionContext,
  store: StatusStore,
  logChannels: LogChannels,
  socketPath: () => string,
  workspaceRoot: () => string,
  projectName: () => string,
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
        await sendRpc(socketPath(), 'restart', { svc });
        void vscode.window.showInformationMessage(`devup: restart sent to "${svc}"`);
      } catch (e) {
        void vscode.window.showErrorMessage(`devup: restart failed — ${rpcMessage(e)}`);
      }
    }),

    vscode.commands.registerCommand('devup.stop', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Stop which service?');
      if (!svc) return;
      try {
        await sendRpc(socketPath(), 'stop', { svc });
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
      // canonicalPort, not info.port: for a lazy service the snapshot carries
      // the rewritten port, and opening that reaches the service directly
      // instead of the proxy that starts it on demand.
      const url = buildServiceUrl(svc, canonicalPort(info), store.getProxy());
      // Do not reach for asExternalUri here: the API docs are explicit that
      // "uris passed through openExternal are automatically resolved and you
      // should not call asExternalUri on them" — doing both resolves twice and
      // tunnels to a port nothing listens on.
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
      // The devup folder, which in a multi-root workspace is not necessarily
      // the first one — service cwds are relative to the config's folder.
      const fullCwd = svc.cwd.startsWith('/') ? svc.cwd : `${workspaceRoot()}/${svc.cwd}`;
      const term = vscode.window.createTerminal({ name: `devup: ${svcName}`, cwd: fullCwd });
      term.show();
    }),

    vscode.commands.registerCommand('devup.copyUrl', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Copy the URL of which service?');
      if (!svc) return;
      const info = store.getAll().find(s => s.name === svc);
      if (!info) { void vscode.window.showWarningMessage(`devup: "${svc}" not found.`); return; }
      // Same URL `Open in browser` uses, proxy route and all — the one thing
      // most often wanted and, until now, unavailable at any speed (issue #44).
      const url = buildServiceUrl(svc, canonicalPort(info), store.getProxy());
      await vscode.env.clipboard.writeText(url);
      void vscode.window.showInformationMessage(`devup: copied ${url}`);
    }),

    vscode.commands.registerCommand('devup.openLogFile', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Open the log file of which service?');
      if (!svc) return;
      const file = logFileFor(projectName(), svc, logDirOverride());
      if (!existsSync(file)) {
        // Rotated per launch, so "not yet" is a normal state rather than an
        // error — and the path is what someone needs in order to check.
        void vscode.window.showWarningMessage(`devup: no log file for "${svc}" yet.\n${file}`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    vscode.commands.registerCommand('devup.revealLogs', async () => {
      const dir = logDirFor(projectName(), logDirOverride());
      if (!existsSync(dir)) {
        void vscode.window.showWarningMessage(`devup: no logs folder yet.\n${dir}`);
        return;
      }
      if (vscode.env.remoteName) {
        // The logs are on the remote host, where the daemon runs, and
        // `revealFileInOS` would open a file manager on the local machine —
        // pointed at a path that does not exist there.
        const choice = await vscode.window.showInformationMessage(
          `devup: logs are on the remote host at ${dir}`, 'Copy path',
        );
        if (choice) await vscode.env.clipboard.writeText(dir);
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),

    vscode.commands.registerCommand('devup.closeForwardedPorts', async () => {
      if (!vscode.env.remoteName) {
        void vscode.window.showInformationMessage('devup: nothing is forwarded — this is a local window.');
        return;
      }
      // The editor owns tunnel lifetime and exposes no API to close one. Its
      // own picker is the closest thing, and it at least removes the hunt.
      try {
        await vscode.commands.executeCommand('remote.tunnel.closeCommandPalette');
      } catch {
        void vscode.window.showWarningMessage(
          'devup: this editor does not offer a close-port picker. Close them from the Ports view.',
        );
      }
    }),

    vscode.commands.registerCommand('devup.refresh', () => {
      // Reconnecting is autonomous, but it backs off to 30 s while the daemon
      // stays down — so someone who has just started one should not have to
      // wait out a delay they cannot see. This retries immediately. Reachable
      // from the refresh button in the view title and the Command Palette.
      store.refresh();
    }),
  );
}

/** `devup --log-dir` moves the root and the daemon does not publish where to,
 *  so anyone using it has to say so here. */
function logDirOverride(): string | undefined {
  return vscode.workspace.getConfiguration('devup').get<string>('logDir')?.trim() || undefined;
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
