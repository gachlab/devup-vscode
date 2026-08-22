/** The attach configuration for a service running under Node's inspector — no
 *  vscode dependency, so it can be unit-tested.
 *
 *  devup starts a debugged service with `--inspect=0` (`utils/process-args.ts`),
 *  so the port is chosen by the OS and read back from Node's own
 *  "Debugger listening on ws://…" banner. It is therefore **different on every
 *  restart**, which is why the config below does not ask the debug adapter to
 *  reattach: it would reconnect to a port that died with the previous process. */
import { isAbsolute, join } from 'node:path';

export interface AttachConfig {
  type: 'node';
  request: 'attach';
  name: string;
  address: string;
  port: number;
  /** The service's own directory: where its sources and source maps are. */
  cwd: string;
  sourceMaps: boolean;
  skipFiles: string[];
  restart: boolean;
}

/** Session names start with this, which is how the extension recognises its
 *  own sessions among whatever else is running. */
export const SESSION_PREFIX = 'devup: ';

export function buildAttachConfig(svcName: string, port: number, cwd: string): AttachConfig {
  return {
    type: 'node',
    request: 'attach',
    name: `${SESSION_PREFIX}${svcName}`,
    // The daemon runs the service on the same host as the extension — in a
    // remote window that is the remote one, which is also where the inspector
    // is bound.
    address: '127.0.0.1',
    port,
    // Where the service's sources and source maps are, which is what resolves
    // them. Note the absence of localRoot/remoteRoot: they declare a
    // remote-to-local path *rebase*, and only paths under remoteRoot get
    // mapped — pinning both to the service directory would leave a breakpoint
    // in a sibling package of a monorepo unbound, which on a same-host attach
    // is a restriction bought for nothing.
    cwd,
    sourceMaps: true,
    skipFiles: ['<node_internals>/**'],
    // Deliberately false: the inspector port changes on every restart, so a
    // reattach would target a dead endpoint. Debug again to pick up the new one.
    restart: false,
  };
}

/** A service's absolute working directory. `cwd` in the config is relative to
 *  the folder that holds it, which in a multi-root workspace is not
 *  necessarily the first one. */
export function resolveServiceCwd(svcCwd: string | undefined, workspaceRoot: string): string | null {
  if (!svcCwd?.trim()) return null;
  const cwd = svcCwd.trim();
  return isAbsolute(cwd) ? cwd : join(workspaceRoot, cwd);
}
