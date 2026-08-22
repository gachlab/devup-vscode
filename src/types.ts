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
  restarts: number;
  crashLog?: string[] | null;
}

export interface ProjectInfo {
  project: string;
  profiles: Record<string, string[]>;
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
