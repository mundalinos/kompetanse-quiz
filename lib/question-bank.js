import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DATA_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const CURATED_DIR = join(DATA_DIR, 'banks');
const GENERATED_DIR = join(DATA_DIR, 'generated');

export const QuestionSchema = z.object({
  goalId: z.string(),
  question: z.string().min(1),
  correct: z.string().min(1),
  wrong: z.array(z.string().min(1)).min(2).max(3),
  explanation: z.string(),
});

const BankSchema = z.object({ questions: z.array(QuestionSchema) });

/** "https://www.udir.no/lk20/tan03-03/kompetansemaal-og-vurdering/kv476" → "lk20-tan03-03-kompetansemaal-og-vurdering-kv476" */
export function bankSlug(goalsUrl) {
  return new URL(goalsUrl).pathname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readBank(dir, slug) {
  let raw;
  try {
    raw = await readFile(join(dir, `${slug}.json`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return BankSchema.parse(JSON.parse(raw)).questions;
}

/**
 * A generated bank only exists if someone asked for one (or no curated bank existed),
 * so it wins over the curated one. Delete data/generated/<slug>.json to go back.
 */
export async function loadBank(goalsUrl) {
  const slug = bankSlug(goalsUrl);
  const generated = await readBank(GENERATED_DIR, slug);
  if (generated) return { source: 'generated', questions: generated };
  const curated = await readBank(CURATED_DIR, slug);
  if (curated) return { source: 'curated', questions: curated };
  return null;
}

export async function saveGeneratedBank(goalsUrl, questions) {
  await mkdir(GENERATED_DIR, { recursive: true });
  const body = { source: goalsUrl, generatedAt: new Date().toISOString(), questions };
  await writeFile(join(GENERATED_DIR, `${bankSlug(goalsUrl)}.json`), JSON.stringify(body, null, 2));
}
