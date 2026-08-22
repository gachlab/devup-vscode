import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyStreamFrame } from '../../src/service-map.js';
import type { ServiceSnapshot } from '../../src/types.js';

function svc(name: string, over: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    name, status: 'running', health: 'up', port: 3000, type: 'api', phase: 0,
    pid: 1, errors: 0, restarts: 0, ...over,
  };
}

function mapOf(...services: ServiceSnapshot[]): Map<string, ServiceSnapshot> {
  return new Map(services.map(s => [s.name, s]));
}

describe('applyStreamFrame — status frames', () => {
  it('adds a service the map has not seen', () => {
    const services = mapOf(svc('app-api'));
    const effect = applyStreamFrame(services, { event: 'status', data: [svc('app-web')] });
    assert.deepEqual(effect, { applied: true, added: ['app-web'], removed: [] });
    assert.deepEqual([...services.keys()], ['app-api', 'app-web']);
  });

  it('updates one it has, without reporting it as added', () => {
    const services = mapOf(svc('app-api', { health: 'up' }));
    const effect = applyStreamFrame(services, { event: 'status', data: [svc('app-api', { health: 'down' })] });
    assert.deepEqual(effect.added, []);
    assert.equal(services.get('app-api')?.health, 'down');
  });

  it('applies a frame carrying several services', () => {
    const services = new Map<string, ServiceSnapshot>();
    const effect = applyStreamFrame(services, { event: 'status', data: [svc('a'), svc('b'), svc('c')] });
    assert.deepEqual(effect.added, ['a', 'b', 'c']);
    assert.equal(services.size, 3);
  });

  it('skips an entry with no usable name rather than filing it under undefined', () => {
    // The protocol is a hand-written copy that nothing validates.
    const services = new Map<string, ServiceSnapshot>();
    const effect = applyStreamFrame(services, {
      event: 'status',
      data: [null, 'nope', {}, { name: '' }, { name: 42 }, svc('real')],
    });
    assert.deepEqual(effect.added, ['real']);
    assert.deepEqual([...services.keys()], ['real']);
  });
});

describe('applyStreamFrame — removal frames', () => {
  it('drops a service the daemon says is gone — the whole of issue #39', () => {
    const services = mapOf(svc('app-api'), svc('app-web'));
    const effect = applyStreamFrame(services, { event: 'removed', data: ['app-web'] });
    assert.deepEqual(effect, { applied: true, added: [], removed: ['app-web'] });
    assert.deepEqual([...services.keys()], ['app-api']);
  });

  it('drops several at once', () => {
    const services = mapOf(svc('a'), svc('b'), svc('c'));
    const effect = applyStreamFrame(services, { event: 'removed', data: ['a', 'c'] });
    assert.deepEqual(effect.removed, ['a', 'c']);
    assert.deepEqual([...services.keys()], ['b']);
  });

  it('reports only what was actually there', () => {
    // A removal for something we never had is not an error, and must not be
    // announced as though a service had just disappeared.
    const services = mapOf(svc('a'));
    const effect = applyStreamFrame(services, { event: 'removed', data: ['ghost'] });
    assert.deepEqual(effect, { applied: true, added: [], removed: [] });
    assert.equal(services.size, 1);
  });

  it('ignores non-string entries', () => {
    const services = mapOf(svc('a'));
    const effect = applyStreamFrame(services, { event: 'removed', data: [null, 42, { name: 'a' }] });
    assert.deepEqual(effect.removed, []);
    assert.equal(services.size, 1);
  });

  it('does not re-add on a later status frame for a service still in the config', () => {
    // Removal then a genuine re-add: a service deleted and put back.
    const services = mapOf(svc('a'));
    applyStreamFrame(services, { event: 'removed', data: ['a'] });
    const effect = applyStreamFrame(services, { event: 'status', data: [svc('a')] });
    assert.deepEqual(effect.added, ['a']);
    assert.equal(services.size, 1);
  });
});

describe('applyStreamFrame — frames it does not understand', () => {
  it('ignores another event without touching the map', () => {
    const services = mapOf(svc('a'));
    const effect = applyStreamFrame(services, { event: 'log', data: 'some line' });
    assert.deepEqual(effect, { applied: false, added: [], removed: [] });
    assert.equal(services.size, 1);
  });

  it('ignores an unknown event even when its data looks like a snapshot', () => {
    // Not the same test as above: that one exits on the data shape and never
    // reaches the event check.
    const services = mapOf(svc('a'));
    const effect = applyStreamFrame(services, { event: 'something-new', data: [svc('b')] });
    assert.deepEqual(effect, { applied: false, added: [], removed: [] });
    assert.deepEqual([...services.keys()], ['a']);
  });

  it('ignores a frame whose data is not an array', () => {
    const services = mapOf(svc('a'));
    for (const data of [null, undefined, 'x', 42, { name: 'b' }]) {
      assert.equal(applyStreamFrame(services, { event: 'status', data }).applied, false);
      assert.equal(applyStreamFrame(services, { event: 'removed', data }).applied, false);
    }
    assert.equal(services.size, 1);
  });

  it('treats an empty snapshot as applied — "connected, nothing configured"', () => {
    // The daemon sends one deliberately, and it is not the same as no frame.
    const services = new Map<string, ServiceSnapshot>();
    assert.equal(applyStreamFrame(services, { event: 'status', data: [] }).applied, true);
  });
});
