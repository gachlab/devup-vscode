/** Cache for the `stats` poll — no vscode dependency, so it can be unit-tested.
 *
 *  The poll runs every 3 s whether or not the numbers move. Firing a change
 *  event on every tick makes every subscriber — tree, status bar, badge,
 *  context key, detail panels — recompute forever (issue #40), which is why
 *  `PortForwarder` had to keep its own fingerprint to ignore the noise.
 *  `update()` reports whether anything actually changed, so the store can stay
 *  quiet when nothing did. */
import type { ServiceStats, SystemStats } from './types.js';
import { serviceStatsKey, systemStatsKey } from './url-builder.js';

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
    // `sendRpc` resolves whatever sat in the response's `result` field, so a
    // daemon answering with null — or with no result key at all — arrives
    // here as null or undefined. Dereferencing it would throw into
    // `pollStats`' bare catch and wedge the cache for the session, which is
    // the very failure `readServices` below exists to prevent; the guard just
    // has to start one level higher.
    if (!result || typeof result !== 'object') return this.clear();
    const services = readServices(result.services);
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

/** Keep only entries that are actually a pair of numbers.
 *
 *  The protocol is a hand-written copy and nothing validates it (CLAUDE.md
 *  rule 2), so a malformed entry has to be survivable. It is worse than it
 *  sounds if it is not: caching one and then comparing against it throws,
 *  `pollStats` swallows the error, the assignment below never runs — and every
 *  later poll re-enters the same throw, freezing the tree and status bar on
 *  stale numbers for the rest of the session with nothing logged. A dropped
 *  entry just reads as "no stats for this service", which the tree and the
 *  status bar already render. */
function readServices(raw: StatsResult['services']): Map<string, ServiceStats> {
  const out = new Map<string, ServiceStats>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, stats] of Object.entries(raw)) {
    if (!stats || typeof stats !== 'object') continue;
    const { cpu, memMB } = stats as Partial<ServiceStats>;
    if (!Number.isFinite(cpu) || !Number.isFinite(memMB)) continue;
    out.set(name, { cpu: cpu as number, memMB: memMB as number });
  }
  return out;
}

function sameServices(a: Map<string, ServiceStats>, b: Map<string, ServiceStats>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, stats] of a) {
    const other = b.get(name);
    if (!other) return false;
    if (serviceStatsKey(stats) !== serviceStatsKey(other)) return false;
  }
  return true;
}

/** Compared by what the status bar would render, not field by field: host free
 *  memory moves on literally every poll, so a field comparison reports a
 *  change every 3 s forever while the screen stays identical. See
 *  `systemStatsKey`, and `serviceStatsKey` for the same argument per service. */
function sameSystem(a: SystemStats | null, b: SystemStats | null): boolean {
  if (a === null || b === null) return a === b;
  return systemStatsKey(a) === systemStatsKey(b);
}
