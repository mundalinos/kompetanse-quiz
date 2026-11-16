/**
 * Builds a static version of the quiz into dist/ for GitHub Pages.
 * Every curriculum with a question bank (data/banks or data/generated) is fetched from udir.no
 * at build time and written as JSON, so the browser needs no server or API key.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCurriculumPage } from '../lib/parse-udir.js';
import { bankSlug, loadBank } from '../lib/question-bank.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const DEFAULT_URL =
  process.env.LEARNING_GOALS_URL || 'https://www.udir.no/lk20/tan03-03/kompetansemaal-og-vurdering/kv476';

async function bankUrls() {
  const urls = new Set([DEFAULT_URL]);
  for (const dir of ['data/banks', 'data/generated']) {
    const files = await readdir(join(ROOT, dir)).catch(() => []);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const { source } = JSON.parse(await readFile(join(ROOT, dir, file), 'utf8'));
      if (source) urls.add(source);
    }
  }
  return [...urls];
}

async function buildCurriculum(url) {
  const bank = await loadBank(url);
  if (!bank) throw new Error(`Ingen spørsmålsbank for ${url}`);
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`udir.no svarte ${res.status} for ${url}`);
  const curriculum = parseCurriculumPage(await res.text());
  return { url, slug: bankSlug(url), source: bank.source, ...curriculum, bank: bank.questions };
}

await rm(DIST, { recursive: true, force: true });
await cp(join(ROOT, 'public'), DIST, { recursive: true });
await cp(join(ROOT, 'lib', 'quiz.js'), join(DIST, 'quiz.js'));
await mkdir(join(DIST, 'data'), { recursive: true });

const curricula = [];
for (const url of await bankUrls()) {
  const data = await buildCurriculum(url);
  await writeFile(join(DIST, 'data', `${data.slug}.json`), JSON.stringify(data));
  curricula.push({ url: data.url, slug: data.slug, title: data.title });
  console.log(`✓ ${data.title} (${data.bank.length} spørsmål, ${data.goals.length} mål)`);
}

await writeFile(join(DIST, 'static-config.json'), JSON.stringify({ defaultUrl: DEFAULT_URL, curricula }, null, 2));
// Tell GitHub Pages not to run Jekyll on the output.
await writeFile(join(DIST, '.nojekyll'), '');
console.log(`Ferdig: ${DIST}`);
