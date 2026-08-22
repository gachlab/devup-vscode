/** Where devup writes a service's log file — no vscode dependency, so it can
 *  be unit-tested.
 *
 *  Another hand-copied mirror (CLAUDE.md rule 2), and this one has a trap in
 *  it: devup sanitises names for log paths with a *different* rule than for
 *  socket paths. `LogSink` (and `devup logs`) strip leading and trailing
 *  underscores; `defaultSocketPath` does not. So a project called
 *  `@gachlab/web` logs to `logs/gachlab_web/` while its socket is
 *  `sock-_gachlab_web.sock`. Not a mistake worth propagating, but it is what
 *  is on disk, and the point of this module is to open the file that exists.
 *
 *  Source: devup `src/process/log-sink.ts` and `src/orchestrator/subcommands.ts`. */
import { join } from 'node:path';
import { homedir } from 'node:os';

/** devup's log-path rule. Note the trim, which `socket-path.ts` deliberately
 *  does not do — see the module comment. */
export function sanitizeForLogs(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'devup';
}

/** The folder holding one project's logs. `override` is the `--log-dir` the
 *  daemon may have been started with, which it does not publish over the
 *  control plane — hence the `devup.logDir` setting. */
export function logDirFor(projectName: string, override?: string): string {
  const root = override?.trim() ? override.trim() : join(homedir(), '.devup', 'logs');
  return join(root, sanitizeForLogs(projectName));
}

export function logFileFor(projectName: string, svcName: string, override?: string): string {
  return join(logDirFor(projectName, override), `${sanitizeForLogs(svcName)}.log`);
}
