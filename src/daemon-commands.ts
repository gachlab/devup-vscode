import * as vscode from 'vscode';

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

export function registerDaemonCommands(context: vscode.ExtensionContext, workspaceCwd: string): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devup.daemon.start', () => {
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      term.sendText('devup up -d');
    }),

    vscode.commands.registerCommand('devup.daemon.stop', () => {
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      term.sendText('devup down');
    }),

    vscode.commands.registerCommand('devup.daemon.restart', () => {
      const term = getOrCreateTerminal(workspaceCwd);
      term.show();
      // Chain so `up -d` only runs after `down` finishes. devup down exits 1
      // when no daemon is running, which is fine for restart — we still want
      // to bring one up afterwards. Hence `;` rather than `&&`.
      term.sendText('devup down ; devup up -d');
    }),
  );
}
