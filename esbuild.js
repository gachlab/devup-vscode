// VS Code extensions ship as a single bundled file — no node_modules in the .vsix.
// esbuild handles bundling; `vscode` is the only host-provided external.
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node22',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
