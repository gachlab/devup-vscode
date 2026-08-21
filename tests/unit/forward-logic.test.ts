import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectForwardPorts, parseForwardMode, isPortIgnored } from '../../src/forward-logic.js';
import type { ServiceSnapshot } from '../../src/types.js';

function svc(name: string, port: number, type: string): ServiceSnapshot {
  return { name, status: 'running', health: 'up', port, type, phase: 1, pid: 1, errors: 0, restarts: 0 };
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

  it('falls back to web for anything else', () => {
    assert.equal(parseForwardMode(undefined), 'web');
    assert.equal(parseForwardMode('nonsense'), 'web');
    assert.equal(parseForwardMode(42), 'web');
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
