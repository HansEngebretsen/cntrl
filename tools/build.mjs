#!/usr/bin/env node
// Builds the cntrl demo from the private TRMNL repo's source.
//
//   node tools/build.mjs            # sw.js only (the app's code changed)
//   node tools/build.mjs --seed     # also seed.json + record.json: the screens, their real renders
//                                   # (local headless Chromium) and the outside data they used
//
// TRMNL=~/Sites/trmnl by default. Nothing here talks to Cloudflare or a device.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TRMNL = process.env.TRMNL || join(homedir(), 'Sites/trmnl');
const { build } = await import(join(TRMNL, 'node_modules/esbuild/lib/main.js'));
const OUT = join(HERE, '.out');
mkdirSync(OUT, { recursive: true });

// Swap the parts that need Cloudflare or a paid API for the demo's stand-ins.
const shims = (puppeteer) => ({
  name: 'cntrl-shims',
  setup(b) {
    b.onResolve({ filter: /^cntrl-worker$/ }, () => ({ path: join(TRMNL, 'src/index.js') }));
    b.onResolve({ filter: /^@cloudflare\/puppeteer$/ }, () => ({ path: join(HERE, 'shim', puppeteer) }));
    b.onResolve({ filter: /\/(claude|gemini)\.js$/ }, (a) => (a.importer.includes('/src/builder/') ? { path: join(HERE, 'shim/ai.js') } : undefined));
    b.onResolve({ filter: /^@anthropic-ai\/sdk$|^@google\/genai$/ }, () => ({ path: join(HERE, 'shim/empty.js') }));
  },
});
writeFileSync(join(HERE, 'shim/empty.js'), 'export default class {}; export const GoogleGenAI = class {};\n');

const common = { bundle: true, logLevel: 'warning', legalComments: 'none', nodePaths: [join(TRMNL, 'node_modules')] };

if (process.argv.includes('--seed')) {
  await build({ ...common, entryPoints: [join(HERE, 'seed.mjs')], outfile: join(OUT, 'seed.mjs'), platform: 'node', format: 'esm', external: [join(TRMNL, 'node_modules/playwright/index.mjs')], alias: { playwright: join(TRMNL, 'node_modules/playwright/index.mjs') }, plugins: [shims('puppeteer-node.js')],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
  process.env.NODE_PATH = join(TRMNL, 'node_modules');
  const { makeSeed } = await import(join(OUT, 'seed.mjs'));
  const { seed, record } = await makeSeed();
  writeFileSync(join(ROOT, 'seed.json'), JSON.stringify(seed));
  writeFileSync(join(ROOT, 'record.json'), JSON.stringify(record));
  console.log(`seed.json ${(JSON.stringify(seed).length / 1e6).toFixed(2)} MB, record.json ${(JSON.stringify(record).length / 1e6).toFixed(2)} MB (${Object.keys(record).length} responses)`);
}

const seedVersion = createHash('sha1').update(readFileSync(join(ROOT, 'seed.json'))).digest('hex').slice(0, 10);
await build({ ...common, entryPoints: [join(HERE, 'sw-entry.js')], outfile: join(ROOT, 'sw.js'), platform: 'browser', format: 'iife', minify: true, target: ['safari16', 'chrome110'],
  plugins: [shims('puppeteer-sw.js')], define: { __SEED_VERSION__: JSON.stringify(seedVersion), __GA__: JSON.stringify((/<!-- Google Analytics[\s\S]*?<\/script>\n?/.exec(readFileSync(join(ROOT, 'index.html'), 'utf8')) || [''])[0]) } });
// define only replaces identifiers; the version sits in a string, so put it in by hand.
writeFileSync(join(ROOT, 'sw.js'), readFileSync(join(ROOT, 'sw.js'), 'utf8').replace('__SEED_VERSION__', seedVersion));
console.log(`sw.js ${(readFileSync(join(ROOT, 'sw.js')).length / 1e6).toFixed(2)} MB, seed ${seedVersion}`);
