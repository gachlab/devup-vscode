import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceUrl, formatCpu, formatMem, formatSystemStats, formatSystemTooltip, systemStatsKey } from '../../src/url-builder.js';
import type { ProxyInfo, SystemStats } from '../../src/types.js';

const proxy: ProxyInfo = {
  active: true,
  provider: 'traefik',
  domain: 'localhost',
  tls: false,
  routes: { 'app-web': '', 'admin-web': 'admin' },
};

describe('buildServiceUrl', () => {
  it('returns localhost URL when proxy is null', () => {
    assert.equal(buildServiceUrl('app-web', 3000, null), 'http://localhost:3000');
  });

  it('returns localhost URL when proxy.active is false', () => {
    assert.equal(buildServiceUrl('app-web', 3000, { ...proxy, active: false }), 'http://localhost:3000');
  });

  it('returns domain root for empty route string', () => {
    assert.equal(buildServiceUrl('app-web', 3000, proxy), 'http://localhost');
  });

  it('returns subdomain for named route', () => {
    assert.equal(buildServiceUrl('admin-web', 4000, proxy), 'http://admin.localhost');
  });

  it('uses https when tls is true', () => {
    const tlsProxy = { ...proxy, tls: true };
    assert.equal(buildServiceUrl('app-web', 3000, tlsProxy), 'https://localhost');
  });

  it('falls back to localhost when service has no route', () => {
    assert.equal(buildServiceUrl('unknown-svc', 9000, proxy), 'http://localhost:9000');
  });
});

describe('formatCpu', () => {
  it('formats with one decimal place', () => {
    assert.equal(formatCpu(2.3456), '2.3%');
  });

  it('formats zero', () => {
    assert.equal(formatCpu(0), '0.0%');
  });

  it('formats 100%', () => {
    assert.equal(formatCpu(100), '100.0%');
  });
});

describe('formatMem', () => {
  it('shows MB when below 1024', () => {
    assert.equal(formatMem(512), '512 MB');
  });

  it('shows GB when 1024 or above', () => {
    assert.equal(formatMem(2048), '2.0 GB');
  });

  it('shows fractional GB', () => {
    assert.equal(formatMem(1536), '1.5 GB');
  });

  it('formats zero', () => {
    assert.equal(formatMem(0), '0 MB');
  });
});

// 31 GB total, 19 GB free — 12 GB in use. Deliberately not a round percentage
// of anything: the bug this covers printed the *memory* share (38.7%) behind a
// CPU icon, so a fixture where the two happen to coincide would prove nothing.
const sys: SystemStats = { totalMemMB: 31000, freeMemMB: 19000, cpuCores: 8, loadAvg1: 1.2, cpuPercent: 15 };

describe('formatSystemStats', () => {
  it('shows the reported CPU, not the memory share', () => {
    const out = formatSystemStats(sys);
    assert.match(out, /\$\(pulse\) 15%/);
    // 12000/31000 = 38.7% — what the old code put behind the pulse icon.
    assert.doesNotMatch(out, /39%/);
  });

  it('shows memory in absolute terms only', () => {
    assert.equal(formatSystemStats(sys), '$(pulse) 15% · $(database) 11.7 GB/30.3 GB');
  });

  it('omits CPU when the daemon does not report it', () => {
    const { cpuPercent, ...rest } = sys;
    const out = formatSystemStats(rest as SystemStats);
    assert.equal(out, '$(database) 11.7 GB/30.3 GB');
    assert.doesNotMatch(out, /\$\(pulse\)/);
    assert.doesNotMatch(out, /%/);
  });

  it('keeps a zero CPU reading, which is a real number', () => {
    assert.match(formatSystemStats({ ...sys, cpuPercent: 0 }), /\$\(pulse\) 0%/);
  });

  it('is empty without stats', () => {
    assert.equal(formatSystemStats(null), '');
  });

  it('drops the memory segment rather than printing NaN', () => {
    assert.equal(formatSystemStats({ totalMemMB: 0, freeMemMB: 0, cpuCores: 8, cpuPercent: 15 }), '$(pulse) 15%');
  });
});

describe('formatSystemTooltip', () => {
  it('spells out CPU against the core count and load', () => {
    assert.equal(formatSystemTooltip(sys), 'RAM: 11.7 GB used of 30.3 GB\nCPU: 15% of 8 cores, load 1.2');
  });

  it('rounds the load average to what the poll can meaningfully report', () => {
    assert.match(formatSystemTooltip({ ...sys, loadAvg1: 1.24 }), /load 1\.2$/);
  });

  it('falls back to the core count when there is no CPU figure', () => {
    const { cpuPercent, loadAvg1, ...rest } = sys;
    assert.equal(formatSystemTooltip(rest as SystemStats), 'RAM: 11.7 GB used of 30.3 GB\n8 cores');
  });

  it('is empty without stats', () => {
    assert.equal(formatSystemTooltip(null), '');
  });
});

describe('systemStatsKey', () => {
  it('is unchanged by host free memory drifting below display precision', () => {
    // The daemon recomputes freeMemMB from os.freemem() on every 3 s poll and
    // it moves every time on a live machine — but 12000 MB and 12003 MB in use
    // both render as 11.7 GB, so there is nothing to redraw.
    assert.equal(systemStatsKey(sys), systemStatsKey({ ...sys, freeMemMB: 18997 }));
  });

  it('changes when the rendered memory does', () => {
    assert.notEqual(systemStatsKey(sys), systemStatsKey({ ...sys, freeMemMB: 18000 }));
  });

  it('changes when the rendered CPU does', () => {
    assert.notEqual(systemStatsKey(sys), systemStatsKey({ ...sys, cpuPercent: 16 }));
  });

  it('is unchanged by a CPU reading that moves under a whole percent', () => {
    // cpuPercent is derived from the load average, so on an 8-core box a 0.01
    // change in load moves it by 0.125 pp. Tracking that would fire the redraw
    // on every kernel loadavg update — which is issue #40 all over again.
    assert.equal(systemStatsKey({ ...sys, cpuPercent: 15.1 }), systemStatsKey({ ...sys, cpuPercent: 15.4 }));
  });

  it('changes when the core count does, which only the tooltip shows', () => {
    assert.notEqual(systemStatsKey(sys), systemStatsKey({ ...sys, cpuCores: 16 }));
  });

  it('is unchanged by a second decimal of load average', () => {
    assert.equal(systemStatsKey({ ...sys, loadAvg1: 1.2 }), systemStatsKey({ ...sys, loadAvg1: 1.24 }));
  });
});
