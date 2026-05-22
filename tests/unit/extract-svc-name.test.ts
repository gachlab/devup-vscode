import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSvcName } from '../../src/svc-name.js';

const snapshot = {
  name: 'api', status: 'running', health: 'up',
  port: 3000, type: 'api', phase: 0,
  pid: 1, errors: 0, restarts: 0,
};

describe('extractSvcName', () => {
  it('returns string arg directly', () => {
    assert.equal(extractSvcName('api'), 'api');
  });

  it('extracts name from tree Node { kind: service, svc: ServiceSnapshot }', () => {
    assert.equal(extractSvcName({ kind: 'service', svc: snapshot }), 'api');
  });

  it('extracts from legacy { svc: string }', () => {
    assert.equal(extractSvcName({ svc: 'api' }), 'api');
  });

  it('extracts from legacy { name: string }', () => {
    assert.equal(extractSvcName({ name: 'api' }), 'api');
  });

  it('returns null for undefined', () => {
    assert.equal(extractSvcName(undefined), null);
  });

  it('returns null for empty object', () => {
    assert.equal(extractSvcName({}), null);
  });

  it('returns null for group node', () => {
    assert.equal(extractSvcName({ kind: 'group', label: 'APIs', services: [] }), null);
  });

  it('does not return object when svc is a ServiceSnapshot (the original bug)', () => {
    const result = extractSvcName({ svc: snapshot });
    assert.notEqual(result, '[object Object]');
    assert.equal(result, null); // svc is not a string, falls through
  });
});
