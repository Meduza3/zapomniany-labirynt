import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildPreview } from './build-preview.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function publicConfig(env) {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY before building the hosted game.');
  const url = new URL(supabaseUrl);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SUPABASE_URL must be an HTTPS project origin or a local development origin.');
  }
  let isPublic = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
  if (publishableKey.split('.').length === 3) {
    try {
      isPublic = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString('utf8')).role === 'anon';
    } catch {}
  }
  if (!isPublic) throw new Error('Only a publishable key or legacy anon key may be included in the website.');
  return { backend: 'supabase', supabaseUrl: url.origin, publishableKey };
}

export async function buildSite({ env = process.env, root = projectRoot, destination = path.join(projectRoot, 'dist') } = {}) {
  const config = publicConfig(env);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(path.join(root, 'public'), destination, { recursive: true });
  await buildPreview({ destination: path.join(destination, 'preview-worker.js') });
  await writeFile(path.join(destination, 'config.js'), `window.LABIRYNT_CONFIG = ${JSON.stringify(config)};\n`);
  await writeFile(path.join(destination, '.nojekyll'), '');
  await build({
    stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: projectRoot },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'external',
    outfile: path.join(destination, 'vendor', 'supabase.js'),
  });
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Website built: ${await buildSite()}`);
}
