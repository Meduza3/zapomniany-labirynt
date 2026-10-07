import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildPreview({ destination = fileURLToPath(new URL('../public/preview-worker.js', import.meta.url)) } = {}) {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/preview-worker.mjs', import.meta.url))],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    outfile: destination,
  });
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Preview worker built: ${await buildPreview()}`);
}
