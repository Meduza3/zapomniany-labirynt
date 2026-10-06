import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildSite, publicConfig } from '../scripts/build.mjs';

const publicEnv = { SUPABASE_URL: 'https://garden.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };

test('hosted website includes only public files, bundled SDK, and public configuration', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'labirynt-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'public'));
  await mkdir(path.join(directory, 'data'));
  await writeFile(path.join(directory, 'public', 'index.html'), '<title>Garden</title>');
  await writeFile(path.join(directory, 'data', 'rooms.json'), 'private-game-state');
  await writeFile(path.join(directory, '.env'), 'SECRET=private-credential');
  const destination = await buildSite({ root: directory, destination: path.join(directory, 'dist'), env: { ...publicEnv, SUPABASE_ACCESS_TOKEN: 'private-credential' } });
  assert.deepEqual((await readdir(destination)).sort(), ['.nojekyll', 'config.js', 'index.html', 'vendor']);
  const window = {};
  const config = await readFile(path.join(destination, 'config.js'), 'utf8');
  runInNewContext(config, { window });
  assert.equal(window.LABIRYNT_CONFIG.backend, 'supabase');
  assert.equal(window.LABIRYNT_CONFIG.supabaseUrl, 'https://garden.supabase.co');
  assert.equal(window.LABIRYNT_CONFIG.publishableKey, publicEnv.SUPABASE_PUBLISHABLE_KEY);
  assert.ok(!config.includes('private-credential'));
  assert.ok((await readFile(path.join(destination, 'vendor', 'supabase.js'), 'utf8')).includes('createClient'));
});

test('website build rejects privileged keys and missing backend configuration', () => {
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  for (const key of ['sb_secret_private', jwt('service_role'), 'malformed', '']) {
    assert.throws(() => publicConfig({ ...publicEnv, SUPABASE_PUBLISHABLE_KEY: key }), /publishable|SUPABASE/);
  }
  assert.equal(publicConfig({ ...publicEnv, SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).publishableKey, jwt('anon'));
  assert.throws(() => publicConfig({}), /SUPABASE_URL/);
  assert.throws(() => publicConfig({ ...publicEnv, SUPABASE_URL: 'http://garden.example' }), /HTTPS/);
  assert.throws(() => publicConfig({ ...publicEnv, SUPABASE_URL: 'https://secret:password@garden.example' }), /HTTPS/);
});
