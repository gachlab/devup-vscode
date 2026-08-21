import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectForwardPorts, parseForwardMode, isPortIgnored, canonicalPort } from '../../src/forward-logic.js';
import type { ServiceSnapshot } from '../../src/types.js';

function svc(name: string, port: number, type: string, originalPort?: number): ServiceSnapshot {
  return { name, status: 'running', health: 'up', port, originalPort, type, phase: 1, pid: 1, errors: 0, restarts: 0 };
}

const services: ServiceSnapshot[] = [
  svc('app-web', 4201, 'web'),
  svc('app-api', 3000, 'api'),
  svc('reservations-web', 4210, 'web'),
  svc('configurations-api', 2999, 'api'),
  // Deliberately not four digits: a lexicographic sort would put 443 and 80
  // after 3000, so this fixture fails if the numeric comparator is lost.
  svc('legacy-web', 80, 'web'),
  svc('tls-api', 443, 'api'),
];

describe('selectForwardPorts', () => {
  it('returns nothing when disabled', () => {
    assert.deepEqual(selectForwardPorts(services, 'off'), []);
  });

  it('forwards only web ports by default', () => {
    assert.deepEqual(selectForwardPorts(services, 'web'), [80, 4201, 4210]);
  });

  it('forwards every port in all mode, sorted', () => {
    assert.deepEqual(selectForwardPorts(services, 'all'), [80, 443, 2999, 3000, 4201, 4210]);
  });

  it('dedupes services sharing a port', () => {
    const dup = [svc('a', 4201, 'web'), svc('b', 4201, 'web')];
    assert.deepEqual(selectForwardPorts(dup, 'web'), [4201]);
  });

  it('skips unusable port numbers', () => {
    const bad = [svc('a', 0, 'web'), svc('b', -1, 'web'), svc('c', 70000, 'web'), svc('d', 4201, 'web')];
    assert.deepEqual(selectForwardPorts(bad, 'web'), [4201]);
  });

  it('handles an empty service list', () => {
    assert.deepEqual(selectForwardPorts([], 'all'), []);
  });
});

describe('parseForwardMode', () => {
  it('accepts the known modes', () => {
    assert.equal(parseForwardMode('off'), 'off');
    assert.equal(parseForwardMode('all'), 'all');
    assert.equal(parseForwardMode('web'), 'web');
  });

  it('falls back to all for anything else', () => {
    assert.equal(parseForwardMode(undefined), 'all');
    assert.equal(parseForwardMode('nonsense'), 'all');
    assert.equal(parseForwardMode(42), 'all');
  });
});

describe('isPortIgnored', () => {
  const ignore = { onAutoForward: 'ignore' };

  it('is false without attributes', () => {
    assert.equal(isPortIgnored(4201, undefined), false);
    assert.equal(isPortIgnored(4201, null), false);
    assert.equal(isPortIgnored(4201, {}), false);
  });

  it('honours an exact port key', () => {
    assert.equal(isPortIgnored(5432, { '5432': ignore }), true);
    assert.equal(isPortIgnored(4201, { '5432': ignore }), false);
  });

  it('honours a range key, inclusive at both ends', () => {
    assert.equal(isPortIgnored(3005, { '3000-3010': ignore }), true);
    assert.equal(isPortIgnored(3000, { '3000-3010': ignore }), true);
    assert.equal(isPortIgnored(3010, { '3000-3010': ignore }), true);
    assert.equal(isPortIgnored(3011, { '3000-3010': ignore }), false);
  });

  it('only reacts to onAutoForward "ignore"', () => {
    assert.equal(isPortIgnored(4201, { '4201': { onAutoForward: 'notify' } }), false);
    assert.equal(isPortIgnored(4201, { '4201': { label: 'app' } }), false);
  });

  it('does not consult regex keys, which match command lines not ports', () => {
    assert.equal(isPortIgnored(4201, { '/.+\\/server.js/': ignore }), false);
  });

  it('survives junk keys and values', () => {
    assert.equal(isPortIgnored(4201, { '': ignore, '  ': ignore, 'abc': ignore, '4201': null }), false);
  });
});

describe('canonicalPort', () => {
  it('trusts originalPort when the daemon publishes it', () => {
    assert.equal(canonicalPort({ port: 13002, originalPort: 3002 }), 3002);
    assert.equal(canonicalPort({ port: 4201, originalPort: 4201 }), 4201);
  });

  it('leaves the port alone when originalPort is missing', () => {
    // Older daemons do not publish it. Undoing the offset here would mangle a
    // service legitimately configured on a high port in a non-lazy stack.
    assert.equal(canonicalPort({ port: 13002 }), 13002);
    assert.equal(canonicalPort({ port: 18080 }), 18080);
  });

  it('leaves an always-on port alone', () => {
    assert.equal(canonicalPort({ port: 4201 }), 4201);
    assert.equal(canonicalPort({ port: 2999 }), 2999);
  });

  it('ignores an unusable originalPort', () => {
    assert.equal(canonicalPort({ port: 13002, originalPort: 0 }), 13002);
    assert.equal(canonicalPort({ port: 13002, originalPort: -1 }), 13002);
    assert.equal(canonicalPort({ port: 13002, originalPort: 70000 }), 13002);
    assert.equal(canonicalPort({ port: 13002, originalPort: undefined }), 13002);
  });
});

describe('selectForwardPorts with lazy services', () => {
  // The bug that shipped in 0.6.0: these were forwarded as 13002 / 14210,
  // which reach the service directly and bypass the proxy that starts it.
  const lazy: ServiceSnapshot[] = [
    svc('authorization-api', 13002, 'api', 3002),
    svc('reservations-web', 14210, 'web', 4210),
    svc('app-web', 4201, 'web', 4201),
    svc('configurations-api', 2999, 'api', 2999),
  ];

  it('forwards the port the app is configured to call', () => {
    assert.deepEqual(selectForwardPorts(lazy, 'all'), [2999, 3002, 4201, 4210]);
  });

  it('still filters by type in web mode', () => {
    assert.deepEqual(selectForwardPorts(lazy, 'web'), [4201, 4210]);
  });

  it('does not invent a port for a daemon that predates originalPort', () => {
    const old = [svc('legacy-api', 18080, 'api')];
    assert.deepEqual(selectForwardPorts(old, 'all'), [18080]);
  });

  it('falls back to the reported port when originalPort is nonsense', () => {
    const bad = [svc('broken', 3000, 'api', 70000), svc('ok', 3001, 'api', 3001)];
    assert.deepEqual(selectForwardPorts(bad, 'all'), [3000, 3001]);
  });

  it('drops a service when neither port is usable', () => {
    const bad = [svc('broken', 70000, 'api', 70001), svc('ok', 3001, 'api', 3001)];
    assert.deepEqual(selectForwardPorts(bad, 'all'), [3001]);
  });
});
