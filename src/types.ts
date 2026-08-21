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
}

export type ConnectionState = 'connecting' | 'connected' | 'unreachable';
