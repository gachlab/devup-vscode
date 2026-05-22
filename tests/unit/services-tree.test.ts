import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseGroups } from '../../src/tree-logic.js';
import type { ServiceSnapshot } from '../../src/types.js';

function svc(name: string, phase: number, type = 'api'): ServiceSnapshot {
  return { name, status: 'running', health: 'up', port: 3000, type, phase, pid: 1, errors: 0, restarts: 0 };
}

describe('buildPhaseGroups', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(buildPhaseGroups([]), []);
  });

  it('groups single phase correctly', () => {
    const groups = buildPhaseGroups([svc('api', 0), svc('web', 0)]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.label, 'phase 0');
    assert.equal(groups[0]!.services.length, 2);
  });

  it('groups multiple phases in numeric order', () => {
    const groups = buildPhaseGroups([svc('api', 1), svc('db', 0), svc('worker', 2)]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0]!.label, 'phase 0');
    assert.equal(groups[1]!.label, 'phase 1');
    assert.equal(groups[2]!.label, 'phase 2');
  });

  it('sorts services within a phase alphabetically', () => {
    const groups = buildPhaseGroups([svc('z-api', 0), svc('a-api', 0), svc('m-api', 0)]);
    const names = groups[0]!.services.map(s => s.name);
    assert.deepEqual(names, ['a-api', 'm-api', 'z-api']);
  });

  it('returns group nodes with kind: group', () => {
    const groups = buildPhaseGroups([svc('api', 0)]);
    assert.equal(groups[0]!.kind, 'group');
  });

  it('handles services without explicit phase (defaults to 0)', () => {
    const noPhase = { ...svc('api', 0), phase: undefined as unknown as number };
    const groups = buildPhaseGroups([noPhase]);
    assert.equal(groups[0]!.label, 'phase 0');
  });
});
