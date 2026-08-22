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

/** How long to keep retrying quickly after the user starts or restarts the
 *  daemon. Long enough for `devup down` and a full boot of a large stack;
 *  after that the ordinary backoff takes over.
 *
 *  Without it, the normal experience is starting the daemon from the button
 *  beside the welcome view and then watching the sidebar say "not running"
 *  for up to 30 s after the stack is up, because the backoff has usually
 *  climbed to its ceiling by the time anyone presses that button. */
const RESTART_WINDOW_MS = 60_000;

export function registerDaemonCommands(
  context: vscode.ExtensionContext,
  workspaceCwd: () => string,
  store: StatusStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.daemon.start', () => {
      const term = getOrCreateTerminal(workspaceCwd());
      term.show();
      term.sendText(`${getDevupCommand()} up -d`);
      store.expectRestart(RESTART_WINDOW_MS);
    }),

    vscode.commands.registerCommand('devup.daemon.stop', () => {
      store.cancelExpectedRestart();
      const term = getOrCreateTerminal(workspaceCwd());
      term.show();
      term.sendText(`${getDevupCommand()} down`);
    }),

    vscode.commands.registerCommand('devup.daemon.restart', () => {
      const term = getOrCreateTerminal(workspaceCwd());
      term.show();
      // Chain so `down` only runs after `up -d` runs; devup down exits 1
      // when no daemon is running, which is fine for restart — we still want
      // to bring one up afterwards. Hence `;` rather than `&&`.
      const devup = getDevupCommand();
      term.sendText(`${devup} down ; ${devup} up -d`);
      store.expectRestart(RESTART_WINDOW_MS);
    }),
  );
}
