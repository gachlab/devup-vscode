import * as vscode from 'vscode';
import type { StatusStore } from './status-store.js';

/** Daemon-level commands: start / stop / restart. All shell out to the
 *  `devup` CLI in the integrated terminal — keeps the behaviour transparent
 *  and consistent with what a user would type by hand. The terminal stays
 *  open so output is visible (and the user can hit Ctrl+C if needed). */

const TERMINAL_NAME = 'devup';

function getOrCreateTerminal(cwd?: string): vscode.Terminal {
  // Re-use an existing 'devup' terminal if it's still alive; otherwise create one.
  const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && t.exitStatus === undefined);
  if (existing) return existing;
  return vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

function getDevupCommand(): string {
  const config = vscode.workspace.getConfiguration('devup');
  const customPath = config.get<string>('executablePath');
  if (customPath?.trim()) return customPath.trim();
  return 'npx devup';
}

/** When the daemon has just been asked to start, retry sooner than the
 *  reconnect backoff would on its own.
 *
 *  Without this, starting the daemon from the button next to the welcome view
 *  and then watching the sidebar keep saying "not running" for up to 30 s is
 *  the normal experience — the backoff has usually climbed to its ceiling by
 *  the time anyone gets around to pressing it. Each nudge resets the backoff,
 *  so the attempts land while a stack is still booting rather than after it. */
const NUDGE_DELAYS_MS = [2_000, 6_000, 12_000];

/** One set at a time, replaced on each start/restart. Registering a fresh
 *  disposable per invocation would pile up dead closures in
 *  `context.subscriptions` for the life of the window. */
let nudgeTimers: NodeJS.Timeout[] = [];

function nudgeReconnect(store: StatusStore): void {
  cancelNudges();
  nudgeTimers = NUDGE_DELAYS_MS.map(delay => setTimeout(() => store.refresh(), delay));
}

function cancelNudges(): void {
  for (const timer of nudgeTimers) clearTimeout(timer);
  nudgeTimers = [];
}

export function registerDaemonCommands(
  context: vscode.ExtensionContext,
  workspaceCwd: string,
  store: StatusStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.daemon.start', () => {
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      term.sendText(`${getDevupCommand()} up -d`);
      nudgeReconnect(store);
    }),

    vscode.commands.registerCommand('devup.daemon.stop', () => {
      // Cancel any nudges still pending from a start: retrying hard against a
      // daemon the user has just asked to go away is not helpful.
      cancelNudges();
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      term.sendText(`${getDevupCommand()} down`);
    }),

    vscode.commands.registerCommand('devup.daemon.restart', () => {
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      // Chain so `down` only runs after `up -d` runs; devup down exits 1
      // when no daemon is running, which is fine for restart — we still want
      // to bring one up afterwards. Hence `;` rather than `&&`.
      const devup = getDevupCommand();
      term.sendText(`${devup} down ; ${devup} up -d`);
      nudgeReconnect(store);
    }),

    { dispose: cancelNudges },
  );
}
