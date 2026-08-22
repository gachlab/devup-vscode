import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatsCache } from '../../src/stats-cache.js';
import type { SystemStats } from '../../src/types.js';

const system: SystemStats = { totalMemMB: 31000, freeMemMB: 19000, cpuCores: 8, loadAvg1: 1.2, cpuPercent: 15 };

function result(services: Record<string, { cpu: number; memMB: number }>, sys: SystemStats | null = system) {
  return { services, system: sys };
}

describe('StatsCache.update', () => {
  it('reports the first poll as a change', () => {
    const cache = new StatsCache();
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 100 } })), true);
  });

  it('reports an identical poll as no change — the whole point of issue #40', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 }, web: { cpu: 2, memMB: 200 } }));
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 100 }, web: { cpu: 2, memMB: 200 } })), false);
  });

  it('notices a moved cpu figure', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.update(result({ api: { cpu: 1.1, memMB: 100 } })), true);
  });

  it('notices a moved memory figure', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 101 } })), true);
  });

  it('notices a service appearing', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 100 }, web: { cpu: 0, memMB: 0 } })), true);
  });

  it('notices a service disappearing', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 }, web: { cpu: 0, memMB: 0 } }));
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 100 } })), true);
  });

  it('notices a service being swapped for another with identical numbers', () => {
    // Same size, same values — only the names differ, which a count-and-sum
    // comparison would miss.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.update(result({ web: { cpu: 1, memMB: 100 } })), true);
  });

  it('notices system memory moving while services hold still', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.update(result({ api: { cpu: 1, memMB: 100 } }, { ...system, freeMemMB: 18000 })), true);
  });

  it('notices host cpu moving while services hold still', () => {
    // Services can be idle while the machine is not — a compile in another
    // window. Comparing only the service map would go quiet here.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 100 } }));
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 100 } }, { ...system, cpuPercent: 90, loadAvg1: 7.2 })), true);
  });

  it('notices system stats arriving or going away', () => {
    const cache = new StatsCache();
    cache.update(result({}, null));
    assert.equal(cache.update(result({}, system)), true);
    assert.equal(cache.update(result({}, null)), true);
  });

  it('survives a daemon that omits the services map', () => {
    const cache = new StatsCache();
    assert.equal(cache.update({ system }), true);
    assert.equal(cache.update({ system }), false);
    assert.equal(cache.get('api'), null);
  });
});

describe('StatsCache reads', () => {
  it('hands back what it was given, and null for the unknown', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.deepEqual(cache.get('api'), { cpu: 1, memMB: 100 });
    assert.equal(cache.get('nope'), null);
    assert.deepEqual(cache.getSystem(), system);
  });
});

describe('StatsCache.clear', () => {
  it('reports true only when there was something to drop', () => {
    const cache = new StatsCache();
    assert.equal(cache.clear(), false);
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    assert.equal(cache.clear(), true);
    assert.equal(cache.clear(), false);
  });

  it('leaves nothing behind', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1, memMB: 100 } }));
    cache.clear();
    assert.equal(cache.get('api'), null);
    assert.equal(cache.getSystem(), null);
  });

  it('counts system-only state as something to drop', () => {
    const cache = new StatsCache();
    cache.update({ system });
    assert.equal(cache.clear(), true);
  });
});

describe('StatsCache and the every-3-seconds problem', () => {
  // The reason issue #40 is easy to "fix" without fixing anything: the daemon
  // recomputes freeMemMB from os.freemem() on every poll, so a field-by-field
  // comparison reports a change every 3 s on any machine that is doing
  // anything at all — including running the editor asking the question.
  const drifting = [19000, 18997, 19002, 18999, 19001];

  it('stays quiet through host memory drifting under the displayed precision', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 100 } }, { ...system, freeMemMB: drifting[0] }));
    for (const freeMemMB of drifting.slice(1)) {
      assert.equal(cache.update(result({ api: { cpu: 0, memMB: 100 } }, { ...system, freeMemMB })), false);
    }
  });

  it('still speaks up once the drift reaches the screen', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 100 } }, { ...system, freeMemMB: 19000 }));
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 100 } }, { ...system, freeMemMB: 18000 })), true);
  });

  it('does not extend that leniency to per-service figures', () => {
    // These drive the tree's warning icons against a raw threshold, so a tenth
    // of a megabyte is a real change even where the label would not move.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 499.6 } }));
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 500.2 } })), true);
  });
});
