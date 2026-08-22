import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sanitizeForLogs, logDirFor, logFileFor } from '../../src/log-paths.js';
import { sanitize as sanitizeForSocket } from '../../src/socket-path.js';

/** devup's log-path rule, copied from src/process/log-sink.ts. */
function daemonLogSanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'devup';
}

const NAMES = ['Guesthub', 'Legaltech Suite', '@gachlab/web', '(demo)', 'app-api', '  padded  ', '', '___'];

describe('sanitizeForLogs', () => {
  it('agrees with the daemon on every name', () => {
    for (const name of NAMES) {
      assert.equal(sanitizeForLogs(name), daemonLogSanitize(name), `diverged on ${JSON.stringify(name)}`);
    }
  });

  it('differs from the socket rule, because devup does', () => {
    // Not a bug here to be tidied away: LogSink trims leading and trailing
    // underscores and defaultSocketPath does not, so one project genuinely has
    // logs/gachlab_web and sock-_gachlab_web.sock. Copying either rule to the
    // other place opens the wrong file.
    assert.equal(sanitizeForLogs('@gachlab/web'), 'gachlab_web');
    assert.equal(sanitizeForSocket('@gachlab/web'), '_gachlab_web');
  });
});

describe('logDirFor and logFileFor', () => {
  const home = homedir();

  it('builds the default path', () => {
    assert.equal(logDirFor('Guesthub'), join(home, '.devup', 'logs', 'Guesthub'));
    assert.equal(logFileFor('Guesthub', 'app-api'), join(home, '.devup', 'logs', 'Guesthub', 'app-api.log'));
  });

  it('sanitises the project and the service separately', () => {
    assert.equal(
      logFileFor('Legaltech Suite', 'check-in/api'),
      join(home, '.devup', 'logs', 'Legaltech_Suite', 'check-in_api.log'),
    );
  });

  it('honours a --log-dir override', () => {
    assert.equal(logDirFor('Guesthub', '/var/log/devup'), join('/var/log/devup', 'Guesthub'));
    assert.equal(logFileFor('Guesthub', 'app-api', '/var/log/devup'), join('/var/log/devup', 'Guesthub', 'app-api.log'));
  });

  it('treats a blank override as absent', () => {
    // The setting defaults to "", and an empty string must not resolve the
    // root to the current working directory.
    assert.equal(logDirFor('Guesthub', ''), join(home, '.devup', 'logs', 'Guesthub'));
    assert.equal(logDirFor('Guesthub', '   '), join(home, '.devup', 'logs', 'Guesthub'));
  });

  it('falls back to devup for a name with nothing usable in it', () => {
    assert.equal(logDirFor('///'), join(home, '.devup', 'logs', 'devup'));
  });
});
