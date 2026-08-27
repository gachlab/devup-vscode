import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import { logDirFor, logFileFor } from './log-paths.js';
import { resolveServiceCwd } from './debug-config.js';
import type { StatusStore, ServiceSnapshot } from './status-store.js';
import { buildServiceUrl } from './url-builder.js';
import { canonicalPort } from './forward-logic.js';
import type { LogChannels } from './log-channels.js';

import { extractSvcName } from './svc-name.js';
import { actionOutcome, supportsRemoteSwitch } from './remote-logic.js';
import type { RemoteResult, StartResult } from './types.js';

/** A switch back to local spawns the process and waits for its port, which
 *  includes whatever a `preBuild` costs. The default RPC timeout is far too
 *  short for that, and timing out here would report a failure for a switch
 *  that is going to succeed. */
const REMOTE_SWITCH_TIMEOUT_MS = 120_000;
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
  /** The daemon's own project name, or null when it is not known — which is
   *  not the same as empty, and must not be papered over with a placeholder. */
  projectName: () => string | null,
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
        const res = await sendRpc(socketPath(), 'restart', { svc }) as StartResult;
        // The daemon answers `ok: true` for a service it did not restart
        // because there is no process here — see `actionOutcome`. Reading only
        // `ok` would report a restart that never happened. The snapshot is the
        // fallback for a daemon too old to say so itself.
        const outcome = actionOutcome('restart', svc, res, store.getAll().find(s => s.name === svc));
        if (outcome.kind === 'skipped') void vscode.window.showWarningMessage(outcome.message);
        else if (outcome.kind === 'failed') void vscode.window.showErrorMessage(outcome.message);
        else void vscode.window.showInformationMessage(outcome.message);
      } catch (e) {
        void vscode.window.showErrorMessage(`devup: restart failed — ${rpcMessage(e)}`);
      }
    }),

    vscode.commands.registerCommand('devup.bringLocal', async (arg?: ServiceArg) => {
      const svc = await resolveServiceName(arg, store, 'Bring which service back to local?');
      if (!svc) return;
      const info = store.getAll().find(s => s.name === svc);
      if (info && !info.remote) {
        void vscode.window.showInformationMessage(`devup: "${svc}" is already running locally.`);
        return;
      }
      if (!supportsRemoteSwitch(store.getInfo()?.contract)) {
        void vscode.window.showWarningMessage(
          `devup: this daemon cannot move services between local and an environment — upgrade @gachlab/devup to 0.18.0 or later.`,
        );
        return;
      }
      // Starting a service can take as long as its `preBuild`, so this is a
      // notification rather than a fire-and-forget: without it the sidebar
      // sits unchanged for a minute and the click reads as ignored.
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `devup: bringing "${svc}" local…` },
        async () => {
          try {
            const res = await sendRpc(socketPath(), 'remote', { svc, local: true },
              { timeoutMs: REMOTE_SWITCH_TIMEOUT_MS }) as RemoteResult;
            // A refusal comes back as a result, not as an RPC error: an
            // unknown environment, a port still held by a process that has not
            // finished draining. All facts worth showing as themselves.
            if (!res.ok) {
              void vscode.window.showErrorMessage(`devup: could not bring "${svc}" local — ${res.error ?? 'unknown reason'}`);
              return;
            }
            void vscode.window.showInformationMessage(`devup: "${svc}" is running locally.`);
          } catch (e) {
            void vscode.window.showErrorMessage(`devup: could not bring "${svc}" local — ${rpcMessage(e)}`);
          }
        },
      );
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
      const fullCwd = resolveServiceCwd(svc?.cwd, workspaceRoot());
      if (!fullCwd) { void vscode.window.showWarningMessage(`devup: cwd not available for "${svcName}"`); return; }
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
      const project = projectName();
      if (!project) { void vscode.window.showWarningMessage(NO_PROJECT_NAME); return; }
      const file = logFileFor(project, svc, logDirOverride());
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
      const project = projectName();
      if (!project) { void vscode.window.showWarningMessage(NO_PROJECT_NAME); return; }
      const dir = logDirFor(project, logDirOverride());
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

    vscode.commands.registerCommand('devup.refresh', () => {
      // Reconnecting is autonomous, but it backs off to 30 s while the daemon
      // stays down — so someone who has just started one should not have to
      // wait out a delay they cannot see. This retries immediately. Reachable
      // from the refresh button in the view title and the Command Palette.
      store.refresh();
    }),
  );
}

/** Logs live under the project name, which with `devup.socketPath` set is a
 *  thing the extension genuinely does not know: discovery has no name to
 *  report, and the daemon's `info` RPC is allowed to fail. Building a path out
 *  of a placeholder would send someone looking for a file that cannot exist. */
const NO_PROJECT_NAME = 'devup: the project name is not known, so the log path cannot be resolved. '
  + 'Set devup.projectName, or wait for the daemon to answer.';

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
