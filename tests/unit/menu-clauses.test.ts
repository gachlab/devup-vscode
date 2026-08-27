import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serviceContextValue } from '../../src/remote-logic.js';
import type { ServiceSnapshot } from '../../src/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string }>;
    menus: { 'view/item/context': Array<{ command: string; when: string }> };
  };
};

const menus = pkg.contributes.menus['view/item/context'];
const commands = new Set(pkg.contributes.commands.map(c => c.command));

/** The `viewItem =~ /…/` half of a `when` clause, as a real RegExp. */
function clausesFor(command: string): RegExp[] {
  return menus
    .filter(m => m.command === command)
    .map(m => {
      const match = /viewItem\s*=~\s*\/(.+?)\/\s*$/.exec(m.when);
      assert.ok(match, `no viewItem clause in: ${m.when}`);
      return new RegExp(match![1]!);
    });
}

const matchesSomeClause = (command: string, contextValue: string): boolean =>
  clausesFor(command).some(re => re.test(contextValue));

/** Every context value the tree can actually produce. The point of the file:
 *  `package.json` and `serviceContextValue` are two halves of one contract and
 *  nothing else checks they agree — CLAUDE.md rule 2. */
const CASES = {
  localApi: serviceContextValue({ type: 'api' }),
  localWeb: serviceContextValue({ type: 'web' }),
  debugApi: serviceContextValue({ type: 'api', debugPort: 39481 }),
  remoteApi: serviceContextValue({ type: 'api', remote: { envName: 'qa', target: 't', readOnly: false } }),
  remoteWeb: serviceContextValue({ type: 'web', remote: { envName: 'qa', target: 't', readOnly: false } }),
} as const;

describe('context menu clauses against the values the tree produces', () => {
  it('every clause names a command that exists', () => {
    for (const m of menus) assert.ok(commands.has(m.command), `menu for unknown command: ${m.command}`);
  });

  it('the always-available actions reach every kind of service', () => {
    // These work regardless of where the process is — a remote service has
    // logs (devup writes one line per proxied request), a detail view, a URL.
    for (const command of ['devup.openServiceDetail', 'devup.tailLogs', 'devup.copyUrl', 'devup.openLogFile', 'devup.openTerminal']) {
      for (const [name, value] of Object.entries(CASES)) {
        assert.ok(matchesSomeClause(command, value), `${command} does not reach ${name} (${value})`);
      }
    }
  });

  it('restart, stop and attach disappear for a service with no process here', () => {
    // Not "present and answering nothing to do": there is no process to
    // restart, stop or attach to, and the menu should say that by not
    // offering it.
    for (const command of ['devup.restart', 'devup.stop', 'devup.debugService']) {
      assert.ok(matchesSomeClause(command, CASES.localApi), `${command} vanished for a local service`);
      assert.ok(matchesSomeClause(command, CASES.debugApi), `${command} vanished for a debugged service`);
      assert.ok(!matchesSomeClause(command, CASES.remoteApi), `${command} is still offered for a remote service`);
    }
  });

  it('bring-local is offered only where it means something', () => {
    assert.ok(matchesSomeClause('devup.bringLocal', CASES.remoteApi));
    assert.ok(matchesSomeClause('devup.bringLocal', CASES.remoteWeb));
    assert.ok(!matchesSomeClause('devup.bringLocal', CASES.localApi));
  });

  it('open-in-browser survives the remote prefix', () => {
    // The clause is anchored (`^(debug-)?service-web$`), so adding a prefix
    // would have dropped it silently — and a remote web service is reachable
    // on localhost exactly like a local one, because devup's proxy answers.
    assert.ok(matchesSomeClause('devup.openInBrowser', CASES.localWeb));
    assert.ok(matchesSomeClause('devup.openInBrowser', CASES.remoteWeb),
      'the remote- prefix broke an anchored clause');
    assert.ok(!matchesSomeClause('devup.openInBrowser', CASES.remoteApi), 'offered for an API');
  });

  it('stop-debugging still matches a debugged service', () => {
    assert.ok(matchesSomeClause('devup.stopDebugging', CASES.debugApi));
    assert.ok(!matchesSomeClause('devup.stopDebugging', CASES.localApi));
  });
});
