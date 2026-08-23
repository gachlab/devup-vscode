import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tooOldMessage } from '../../src/daemon-version.js';
import { describeDaemon, usableVersion } from '../../src/diagnosis.js';

describe('tooOldMessage', () => {
  it('names the version actually running when the daemon reports one', () => {
    // "Needs 0.14.0 or newer" is half an answer. Diagnosing why debugging did
    // not work was, in large part, working out what the daemon was.
    const msg = tooOldMessage('cannot use the inspector.', '0.14.0', '0.13.2');
    assert.match(msg, /0\.13\.2/);
    assert.match(msg, /0\.14\.0 or newer/);
  });

  it('does not render the daemon\'s "unknown" sentinel as a version', () => {
    const msg = tooOldMessage('cannot use the inspector.', '0.14.0', 'unknown');
    assert.ok(!/devup unknown/.test(msg), msg);
    assert.match(msg, /predates 0\.16\.0/);
  });

  it('says why it cannot name it when the daemon predates the field', () => {
    const msg = tooOldMessage('cannot use the inspector.', '0.14.0', undefined);
    assert.match(msg, /0\.14\.0 or newer/);
    assert.match(msg, /predates 0\.16\.0/);
    assert.ok(!msg.includes('undefined'), 'never leak the missing value into the message');
  });
});

describe('describeDaemon', () => {
  it('names the version and the contract when the daemon reports them', () => {
    // Working out which devup was actually running used to be most of the work
    // of diagnosing why debugging or forwarding misbehaved.
    assert.equal(
      describeDaemon({ version: '0.16.0', contract: 1 }),
      '@gachlab/devup 0.16.0, control-plane contract 1',
    );
  });

  it('says a silent daemon is old, because only old ones are silent', () => {
    const msg = describeDaemon({});
    assert.match(msg, /older than 0\.16\.0/);
  });

  it('does not print the daemon\'s "unknown" sentinel as if it were a version', () => {
    // The daemon sends that literal string when it cannot read its own
    // manifest. "@gachlab/devup unknown" reads like a bug in the extension.
    const msg = describeDaemon({ version: 'unknown' });
    assert.ok(!msg.includes('unknown)') && !/devup unknown/.test(msg), msg);
    assert.match(msg, /older than 0\.16\.0|does not report/);
  });

  it('omits the contract when the daemon does not send one', () => {
    assert.equal(describeDaemon({ version: '0.16.0' }), '@gachlab/devup 0.16.0');
  });

  it('says so when there is no daemon at all', () => {
    assert.equal(describeDaemon(undefined), 'not connected');
  });
});

describe('usableVersion', () => {
  it('rejects the sentinel and the empty string, keeps a real version', () => {
    assert.equal(usableVersion('0.16.0'), '0.16.0');
    assert.equal(usableVersion('unknown'), null);
    assert.equal(usableVersion(''), null);
    assert.equal(usableVersion(undefined), null);
  });
});
