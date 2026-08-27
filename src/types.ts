/** Pure data types shared across the extension — no vscode dependency. */

export interface ServiceSnapshot {
  name: string;
  status: string;
  health: string;
  port: number;
  /** Present from @gachlab/devup >= 0.12.0 — 0.11.2 does not carry it. For a
   *  lazy service, `port` is the rewritten internal port and this is the
   *  configured one the proxy listens on; for an always-on service the two are
   *  the same. */
  originalPort?: number;
  type: string;
  phase: number;
  cmd?: string;
  cwd?: string;
  pid: number | null;
  errors: number;
  /** The auto-restart **budget** spent, not a history: the daemon resets it to
   *  0 on every manual restart and every explicit start. Never use it to ask
   *  whether a service died between two moments — that is what `crashes` is
   *  for. */
  restarts: number;
  /** How many times the service has crashed since the daemon started. Only
   *  ever goes up. Present from @gachlab/devup >= 0.16.0. */
  crashes?: number;
  /** Milliseconds until the queued auto-restart fires, `null` when none is.
   *
   *  What separates "out of restart budget" from "seconds from coming back":
   *  the daemon raises `restarts` to its maximum *before* scheduling the last
   *  attempt, so `status` and `restarts` together cannot tell them apart.
   *  Present from @gachlab/devup >= 0.17.0. */
  restartPendingIn?: number | null;
  crashLog?: string[] | null;
  /** When the current process started, or null when it is not running.
   *  Present from @gachlab/devup >= 0.14.0. */
  startedAt?: number | null;
  /** The port Node's inspector bound to, once it has announced it — devup
   *  starts a debugged service with `--inspect=0`, so the OS picks it and it
   *  differs on every restart. Null when the service is not being debugged, and
   *  briefly while it is starting. Present from @gachlab/devup >= 0.14.0. */
  debugPort?: number | null;
  /** Set when the service is **not a local process**: devup holds its
   *  configured port and forwards to a remote environment. Absent, or null,
   *  for an ordinary service. Present from @gachlab/devup >= 0.18.0 —
   *  `contract >= 3`.
   *
   *  Three things follow that nothing else in the snapshot says:
   *
   *  - `pid` is null and stays null, so there is no inspector to attach to.
   *  - the service is **absent from `stats`** — no process to sample, which is
   *    not the same as 0% CPU.
   *  - `errors` counts requests that never reached the environment, not
   *    stderr lines. A 500 that came back is the service's own business.
   *
   *  It is an added field rather than a new `status` value on purpose: a
   *  remote service reports `status: 'running'`, so a client that has never
   *  heard of this renders it as the running service it is. */
  remote?: RemoteInfo | null;
}

export interface RemoteInfo {
  /** Which entry of the project's `environments` block serves it. */
  envName: string;
  /** Absolute upstream base, e.g. `https://check-in-api.qa.norelian.com`. */
  target: string;
  /** Whether devup refuses writes to it with 405. **False by default**, so for
   *  most remote services a request made from this machine changes data in a
   *  shared environment. */
  readOnly: boolean;
}

/** The `start` / `restart` result.
 *
 *  `skippedRemote` is present from @gachlab/devup >= 0.19.0 (`contract >= 4`)
 *  and names the environment when there was no process here to act on. It
 *  arrives with `ok: true`, because the service *is* answering — devup simply
 *  spawned nothing. Rendering that as "restarted" claims something that did
 *  not happen. */
export interface StartResult {
  ok: boolean;
  skippedIdle?: boolean;
  skippedRemote?: string;
}

/** The `debug` result. Unlike a restart, `ok` is **false** when the service is
 *  remote: the inspector runs inside a process, and the process is elsewhere. */
export interface DebugResult {
  debug: boolean;
  port: number | null;
  ok: boolean;
  skippedRemote?: string;
}

/** The `remote` result — the RPC that moves a service between local and an
 *  environment. Present from @gachlab/devup >= 0.18.0.
 *
 *  Failures arrive as `ok: false` with a reason rather than as an RPC error:
 *  an unknown environment, a service the environment cannot reach, a port
 *  still held by a process that has not finished draining. All facts about the
 *  stack worth showing. */
export interface RemoteResult {
  ok: boolean;
  remote: RemoteInfo | null;
  error?: string;
}

export interface ProjectInfo {
  project: string;
  profiles: Record<string, string[]>;
  /** The devup release running the daemon, or `'unknown'` if it could not read
   *  its own manifest. Present from @gachlab/devup >= 0.16.0 — and its absence
   *  is itself the answer when what you are asking is how old the daemon is. */
  version?: string;
  /** Which revision of the wire shapes the daemon speaks. **Check this, not
   *  `version`**: it answers "can I trust this field" directly, where the
   *  release number makes us keep our own table of what arrived when — and
   *  that table is exactly what goes stale. Present from >= 0.16.0. */
  contract?: number;
  /** Every RPC the daemon answers. Ask this rather than sending a request and
   *  looking for `unknown method` in the error. Present from >= 0.16.0. */
  methods?: string[];
}

export interface ProxyInfo {
  active: boolean;
  provider: string;
  domain: string;
  tls: boolean;
  routes: Record<string, string>;
}

export interface ServiceStats {
  cpu: number;
  memMB: number;
}

export interface SystemStats {
  totalMemMB: number;
  freeMemMB: number;
  cpuCores: number;
  /** 1-minute load average (@gachlab/devup >= 0.14.0). Absent on Windows,
   *  where `os.loadavg()` is hardcoded to zeroes and the daemon omits it
   *  rather than reporting an idle machine. */
  loadAvg1?: number;
  /** That load as a percentage of available cores — the figure to show as
   *  "CPU". Absent for the same reason as `loadAvg1`, and on daemons older
   *  than 0.14.0. */
  cpuPercent?: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'unreachable';
