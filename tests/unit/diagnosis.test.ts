import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, describeDiagnosis, type DiagnosisInput } from '../../src/diagnosis.js';

const base: DiagnosisInput = {
  state: 'unreachable',
  configFile: '/w/devup.config.ts',
  source: 'config file',
  socketExists: false,
};

describe('diagnose', () => {
  it('says connected when it is', () => {
    assert.equal(diagnose({ ...base, state: 'connected' }), 'connected');
    // Even with everything else looking wrong: a live connection is the answer.
    assert.equal(diagnose({ ...base, state: 'connected', configFile: null, source: 'fallback' }), 'connected');
  });

  it('does not call a connection in progress a failure', () => {
    // The state is `connecting` for the 2 s probe and on every backoff attempt.
    // Diagnosing that as noAnswer offered to restart a perfectly good daemon.
    assert.equal(diagnose({ ...base, state: 'connecting', socketExists: true }), 'connecting');
    assert.equal(diagnose({ ...base, state: 'connecting', socketExists: false }), 'connecting');
  });

  it('still reports a workspace problem while connecting, since it is one either way', () => {
    assert.equal(diagnose({ ...base, state: 'connecting', configFile: null, source: 'fallback' }), 'noConfig');
    assert.equal(diagnose({ ...base, state: 'connecting', source: 'fallback' }), 'guessedName');
  });

  it('distinguishes a missing daemon from a wedged one', () => {
    assert.equal(diagnose({ ...base, socketExists: false }), 'socketMissing');
    assert.equal(diagnose({ ...base, socketExists: true }), 'noAnswer');
  });

  it('says so when there is no config to resolve a name from', () => {
    assert.equal(diagnose({ ...base, configFile: null, source: 'fallback' }), 'noConfig');
  });

  it('says so when the name was guessed from the folder', () => {
    assert.equal(diagnose({ ...base, source: 'fallback' }), 'guessedName');
    // A guessed name is the problem whether or not something is listening at
    // the path it produced.
    assert.equal(diagnose({ ...base, source: 'fallback', socketExists: true }), 'guessedName');
  });

  it('does not send someone to fix a config they deliberately bypassed', () => {
    // With an explicit setting, a missing config file is not the story.
    assert.equal(diagnose({ ...base, configFile: null, source: 'projectName setting' }), 'socketMissing');
    assert.equal(diagnose({ ...base, configFile: null, source: 'socketPath setting' }), 'socketMissing');
    assert.equal(diagnose({ ...base, configFile: null, source: 'socketPath setting', socketExists: true }), 'noAnswer');
  });
});

describe('describeDiagnosis', () => {
  const detail = {
    projectName: 'Guesthub',
    socketPath: '/home/u/.devup/sock-Guesthub.sock',
    source: 'config file' as const,
    configFile: '/w/devup.config.ts',
    socketExists: false,
  };

  it('shows the path, where it came from, and whether it is there', () => {
    const text = describeDiagnosis('socketMissing', detail);
    assert.match(text, /Guesthub/);
    assert.match(text, /sock-Guesthub\.sock/);
    assert.match(text, /read from the config file/);
    assert.match(text, /not found/);
    assert.doesNotMatch(text, /\bexists\b/);
  });

  it('reports an existing socket as existing', () => {
    assert.match(describeDiagnosis('noAnswer', { ...detail, socketExists: true }), /exists/);
  });

  it('names the setting a guessed name should be fixed with', () => {
    const text = describeDiagnosis('guessedName', { ...detail, source: 'fallback' });
    assert.match(text, /guessed from the workspace folder name/);
    assert.match(text, /devup\.projectName/);
  });

  it('says which override is in force', () => {
    assert.match(describeDiagnosis('socketMissing', { ...detail, source: 'socketPath setting' }), /devup\.socketPath setting/);
    assert.match(describeDiagnosis('socketMissing', { ...detail, source: 'projectName setting' }), /devup\.projectName setting/);
  });

  it('says there is no config file rather than printing null', () => {
    const text = describeDiagnosis('noConfig', { ...detail, configFile: null });
    assert.match(text, /none found in this workspace/);
    assert.doesNotMatch(text, /null/);
  });

  it('carries an explanation for every case', () => {
    for (const d of ['connected', 'connecting', 'noWorkspace', 'noConfig', 'guessedName', 'socketMissing', 'noAnswer'] as const) {
      const text = describeDiagnosis(d, detail);
      // Four header lines, a blank, then the explanation.
      assert.ok(text.split('\n').slice(5).join('').trim().length > 0, `no explanation for ${d}`);
    }
  });
});
