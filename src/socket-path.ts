/** Where a project's control-plane socket lives — no vscode dependency, so it
 *  can be unit-tested.
 *
 *  This is a mirror of devup's own `defaultSocketPath`
 *  (`src/control-plane/socket-server.ts`), and mirrors are where this
 *  extension goes wrong (CLAUDE.md rule 2). It must match character for
 *  character: a name the two sanitise differently resolves to two different
 *  paths, and the symptom is the extension insisting nothing is running while
 *  the daemon is up. */
import { join } from 'node:path';
import { homedir } from 'node:os';

const SAFE = /[^a-zA-Z0-9._-]+/g;

/** Exactly devup's rule: runs of unsafe characters become one underscore, and
 *  a name that is left empty becomes `devup`.
 *
 *  Deliberately does *not* trim leading or trailing underscores — the
 *  extension used to, which meant `@gachlab/web` resolved to
 *  `sock-gachlab_web.sock` while the daemon listened on
 *  `sock-_gachlab_web.sock`. */
export function sanitize(name: string): string {
  return name.replace(SAFE, '_') || 'devup';
}

export function defaultSocketPath(projectName: string): string {
  return join(homedir(), '.devup', `sock-${sanitize(projectName)}.sock`);
}
