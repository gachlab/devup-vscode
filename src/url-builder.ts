import type { ProxyInfo } from './status-store.js';

/** Mirrors the TUI's buildServiceUrl — honours proxy + TLS settings when active. */
export function buildServiceUrl(name: string, port: number, proxy: ProxyInfo | null): string {
  if (proxy?.active) {
    const sub = proxy.routes[name];
    if (sub !== undefined) {
      const host = sub ? `${sub}.${proxy.domain}` : proxy.domain;
      return `${proxy.tls ? 'https' : 'http'}://${host}`;
    }
  }
  return `http://localhost:${port}`;
}

export function formatCpu(cpu: number): string {
  return `${cpu.toFixed(1)}%`;
}

export function formatMem(memMB: number): string {
  return memMB >= 1024 ? `${(memMB / 1024).toFixed(1)} GB` : `${memMB.toFixed(0)} MB`;
}
