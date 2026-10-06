import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareEdge } from './prepare-edge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}.`)));
  });
}

export async function deployBackend(env = process.env) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = env.SUPABASE_PROJECT_REF?.trim();
  if (!token || !/^[a-z]{20}$/.test(ref || '')) throw new Error('Set SUPABASE_ACCESS_TOKEN and the 20-letter SUPABASE_PROJECT_REF.');
  const projectUrl = `https://${ref}.supabase.co`;
  let siteUrl;
  if (env.GAME_SITE_URL) {
    const url = new URL(env.GAME_SITE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('GAME_SITE_URL must be the HTTPS address of the game.');
    siteUrl = url.href;
  }
  async function management(route, method = 'GET', body, headers = {}) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Supabase ${method} ${route} failed (${response.status}). Check the project and access-token permissions in the Supabase dashboard.`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const query = (sql, parameters = []) => management('/database/query', 'POST', { query: sql, parameters });
  console.log('Preparing game rules for Supabase.');
  await prepareEdge();
  const applied = await management('/database/migrations');
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const filename of migrations) {
    const name = filename.slice(0, -4);
    if (applied.some(migration => migration.name === name || migration.version === name.split('_')[0])) continue;
    console.log(`Applying database migration ${name}.`);
    await management('/database/migrations', 'POST', {
      name,
      query: await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'),
    }, { 'Idempotency-Key': `labirynt:${ref}:${name}` });
  }
  const authConfig = await management('/config/auth');
  const authChanges = {
    ...(authConfig.external_anonymous_users_enabled === true ? {} : { external_anonymous_users_enabled: true }),
    ...(siteUrl && authConfig.site_url !== siteUrl ? { site_url: siteUrl } : {}),
  };
  if (Object.keys(authChanges).length) {
    console.log('Enabling guest players.');
    await management('/config/auth', 'PATCH', authChanges);
  }
  const existing = await query("select decrypted_secret from vault.decrypted_secrets where name = 'labirynt_bot_secret' limit 1");
  const botSecret = existing?.[0]?.decrypted_secret || randomBytes(32).toString('base64url');
  console.log('Configuring the private bot worker.');
  await management('/secrets', 'POST', [{ name: 'LABIRYNT_BOT_SECRET', value: botSecret }]);
  await run(fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url)), ['functions', 'deploy', 'game-api', 'bot-worker', '--project-ref', ref, '--use-api'], env);
  await query('select public.configure_cloud_runtime($1::text, $2::text)', [projectUrl, botSecret]);
  console.log(`Backend deployed: ${projectUrl}. Run the cloud integration tests before publishing the website.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await deployBackend(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
