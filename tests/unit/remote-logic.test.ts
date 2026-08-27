import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionOutcome, canAttachDebugger, debugPickDescription, errorsLabel, remoteDescription,
  remoteBannerText, remoteOf, remoteTooltipLines, reportsSkippedRemote, serviceContextValue,
  serviceStatusText, supportsRemoteSwitch,
} from '../../src/remote-logic.js';
import type { RemoteInfo } from '../../src/types.js';

const qa: RemoteInfo = { envName: 'qa', target: 'https://app-api.qa.norelian.com', readOnly: false };
const qaRo: RemoteInfo = { ...qa, readOnly: true };

describe('remoteOf', () => {
  it('reads the field', () => {
    assert.equal(remoteOf({ remote: qa }), qa);
  });

  it('treats absent and null the same', () => {
    // A daemon before 0.18.0 omits it; one after sends null for a local
    // service. Neither is remote, and a caller should not have to know which
    // shape it got.
    assert.equal(remoteOf({}), null);
    assert.equal(remoteOf({ remote: null }), null);
  });
});

describe('remoteDescription', () => {
  it('names the environment rather than repeating the status', () => {
    // `running` is true and useless: what matters is that the process is not
    // on this machine.
    assert.equal(remoteDescription(qa), '→ qa');
  });

  it('marks a read-only environment', () => {
    assert.equal(remoteDescription(qaRo), '→ qa (read-only)');
  });
});

describe('remoteTooltipLines', () => {
  it('leads with the write warning, because that is the line with consequences', () => {
    const [first] = remoteTooltipLines(qa);
    assert.match(first!, /writes from here reach it/);
  });

  it('says so plainly when writes are refused', () => {
    const [first] = remoteTooltipLines(qaRo);
    assert.match(first!, /read-only/);
    assert.ok(!/writes from here reach it/.test(first!), first);
  });

  it('names the target and explains the two absences', () => {
    const lines = remoteTooltipLines(qa).join('\n');
    assert.match(lines, /https:\/\/app-api\.qa\.norelian\.com/);
    // Both come from having no process, and neither is guessable from the row.
    assert.match(lines, /attach a debugger/);
    assert.match(lines, /CPU or memory/);
  });
});

describe('errorsLabel', () => {
  it('counts stderr lines for a local service', () => {
    assert.equal(errorsLabel({}), 'errors');
  });

  it('counts unreachable requests for a remote one', () => {
    // Same number, different thing to do about it: local errors point at the
    // service, remote ones at the network or the environment being down.
    assert.equal(errorsLabel({ remote: qa }), 'unreachable requests');
  });
});

describe('canAttachDebugger', () => {
  it('allows a local service', () => {
    assert.deepEqual(canAttachDebugger({ name: 'app-api' }), { ok: true });
  });

  it('refuses a remote one and says what to do instead', () => {
    // Offering the entry and doing nothing is the failure this replaces. The
    // reason is the useful half.
    const v = canAttachDebugger({ name: 'app-api', remote: qa });
    assert.equal(v.ok, false);
    assert.match(v.reason!, /served from qa/);
    assert.match(v.reason!, /Bring it local/);
  });
});

describe('actionOutcome', () => {
  it('reports an ordinary restart as done', () => {
    const out = actionOutcome('restart', 'app-api', { ok: true });
    assert.equal(out.kind, 'done');
    assert.match(out.message, /restart sent/);
  });

  it('reports a skip when the daemon says the service is remote', () => {
    // `skippedRemote` arrives with `ok: true`, so a client that only reads
    // `ok` claims a restart that never happened.
    const out = actionOutcome('restart', 'app-api', { ok: true, skippedRemote: 'qa' });
    assert.equal(out.kind, 'skipped');
    assert.match(out.message, /served from qa — nothing to restart here/);
  });

  it('falls back to the snapshot against a daemon too old to send the field', () => {
    // contract 3 has `remote` on the snapshot but no `skippedRemote` on the
    // result. Without this the extension would say "restarted" there.
    const out = actionOutcome('restart', 'app-api', { ok: true }, { remote: qa });
    assert.equal(out.kind, 'skipped');
    assert.match(out.message, /served from qa/);
  });

  it('prefers the daemon over the snapshot when both say something', () => {
    // The result describes what just happened; the snapshot may be a poll old.
    const out = actionOutcome('start', 'app-api', { ok: true, skippedRemote: 'staging' }, { remote: qa });
    assert.match(out.message, /served from staging/);
  });

  it('reports a genuine failure', () => {
    const out = actionOutcome('start', 'app-api', { ok: false });
    assert.equal(out.kind, 'failed');
  });

  it('does not call a failure a skip just because the snapshot is stale', () => {
    // A service brought local a moment ago that then failed to start: the
    // snapshot may still say remote, but `ok: false` with no `skippedRemote`
    // is the daemon saying it tried and could not.
    const out = actionOutcome('start', 'app-api', { ok: false }, { remote: null });
    assert.equal(out.kind, 'failed');
  });

  it('keeps the lazy-idle skip distinct', () => {
    const out = actionOutcome('restart', 'app-api', { ok: true, skippedIdle: true });
    assert.equal(out.kind, 'skipped');
    assert.match(out.message, /idle \(lazy\)/);
  });

  it('says something sensible when the daemon answered nothing at all', () => {
    const out = actionOutcome('restart', 'app-api', undefined);
    assert.equal(out.kind, 'done');
  });
});

