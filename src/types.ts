/** Pure data types shared across the extension — no vscode dependency. */

export interface ServiceSnapshot {
  name: string;
  status: string;
  health: string;
  port: number;
  type: string;
  phase: number;
  pid: number | null;
  errors: number;
  restarts: number;
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
