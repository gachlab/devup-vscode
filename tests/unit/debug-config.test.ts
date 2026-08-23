import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { buildAttachConfig, buildBrowserConfig, buildServiceConfigurations, classifyTermination, parseBrowser, pathRebase, resolveServiceCwd, DEBUG_TYPE, SESSION_PREFIX } from '../../src/debug-config.js';

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
    assert.equal(config.sourceMaps, true);
  });

  it('declares no remote path rebase when there is nothing to rebase', () => {
    // localRoot/remoteRoot map paths under remoteRoot and drop everything
    // else, so pinning them to the service directory when both spellings are
    // the same would be a restriction bought for nothing.
    assert.ok(!('localRoot' in config), 'localRoot should not be set');
    assert.ok(!('remoteRoot' in config), 'remoteRoot should not be set');
    assert.ok(!('localRoot' in buildAttachConfig('a', 1, '/w/app/api', null)));
  });

  it('lleva el rebase que le den, sin inventarlo', () => {
    const linked = buildAttachConfig('app-api', 39481, '/home/u/repos/app/api',
      { localRoot: '/home/u/repos', remoteRoot: '/mnt/data/repos' });
    assert.equal(linked.localRoot, '/home/u/repos');
    assert.equal(linked.remoteRoot, '/mnt/data/repos');
    // El cwd sigue siendo el que el editor entiende.
    assert.equal(linked.cwd, '/home/u/repos/app/api');
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

describe('SESSION_PREFIX', () => {
  it('is the prefix the session name is built from', () => {
    // The extension recognises its own debug sessions by this, to avoid
    // attaching twice to an inspector that serves one debugger at a time.
    assert.ok(buildAttachConfig('app-api', 1, '/w').name.startsWith(SESSION_PREFIX));
    assert.equal(buildAttachConfig('app-api', 1, '/w').name.slice(SESSION_PREFIX.length), 'app-api');
  });
});

describe('buildServiceConfigurations', () => {
  it('da una entrada por servicio, con su nombre de sesión', () => {
    const configs = buildServiceConfigurations(['app-api', 'app-web']);
    assert.deepEqual(configs.map(c => c.service), ['app-api', 'app-web']);
    assert.deepEqual(configs.map(c => c.name), ['devup: app-api', 'devup: app-web']);
  });

  it('las marca del tipo que resuelve la extensión, no node', () => {
    // El resolver es quien convierte esto en un attach de node, después de
    // pedirle al daemon que reinicie el servicio bajo el inspector. Nacer como
    // `node` saltaría ese paso y apuntaría a un puerto que aún no existe.
    const [config] = buildServiceConfigurations(['app-api']);
    assert.equal(config!.type, DEBUG_TYPE);
    assert.equal(config!.request, 'attach');
  });

  it('no inventa entradas cuando no hay servicios', () => {
    assert.deepEqual(buildServiceConfigurations([]), []);
  });

  it('el nombre lleva el prefijo por el que la extensión reconoce sus sesiones', () => {
    // De esto depende el re-acople: `onDidTerminateDebugSession` sólo trae el
    // nombre de la sesión.
    const [config] = buildServiceConfigurations(['app-api']);
    assert.ok(config!.name.startsWith(SESSION_PREFIX));
    assert.equal(config!.name.slice(SESSION_PREFIX.length), 'app-api');
  });
});

describe('classifyTermination', () => {
  it('el mismo puerto sigue escuchando: el usuario se desacopló', () => {
    // Node deja el inspector abierto cuando un cliente se desconecta.
    assert.equal(classifyTermination(39481, 39481), 'detached');
  });

  it('otro puerto ya arriba: el servicio reinició y ganó la carrera', () => {
    // `--inspect=0` reparte un puerto distinto en cada arranque, así que un
    // número diferente sólo puede ser un proceso nuevo.
    assert.equal(classifyTermination(39481, 40122), 'restarted');
  });

  it('sin puerto: aún no se sabe', () => {
    // El daemon limpia `debugPort` al cerrarse el proceso. Si volverá o no lo
    // dice el puerto nuevo, cuando aparezca.
    assert.equal(classifyTermination(39481, null), 'unknown');
    assert.equal(classifyTermination(39481, undefined), 'unknown');
  });

  it('no confunde una sesión sin puerto conocido con un desacople', () => {
    // Si no supimos a qué puerto se acopló la sesión, un puerto vivo no
    // demuestra que nadie reiniciara.
    assert.equal(classifyTermination(undefined, 39481), 'restarted');
    assert.equal(classifyTermination(undefined, null), 'unknown');
  });
});

describe('buildBrowserConfig', () => {
  const config = buildBrowserConfig('app-web', 'http://localhost:4201', '/w/app/web', ['devup: app-api']);

  it('lanza el navegador contra la URL del servicio', () => {
    assert.equal(config.request, 'launch');
    assert.equal(config.url, 'http://localhost:4201');
  });

  it('enraíza los source maps en la carpeta del web, no en la del monorepo', () => {
    // Un breakpoint en un .ts del front sólo liga si webRoot apunta a donde
    // están sus fuentes.
    assert.equal(config.webRoot, '/w/app/web');
    assert.equal(config.sourceMaps, true);
  });

  it('arrastra las sesiones de los APIs al cerrarse', () => {
    // Es lo único que hace que esto se sienta como una sola cosa: no hay API
    // de compounds, sólo se puede lanzar por nombre uno ya escrito a mano en
    // launch.json.
    assert.deepEqual(config.cascadeTerminateToConfigurations, ['devup: app-api']);
  });

  it('no arrastra nada si no se acopló a ningún API', () => {
    assert.deepEqual(buildBrowserConfig('app-web', 'http://x', '/w', []).cascadeTerminateToConfigurations, []);
  });

  it('usa chrome por defecto y edge cuando se pide', () => {
    assert.equal(config.type, 'chrome');
    assert.equal(buildBrowserConfig('a', 'http://x', '/w', [], 'msedge').type, 'msedge');
  });

  it('nombra la sesión con el prefijo de la extensión', () => {
    assert.ok(config.name.startsWith(SESSION_PREFIX));
  });
});

describe('parseBrowser', () => {
  it('acepta los dos navegadores que js-debug trae', () => {
    assert.equal(parseBrowser('chrome'), 'chrome');
    assert.equal(parseBrowser('msedge'), 'msedge');
  });

  it('cae a chrome ante cualquier otra cosa', () => {
    // Un valor inesperado llegaría a js-debug como un tipo de depurador que no
    // existe, y el error sería "Cannot find debug adapter".
    assert.equal(parseBrowser('firefox'), 'chrome');
    assert.equal(parseBrowser(undefined), 'chrome');
    assert.equal(parseBrowser(42), 'chrome');
  });
});

describe('pathRebase', () => {
  it('no rebasa nada cuando las dos formas coinciden', () => {
    // localRoot/remoteRoot no sólo traducen: js-debug descarta todo lo que no
    // cuelgue de remoteRoot. Declararlos sin necesidad es perder el resto del
    // monorepo a cambio de nada.
    assert.equal(pathRebase('/w', '/w'), null);
  });

  it('rebasa del lado del editor al lado del proceso', () => {
    assert.deepEqual(pathRebase('/home/u/repos', '/mnt/data/repos'),
      { localRoot: '/home/u/repos', remoteRoot: '/mnt/data/repos' });
  });

  it('en macOS no confunde un cambio de mayúsculas con dos ubicaciones', () => {
    // `realpathSync` devuelve el casing real del disco, así que abrir
    // /Users/u/Repos cuando el disco dice `repos` parecerían dos sitios.
    assert.equal(pathRebase('/Users/u/Repos', '/Users/u/repos', true), null);
    // Y con la comparación sensible sí son dos, que es lo correcto en Linux.
    assert.notEqual(pathRebase('/Users/u/Repos', '/Users/u/repos', false), null);
  });
});
