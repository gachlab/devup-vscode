/** Cache for the `stats` poll — no vscode dependency, so it can be unit-tested.
 *
 *  The poll runs every 3 s whether or not the numbers move. Firing a change
 *  event on every tick makes every subscriber — tree, status bar, badge,
 *  context key, detail panels — recompute forever (issue #40), which is why
 *  `PortForwarder` had to keep its own fingerprint to ignore the noise.
 *  `update()` reports whether anything actually changed, so the store can stay
 *  quiet when nothing did. */
import type { ServiceStats, SystemStats } from './types.js';

export interface StatsResult {
  services?: Record<string, ServiceStats>;
  system?: SystemStats | null;
}

export class StatsCache {
  private services = new Map<string, ServiceStats>();
  private system: SystemStats | null = null;

  get(name: string): ServiceStats | null {
    return this.services.get(name) ?? null;
  }

  getSystem(): SystemStats | null {
    return this.system;
  }

  /** Replace the cached stats; true when the new numbers differ from the old. */
  update(result: StatsResult): boolean {
    const raw = result.services;
    const services = new Map<string, ServiceStats>(
      raw && typeof raw === 'object' ? Object.entries(raw) : [],
    );
    const system = result.system ?? null;
    const changed = !sameServices(this.services, services) || !sameSystem(this.system, system);
    this.services = services;
    this.system = system;
    return changed;
  }

  /** Drop everything; true when there was anything to drop, so a disconnect
   *  that empties the cache still reaches the UI. */
  clear(): boolean {
    const had = this.services.size > 0 || this.system !== null;
    this.services.clear();
    this.system = null;
    return had;
  }
}

function sameServices(a: Map<string, ServiceStats>, b: Map<string, ServiceStats>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, stats] of a) {
    const other = b.get(name);
    if (!other) return false;
    if (stats.cpu !== other.cpu || stats.memMB !== other.memMB) return false;
  }
  return true;
}

function sameSystem(a: SystemStats | null, b: SystemStats | null): boolean {
  if (a === null || b === null) return a === b;
  return a.totalMemMB === b.totalMemMB
    && a.freeMemMB === b.freeMemMB
    && a.cpuCores === b.cpuCores
    && a.loadAvg1 === b.loadAvg1
    && a.cpuPercent === b.cpuPercent;
}
