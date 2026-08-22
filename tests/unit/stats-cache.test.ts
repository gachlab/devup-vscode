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

  it('stays quiet through a service RSS drifting under the displayed megabyte', () => {
    // Same argument per service: the daemon reports RSS to a tenth of a
    // megabyte, a live Node dev server never holds still to that precision,
    // and the tree prints whole megabytes.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1.2, memMB: 184.2 } }));
    assert.equal(cache.update(result({ api: { cpu: 1.2, memMB: 184.4 } })), false);
  });

  it('speaks up when a service figure the tree prints does move', () => {
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 1.2, memMB: 184.4 } }));
    assert.equal(cache.update(result({ api: { cpu: 1.2, memMB: 185.1 } })), true);
    assert.equal(cache.update(result({ api: { cpu: 1.3, memMB: 185.1 } })), true);
  });

  it('compares memory at the megabyte even above a gigabyte, where the tree prints tenths', () => {
    // formatMem would render 1490 and 1510 MB alike as `1.5 GB`. A key that
    // coarse leaves a service sitting at 1510 MB with the wrong warning icon
    // against a 1500 MB threshold for as long as it sits there.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 1490 } }));
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 1510 } })), true);
  });

  it('accepts one poll of lag on a threshold crossing hidden inside a megabyte', () => {
    // The known cost of comparing at display precision: 499.6 and 500.2 both
    // print `500 MB`, so the tree's warning icon waits for the next poll where
    // the printed figure moves. Documented here so it is a decision, not a
    // surprise.
    const cache = new StatsCache();
    cache.update(result({ api: { cpu: 0, memMB: 499.6 } }));
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 500.2 } })), false);
    assert.equal(cache.update(result({ api: { cpu: 0, memMB: 501.0 } })), true);
  });
});

describe('StatsCache against a malformed stats frame', () => {
  // The protocol is a hand-written copy that nothing validates (CLAUDE.md
  // rule 2). Caching a bad entry and then comparing against it next poll used
  // to throw inside pollStats' bare catch, so the cache was never assigned and
  // every later poll re-entered the same throw — the tree and status bar froze
  // on stale numbers for the rest of the session, silently.
  const junk = { services: { api: null, web: 'nope', ok: { cpu: 1, memMB: 100 } } } as never;

  it('drops entries that are not a pair of numbers, and keeps the good one', () => {
    const cache = new StatsCache();
    cache.update(junk);
    assert.equal(cache.get('api'), null);
    assert.equal(cache.get('web'), null);
    assert.deepEqual(cache.get('ok'), { cpu: 1, memMB: 100 });
  });

  it('still updates on the next poll instead of wedging', () => {
    const cache = new StatsCache();
    cache.update(junk);
    assert.equal(cache.update(result({ api: { cpu: 2, memMB: 200 }, ok: { cpu: 1, memMB: 100 } })), true);
    assert.deepEqual(cache.get('api'), { cpu: 2, memMB: 200 });
  });

  it('drops NaN, which would otherwise be rendered as "NaN MB"', () => {
    const cache = new StatsCache();
    cache.update({ services: { api: { cpu: Number.NaN, memMB: 100 } }, system });
    assert.equal(cache.get('api'), null);
  });
});
