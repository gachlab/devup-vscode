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

/** The debug type this extension contributes.
 *
 *  A configuration of this type carries only a service name; everything else —
 *  asking the daemon to restart it under the inspector, waiting for Node to
 *  announce a port, resolving the service's directory — happens in
 *  `resolveDebugConfiguration`, which is allowed to be async and to hand back a
 *  configuration of a *different* type. VS Code re-runs the resolver chain for
 *  whatever type comes out, which is how this becomes a plain `node` attach.
 *  js-debug does the same thing internally (`chrome` → `pwa-chrome`). */
export const DEBUG_TYPE = 'devup';

export interface DevupDebugConfig {
  type: typeof DEBUG_TYPE;
  request: 'attach';
  name: string;
  /** The devup service to attach to. Absent means "ask". */
  service?: string;
}

/** One entry per service for the Run and Debug dropdown. */
export function buildServiceConfigurations(serviceNames: readonly string[]): DevupDebugConfig[] {
  return serviceNames.map(service => ({
    type: DEBUG_TYPE,
    request: 'attach' as const,
    name: `${SESSION_PREFIX}${service}`,
    service,
  }));
}

/** What the end of a debug session means for the service behind it.
 *
 *  `onDidTerminateDebugSession` fires the same whether the service restarted
 *  or the user detached, so the answer has to come from the inspector port the
 *  daemon reports. Comparing ports rather than timing is what makes this
 *  reliable: devup starts a debugged service with `--inspect=0`, so a restart
 *  always yields a *different* port, while a detach leaves the old one
 *  listening — Node keeps its inspector open when a client disconnects. */
export type TerminationCause = 'detached' | 'restarted' | 'unknown';

export function classifyTermination(sessionPort: number | undefined, reportedPort: number | null | undefined): TerminationCause {
  // Same port still listening: nothing restarted.
  if (typeof reportedPort === 'number' && reportedPort === sessionPort) return 'detached';
  // A different port is already up — the restart got here first.
  if (typeof reportedPort === 'number') return 'restarted';
  // No port at all: the process is gone or on its way back. Which it is only
  // becomes clear when (and whether) a new port appears.
  return 'unknown';
}
