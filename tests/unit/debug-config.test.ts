import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildAttachConfig, resolveServiceCwd } from '../../src/debug-config.js';

describe('buildAttachConfig', () => {
  const config = buildAttachConfig('app-api', 39481, '/w/app/api');

  it('attaches rather than launching', () => {
    // The daemon owns the process — watch, health checks and restarts included.
    // Launching a second copy is what this feature exists to avoid.
    assert.equal(config.request, 'attach');
    assert.equal(config.type, 'node');
  });

  it('targets the reported inspector port on localhost', () => {
    assert.equal(config.port, 39481);
    assert.equal(config.address, '127.0.0.1');
  });

  it('roots source maps at the service, not the workspace', () => {
    assert.equal(config.cwd, '/w/app/api');
    assert.equal(config.localRoot, '/w/app/api');
    assert.equal(config.remoteRoot, '/w/app/api');
    assert.equal(config.sourceMaps, true);
  });

  it('does not ask the adapter to reattach', () => {
    // devup starts a debugged service with `--inspect=0`, so the OS picks the
    // port and it differs on every restart — a reattach would reconnect to a
    // dead endpoint.
    assert.equal(config.restart, false);
  });

  it('skips node internals and names the session after the service', () => {
    assert.deepEqual(config.skipFiles, ['<node_internals>/**']);
    assert.equal(config.name, 'devup: app-api');
  });
});

describe('resolveServiceCwd', () => {
  it('resolves a relative cwd against the folder that holds the config', () => {
    // Not against workspaceFolders[0]: in a multi-root workspace the devup
    // folder need not be the first.
    assert.equal(resolveServiceCwd('app/api', '/w/second'), join('/w/second', 'app', 'api'));
  });

  it('leaves an absolute cwd alone', () => {
    assert.equal(resolveServiceCwd('/srv/app/api', '/w'), '/srv/app/api');
  });

  it('handles the current-directory cwd real configs use', () => {
    assert.equal(resolveServiceCwd('.', '/w'), '/w');
  });

  it('is null when there is no cwd to resolve', () => {
    assert.equal(resolveServiceCwd(undefined, '/w'), null);
    assert.equal(resolveServiceCwd('', '/w'), null);
    assert.equal(resolveServiceCwd('   ', '/w'), null);
  });
});

describe('the port the config is built from', () => {
  it('is whatever was reported, not a fixed one', () => {
    // devup uses --inspect=0 and reads the port back from Node's banner, so
    // 9229 is never a safe assumption.
    assert.equal(buildAttachConfig('a', 40001, '/w').port, 40001);
    assert.equal(buildAttachConfig('a', 33333, '/w').port, 33333);
  });
});
