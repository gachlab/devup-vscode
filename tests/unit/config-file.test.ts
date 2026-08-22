import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProjectName, findConfigFile, readProjectName } from '../../src/config-file.js';

describe('parseProjectName', () => {
  it('reads the top-level name of a defineConfig call', () => {
    assert.equal(parseProjectName(`import { defineConfig } from '@gachlab/devup';

export default defineConfig({
  name: 'Guesthub',
  icon: '🏨',
  envFile: '.env',
  services: [
    { name: 'configurations-api', cwd: 'configurations/api', port: 2999 },
  ],
});`), 'Guesthub');
  });

  it('is not fooled by services declared before the name — issue #38', () => {
    // A legal reordering. The old regex took the first `name:` anywhere in the
    // file and came back with the first *service* instead.
    assert.equal(parseProjectName(`export default defineConfig({
  services: [ { name: 'configurations-api', port: 2999 } ],
  name: 'Guesthub',
})`), 'Guesthub');
  });

  it('ignores a name nested in any other object', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  proxy: { name: 'traefik', domain: 'guesthub.test' },
  services: [{ name: 'app-api', healthCheck: { name: 'tcp' } }],
})`), null);
  });

  it('handles double quotes, backticks and spaces in the value', () => {
    assert.equal(parseProjectName(`export default defineConfig({ name: "Tamanaco" })`), 'Tamanaco');
    assert.equal(parseProjectName('export default defineConfig({ name: `Tamanaco` })'), 'Tamanaco');
    assert.equal(parseProjectName(`export default defineConfig({ name: 'Legaltech Suite' })`), 'Legaltech Suite');
  });

  it('handles a quoted key', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  "services": [{ "name": "svc" }],
  "name": "Quoted",
})`), 'Quoted');
  });

  it('handles a type argument on defineConfig', () => {
    assert.equal(parseProjectName(`export default defineConfig<DevStackConfig>({
  services: [{ name: 'svc' }],
  name: 'Generic',
})`), 'Generic');
  });

  it('handles a plain default export and module.exports', () => {
    assert.equal(parseProjectName(`export default {\n  services: [{ name: 'svc' }],\n  name: 'Direct',\n};`), 'Direct');
    assert.equal(parseProjectName(`module.exports = {\n  services: [{ name: 'svc' }],\n  name: 'CJS',\n};`), 'CJS');
  });

  it('does not read a name out of a comment', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  // name: 'Commented',
  /* name: 'AlsoCommented' */
  services: [],
  name: 'Real',
})`), 'Real');
  });

  it('does not read a name out of a string value', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  banner: '"name": "fake"',
  motd: 'name: also fake',
  name: 'Real',
})`), 'Real');
  });

  it('is not confused by braces or quotes inside a string', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  banner: 'a { b } c',
  envFile: "it's fine",
  name: 'Braces',
})`), 'Braces');
  });

  it('steps over a template literal with an interpolation', () => {
    assert.equal(parseProjectName('export default defineConfig({\n  envFile: `${process.cwd()}/.env`,\n  name: \'Tmpl\',\n})'), 'Tmpl');
  });

  it('refuses an interpolated template literal rather than inventing a name', () => {
    // `${pkg.name}` would sanitise to `pkg.name` and resolve to
    // sock-pkg.name.sock — reported as read from the config, so the user would
    // be told to start a daemon instead of that the name could not be read.
    assert.equal(parseProjectName('export default defineConfig({ name: `${pkg.name}` })'), null);
    assert.equal(parseProjectName('export default defineConfig({ name: `devup-${env}` })'), null);
    // A backtick with nothing interpolated is a perfectly good literal.
    assert.equal(parseProjectName('export default defineConfig({ name: `Plain` })'), 'Plain');
  });

  it('does not match a key that merely ends in name', () => {
    assert.equal(parseProjectName(`export default defineConfig({
  filename: 'nope.txt',
  hostname: 'nope.local',
})`), null);
  });

  it('returns null rather than guessing', () => {
    assert.equal(parseProjectName(`export default defineConfig({ services: [{ name: 'svc' }] })`), null);
    assert.equal(parseProjectName(`const config = { name: 'Orphan' };`), null);
    assert.equal(parseProjectName(''), null);
    assert.equal(parseProjectName(`export default defineConfig({ name: '' })`), null);
  });

  it('survives an unterminated object without hanging', () => {
    assert.equal(parseProjectName(`export default defineConfig({ services: [ { name: 'a'`), null);
    assert.equal(parseProjectName('export default defineConfig({ envFile: `unterminated'), null);
  });
});

