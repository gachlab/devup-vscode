import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import type { StatusStore } from './status-store.js';
import { extractSvcName } from './svc-name.js';
import { buildAttachConfig, resolveServiceCwd } from './debug-config.js';

/** Debugging a service used to mean stopping it in devup, running it by hand
 *  outside, and giving up watch, health checks and restarts while you did
 *  (issue #43). devup 0.14.0 can start one under `--inspect` on request
 *  (gachlab/devup#84), which is the half that was missing.
 *
 *  The flag lives on the service in the daemon's state, so it survives the
 *  crash-and-restart that usually prompts a debugging session — and outlives
 *  the session too, which is why turning it back off is a command of its own. */

/** How long to wait for Node to announce its inspector port after the restart.
 *  The RPC returns as soon as the service is up, which is typically before the
 *  banner has been parsed out of stderr. */
const PORT_WAIT_MS = 15_000;

/** The `debug` RPC restarts the service and resolves once it is up — which for
 *  a service with a health check can be half a minute. The client's 5 s
 *  default would give up on a restart that is going fine, leaving the service
 *  under the inspector with the user told it failed. */
const DEBUG_RPC_TIMEOUT_MS = 120_000;

interface DebugResult {
  debug: boolean;
  port: number | null;
  ok: boolean;
}

export function registerDebugCommands(
  context: vscode.ExtensionContext,
  store: StatusStore,
  socketPath: () => string,
  workspaceRoot: () => string,
  folder: () => vscode.WorkspaceFolder,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.debugService', async (arg?: string | Record<string, unknown>) => {
      const svcName = await pickService(arg, store, 'Debug which service?');
      if (!svcName) return;

      const result = await withProgress(`devup: restarting "${svcName}" under the inspector…`, async () => {
        // Not pre-checked against `cmd`: the daemon decides what it can
        // inspect, and its refusal ("does not run node") is the better message.
        return await sendRpc(socketPath(), 'debug', { svc: svcName, enable: true },
          { timeoutMs: DEBUG_RPC_TIMEOUT_MS }) as DebugResult;
      });
      if (result === null) return;

      if (!result.ok) {
        // The daemon rolls the flag back when the restart fails, so the service
        // is not left unstartable — but it is also not running.
        void vscode.window.showErrorMessage(
          `devup: "${svcName}" did not come back up under the inspector. The debug flag was rolled back; check its logs.`,
        );
        return;
      }

      const port = result.port ?? await waitForDebugPort(store, svcName);
      if (port === null) {
        void vscode.window.showWarningMessage(
          `devup: "${svcName}" restarted, but Node has not announced an inspector port. `
          + 'It may not be a Node process, or it may still be starting.',
        );
        return;
      }

      const svc = store.getAll().find(s => s.name === svcName);
      const cwd = resolveServiceCwd(svc?.cwd, workspaceRoot()) ?? workspaceRoot();
      const started = await vscode.debug.startDebugging(folder(), buildAttachConfig(svcName, port, cwd));
      if (!started) {
        void vscode.window.showErrorMessage(`devup: could not attach to "${svcName}" on port ${port}.`);
      }
    }),

    vscode.commands.registerCommand('devup.stopDebugging', async (arg?: string | Record<string, unknown>) => {
      const svcName = await pickService(arg, store, 'Stop debugging which service?', true);
      if (!svcName) return;

      const result = await withProgress(`devup: restarting "${svcName}" without the inspector…`, async () => {
        return await sendRpc(socketPath(), 'debug', { svc: svcName, enable: false },
          { timeoutMs: DEBUG_RPC_TIMEOUT_MS }) as DebugResult;
      });
      if (result === null) return;

      // Turning the inspector off can fail too, and the daemon deliberately
      // does not roll that back — reporting success here would be a lie.
      if (!result.ok) {
        void vscode.window.showErrorMessage(`devup: "${svcName}" did not come back up. Check its logs.`);
        return;
      }
      void vscode.window.showInformationMessage(`devup: "${svcName}" is no longer running under the inspector.`);
    }),
  );
}

/** Runs an RPC behind a progress notification. Returns null when it failed,
 *  having already reported why. */
async function withProgress<T>(title: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, run);
  } catch (e) {
    const message = e instanceof RpcCallError || e instanceof Error ? e.message : String(e);
    // A daemon that predates the RPC answers with this rather than anything a
    // user could act on.
    void vscode.window.showErrorMessage(
      message.includes('unknown method')
        ? 'devup: this daemon cannot start a service under the inspector. Needs @gachlab/devup 0.14.0 or newer.'
        : `devup: ${message}`,
    );
    return null;
  }
}

/** Waits for the inspector port to appear in the status stream.
 *
 *  `debug` returns as soon as the service is up, which is normally before Node
 *  has printed "Debugger listening on ws://…" — the daemon parses that out of
 *  stderr and publishes it as `debugPort` on the next status frame. */
function waitForDebugPort(store: StatusStore, svcName: string): Promise<number | null> {
  const current = store.getAll().find(s => s.name === svcName)?.debugPort;
  if (typeof current === 'number') return Promise.resolve(current);

  return new Promise(resolve => {
    let done = false;
    const finish = (port: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.dispose();
      resolve(port);
    };
    const timer = setTimeout(() => finish(null), PORT_WAIT_MS);
    const sub = store.onDidChange(() => {
      const port = store.getAll().find(s => s.name === svcName)?.debugPort;
      if (typeof port === 'number') finish(port);
    });
  });
}

async function pickService(
  arg: string | Record<string, unknown> | undefined,
  store: StatusStore,
  prompt: string,
  debuggingOnly = false,
): Promise<string | null> {
  const name = extractSvcName(arg);
  if (name) return name;
  const all = store.getAll().filter(s => !debuggingOnly || typeof s.debugPort === 'number');
  if (!all.length) {
    void vscode.window.showInformationMessage(
      debuggingOnly ? 'devup: no service is running under the inspector.' : 'devup: no services available.',
    );
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    all.map(s => ({
      label: s.name,
      description: typeof s.debugPort === 'number' ? `inspector on :${s.debugPort}` : (s.cmd ?? s.type),
      svc: s.name,
    })),
    { placeHolder: prompt },
  );
  return picked?.svc ?? null;
}
