import type { ProxyInfo, SystemStats } from './types.js';

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

/** Host figures for the status bar: CPU only when the daemon actually reports
 *  one, memory in absolute terms.
 *
 *  This slot used to show the *memory* percentage behind a `$(pulse)` icon,
 *  with the same memory printed again in GB right after it — the same quantity
 *  twice, one of them labelled CPU (issue #37). The protocol carried no host
 *  CPU figure at all until devup 0.14.0 added `cpuPercent`, so when it is
 *  missing (older daemon, or Windows, where `os.loadavg()` is always zero) the
 *  segment is memory alone rather than a plausible-looking stand-in. */
export function formatSystemStats(sys: SystemStats | null): string {
  if (!sys) return '';
  const parts: string[] = [];
  if (isFiniteNumber(sys.cpuPercent)) parts.push(`$(pulse) ${formatCpu(sys.cpuPercent)}`);
  if (hasMemory(sys)) {
    parts.push(`$(database) ${formatMem(sys.totalMemMB - sys.freeMemMB)}/${formatMem(sys.totalMemMB)}`);
  }
  return parts.join(' · ');
}

/** The same figures spelled out for the status-bar tooltip, one per line. */
export function formatSystemTooltip(sys: SystemStats | null): string {
  if (!sys) return '';
  const lines: string[] = [];
  if (hasMemory(sys)) {
    lines.push(`RAM: ${formatMem(sys.totalMemMB - sys.freeMemMB)} used of ${formatMem(sys.totalMemMB)}`);
  }
  const cores = isFiniteNumber(sys.cpuCores) ? `${sys.cpuCores} cores` : '';
  if (isFiniteNumber(sys.cpuPercent)) {
    // One decimal, though the daemon sends two: the tooltip is part of the
    // comparison that decides whether to redraw (see `systemStatsKey`), and a
    // second decimal of load average moves on nearly every poll without
    // telling anyone anything.
    const load = isFiniteNumber(sys.loadAvg1) ? `, load ${sys.loadAvg1.toFixed(1)}` : '';
    lines.push(`CPU: ${formatCpu(sys.cpuPercent)}${cores ? ` of ${cores}${load}` : ''}`);
  } else if (cores) {
    lines.push(cores);
  }
  return lines.join('\n');
}

/** What the UI would show for these system stats, as one string.
 *
 *  Two snapshots with the same key are indistinguishable on screen, so there
 *  is nothing to redraw. This is the comparison `StatsCache` uses for system
 *  stats, because comparing the raw fields does not work: the daemon recomputes
 *  `freeMemMB` from `os.freemem()` on every 3 s poll, and on a live machine
 *  that whole-megabyte figure moves every single time — while the text built
 *  from it, quantised to 0.1 GB, does not. Comparing the fields would leave the
 *  UI recomputing 1,200 times an hour with nothing to show for it, which is the
 *  whole of issue #40.
 *
 *  The status bar is the only consumer of `SystemStats`; if another appears,
 *  its output belongs in this key too. */
export function systemStatsKey(sys: SystemStats): string {
  return `${formatSystemStats(sys)}\u0000${formatSystemTooltip(sys)}`;
}

function hasMemory(sys: SystemStats): boolean {
  return isFiniteNumber(sys.totalMemMB) && sys.totalMemMB > 0 && isFiniteNumber(sys.freeMemMB);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
