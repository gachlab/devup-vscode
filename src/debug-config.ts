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
  /** Only when the workspace is reached through a symlink — see below. */
  localRoot?: string;
  remoteRoot?: string;
}

/** Session names start with this, which is how the extension recognises its
 *  own sessions among whatever else is running. */
export const SESSION_PREFIX = 'devup: ';

export interface PathRebase {
  localRoot: string;
  remoteRoot: string;
}

/** The rebase to declare when the editor and the runtime spell the same tree
 *  differently, or null when they agree.
 *
 *  **Anchor this at the workspace folder, never at one service's directory.**
 *  js-debug's `rebaseRemoteToLocal` returns the empty string — no local file at
 *  all — for anything that does not sit under `remoteRoot`, so a rebase pinned
 *  to `services/api` would silently stop binding breakpoints in
 *  `packages/shared`, which is the normal shape of a monorepo. The pair is a
 *  restriction as much as a translation.
 *
 *  `caseInsensitive` is for macOS: `realpathSync` returns the true casing of a
 *  path, so opening `/Users/u/Repos` when the disk says `repos` would look
 *  like two locations and switch the restriction on for a workspace that never
 *  needed it. */
export function pathRebase(localRoot: string, realRoot: string, caseInsensitive = false): PathRebase | null {
  if (localRoot === realRoot) return null;
  if (caseInsensitive && localRoot.toLowerCase() === realRoot.toLowerCase()) return null;
  return { localRoot, remoteRoot: realRoot };
}

/** @param cwd  the service's directory as the *editor* spells it.
 *  @param rebase  from `pathRebase`, anchored at the workspace folder. Null
 *         when the editor and the runtime agree on how to spell paths, which
 *         is the common case. */
export function buildAttachConfig(svcName: string, port: number, cwd: string, rebase: PathRebase | null = null): AttachConfig {
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
    // them.
    cwd,
    sourceMaps: true,
    skipFiles: ['<node_internals>/**'],
    // Deliberately false: the inspector port changes on every restart, so a
    // reattach would target a dead endpoint. Debug again to pick up the new one.
    restart: false,
    // A path rebase, only when there is genuinely something to rebase.
    //
    // Node resolves symlinks when it loads a module, so a service under
    // `~/repos/x` — where `~/repos` is a link to `/mnt/data/repos` — reports
    // its scripts as `file:///mnt/data/repos/x/...`. If the editor opened the
    // linked spelling, js-debug is matching two different strings for the same
    // file and every breakpoint stays unbound, silently. See `pathRebase` for
    // why this is left out whenever it is not needed.
    ...(rebase ?? {}),
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

/** The browser half of a stack session.
 *
 *  In a remote window js-debug launches the browser on the *local* machine
 *  through its bundled companion extension and tunnels the debug port back —
 *  no configuration needed here, and `debug.javascript.automaticallyTunnelRemoteServer`
 *  (on by default) opens the tunnel to the dev server too.
 *
 *  `cascadeTerminateToConfigurations` is what makes this feel like one thing:
 *  closing the browser ends the API sessions with it. Note it ends the debug
 *  *sessions*, not the services — devup keeps running them, which is the whole
 *  point of attaching rather than launching. */
export interface BrowserDebugConfig {
  type: 'chrome' | 'msedge';
  request: 'launch';
  name: string;
  url: string;
  webRoot: string;
  sourceMaps: boolean;
  cascadeTerminateToConfigurations: string[];
}

export function buildBrowserConfig(
  svcName: string,
  url: string,
  webRoot: string,
  alsoTerminate: readonly string[],
  browser: 'chrome' | 'msedge' = 'chrome',
): BrowserDebugConfig {
  return {
    type: browser,
    request: 'launch',
    name: `${SESSION_PREFIX}${svcName} (browser)`,
    url,
    // Where the sources the browser loads live on disk, so a breakpoint in a
    // .ts of the frontend binds. The service's own directory, not the
    // workspace root: in a monorepo those are not the same place.
    webRoot,
    sourceMaps: true,
    cascadeTerminateToConfigurations: [...alsoTerminate],
  };
}

/** Reads the browser preference, defaulting to Chrome. Anything unexpected
 *  falls back rather than reaching js-debug as an unknown debug type. */
export function parseBrowser(raw: unknown): 'chrome' | 'msedge' {
  return raw === 'msedge' ? 'msedge' : 'chrome';
}
