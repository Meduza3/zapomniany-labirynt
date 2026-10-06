import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function prepareEdge() {
  const directory = new URL('../supabase/functions/_shared/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const name of ['engine.mjs', 'bot.mjs', 'cloud-room.mjs']) {
    await copyFile(new URL(`../src/${name}`, import.meta.url), new URL(name, directory));
  }
  return fileURLToPath(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Game rules prepared: ${await prepareEdge()}`);
}
