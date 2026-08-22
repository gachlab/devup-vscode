import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sanitize, defaultSocketPath } from '../../src/socket-path.js';

/** devup's own rule, copied from src/control-plane/socket-server.ts. If this
 *  and `sanitize` ever disagree, the extension resolves a path the daemon does
 *  not listen on and reports it as "not running". */
function daemonSanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'devup';
}

const NAMES = [
  'Guesthub', 'Tamanaco', 'Legaltech Suite', '@gachlab/web', '(demo)', '#1 stack',
  'a b  c', '___', '  padded  ', 'ünïcode', 'dots.and-dashes_ok', '', '/', 'x/',
];

describe('sanitize', () => {
  it('agrees with the daemon on every name', () => {
    for (const name of NAMES) {
      assert.equal(sanitize(name), daemonSanitize(name), `diverged on ${JSON.stringify(name)}`);
    }
  });

  it('keeps the underscores a leading unsafe character produces', () => {
    // Trimming them is what made `@gachlab/web` resolve to sock-gachlab_web
    // while the daemon listened on sock-_gachlab_web.
    assert.equal(sanitize('@gachlab/web'), '_gachlab_web');
    assert.equal(sanitize('(demo)'), '_demo_');
  });

  it('collapses a run of unsafe characters into one underscore', () => {
    assert.equal(sanitize('a   b'), 'a_b');
  });

  it('falls back to devup for a name with nothing usable left', () => {
    assert.equal(sanitize(''), 'devup');
  });
});

describe('defaultSocketPath', () => {
  it('builds the path the daemon binds', () => {
    assert.equal(defaultSocketPath('Guesthub'), join(homedir(), '.devup', 'sock-Guesthub.sock'));
    assert.equal(defaultSocketPath('Legaltech Suite'), join(homedir(), '.devup', 'sock-Legaltech_Suite.sock'));
  });
});
