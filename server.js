import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCurriculumPage } from './lib/parse-udir.js';
import { buildQuiz } from './lib/quiz.js';
import { loadBank, saveGeneratedBank } from './lib/question-bank.js';
import { generateQuestions } from './lib/generate.js';

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_URL =
  process.env.LEARNING_GOALS_URL ||
  'https://www.udir.no/lk20/tan03-03/kompetansemaal-og-vurdering/kv476';
const ALLOWED_HOSTS = new Set(['www.udir.no', 'udir.no']);
const CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const cache = new Map();
const pendingGenerations = new Map();

/** Only allow https URLs on udir.no — the server fetches them, so anything else is an SSRF risk. */
function validateGoalsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Ugyldig URL.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new HttpError(400, 'Kun https-lenker til udir.no er tillatt.');
  }
  return url.toString();
}

async function loadCurriculum(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(502, `Udir svarte med status ${res.status}.`);
  const data = parseCurriculumPage(await res.text());
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** Curated or cached bank if present; otherwise generate once with Claude and cache to disk. */
async function getQuestionBank(goalsUrl, curriculum, { regenerate = false } = {}) {
  if (!regenerate) {
    const existing = await loadBank(goalsUrl);
    if (existing) return existing;
  }
  // Deduplicate concurrent requests so one URL triggers at most one paid generation.
  if (!pendingGenerations.has(goalsUrl)) {
    const job = generateQuestions(curriculum)
      .then(async (questions) => {
        if (questions.length === 0) throw new HttpError(502, 'Claude laget ingen brukbare spørsmål.');
        await saveGeneratedBank(goalsUrl, questions);
        return { source: 'generated', questions };
      })
      .finally(() => pendingGenerations.delete(goalsUrl));
    pendingGenerations.set(goalsUrl, job);
  }
  return pendingGenerations.get(goalsUrl);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, reqUrl) {
  // API calls can spend Claude credits, so refuse requests triggered by other websites.
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Forespørsel fra annen nettside avvist.');
  const goalsUrl = validateGoalsUrl(reqUrl.searchParams.get('url') || DEFAULT_URL);
  const curriculum = await loadCurriculum(goalsUrl);

  if (reqUrl.pathname === '/api/goals') {
    return sendJson(res, 200, { url: goalsUrl, ...curriculum });
  }
  if (reqUrl.pathname === '/api/quiz') {
    const perGoal = Math.min(Math.max(Number(reqUrl.searchParams.get('perGoal')) || 1, 1), 5);
    const bank = await getQuestionBank(goalsUrl, curriculum);
    return sendJson(res, 200, {
      url: goalsUrl,
      title: curriculum.title,
      source: bank.source,
      ...buildQuiz(curriculum, bank.questions, perGoal),
    });
  }
  if (reqUrl.pathname === '/api/generate') {
    if (req.method !== 'POST') throw new HttpError(405, 'Bruk POST.');
    const bank = await getQuestionBank(goalsUrl, curriculum, { regenerate: true });
    return sendJson(res, 200, { url: goalsUrl, source: bank.source, count: bank.questions.length });
  }
  if (reqUrl.pathname === '/api/config') {
    return sendJson(res, 200, { defaultUrl: DEFAULT_URL });
  }
  throw new HttpError(404, 'Ukjent endepunkt.');
}

async function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (file.includes('..') || !MIME[extname(file)]) throw new HttpError(404, 'Ikke funnet.');
  const body = await readFile(join(PUBLIC_DIR, file)).catch(() => {
    throw new HttpError(404, 'Ikke funnet.');
  });
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (reqUrl.pathname.startsWith('/api/')) await handleApi(req, res, reqUrl);
    else await serveStatic(res, reqUrl.pathname);
  } catch (err) {
    const status = err.status ?? (err.name === 'TimeoutError' || err.name === 'TypeError' ? 502 : 500);
    if (status === 502 && !(err instanceof HttpError)) err.message = 'Klarte ikke å hente siden fra udir.no.';
    if (status === 500) console.error(err);
    sendJson(res, status, { error: status === 500 ? 'Noe gikk galt på serveren.' : err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Quiz kjører på http://localhost:${PORT}`);
  console.log(`Standard kompetansemål: ${DEFAULT_URL}`);
});