describe('findConfigFile and readProjectName', () => {
  let dir = '';
  before(() => { dir = mkdtempSync(join(tmpdir(), 'devup-discovery-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  const folder = (name: string) => {
    const p = join(dir, name);
    mkdirSync(p, { recursive: true });
    return p;
  };

  it('finds nothing in a folder without a config', () => {
    const p = folder('empty');
    assert.equal(findConfigFile(p), null);
    assert.equal(readProjectName(p), null);
  });

  it('reads a JSON config', () => {
    const p = folder('json');
    writeFileSync(join(p, 'devup.config.json'), JSON.stringify({ name: 'FromJson', services: [] }));
    assert.equal(findConfigFile(p), join(p, 'devup.config.json'));
    assert.deepEqual(readProjectName(p), { name: 'FromJson', file: join(p, 'devup.config.json') });
  });

  it('reads a TypeScript config', () => {
    const p = folder('ts');
    writeFileSync(join(p, 'devup.config.ts'), `export default defineConfig({ services: [], name: 'FromTs' })`);
    assert.deepEqual(readProjectName(p), { name: 'FromTs', file: join(p, 'devup.config.ts') });
  });

  it('prefers the file the daemon would load, not the one that parses exactly', () => {
    // devup's loader takes devup.config.ts first (src/config/loader.ts). Were
    // this the other way round, a repo carrying both would run under one name
    // and be looked for under the other.
    const p = folder('both');
    writeFileSync(join(p, 'devup.config.json'), JSON.stringify({ name: 'FromJson' }));
    writeFileSync(join(p, 'devup.config.ts'), `export default defineConfig({ name: 'FromTs' })`);
    assert.equal(findConfigFile(p), join(p, 'devup.config.ts'));
    assert.equal(readProjectName(p)?.name, 'FromTs');
  });

  it('ignores a .mjs config, which devup itself does not load', () => {
    const p = folder('mjs');
    writeFileSync(join(p, 'devup.config.mjs'), `export default defineConfig({ name: 'FromMjs' })`);
    assert.equal(findConfigFile(p), null);
    assert.equal(readProjectName(p), null);
  });

  it('falls through to the next variant when one carries no name', () => {
    const p = folder('fallthrough');
    writeFileSync(join(p, 'devup.config.ts'), `export default defineConfig({ services: [] })`);
    writeFileSync(join(p, 'devup.config.json'), JSON.stringify({ name: 'FromJson' }));
    assert.equal(readProjectName(p)?.name, 'FromJson');
  });

  it('does not throw on malformed JSON, and moves on', () => {
    const p = folder('broken-json');
    writeFileSync(join(p, 'devup.config.js'), `module.exports = { services: [] }`);
    writeFileSync(join(p, 'devup.config.json'), '{ not json at all');
    assert.equal(readProjectName(p), null);
    writeFileSync(join(p, 'devup.config.js'), `module.exports = { name: 'FromJs' }`);
    assert.equal(readProjectName(p)?.name, 'FromJs');
  });

  it('trims a name padded with whitespace', () => {
    const p = folder('padded');
    writeFileSync(join(p, 'devup.config.json'), JSON.stringify({ name: '  Padded  ' }));
    assert.equal(readProjectName(p)?.name, 'Padded');
  });

  it('reports the file it found even when nothing declares a name', () => {
    const p = folder('nameless');
    writeFileSync(join(p, 'devup.config.ts'), `export default defineConfig({ services: [] })`);
    assert.equal(findConfigFile(p), join(p, 'devup.config.ts'));
    assert.equal(readProjectName(p), null);
  });
});
