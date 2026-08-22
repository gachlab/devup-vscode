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

/** Host CPU load, in whole percent — coarser than the per-service `formatCpu`,
 *  on purpose.
 *
 *  The daemon derives this from the 1-minute load average
 *  (`round(load / cores * 1000) / 10`), so on an 8-core machine a 0.01 change
 *  in load moves it by 0.125 pp — enough to change a tenth-of-a-percent
 *  reading on essentially every kernel loadavg update. Since what the status
 *  bar renders is also what decides whether to redraw (`systemStatsKey`),
 *  showing that last digit would keep the whole UI recomputing every few
 *  seconds to display a number nobody can act on. The tooltip's load average
 *  carries the finer detail for anyone who wants it. */
export function formatHostCpu(cpuPercent: number): string {
  return `${Math.round(cpuPercent)}%`;
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
  if (isFiniteNumber(sys.cpuPercent)) parts.push(`$(pulse) ${formatHostCpu(sys.cpuPercent)}`);
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
    // `loadAvg1` is deliberately not shown. It is the same measurement as
    // cpuPercent, at a resolution that moves between polls on any busy
    // machine — and since this text is part of the redraw key, printing it
    // would put the noise straight back that `formatHostCpu` took out.
    lines.push(`CPU: ${formatHostCpu(sys.cpuPercent)}${cores ? ` of ${cores}` : ''}`);
  } else if (cores) {
    lines.push(cores);
  }
  return lines.join('\n');
}

/** The precision at which one service's stats can change anything on screen.
 *
 *  Compared like the system key at the precision that is shown rather than
 *  field by field: the daemon reports RSS to a tenth of a megabyte and no live
 *  Node dev server holds still to that between two polls 3 s apart, so an
 *  exact comparison reports a change on essentially every tick and redraws
 *  `184 MB` as `184 MB` forever — issue #40 again, for the common case.
 *
 *  Memory is compared at the whole megabyte rather than at what `formatMem`
 *  prints, which is not the same thing above a gigabyte: there it prints
 *  tenths of a gigabyte, and a key that coarse would let a service sitting at
 *  1510 MB keep the wrong warning icon indefinitely against a 1500 MB
 *  threshold — the icons test the raw value. At the megabyte the blind spot is
 *  under 1 MB and closes on the next poll that moves the figure. CPU needs no
 *  such allowance: the daemon already rounds it to the tenth that `formatCpu`
 *  prints. */
export function serviceStatsKey(stats: { cpu: number; memMB: number }): string {
  return `${formatCpu(stats.cpu)}\u0000${Math.round(stats.memMB)}`;
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

/** The route a service is reachable on through the proxy, or null when it has
 *  none — which the sidebar used to render identically to having one. Empty
 *  string is a real value: it means the domain root. */
export function proxyRouteFor(name: string, proxy: ProxyInfo | null): string | null {
  if (!proxy?.active) return null;
  const sub = proxy.routes[name];
  if (sub === undefined) return null;
  return sub ? `${sub}.${proxy.domain}` : proxy.domain;
}

/** One line describing the running proxy, for the tree root. */
export function describeProxy(proxy: ProxyInfo | null): string | null {
  if (!proxy) return null;
  const parts = [proxy.provider || 'proxy', proxy.domain].filter(Boolean);
  parts.push(proxy.tls ? 'TLS' : 'no TLS');
  if (!proxy.active) parts.push('inactive');
  return parts.join(" \u00b7 ");
}
