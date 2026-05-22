import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceUrl, formatCpu, formatMem } from '../../src/url-builder.js';
import type { ProxyInfo } from '../../src/types.js';

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
