import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import type { StatusStore } from './status-store.js';
import { extractSvcName } from './svc-name.js';
import { buildAttachConfig, resolveServiceCwd, SESSION_PREFIX } from './debug-config.js';

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

/** The protocol is a hand-written copy that nothing validates (CLAUDE.md rule
 *  2), and `sendRpc` resolves the response's `result` field verbatim — so a
 *  daemon answering `null`, or with no result at all, reaches here as
 *  something that has no `ok` to read. */
function isDebugResult(value: unknown): value is DebugResult {
  return !!value
    && typeof value === 'object'
    && typeof (value as DebugResult).ok === 'boolean';
}

/** Distinguishes "the call failed and the user has been told" from a result
 *  that merely happens to be falsy. */
type Attempt<T> = { ok: true; value: T } | { ok: false };

export function registerDebugCommands(
  context: vscode.ExtensionContext,
  store: StatusStore,
  socketPath: () => string,
  workspaceRoot: () => string,
  folder: () => vscode.WorkspaceFolder,
): void {
  // Node's inspector serves one debugger at a time, and `debugPort` stays set
  // for as long as you are attached — which is exactly the state the
  // attach-without-restarting branch keys on. Without this, running the
  // command twice on the same service produces a raw adapter connection error.
  // The stable API exposes no list of sessions, so we keep our own.
  const attached = new Set<string>();
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(session => {
      const name = sessionServiceName(session.name);
      if (name) attached.add(name);
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      const name = sessionServiceName(session.name);
      if (name) attached.delete(name);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devup.debugService', async (arg?: string | Record<string, unknown>) => {
      const svcName = await pickService(arg, store, 'Debug which service?');
      if (!svcName) return;

      // Already under the inspector: a service declared `debug: true` in the
      // config comes up that way, and a watch-triggered restart ends the
      // session while leaving the service debugged on a new port. Restarting
      // it again would throw away the state the user is here to look at.
      if (attached.has(svcName)) {
        void vscode.window.showInformationMessage(`devup: already debugging "${svcName}".`);
        return;
      }

      const live = store.getAll().find(s => s.name === svcName);
      if (typeof live?.debugPort === 'number') {
        await attach(svcName, live.debugPort, live.cwd, workspaceRoot(), folder());
        return;
      }

      const attempt = await withProgress(`devup: restarting "${svcName}" under the inspector…`, async () =>
        // Not pre-checked against `cmd`: the daemon decides what it can
        // inspect, and its refusal ("does not run node") is the better message.
        await sendRpc(socketPath(), 'debug', { svc: svcName, enable: true },
          { timeoutMs: DEBUG_RPC_TIMEOUT_MS }),
      );
      if (!attempt.ok) return;
      const result = attempt.value;

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
      await attach(svcName, port, svc?.cwd, workspaceRoot(), folder());
    }),

    vscode.commands.registerCommand('devup.stopDebugging', async (arg?: string | Record<string, unknown>) => {
      // Every service, not only those reporting a port — and the tree entry,
      // which can only key on the live port, is deliberately not the whole
      // story here. The daemon nulls
      // `debugPort` whenever the process is not running and never publishes the
      // `debug` flag itself, so a debugged service that is stopped or crashed
      // looks identical to one that was never debugged — while the flag is
      // still set, and every restart brings `--inspect` back with it.
      const svcName = await pickService(arg, store, 'Stop debugging which service?');
      if (!svcName) return;

      const attempt = await withProgress(`devup: restarting "${svcName}" without the inspector…`, async () =>
        await sendRpc(socketPath(), 'debug', { svc: svcName, enable: false },
          { timeoutMs: DEBUG_RPC_TIMEOUT_MS }),
      );
      if (!attempt.ok) return;
      const result = attempt.value;

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

/** Runs the debug RPC behind a progress notification. Reports failure to the
 *  user and says so in the return, rather than handing back a value the caller
 *  has to tell apart from a legitimate one. */
async function withProgress(title: string, run: () => Promise<unknown>): Promise<Attempt<DebugResult>> {
  try {
    const value = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title }, run,
    );
    if (!isDebugResult(value)) {
      void vscode.window.showErrorMessage('devup: the daemon gave an answer this extension does not understand.');
      return { ok: false };
    }
    return { ok: true, value };
  } catch (e) {
    const message = e instanceof RpcCallError || e instanceof Error ? e.message : String(e);
    // A daemon that predates the RPC answers with this rather than anything a
    // user could act on.
    void vscode.window.showErrorMessage(
      message.includes('unknown method')
        ? 'devup: this daemon cannot start a service under the inspector. Needs @gachlab/devup 0.14.0 or newer.'
        : `devup: ${message}`,
    );
    return { ok: false };
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

/** The service behind one of our session names, or null for anyone else's. */
function sessionServiceName(sessionName: string): string | null {
  return sessionName.startsWith(SESSION_PREFIX) ? sessionName.slice(SESSION_PREFIX.length) : null;
}

async function attach(
  svcName: string,
  port: number,
  svcCwd: string | undefined,
  workspaceRoot: string,
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  const cwd = resolveServiceCwd(svcCwd, workspaceRoot) ?? workspaceRoot;
  try {
    // A false return and a rejection both mean it did not attach; only the
    // first was being reported.
    const started = await vscode.debug.startDebugging(folder, buildAttachConfig(svcName, port, cwd));
    if (started) return;
    void vscode.window.showErrorMessage(`devup: could not attach to "${svcName}" on port ${port}.`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`devup: could not attach to "${svcName}" on port ${port} — ${message}`);
  }
}

async function pickService(
  arg: string | Record<string, unknown> | undefined,
  store: StatusStore,
  prompt: string,
): Promise<string | null> {
  const name = extractSvcName(arg);
  if (name) return name;
  const all = store.getAll();
  if (!all.length) {
    void vscode.window.showInformationMessage('devup: no services available.');
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
