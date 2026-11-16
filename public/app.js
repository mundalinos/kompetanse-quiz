const STORAGE_KEY = 'kompetansequiz.settings';
const SOURCE_LABELS = { curated: 'ferdig spørsmålsbank', generated: 'generert av Claude' };
const PER_GOAL_CHOICES = [1, 2, 3];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const RING_LENGTH = 478; // ≈ 2πr for r = 76
const ICON_CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_CROSS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const $ = (id) => document.getElementById(id);

let defaultUrl = '';
/** Set when running from the static build (GitHub Pages): questions come from bundled JSON, not the server. */
let staticConfig = null;
let settings = { url: '', perGoal: 1 };
let quiz = null;
let current = 0;
let picked = null;
let answers = [];
let timer = { start: 0, handle: null };

/* ---------- Settings ---------- */

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

/** URL priority: ?url= in address bar > saved setting > server default. */
function initialSettings() {
  const params = new URLSearchParams(location.search);
  const saved = loadSettings();
  const perGoal = Number(params.get('perGoal')) || saved.perGoal || 1;
  return {
    url: params.get('url') || saved.url || defaultUrl,
    perGoal: PER_GOAL_CHOICES.includes(perGoal) ? perGoal : 1,
  };
}

/** Mirrors the server rule: only https links on udir.no are accepted. */
function isValidGoalsUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && ['www.udir.no', 'udir.no'].includes(url.hostname);
  } catch {
    return false;
  }
}

/* ---------- Screens ---------- */

function showScreen(name) {
  for (const id of ['start', 'question', 'result']) $(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

let toastHandle;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => (el.hidden = true), 4000);
}

/** "Kompetansemål etter yrkesliv i tannhelsesekretærfaget" → "Yrkesliv i tannhelsesekretærfaget" */
function shortTitle(title) {
  const short = title.replace(/^kompetansemål etter\s+/i, '').trim();
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/* ---------- 1 · Start ---------- */

function renderStart(errorMessage = '') {
  const url = $('goals-url').value;
  const hasUrl = url.length > 0;
  const valid = isValidGoalsUrl(url);
  const showError = Boolean(errorMessage) || (hasUrl && !valid);

  $('clear-url').hidden = !hasUrl;
  $('paste-url').hidden = hasUrl;
  $('url-field').classList.toggle('url-field--error', showError);
  $('goals-url').setAttribute('aria-invalid', String(showError));
  $('url-hint').classList.toggle('hint--error', showError);
  $('url-hint').textContent =
    errorMessage ||
    (hasUrl && !valid
      ? 'Det ser ikke ut som en lenke til udir.no. Start med https://www.udir.no/'
      : 'Siden «Kompetansemål og vurdering» for faget på udir.no.');
  $('start-btn').disabled = !valid;

  $('per-goal').replaceChildren(
    ...PER_GOAL_CHOICES.map((n) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = n;
      btn.setAttribute('aria-pressed', String(settings.perGoal === n));
      btn.addEventListener('click', () => {
        settings.perGoal = n;
        renderStart();
      });
      return btn;
    }),
  );
}

function setLoading(isLoading, label = 'Laster spørsmål…') {
  $('start-btn').disabled = isLoading || !isValidGoalsUrl($('goals-url').value);
  $('start-label').textContent = isLoading ? label : 'Start quiz';
}