describe('contract gates', () => {
  it('needs 3 for the remote switch, and 4 for skippedRemote', () => {
    assert.equal(supportsRemoteSwitch(2), false);
    assert.equal(supportsRemoteSwitch(3), true);
    assert.equal(reportsSkippedRemote(3), false);
    assert.equal(reportsSkippedRemote(4), true);
  });

  it('treats an unknown contract as too old for both', () => {
    // `contract` is absent from daemons before 0.16.0, and its absence *is*
    // the answer — it must not read as "new enough".
    assert.equal(supportsRemoteSwitch(undefined), false);
    assert.equal(reportsSkippedRemote(undefined), false);
  });
});

describe('serviceStatusText', () => {
  it('shows status and health for a local service', () => {
    assert.equal(serviceStatusText({ status: 'running', health: 'up' }), 'running/up');
  });

  it('puts the environment where the status would be', () => {
    // Every remote service reports `running`, so the column would read the
    // same for all of them. The environment is what varies.
    assert.equal(serviceStatusText({ status: 'running', health: 'up', remote: qa }), '→ qa/up');
  });

  it('keeps health, which for a remote service is whether the environment answers', () => {
    assert.equal(serviceStatusText({ status: 'running', health: 'down', remote: qa }), '→ qa/down');
  });

  it('marks read-only there too', () => {
    assert.equal(serviceStatusText({ status: 'running', health: 'up', remote: qaRo }), '→ qa (read-only)/up');
  });
});

describe('serviceContextValue', () => {
  it('is unchanged for an ordinary service', () => {
    assert.equal(serviceContextValue({ type: 'api' }), 'service-api');
  });

  it('keeps the debug prefix', () => {
    assert.equal(serviceContextValue({ type: 'api', debugPort: 39481 }), 'debug-service-api');
  });

  it('adds a remote prefix the menus can anchor on', () => {
    assert.equal(serviceContextValue({ type: 'web', remote: qa }), 'remote-service-web');
  });

  it('still matches the unanchored service- clauses that already exist', () => {
    // Every menu clause in package.json today tests `=~ /service-/`. A prefix
    // that broke those would silently empty the context menu.
    for (const v of [
      serviceContextValue({ type: 'api', remote: qa }),
      serviceContextValue({ type: 'api', remote: qa, debugPort: 1 }),
    ]) {
      assert.match(v, /service-/);
    }
  });
});

describe('debugPickDescription', () => {
  it('shows the inspector port when there is one', () => {
    assert.equal(debugPickDescription({ name: 'a', type: 'api', debugPort: 39481 }), 'inspector on :39481');
  });

  it('falls back to the command, then to the type', () => {
    assert.equal(debugPickDescription({ name: 'a', type: 'api', cmd: 'node' }), 'node');
    assert.equal(debugPickDescription({ name: 'a', type: 'web' }), 'web');
  });

  it('replaces all of that with the reason for a remote service', () => {
    // Kept in the list rather than filtered out: removing it leaves someone
    // hunting for a service that is plainly in the sidebar. The reason says
    // both why it is unavailable and what to do about it.
    const d = debugPickDescription({ name: 'a', type: 'api', cmd: 'node', remote: qa });
    assert.match(d, /served from qa/);
    assert.match(d, /Bring it local/);
    assert.ok(!/node/.test(d), d);
  });
});

describe('remoteBannerText', () => {
  it('names the environment, the target and what writes do', () => {
    const t = remoteBannerText(qa);
    assert.match(t, /Served from qa/);
    assert.match(t, /https:\/\/app-api\.qa\.norelian\.com/);
    assert.match(t, /Writes from here reach it/);
  });

  it('says writes are refused for a read-only environment', () => {
    const t = remoteBannerText(qaRo);
    assert.match(t, /read-only/);
    assert.ok(!/Writes from here reach it/.test(t), t);
  });

  it('carries no markdown — the panel is HTML, not a tooltip', () => {
    assert.ok(!/\*\*/.test(remoteBannerText(qa)));
  });
});
