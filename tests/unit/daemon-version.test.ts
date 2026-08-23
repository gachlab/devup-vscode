import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tooOldMessage, daemonHasMethod } from '../../src/daemon-version.js';

describe('tooOldMessage', () => {
  it('names the version actually running when the daemon reports one', () => {
    // "Needs 0.14.0 or newer" is half an answer. Diagnosing why debugging did
    // not work was, in large part, working out what the daemon was.
    const msg = tooOldMessage('cannot use the inspector.', '0.14.0', '0.13.2');
    assert.match(msg, /0\.13\.2/);
    assert.match(msg, /0\.14\.0 or newer/);
  });

  it('says why it cannot name it when the daemon predates the field', () => {
    const msg = tooOldMessage('cannot use the inspector.', '0.14.0', undefined);
    assert.match(msg, /0\.14\.0 or newer/);
    assert.match(msg, /predates 0\.16\.0/);
    assert.ok(!msg.includes('undefined'), 'never leak the missing value into the message');
  });
});

describe('daemonHasMethod', () => {
  it('answers from the advertised list', () => {
    assert.equal(daemonHasMethod('debug', ['ping', 'debug']), true);
    assert.equal(daemonHasMethod('teleport', ['ping', 'debug']), false);
  });

  it('answers "no idea" for a daemon that advertises nothing', () => {
    // `methods` arrived in 0.16.0, and refusing to try against every daemon
    // released before it would break the extension for its own users. The
    // caller falls back to finding out from the error.
    assert.equal(daemonHasMethod('debug', undefined), undefined);
  });
});