async function startQuiz() {
  settings.url = $('goals-url').value.trim();
  saveSettings();
  history.replaceState(null, '', location.pathname);
  showScreen('start');
  setLoading(true);

  try {
    const body = staticConfig ? await loadStaticQuiz() : await loadServerQuiz();
    if (body.questions.length === 0) throw new Error('Fant ingen spørsmål for disse kompetansemålene.');

    quiz = body;
    current = 0;
    answers = [];
    $('source').textContent = SOURCE_LABELS[body.source] ?? body.source;
    $('subject').textContent = shortTitle(body.title);
    $('result-subject').textContent = shortTitle(body.title);
    showScreen('question');
    renderQuestion();
  } catch (err) {
    renderStart(`Kunne ikke lage quiz: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

async function loadServerQuiz() {
  const res = await fetch(`/api/quiz?${new URLSearchParams(settings)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Feil ${res.status}`);
  return body;
}

async function loadStaticQuiz() {
  const entry = staticConfig.curricula.find((c) => c.url === settings.url);
  if (!entry) {
    throw new Error('Denne læreplanen finnes ikke i nettversjonen. Kjør appen lokalt (npm start) for andre lenker.');
  }
  const [res, { buildQuiz }] = await Promise.all([fetch(`data/${entry.slug}.json`), import('./quiz.js')]);
  if (!res.ok) throw new Error(`Feil ${res.status}`);
  const data = await res.json();
  return { title: data.title, source: data.source, ...buildQuiz(data, data.bank, settings.perGoal) };
}

async function regenerate() {
  if (!isValidGoalsUrl($('goals-url').value)) return renderStart();
  if (!confirm('Lage nye spørsmål med Claude? Dette bruker API-kreditt og erstatter tidligere genererte spørsmål.')) return;

  const btn = $('regenerate');
  btn.disabled = true;
  setLoading(true, 'Lager spørsmål… (kan ta et minutt)');
  try {
    const url = $('goals-url').value.trim();
    const res = await fetch(`api/generate?${new URLSearchParams({ url })}`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Feil ${res.status}`);
    $('source').textContent = SOURCE_LABELS.generated;
    toast(`${body.count} nye spørsmål er klare.`);
    renderStart();
  } catch (err) {
    renderStart(`Kunne ikke lage spørsmål: ${err.message}`);
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
}

/* ---------- 2 · Question ---------- */

const formatTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function startTimer() {
  stopTimer();
  timer.start = performance.now();
  $('timer').textContent = '0:00';
  timer.handle = setInterval(() => ($('timer').textContent = formatTime(performance.now() - timer.start)), 250);
}

function stopTimer() {
  clearInterval(timer.handle);
  return performance.now() - timer.start;
}

function renderProgress() {
  const total = quiz.questions.length;
  $('counter').textContent = `Spørsmål ${current + 1} av ${total}`;
  $('progress').setAttribute('aria-valuemax', total);
  $('progress').setAttribute('aria-valuenow', current + 1);
  $('progress-bar').style.width = `${((current + 1) / total) * 100}%`;
}

function renderQuestion() {
  const q = quiz.questions[current];
  picked = null;
  renderProgress();
  $('prompt').textContent = q.prompt;
  $('feedback').hidden = true;
  $('question-actions').hidden = false;
  $('check').disabled = true;

  $('options').replaceChildren(
    ...q.options.map((text, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      const badge = document.createElement('span');
      badge.className = 'option__badge';
      badge.textContent = LETTERS[i];
      const label = document.createElement('span');
      label.className = 'option__text';
      label.textContent = text;
      btn.append(badge, label);
      btn.addEventListener('click', () => pick(i));
      return btn;
    }),
  );
  startTimer();
}

function pick(index) {
  picked = index;
  [...$('options').children].forEach((btn, i) => btn.setAttribute('aria-checked', String(i === index)));
  $('check').disabled = false;
}

/* ---------- 3 · Answer feedback ---------- */

function submitAnswer(choice) {
  const q = quiz.questions[current];
  const elapsed = stopTimer();
  const correct = choice === q.answerIndex;
  answers.push({ goalId: q.goalId, correct, skipped: choice === null, ms: elapsed });

  [...$('options').children].forEach((btn, i) => {
    btn.disabled = true;
    btn.removeAttribute('aria-checked');
    btn.classList.toggle('is-right', i === q.answerIndex);
    btn.classList.toggle('is-wrong', i === choice && !correct);
  });

  const sheet = $('feedback');
  sheet.className = `sheet ${correct ? 'sheet--ok' : 'sheet--bad'}`;
  $('feedback-icon').innerHTML = correct ? ICON_CHECK : ICON_CROSS;
  $('feedback-title').textContent = correct ? 'Riktig!' : choice === null ? 'Hoppet over' : 'Ikke helt';
  $('feedback-sub').textContent = correct
    ? `Besvart på ${Math.max(1, Math.round(elapsed / 1000))} s`
    : `Riktig svar er ${LETTERS[q.answerIndex]}: ${q.options[q.answerIndex]}`;
  $('feedback-text').textContent = q.explanation ?? '';
  $('next-label').textContent = current + 1 < quiz.questions.length ? 'Neste spørsmål' : 'Se resultat';

  $('question-actions').hidden = true;
  sheet.hidden = false;
  $('next').focus();
}

function nextQuestion() {
  current++;
  if (current < quiz.questions.length) {
    renderQuestion();
    window.scrollTo(0, 0);
  } else {
    renderResult();
  }
}

/* ---------- 4 · Results ---------- */

/** A goal counts as reached when every question about it was answered correctly. */
function goalResults() {
  return quiz.goals.map((goal) => {
    const own = answers.filter((a) => a.goalId === goal.id);
    const status = own.length === 0 ? 'untested' : own.every((a) => a.correct) ? 'reached' : 'not-reached';
    return { goal, status };
  });
}

function bestStreak() {
  let best = 0;
  let run = 0;
  for (const a of answers) {
    run = a.correct ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function renderResult() {
  const total = answers.length;
  const score = answers.filter((a) => a.correct).length;
  const results = goalResults();
  const tested = results.filter((r) => r.status !== 'untested');
  const reached = results.filter((r) => r.status === 'reached').length;
  const answered = answers.filter((a) => !a.skipped);
  const avgMs = answered.length ? answered.reduce((sum, a) => sum + a.ms, 0) / answered.length : 0;
  const ratio = total ? score / total : 0;

  $('score-value').textContent = score;
  $('score-total').textContent = `/${total}`;
  $('ring-label').setAttribute('aria-label', `${score} av ${total} riktige`);
  $('ring-arc').setAttribute('stroke-dasharray', `0 ${RING_LENGTH}`);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => $('ring-arc').setAttribute('stroke-dasharray', `${ratio * RING_LENGTH} ${RING_LENGTH}`)),
  );

  $('result-title').textContent =
    reached === tested.length ? 'Alle mål nådd!' : ratio >= 0.7 ? 'Godt jobbet!' : 'Øvelse gjør mester';
  $('result-text').textContent =
    reached === tested.length
      ? 'Du svarte riktig på alle spørsmålene for hvert kompetansemål.'
      : `${tested.length - reached} kompetansemål trenger mer øving. Se listen under.`;

  $('stat-goals').textContent = `${reached}/${tested.length}`;
  $('stat-avg').textContent = answered.length ? `${(avgMs / 1000).toFixed(1)}s` : '–';
  $('stat-streak').textContent = bestStreak();

  $('answer-grid').replaceChildren(
    ...answers.map((a, i) => {
      const li = document.createElement('li');
      li.className = a.correct ? 'ok' : 'bad';
      li.setAttribute('aria-label', `Spørsmål ${i + 1}: ${a.correct ? 'riktig' : a.skipped ? 'hoppet over' : 'feil'}`);
      li.innerHTML = (a.correct ? ICON_CHECK : ICON_CROSS).replace(/width="22" height="22"/, 'width="14" height="14"');
      return li;
    }),
  );

  const statusText = { reached: 'nådd', 'not-reached': 'ikke nådd', untested: 'ingen spørsmål' };
  $('goal-status').replaceChildren(
    ...results.map(({ goal, status }) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = `goal-dot ${status}`;
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', statusText[status]);
      if (status !== 'untested') {
        dot.innerHTML = (status === 'reached' ? ICON_CHECK : ICON_CROSS).replace(/width="22" height="22"/, 'width="12" height="12"');
      }
      const text = document.createElement('span');
      text.textContent = goal.text;
      if (status === 'untested') text.className = 'untested-text';
      li.append(dot, text);
      return li;
    }),
  );

  showScreen('result');
}

async function shareResult() {
  const results = goalResults();
  const reached = results.filter((r) => r.status === 'reached').length;
  const tested = results.filter((r) => r.status !== 'untested').length;
  const score = answers.filter((a) => a.correct).length;
  const text = `${quiz.title}: ${score}/${answers.length} riktige, ${reached} av ${tested} kompetansemål nådd.`;
  try {
    if (navigator.share) await navigator.share({ title: 'Kompetansequiz', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Resultatet er kopiert.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Kunne ikke dele resultatet.');
  }
}

function quit() {
  stopTimer();
  if (!$('screen-question').hidden && !confirm('Avslutte quizen? Svarene dine blir ikke lagret.')) {
    startTimer();
    return;
  }
  showScreen('start');
  renderStart();
}

/* ---------- Wiring ---------- */

$('goals-url').addEventListener('input', () => renderStart());
$('clear-url').addEventListener('click', () => {
  $('goals-url').value = '';
  renderStart();
  $('goals-url').focus();
});
$('paste-url').addEventListener('click', async () => {
  try {
    $('goals-url').value = (await navigator.clipboard.readText()).trim();
  } catch {
    toast('Fikk ikke lest utklippstavlen. Lim inn med Ctrl/Cmd+V.');
  }
  renderStart();
});
$('start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isValidGoalsUrl($('goals-url').value)) startQuiz();
});
$('regenerate').addEventListener('click', regenerate);
$('check').addEventListener('click', () => picked !== null && submitAnswer(picked));
$('skip').addEventListener('click', () => submitAnswer(null));
$('next').addEventListener('click', nextQuestion);
document.querySelectorAll('.quit').forEach((btn) => btn.addEventListener('click', quit));
$('share').addEventListener('click', shareResult);
$('restart').addEventListener('click', startQuiz);
$('home').addEventListener('click', () => {
  showScreen('start');
  renderStart();
});

staticConfig = await fetch('static-config.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const config = staticConfig ?? (await fetch('api/config').then((r) => r.json()).catch(() => ({})));
defaultUrl = config.defaultUrl ?? '';
if (staticConfig) {
  // No server on GitHub Pages, so Claude generation is unavailable.
  $('regenerate-wrap').hidden = true;
  $('source').textContent = 'ferdig spørsmålsbank';
}
settings = initialSettings();
$('goals-url').value = settings.url;
renderStart();
