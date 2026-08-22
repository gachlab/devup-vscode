import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Backoff } from '../../src/backoff.js';

describe('Backoff', () => {
  it('starts at the base delay', () => {
    assert.equal(new Backoff().next(), 3000);
  });

  it('doubles each attempt up to the ceiling, then holds', () => {
    const b = new Backoff();
    assert.deepEqual([b.next(), b.next(), b.next(), b.next(), b.next(), b.next(), b.next()],
      [3000, 6000, 12000, 24000, 30000, 30000, 30000]);
  });

  it('never exceeds the ceiling, however long the daemon stays down', () => {
    const b = new Backoff();
    for (let i = 0; i < 100; i++) assert.ok(b.next() <= 30000);
  });

  it('goes back to the base delay after a successful connect', () => {
    const b = new Backoff();
    b.next(); b.next(); b.next();
    b.reset();
    assert.equal(b.next(), 3000);
  });

  it('honours custom bounds', () => {
    const b = new Backoff(1000, 4000);
    assert.deepEqual([b.next(), b.next(), b.next(), b.next()], [1000, 2000, 4000, 4000]);
  });
});
