(() => {
'use strict';

/* =====================================================================
   Lung Risk Lens: client-side app. Data -> models -> risk check + analytics.
   ===================================================================== */

/* ---------- constants ---------- */
const DATA_URL = 'data/lung_cancer.csv';
const POLL_MS = 4000;
const LIFE = [['SMOKING','Smoking'],['YELLOW_FINGERS','Yellow fingers'],['ANXIETY','Anxiety'],['PEER_PRESSURE','Peer pressure'],['ALCOHOL CONSUMING','Alcohol consumption'],['CHRONIC DISEASE','Chronic disease'],['ALLERGY','Allergy']];
const SYMP = [['FATIGUE','Fatigue'],['WHEEZING','Wheezing'],['COUGHING','Coughing'],['SHORTNESS OF BREATH','Shortness of breath'],['SWALLOWING DIFFICULTY','Swallowing difficulty'],['CHEST PAIN','Chest pain']];
const FACT = [...LIFE.map(([key,label]) => ({key,label,group:'life'})), ...SYMP.map(([key,label]) => ({key,label,group:'symptom'}))];
const NF = FACT.length;
const NL = LIFE.length;
const FI = Object.fromEntries(FACT.map((f,i) => [f.key,i]));
const SHORT = {SMOKING:'Smoking',YELLOW_FINGERS:'Yellow fing.',ANXIETY:'Anxiety',PEER_PRESSURE:'Peer press.','ALCOHOL CONSUMING':'Alcohol','CHRONIC DISEASE':'Chronic dis.',ALLERGY:'Allergy',FATIGUE:'Fatigue',WHEEZING:'Wheezing',COUGHING:'Coughing','SHORTNESS OF BREATH':'Breathless','SWALLOWING DIFFICULTY':'Swallowing','CHEST PAIN':'Chest pain'};
const HINT = {SMOKING:'Currently or regularly smokes',YELLOW_FINGERS:'Yellow staining on fingers, often from heavy smoking',ANXIETY:'Ongoing anxiety',PEER_PRESSURE:'Smoking or drinking influenced by peers',CHRONIC_DISEASE:'',ALLERGY:'Known allergies',FATIGUE:'Unusual tiredness',WHEEZING:'Whistling sound when breathing',COUGHING:'Frequent or lasting cough','SHORTNESS OF BREATH':'Breathless with little effort','SWALLOWING DIFFICULTY':'Food or drink is hard to swallow','CHEST PAIN':'Pain or tightness in the chest','CHRONIC DISEASE':'A long-term medical condition','ALCOHOL CONSUMING':'Drinks alcohol regularly'};
const BANDS = ['Under 50','50–54','55–59','60–64','65–69','70–74','75+'];
const bandOf = a => a < 50 ? 0 : a < 55 ? 1 : a < 60 ? 2 : a < 65 ? 3 : a < 70 ? 4 : a < 75 ? 5 : 6;
const LOW_MAX = 35, HIGH_MIN = 65;
const MODEL_NAME = { gbm: 'LightGBM', mlp: 'K-Means SMOTE + MLP' };
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const avg = a => a.length ? a.reduce((x,y) => x + y, 0) / a.length : 0;
const pct = (a,b) => b ? 100 * a / b : 0;
const norm = s => String(s).replace(/[^a-z0-9]/gi,'').toUpperCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const niceMax = v => [4,8,12,16,20,24,28,32,40,48,60,80,100,120,160,200,240,300].find(s => s >= v) || Math.ceil(v/100)*100;
const clock = d => d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const median = a => { if (!a.length) return 0; const s = [...a].sort((x,y) => x-y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
const sd = a => { const m = avg(a); return Math.sqrt(avg(a.map(x => (x-m)**2))); };
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k,v) { try { localStorage.setItem(k,v); } catch (e) { /* private mode */ } } };

/* ---------- state ---------- */
const ML = makeML(NF);
const S = { rows: [], info: null, models: {}, ys: [], train: { running: false }, source: 'none', rawText: '', dedupe: true, added: 0, ver: 0 };
const F = { sex: null, band: null, burden: null, flags: new Map() };
const P = { age: 62, sex: 1, f: new Array(NF).fill(0), example: true, pins: [] };
let ANIM = false, PAGE = 'overview', VIEW = 'check';

/* =====================================================================
   1. CSV -> rows
   ===================================================================== */
function parseCSV(text) {
  const lines = text.replace(/^﻿/,'').split(/\r?\n/).filter(l => l.trim() !== '');
  const split = l => l.split(',').map(s => s.trim().replace(/^"|"$/g,''));
  if (lines.length < 2) throw new Error('The file has no data rows.');
  return { head: split(lines[0]), raw: lines.slice(1).map(split) };
}
function buildRows(text, dedupe) {
  const { head, raw } = parseCSV(text);
  const idx = {};
  head.forEach((h,i) => { idx[norm(h)] = i; });
  const need = ['GENDER','AGE',...FACT.map(f => f.key),'LUNG_CANCER'];
  const missing = need.filter(k => idx[norm(k)] === undefined);
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));
  const col = k => raw.map(r => r[idx[norm(k)]]);
  const binary = k => {
    const nums = col(k).map(v => /^(yes|y|true)$/i.test(v) ? 1 : /^(no|n|false)$/i.test(v) ? 0 : Number(v));
    const shift = (!nums.includes(0) && nums.includes(2)) ? 1 : 0;      // supports the original 1/2 coding
    return nums.map(v => (v - shift) === 1 ? 1 : 0);
  };
  const bins = FACT.map(f => binary(f.key));
  const target = binary('LUNG_CANCER');
  const sexCol = col('GENDER'), ageCol = col('AGE');
  const cells = need.map(k => col(k));
  let rows = [], invalid = 0;
  raw.forEach((_, i) => {
    const age = Number(ageCol[i]);
    const blank = cells.some(c => c[i] === undefined || c[i] === '');
    if (blank || !Number.isFinite(age) || age <= 0) { invalid++; return; }
    const f = bins.map(b => b[i]);
    const r = { age, sex: /^m/i.test(sexCol[i]) ? 1 : 0, f, y: target[i] };
    r.band = bandOf(age);
    r.bur = f.slice(NL).reduce((a,b) => a + b, 0);
    rows.push(r);
  });
  const total = rows.length;
  const seen = new Set(); let dupes = 0;
  const kept = rows.filter(r => { const k = r.age + '|' + r.sex + '|' + r.f.join('') + '|' + r.y; if (seen.has(k)) { dupes++; return false; } seen.add(k); return true; });
  if (dedupe) rows = kept;
  if (rows.length < 20) throw new Error('Need at least 20 valid rows to train the models.');
  return { rows, info: { rawCount: total + invalid, invalid, dupesFound: dupes, dupesRemoved: dedupe ? dupes : 0 } };
}

/* =====================================================================
   2. Models: LightGBM-style trees (instant) + K-Means SMOTE + MLP (background worker)
   ===================================================================== */
let worker = null, trainToken = 0, trainTimer = 0;
function resetModels() {
  S.models = {}; S.ys = S.rows.map(r => r.y);
  const np = S.ys.reduce((a,b) => a + b, 0);
  if (np === 0 || np === S.ys.length) return false;
  S.models.gbm = ML.trainAll(S.rows, null, ['gbm']).models.gbm;
  return true;
}
function startTraining() {
  clearTimeout(trainTimer);
  trainTimer = setTimeout(runTraining, 350);
}
function runTraining() {
  const token = ++trainToken, rows = S.rows.map(r => ({ age: r.age, sex: r.sex, f: r.f, y: r.y }));
  if (worker) { worker.terminate(); worker = null; }
  if (!S.models.gbm) { S.train.running = false; updateTrainUI(); return; }
  S.train.running = true;
  updateTrainUI(); renderAll();
  const finish = res => {
    if (token !== trainToken) return;
    Object.assign(S.models, res.models); S.ver++; S.train.running = false;
    updateTrainUI(); renderAll();
    toast('K-Means SMOTE + MLP is ready');
  };
  const fallback = () => setTimeout(() => finish(ML.trainAll(rows, null, ['mlp'])), 30);
  try {
    const src = `const ML=(${makeML.toString()})(${NF});onmessage=e=>{postMessage({t:'d',res:ML.trainAll(e.data.rows,null,e.data.only)});};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = e => { if (token !== trainToken) return; worker.terminate(); worker = null; finish(e.data.res); };
    worker.onerror = () => { if (worker) { worker.terminate(); worker = null; } fallback(); };
    worker.postMessage({ rows, only: ['mlp'] });
  } catch (e) { fallback(); }
}
function updateTrainUI() {
  $('#trainPill').hidden = !S.train.running;
  $('#trainText').textContent = 'Training K-Means SMOTE + MLP';
}
const ready = k => !!S.models[k];
function pm(key, r) { return ML.predict(S.models[key], r) * 100; }
// the risk score is the average of the models that are ready (LightGBM first, then K-Means SMOTE + MLP)
function scoreOf(r) {
  const ks = Object.keys(S.models);
  return ks.length ? avg(ks.map(k => pm(k, r))) : NaN;
}
const tierOf = s => s < LOW_MAX ? 'low' : s < HIGH_MIN ? 'mod' : 'high';
const scoreCache = {};
function datasetScores() {
  const key = S.ver + '|' + Object.keys(S.models).join();
  if (!scoreCache[key]) { Object.keys(scoreCache).forEach(k => delete scoreCache[k]); scoreCache[key] = S.rows.map(scoreOf); }
  return scoreCache[key];
}

/* =====================================================================
   3. Loading + live refresh + session records
   ===================================================================== */
function ingest(text, source, keepFilters) {
  const errEl = $('#dpError');
  try {
    const prev = S.rows.length, wasFile = S.source;
    const { rows, info } = buildRows(text, S.dedupe);
    S.rows = rows;
    S.info = { ...info, name: source.name, time: new Date() };
    S.source = source.kind; S.rawText = text; S.added = 0;
    errEl.hidden = true;
    if (!keepFilters) { F.sex = null; F.band = null; F.burden = null; F.flags.clear(); }
    afterData();
    if (prev && wasFile === 'file' && source.kind === 'file') {
      const d = rows.length - prev;
      toast(d > 0 ? `Dataset updated: +${d} record${d === 1 ? '' : 's'}` : d < 0 ? `Dataset updated: ${-d} fewer record${d === -1 ? '' : 's'}` : 'Dataset updated');
    }
    return true;
  } catch (e) {
    errEl.textContent = e.message; errEl.hidden = false;
    $('#dataPanel').hidden = false; $('#dataBtn').setAttribute('aria-expanded', 'true');
    return false;
  }
}
function afterData() {
  S.ver++;
  resetModels();
  charts.forEach(c => { c.drawn = false; });
  renderAll();
  startTraining();
}
async function fetchText() {
  const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
async function boot() {
  let loaded = false;
  const seed = document.getElementById('seed');
  if (seed) loaded = ingest(seed.textContent, { kind: 'embedded', name: 'Embedded dataset' });
  else {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      loaded = ingest(await r.text(), { kind: 'file', name: 'data/lung_cancer.csv' });
    } catch (e) { /* not served over http: use the bundled copy */ }
    if (!loaded && window.SEED_CSV) loaded = ingest(window.SEED_CSV, { kind: 'embedded', name: 'data/lung_cancer.js (bundled copy)' });
    if (!loaded) {
      setStatus();
      $('#dpError').textContent = 'Could not read data/lung_cancer.csv. Start a local server in this folder (python3 -m http.server) or load a CSV with the button below.';
      $('#dpError').hidden = false; $('#dataPanel').hidden = false;
    }
  }
  setStatus();
  setInterval(async () => {
    if (S.source !== 'file') return;
    try {
      const t = await fetchText();
      if (t !== S.rawText) ingest(t, { kind: 'file', name: 'data/lung_cancer.csv' });
      else { S.info.checked = new Date(); setStatus(); }
    } catch (e) { /* keep last good data */ }
  }, POLL_MS);
}
function setStatus() {
  const pill = $('#livePill'), t = $('#liveText');
  if (!S.info) { pill.className = 'pill'; t.textContent = 'No data'; return; }
  const n = S.rows.length;
  pill.className = 'pill' + (S.source === 'file' ? ' live' : '');
  t.textContent = S.source === 'file' ? `Live · ${n} records · ${clock(S.info.checked || S.info.time)}` : S.source === 'upload' ? `Uploaded · ${n} records` : `${n} records`;
  $('#dpSource').textContent = S.info.name;
  $('#dpRows').textContent = n;
  $('#dpDupes').textContent = S.info.dupesFound;
  $('#dpAdded').textContent = S.added;
  $('#dpTime').textContent = clock(S.info.time);
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4100);
}
function csvText() {
  const cols = ['GENDER','AGE',...FACT.map(f => f.key),'LUNG_CANCER'];
  const lines = S.rows.map(r => [r.sex ? 'MALE' : 'FEMALE', r.age, ...r.f, r.y ? 'YES' : 'NO'].join(','));
  return [cols.join(','), ...lines].join('\n');
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? okMsg : 'Copy is blocked in this view. Select the text and copy it manually.');
  } catch (e) { toast('Copy is blocked in this view.'); }
}

/* =====================================================================
   4. Risk check
   ===================================================================== */
function buildForm() {
  const mk = (list, el, offset) => {
    $(el).innerHTML = list.map(([key,label], i) => `<label class="chip" for="f${offset+i}" title="${esc(HINT[key] || '')}"><input type="checkbox" id="f${offset+i}" data-i="${offset+i}"><span>${esc(label)}</span></label>`).join('');
  };
  mk(LIFE, '#chipsLife', 0); mk(SYMP, '#chipsSymp', NL);
  $('#form').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.i !== undefined) P.f[+t.dataset.i] = t.checked ? 1 : 0;
    else if (t.name === 'sex') P.sex = +t.value;
    else if (t.id === 'ageNum') setAge(t.value);
    markEdited(); renderResult();
  });
  $('#ageRange').addEventListener('input', e => { setAge(e.target.value); markEdited(); renderResult(); });
  $('#ageNum').addEventListener('input', e => { if (e.target.value !== '') { setAge(e.target.value, true); markEdited(); renderResult(); } });
  const preset = (age, sex, on) => { P.age = age; P.sex = sex; P.f = FACT.map(f => on.includes(f.key) ? 1 : 0); syncForm(); markEdited(); renderResult(); };
  $('#presetLow').onclick = () => preset(45, 0, ['ALLERGY']);
  $('#presetHigh').onclick = () => preset(68, 1, ['SMOKING','ALCOHOL CONSUMING','CHRONIC DISEASE','FATIGUE','WHEEZING','COUGHING','CHEST PAIN','SWALLOWING DIFFICULTY']);
  $('#presetClear').onclick = () => preset(55, 0, []);
  P.f = FACT.map(f => ['SMOKING','FATIGUE','COUGHING','WHEEZING','ANXIETY'].includes(f.key) ? 1 : 0);
  syncForm();
  $('#pinBtn').onclick = pinProfile;
  $('#copyBtn').onclick = copySummary;
  $('#miniGo').onclick = () => $('#resultCard').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  $('#pins').addEventListener('click', e => {
    const x = e.target.closest('[data-del]'); if (x) { P.pins.splice(+x.dataset.del, 1); renderPins(scoreOf({ age: P.age, sex: P.sex, f: P.f })); return; }
    const l = e.target.closest('[data-load]'); if (l) { const p = P.pins[+l.dataset.load]; P.age = p.age; P.sex = p.sex; P.f = [...p.f]; syncForm(); markEdited(); renderResult(); }
  });
}
function setAge(v, keepInput) {
  let a = Math.round(Number(v));
  if (!Number.isFinite(a)) return;
  a = Math.min(100, Math.max(18, a));
  P.age = a;
  $('#ageRange').value = Math.min(90, a);
  if (!keepInput) $('#ageNum').value = a;
}
function syncForm() {
  $('#ageRange').value = Math.min(90, P.age); $('#ageNum').value = P.age;
  $(P.sex ? '#sexM' : '#sexF').checked = true;
  FACT.forEach((f,i) => { $('#f' + i).checked = !!P.f[i]; });
}
function markEdited() {
  if (P.example) { P.example = false; $('#exampleNote').textContent = 'Answers stay in this browser. The score updates as you change them.'; }
}
const TIER = {
  low: { label: 'Lower risk', advice: 'Few of the indicators match the positive cases in the data. Keep an eye out for new or lasting symptoms.', icon: '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
  mod: { label: 'Moderate risk', advice: 'Several indicators overlap with positive cases. A check-up is a reasonable next step.', icon: '<path d="M8 1.8L15 14H1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.2v4M8 12v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  high: { label: 'Higher risk', advice: 'Many indicators match positive cases in the data. Please speak with a doctor about proper screening.', icon: '<path d="M5 1h6l4 4v6l-4 4H5l-4-4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 4.8v4.2M8 11.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' }
};
const tierPill = (tier, cls = '') => `<span class="tier-pill ${tier} ${cls}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${TIER[tier].icon}</svg>${TIER[tier].label}</span>`;
function gaugeSVG(shown, target) {
  const cx = 150, cy = 140, R = 112, sw = 18;
  const pt = (s, r = R) => { const a = Math.PI * (1 - s / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (s0, s1) => { const [x0,y0] = pt(s0), [x1,y1] = pt(s1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const g = 0.9, tier = tierOf(target);
  const seg = (a, b, c) => `<path d="${arc(a + g, b - g)}" fill="none" stroke="var(--${c})" stroke-width="${sw}" opacity="${tier === c ? 1 : .25}"/>`;
  const sc = Math.min(100, Math.max(0, shown)), [mx, my] = pt(sc);
  return `<svg viewBox="0 0 300 175" role="img" aria-label="Risk score ${Math.round(target)} out of 100">
    ${seg(0, LOW_MAX, 'low')}${seg(LOW_MAX, HIGH_MIN, 'mod')}${seg(HIGH_MIN, 100, 'high')}
    <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="12" fill="var(--surface)" stroke="var(--ink)" stroke-width="3"/>
    <text x="${cx}" y="${cy - 14}" text-anchor="middle" style="font:500 54px var(--f-mono);fill:var(--ink);letter-spacing:-.03em">${Math.round(shown)}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="ax">out of 100</text>
    <text x="${pt(0)[0]}" y="${cy + 32}" text-anchor="middle" class="ax">0</text>
    <text x="${pt(100)[0]}" y="${cy + 32}" text-anchor="middle" class="ax">100</text>
  </svg>`;
}
const G = { shown: 0, raf: 0, tier: '' };
function animateGauge(to) {
  cancelAnimationFrame(G.raf);
  const from = G.shown, t0 = performance.now(), dur = REDUCED ? 0 : 700;
  const step = now => {
    const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
    G.shown = from + (to - from) * e;
    $('#gauge').innerHTML = gaugeSVG(G.shown, to);
    if (k < 1) G.raf = requestAnimationFrame(step);
  };
  G.raf = requestAnimationFrame(step);
}
const NOTES = {
  'COUGHING': 'A cough that lasts more than three weeks is worth a check-up.',
  'CHEST PAIN': 'Chest pain that is new, lasting, or comes with breathlessness needs prompt medical attention.',
  'SHORTNESS OF BREATH': 'New or worsening breathlessness should be assessed by a doctor.',
  'SWALLOWING DIFFICULTY': 'Ongoing trouble swallowing should be checked, whatever the cause.',
  'WHEEZING': 'Wheezing that is new or does not settle is worth discussing with a doctor.',
  'FATIGUE': 'Tiredness with no clear reason for several weeks deserves a general check.',
  'SMOKING': 'Quitting smoking lowers lung risk at any age. A doctor or quitline can help you plan it.',
  'ALCOHOL CONSUMING': 'Cutting back on alcohol supports lung and overall health.',
  'CHRONIC DISEASE': 'Keep long-term conditions well managed and review them at regular visits.'
};
function renderSteps(tier) {
  const out = [];
  if (tier === 'high') out.push('<b>Book a doctor visit soon</b> and share this summary. Ask whether lung screening suits you.');
  else if (tier === 'mod') out.push('<b>Plan a check-up</b> and mention the symptoms you ticked.');
  else out.push('<b>Stay alert.</b> See a doctor if a symptom lasts or gets worse.');
  const order = ['COUGHING','CHEST PAIN','SHORTNESS OF BREATH','SWALLOWING DIFFICULTY','WHEEZING','FATIGUE','SMOKING','ALCOHOL CONSUMING','CHRONIC DISEASE'];
  order.filter(k => P.f[FI[k]]).slice(0, 4).forEach(k => out.push(NOTES[k]));
  if (!P.f.some(Boolean)) out.push('Tick any habits or symptoms that apply to see tailored guidance.');
  $('#steps').innerHTML = out.map(t => `<li><span>${t}</span></li>`).join('');
}
function renderAgree(me) {
  const keys = ['gbm','mlp'];
  const items = keys.map(k => {
    if (!ready(k)) return `<div class="ag wait"><span>${MODEL_NAME[k]}</span><b>${S.train.running ? 'training…' : '–'}</b></div>`;
    const s = pm(k, me); return `<div class="ag ${tierOf(s)}"><span>${MODEL_NAME[k]}</span><b>${Math.round(s)}</b></div>`;
  });
  const tiers = keys.filter(ready).map(k => tierOf(pm(k, me)));
  let v = '';
  if (tiers.length === 2) v = tiers[0] === tiers[1] ? `Both models agree: ${TIER[tiers[0]].label.toLowerCase()}.` : 'The two models differ. Treat the result as less certain.';
  else if (S.train.running) v = 'Showing LightGBM for now. The score updates when K-Means SMOTE + MLP finishes.';
  $('#agree').innerHTML = items.join('') + (v ? `<div class="verdict">${v}</div>` : '');
}
function renderPins(cur) {
  $('#pins').innerHTML = P.pins.map((p, i) => {
    const s = scoreOf(p), d = Math.round(cur - s), n = p.f.reduce((a,b) => a + b, 0);
    return `<div class="pin"><span class="tag">${'ABC'[p.n]}</span><button type="button" class="load" data-load="${i}" title="Load this profile">Age ${p.age} · ${p.sex ? 'M' : 'F'} · ${n} item${n === 1 ? '' : 's'} · ${Math.round(s)}</button><span class="d ${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d === 0 ? '±0' : (d > 0 ? '+' : '−') + Math.abs(d)}</span><button type="button" class="x" data-del="${i}" aria-label="Remove pin">×</button></div>`;
  }).join('');
  $('#pinBtn').textContent = P.pins.length >= 3 ? 'Replace oldest pin' : 'Pin to compare';
}
let pinSeq = 0;
function pinProfile() {
  if (P.pins.length >= 3) P.pins.shift();
  P.pins.push({ age: P.age, sex: P.sex, f: [...P.f], n: pinSeq++ % 3 });
  renderPins(scoreOf({ age: P.age, sex: P.sex, f: P.f }));
  toast('Pinned. Change an answer to see how the score moves against it.');
}
const keysText = () => Object.keys(S.models).map(k => MODEL_NAME[k]).join(' and ');
function copySummary() {
  const me = { age: P.age, sex: P.sex, f: P.f }, s = scoreOf(me);
  const on = FACT.filter((f,i) => P.f[i]).map(f => f.label);
  copyText(`Lung Risk Lens summary\nScore: ${Math.round(s)}/100 (${TIER[tierOf(s)].label}), average of ${keysText()}\nAge ${P.age}, ${P.sex ? 'male' : 'female'}\nReported: ${on.length ? on.join(', ') : 'none'}\nThis is a screening aid trained on a small survey dataset. It does not diagnose lung cancer.`, 'Summary copied');
}
let lastTier = '';
function renderResult() {
  if (!Object.keys(S.models).length) {
    $('#gauge').innerHTML = ''; $('#tier').innerHTML = ''; $('#agree').innerHTML = '';
    $('#advice').textContent = S.rows.length ? 'The dataset needs both positive and negative cases before a score can be calculated.' : 'Waiting for data…';
    $('#drivers').innerHTML = ''; $('#similar').innerHTML = ''; $('#steps').innerHTML = ''; $('#percentile').innerHTML = ''; return;
  }
  const me = { age: P.age, sex: P.sex, f: P.f };
  const score = scoreOf(me), tier = tierOf(score);
  animateGauge(score);
  $('#tier').innerHTML = tierPill(tier, tier !== lastTier ? 'pop' : ''); lastTier = tier;
  $('#advice').textContent = TIER[tier].advice;
  const ds = datasetScores(), below = ds.filter(s => s < score).length;
  $('#percentile').innerHTML = `Scores higher than <b>${Math.round(pct(below, ds.length))}%</b> of the ${ds.length} records in the dataset.`;
  renderAgree(me); renderPins(score); renderSteps(tier);
  $('#miniScore').textContent = Math.round(score);
  $('#miniTier').className = 'tier-pill ' + tier; $('#miniTier').innerHTML = TIER[tier].label;

  const items = [];
  FACT.forEach((f, i) => { if (P.f[i]) items.push({ label: f.label, d: score - scoreOf({ ...me, f: P.f.map((v, j) => j === i ? 0 : v) }) }); });
  const mean = avg(S.rows.map(r => r.age)), ageAlt = scoreOf({ ...me, age: mean });
  if (Math.abs(score - ageAlt) >= 1) items.push({ label: `Age ${P.age} vs average ${Math.round(mean)}`, d: score - ageAlt });
  items.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const top = items.slice(0, 7), mx = Math.max(5, ...top.map(x => Math.abs(x.d)));
  $('#drivers').innerHTML = top.length ? top.map(x => `<div class="drv"><span>${esc(x.label)}</span><div class="bar"><i class="${x.d >= 0 ? 'up' : 'dn'}" data-w="${Math.min(50, 50 * Math.abs(x.d) / mx)}"></i></div><b>${x.d >= 0 ? '+' : '−'}${Math.abs(x.d).toFixed(0)}</b></div>`).join('') + '<p class="hint">Points gained or lost if that item were removed.</p>' : '<p class="empty">Nothing ticked yet. Pick habits or symptoms to see what drives the score.</p>';
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#drivers .bar i').forEach(i => { i.style.width = i.dataset.w + '%'; })));

  const K = 15;
  const near = S.rows.map(r => {
    let d = r.sex === P.sex ? 0 : 1;
    for (let i = 0; i < NF; i++) if (r.f[i] !== P.f[i]) d++;
    return { d: d + Math.abs(r.age - P.age) / 10, y: r.y };
  }).sort((a, b) => a.d - b.d).slice(0, K);
  const yes = near.filter(r => r.y).length;
  $('#similar').innerHTML = `<div class="sim-dots" role="img" aria-label="${yes} of ${near.length} similar records had lung cancer">${near.map((r, i) => `<i class="${r.y ? 'y' : 'n'}" style="--i:${i}"></i>`).join('')}</div>
    <p style="font-size:13.5px"><b>${yes} of ${near.length}</b> of the most similar records had lung cancer (${Math.round(pct(yes, near.length))}%).</p>
    <div class="legend"><span><i style="background:var(--pos)"></i>Lung cancer</span><span><i style="background:var(--neg)"></i>No lung cancer</span></div>`;
}

/* =====================================================================
   5. Analytics: filters, helpers, charts
   ===================================================================== */
function view(except) {
  return S.rows.filter(r => {
    if (except !== 'sex' && F.sex !== null && r.sex !== F.sex) return false;
    if (except !== 'band' && F.band !== null && r.band !== F.band) return false;
    if (except !== 'burden' && F.burden !== null && r.bur !== F.burden) return false;
    if (except !== 'flags') for (const [k, v] of F.flags) { if (except === 'flag:' + k) continue; if (r.f[FI[k]] !== v) return false; }
    return true;
  });
}
const charts = [];
function mount(id, fn) { const c = { el: document.getElementById(id), fn, w: 0, drawn: false }; charts.push(c); return c; }
function drawChart(c) {
  const w = c.el.clientWidth; if (!w) return;
  ANIM = !c.drawn && !REDUCED; c.w = w;
  try { c.fn(c.el, w); } catch (e) { console.error(c.el.id, e); }
  c.drawn = true; ANIM = false;
}
const ro = new ResizeObserver(() => charts.forEach(c => { const w = c.el.clientWidth; if (w && w !== c.w) drawChart(c); }));
const at = (t, i = 0) => ANIM ? ` class="a-${t}" style="--i:${i}"` : '';
const noData = el => { el.innerHTML = '<div class="nodata">No records match these filters.</div>'; };
const tipA = html => `data-tip="${esc(html)}"`;
const waiting = (el, msg) => { el.innerHTML = `<div class="nodata">${msg}</div>`; };

function tween(el, to, fmt) {
  if (!Number.isFinite(to)) { el.textContent = '–'; el._v = 0; return; }
  const from = el._v || 0; el._v = to; cancelAnimationFrame(el._raf);
  const t0 = performance.now(), dur = REDUCED ? 0 : 750;
  const step = now => { const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
function buildKPIs() {
  const defs = [['Records in view'], ['Lung cancer rate'], ['Average age'], ['Symptoms per person']];
  $('#kpis').innerHTML = defs.map((d, i) => `<div class="kpi" style="--d:${i}"><span class="eyebrow">${d[0]}</span><span class="n" id="kn${i}">–</span><span class="s" id="ks${i}"></span></div>`).join('');
}
function renderKPIs() {
  const v = view(), all = S.rows, n = v.length, yes = v.filter(r => r.y).length;
  const rate = pct(yes, n), rateAll = pct(all.filter(r => r.y).length, all.length);
  tween($('#kn0'), n, x => Math.round(x));
  tween($('#kn1'), n ? rate : NaN, x => x.toFixed(1) + '%');
  tween($('#kn2'), n ? avg(v.map(r => r.age)) : NaN, x => x.toFixed(1));
  tween($('#kn3'), n ? avg(v.map(r => r.bur)) : NaN, x => x.toFixed(1));
  $('#ks0').textContent = `of ${all.length} in the dataset`;
  $('#ks1').textContent = `${yes} positive · overall ${rateAll.toFixed(1)}%`;
  $('#ks2').textContent = `overall ${avg(all.map(r => r.age)).toFixed(1)}`;
  $('#ks3').textContent = `of 6 · overall ${avg(all.map(r => r.bur)).toFixed(1)}`;
}
function renderInsights() {
  const rows = view(), n = rows.length, out = [];
  if (n < 10) { $('#insights').innerHTML = ''; return; }
  const stat = FACT.map((f, i) => {
    const on = rows.filter(r => r.f[i]), off = rows.filter(r => !r.f[i]);
    return { f, on: on.length, off: off.length, ron: pct(on.filter(r => r.y).length, on.length), roff: pct(off.filter(r => r.y).length, off.length) };
  }).filter(o => o.on >= 8 && o.off >= 8).sort((a, b) => (b.ron - b.roff) - (a.ron - a.roff));
  if (stat.length) { const o = stat[0]; out.push(['Strongest signal', o.f.label, `${o.ron.toFixed(0)}% had lung cancer when present, ${o.roff.toFixed(0)}% when absent (+${(o.ron - o.roff).toFixed(0)} points).`]); }
  const bandStat = BANDS.map((b, i) => { const rs = rows.filter(r => r.band === i); return { b, n: rs.length, rate: pct(rs.filter(r => r.y).length, rs.length) }; }).filter(x => x.n >= 10);
  if (bandStat.length > 1) { const hi = [...bandStat].sort((a, b) => b.rate - a.rate)[0], lo = [...bandStat].sort((a, b) => a.rate - b.rate)[0]; out.push(['Age pattern', `Peaks at ${hi.b}`, `${hi.rate.toFixed(0)}% positive (n=${hi.n}). Lowest is ${lo.b} at ${lo.rate.toFixed(0)}%.`]); }
  const hi3 = rows.filter(r => r.bur >= 3), lo3 = rows.filter(r => r.bur < 3);
  if (hi3.length >= 8 && lo3.length >= 8) out.push(['Symptom threshold', '3 or more symptoms', `${pct(hi3.filter(r => r.y).length, hi3.length).toFixed(0)}% positive, against ${pct(lo3.filter(r => r.y).length, lo3.length).toFixed(0)}% with fewer.`]);
  const yes = rows.filter(r => r.y).length, no = n - yes;
  if (yes && no) { const ratio = Math.max(yes, no) / Math.min(yes, no); out.push(['Class balance', `${ratio.toFixed(1)} : 1`, ratio > 3 ? `${yes > no ? 'Positive' : 'Negative'} cases dominate, so accuracy alone can mislead. Check sensitivity, specificity and AUC.` : 'The two outcomes are reasonably balanced.']); }
  $('#insights').innerHTML = out.map(([k, big, text], i) => `<div class="insight" style="--d:${i}"><span class="eyebrow">${k}</span><span class="big">${esc(big)}</span><p>${esc(text)}</p></div>`).join('');
}
function renderHealth() {
  const i = S.info, all = S.rows, yes = all.filter(r => r.y).length;
  if (!i) return;
  const item = (b, label, tag, warn) => `<div class="hitem"><b>${b}</b><span>${label}</span>${tag ? `<span class="tag ${warn ? 'warn' : ''}">${tag}</span>` : ''}</div>`;
  $('#health').innerHTML = `<div class="health">
    ${item(all.length, 'Records used', S.added ? `includes ${S.added} added this session` : '')}
    ${item(i.rawCount, 'Rows in the file', '')}
    ${item(i.dupesFound, 'Duplicate rows', i.dupesRemoved ? 'removed' : i.dupesFound ? 'kept (switch in Data)' : 'none', !i.dupesRemoved && i.dupesFound > 0)}
    ${item(i.invalid, 'Rows with missing values', i.invalid ? 'dropped' : 'none', i.invalid > 0)}
    ${item(16, 'Columns', '1 outcome · 15 inputs')}
    ${item(all.length ? Math.min(...all.map(r => r.age)) + '–' + Math.max(...all.map(r => r.age)) : '–', 'Age range, years', '')}
    ${item(`${pct(yes, all.length).toFixed(0)} / ${pct(all.length - yes, all.length).toFixed(0)}`, 'Percent positive / negative', pct(yes, all.length) > 75 || pct(yes, all.length) < 25 ? 'imbalanced' : 'balanced', pct(yes, all.length) > 75 || pct(yes, all.length) < 25)}
  </div>`;
}

/* ----- chart: outcome donut ----- */
function chartOutcome(el, w) {
  const rows = view();
  if (!rows.length) return noData(el);
  const n = rows.length, yes = rows.filter(r => r.y).length, no = n - yes, r = 70, C = 2 * Math.PI * r, gap = 3;
  const ya = C * yes / n, na = C * no / n;
  const arcY = yes ? `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--pos)" stroke-width="24" stroke-dasharray="${Math.max(0, ya - (no ? gap : 0))} ${C}" transform="rotate(-90 100 100)" ${ANIM ? `class="a-donut" style="--c:${C}"` : ''}/>` : '';
  const arcN = no ? `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--neg)" stroke-width="24" stroke-dasharray="${Math.max(0, na - (yes ? gap : 0))} ${C}" stroke-dashoffset="${-ya}" transform="rotate(-90 100 100)" ${ANIM ? `class="a-donut" style="--c:${C}"` : ''}/>` : '';
  el.innerHTML = `<svg viewBox="0 0 200 200" style="max-width:220px;margin:0 auto" role="img" aria-label="${yes} with lung cancer, ${no} without">
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="24"/>${arcY}${arcN}
    <text x="100" y="104" text-anchor="middle" style="font:500 30px var(--f-mono);fill:var(--ink)">${pct(yes, n).toFixed(0)}%</text>
    <text x="100" y="124" text-anchor="middle" class="ax">lung cancer</text></svg>
    <div class="legend" style="justify-content:center;margin-top:14px"><span><i style="background:var(--pos)"></i>Yes ${yes}</span><span><i style="background:var(--neg)"></i>No ${no}</span></div>`;
}

/* ----- chart: age histogram with KDE ----- */
function chartHist(el, w) {
  const rows = view();
  if (rows.length < 2) { $('#histStats').innerHTML = ''; return noData(el); }
  const ages = rows.map(r => r.age), mn = Math.min(...ages), mx = Math.max(...ages);
  const lo = Math.floor(mn / 5) * 5, hi = Math.ceil((mx + 1) / 5) * 5, nb = (hi - lo) / 5;
  const bins = Array.from({ length: nb }, (_, i) => ({ x0: lo + i * 5, yes: 0, no: 0 }));
  rows.forEach(r => { const b = bins[Math.min(nb - 1, Math.floor((r.age - lo) / 5))]; r.y ? b.yes++ : b.no++; });
  const H = 240, m = { l: 34, r: 8, t: 14, b: 28 };
  const top = niceMax(Math.max(...bins.map(b => b.yes + b.no), 1));
  const X = a => m.l + (w - m.l - m.r) * (a - lo) / (hi - lo), Y = v => m.t + (H - m.t - m.b) * (1 - v / top);
  const bw = (w - m.l - m.r) / nb;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Age distribution">`;
  for (let k = 0; k <= 4; k++) { const v = top * k / 4; s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`; }
  bins.forEach((b, i) => {
    const t = b.yes + b.no, x = X(b.x0) + 1.5, ww = bw - 3;
    const tip = `<b>Age ${b.x0}–${b.x0 + 4}</b><br>Lung cancer: ${b.yes}<br>No lung cancer: ${b.no}<br>${t} records`;
    s += `<g ${tipA(tip)}><rect x="${x - 1.5}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}" fill="transparent"/>`;
    if (b.yes) s += `<rect${at('grow', i)} x="${x}" y="${Y(b.yes)}" width="${ww}" height="${Y(0) - Y(b.yes)}" rx="3" fill="var(--pos)"/>`;
    if (b.no) { const t0 = Y(t), bt = b.yes ? Y(b.yes) - 2 : Y(0); s += `<rect${at('grow', i)} x="${x}" y="${t0}" width="${ww}" height="${Math.max(1, bt - t0)}" rx="3" fill="var(--neg)"/>`; }
    s += `<text class="ax" x="${X(b.x0)}" y="${H - 8}" text-anchor="middle">${b.x0}</text></g>`;
  });
  s += `<text class="ax" x="${X(hi)}" y="${H - 8}" text-anchor="middle">${hi}</text>`;
  // KDE (Silverman bandwidth), scaled to counts per bin
  const n = ages.length, mean = avg(ages), sdv = sd(ages) || 1, h = 1.06 * sdv * Math.pow(n, -0.2);
  let path = '';
  for (let a = lo; a <= hi + 0.01; a += (hi - lo) / 80) {
    let d = 0; for (const x of ages) d += Math.exp(-0.5 * ((a - x) / h) ** 2);
    const cnt = d / (n * h * Math.sqrt(2 * Math.PI)) * n * 5;
    path += (path ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(Math.min(top, cnt)).toFixed(1);
  }
  s += `<path${ANIM ? ' class="a-draw"' : ''} pathLength="1" d="${path}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" opacity=".75"/>`;
  const med = median(ages);
  s += `<line x1="${X(mean)}" x2="${X(mean)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--accent)" stroke-width="2"/><line x1="${X(med)}" x2="${X(med)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink2)" stroke-width="2" stroke-dasharray="4 4"/>`;
  el.innerHTML = s + '</svg><div class="legend"><span><i style="background:var(--pos)"></i>Lung cancer</span><span><i style="background:var(--neg)"></i>No lung cancer</span><span><u style="border-color:var(--ink)"></u>Smoothed curve</span><span><u style="border-color:var(--accent)"></u>Mean</span><span><u style="border-color:var(--ink2);border-top-style:dashed"></u>Median</span></div>';
  $('#histStats').innerHTML = [['Minimum', mn], ['Maximum', mx], ['Mean', mean.toFixed(1)], ['Median', med % 1 ? med.toFixed(1) : med], ['Std. deviation', sdv.toFixed(1)]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

/* ----- chart: outcome by age band ----- */
function chartAge(el, w) {
  const rows = view('band');
  if (!rows.length) return noData(el);
  const H = 250, m = { l: 34, r: 6, t: 26, b: 30 };
  const bands = BANDS.map((b, i) => { const rs = rows.filter(r => r.band === i), yes = rs.filter(r => r.y).length; return { b, i, n: rs.length, yes, no: rs.length - yes }; });
  const max = niceMax(Math.max(...bands.map(x => x.n), 1));
  const y = v => m.t + (H - m.t - m.b) * (1 - v / max);
  const slot = (w - m.l - m.r) / bands.length, bw = Math.min(46, slot * .62);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Outcome by age band">`;
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
  bands.forEach(b => {
    const cx = m.l + slot * (b.i + .5), x0 = cx - bw / 2, dim = F.band !== null && F.band !== b.i ? ' dim' : '', rate = pct(b.yes, b.n);
    const tip = `<b>${b.b}</b><br>Lung cancer: ${b.yes} (${rate.toFixed(0)}%)<br>No lung cancer: ${b.no}<br>${b.n} records`;
    s += `<g class="mk${dim}" data-f="band:${b.i}" ${tipA(tip)}><rect class="hit" x="${cx - slot / 2}" y="${m.t - 16}" width="${slot}" height="${H - m.t - m.b + 16}" fill="transparent" rx="6"/>`;
    if (b.yes) s += `<rect${at('grow', b.i)} x="${x0}" y="${y(b.yes)}" width="${bw}" height="${y(0) - y(b.yes)}" rx="3" fill="var(--pos)"/>`;
    if (b.no) { const top = y(b.n), bot = b.yes ? y(b.yes) - 2 : y(0); s += `<rect${at('grow', b.i)} x="${x0}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" rx="3" fill="var(--neg)"/>`; }
    if (b.n) s += `<text class="vl" x="${cx}" y="${y(b.n) - 6}" text-anchor="middle">${rate.toFixed(0)}%</text>`;
    s += `<text class="lb${F.band === b.i ? ' sel' : ''}" x="${cx}" y="${H - 8}" text-anchor="middle">${slot < 60 ? b.b.replace('Under ', '<').replace(/–\d+/, '') : b.b}</text></g>`;
  });
  el.innerHTML = s + '</svg><div class="legend"><span><i style="background:var(--pos)"></i>Lung cancer</span><span><i style="background:var(--neg)"></i>No lung cancer</span></div>';
}

/* ----- chart: sex ----- */
function chartSex(el, w) {
  const rows = view('sex');
  if (!rows.length) return noData(el);
  const items = [{ v: 0, name: 'Female' }, { v: 1, name: 'Male' }].map(o => { const rs = rows.filter(r => r.sex === o.v); return { ...o, rs, n: rs.length, yes: rs.filter(r => r.y).length }; });
  const rowH = 64, H = rowH * 2 + 6;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate by sex">`;
  items.forEach((o, i) => {
    const y0 = i * rowH + 4, rate = pct(o.yes, o.n), yesW = w * rate / 100, dim = F.sex !== null && F.sex !== o.v ? ' dim' : '';
    const tip = `<b>${o.name}</b><br>Lung cancer: ${o.yes} (${rate.toFixed(0)}%)<br>No lung cancer: ${o.n - o.yes}<br>${o.n} records`;
    s += `<g class="mk${dim}" data-f="sex:${o.v}" ${tipA(tip)}><rect class="hit" x="0" y="${y0 - 4}" width="${w}" height="${rowH - 4}" fill="transparent" rx="8"/>
      <text class="lb${F.sex === o.v ? ' sel' : ''}" x="0" y="${y0 + 14}">${o.name}</text>
      <text class="vl" x="${w}" y="${y0 + 14}" text-anchor="end">${o.n ? rate.toFixed(0) + '%' : '–'} · n=${o.n}</text>`;
    if (o.n) {
      if (o.yes) s += `<rect${at('growx', i)} x="0" y="${y0 + 22}" width="${Math.max(3, yesW - (o.n > o.yes ? 1 : 0))}" height="14" rx="3" fill="var(--pos)"/>`;
      if (o.n > o.yes) s += `<rect${at('growx', i)} x="${yesW + 1}" y="${y0 + 22}" width="${Math.max(3, w - yesW - 1)}" height="14" rx="3" fill="var(--neg)"/>`;
    }
    s += '</g>';
  });
  const st = (v, f) => { const rs = rows.filter(r => r.sex === v); return rs.length ? f(rs) : '–'; };
  const smk = r => Math.round(pct(r.filter(x => x.f[0]).length, r.length)) + '%';
  el.innerHTML = s + `</svg><div class="statlist" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--line);font-size:13px">
    ${[['', 'Female', 'Male', true], ['Average age', st(0, r => avg(r.map(x => x.age)).toFixed(1)), st(1, r => avg(r.map(x => x.age)).toFixed(1))], ['Symptoms per person', st(0, r => avg(r.map(x => x.bur)).toFixed(1)), st(1, r => avg(r.map(x => x.bur)).toFixed(1))], ['Smokers', st(0, smk), st(1, smk)]].map(([a, b, c, head]) => `<div style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:baseline;${head ? 'font:500 11px var(--f-mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)' : ''}"><span style="color:var(--ink2)">${a}</span><b style="font:${head ? 'inherit' : '500 13px var(--f-mono)'};min-width:5.5em;text-align:right">${b}</b><b style="font:${head ? 'inherit' : '500 13px var(--f-mono)'};min-width:5.5em;text-align:right">${c}</b></div>`).join('')}</div>`;
}

/* ----- chart: factor dumbbell ----- */
function chartFactor(el, w) {
  if (!view().length && !view('flags').length) return noData(el);
  const lw = w < 520 ? 148 : 172, rw = w < 420 ? 0 : 58, x0 = lw, x1 = w - rw - 10, rowH = 28, top = 22;
  const stat = FACT.map((f, i) => {
    const rows = view('flag:' + f.key);
    const on = rows.filter(r => r.f[i] === 1), off = rows.filter(r => r.f[i] === 0);
    const ron = pct(on.filter(r => r.y).length, on.length), roff = pct(off.filter(r => r.y).length, off.length);
    return { f, i, on: on.length, off: off.length, ron, roff, gap: (on.length && off.length) ? ron - roff : -999 };
  }).sort((a, b) => b.gap - a.gap);
  const rates = stat.filter(o => o.gap > -999).flatMap(o => [o.ron, o.roff]);
  const lo = rates.length ? Math.max(0, Math.floor((Math.min(...rates) - 4) / 20) * 20) : 0;
  const H = top + stat.length * rowH + 6, X = v => x0 + (x1 - x0) * (v - lo) / (100 - lo);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate with and without each factor">`;
  for (let v = lo; v <= 100; v += (100 - lo > 60 ? 25 : 10)) s += `<line class="gl" x1="${X(v)}" x2="${X(v)}" y1="${top - 6}" y2="${H - 4}"/><text class="ax" x="${X(v)}" y="10" text-anchor="middle">${v}%</text>`;
  stat.forEach((o, k) => {
    const y = top + k * rowH + rowH / 2, sel = F.flags.get(o.f.key) === 1, small = o.on < 5 || o.off < 5;
    const tip = `<b>${esc(o.f.label)}</b><br>Present: ${o.on ? o.ron.toFixed(0) + '%' : '–'} with lung cancer (n=${o.on})<br>Absent: ${o.off ? o.roff.toFixed(0) + '%' : '–'} (n=${o.off})` + (small ? '<br>Small group, read with care' : '');
    s += `<g class="mk" data-f="flag:${esc(o.f.key)}" ${tipA(tip)}><rect class="hit" x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="${sel ? 'var(--accent-soft)' : 'transparent'}" rx="6"/><text class="lb${sel ? ' sel' : ''}" x="6" y="${y + 4}">${esc(o.f.label)}</text>`;
    if (o.on && o.off) {
      s += `<line${at('fade', k)} x1="${X(o.roff)}" x2="${X(o.ron)}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="2" opacity=".6"/>
        <circle${at('pop', k)} cx="${X(o.roff)}" cy="${y}" r="6" fill="var(--surface)" stroke="var(--neg)" stroke-width="2.5"/>
        <circle${at('pop', k)} cx="${X(o.ron)}" cy="${y}" r="6" fill="var(--pos)" stroke="var(--surface)" stroke-width="2"${small ? ' opacity=".5"' : ''}/>`;
      if (rw) s += `<text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${o.gap >= 0 ? '+' : '−'}${Math.abs(o.gap).toFixed(0)} pts</text>`;
    } else s += `<text class="ax" x="${x0 + 6}" y="${y + 4}">no comparison in view</text>`;
    s += '</g>';
  });
  el.innerHTML = s + '</svg>';
}

/* ----- chart: symptom burden ----- */
function chartBurden(el, w) {
  const rows = view('burden');
  if (!rows.length) return noData(el);
  const H = 330, m = { l: 34, r: 6, t: 24, b: 40 }, y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
  const data = [0,1,2,3,4,5,6].map(k => { const rs = rows.filter(r => r.bur === k); return { k, n: rs.length, yes: rs.filter(r => r.y).length, rate: pct(rs.filter(r => r.y).length, rs.length) }; });
  const slot = (w - m.l - m.r) / 7, bw = Math.min(30, slot * .64);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate by number of symptoms">`;
  [0, 50, 100].forEach(v => { s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`; });
  data.forEach(d => {
    const cx = m.l + slot * (d.k + .5), dim = F.burden !== null && F.burden !== d.k ? ' dim' : '';
    const tip = `<b>${d.k} symptom${d.k === 1 ? '' : 's'}</b><br>${d.n ? d.rate.toFixed(0) + '% with lung cancer' : 'No records'}<br>${d.yes} of ${d.n} records`;
    s += `<g class="mk${dim}" data-f="burden:${d.k}" ${tipA(tip)}><rect class="hit" x="${cx - slot / 2}" y="${m.t - 14}" width="${slot}" height="${H - m.t - m.b + 14}" fill="transparent" rx="6"/>`;
    if (d.n) s += `<rect${at('grow', d.k)} x="${cx - bw / 2}" y="${y(d.rate)}" width="${bw}" height="${Math.max(2, y(0) - y(d.rate))}" rx="3" fill="var(--pos)"/><text class="vl" x="${cx}" y="${y(d.rate) - 6}" text-anchor="middle">${d.rate.toFixed(0)}</text>`;
    s += `<text class="lb${F.burden === d.k ? ' sel' : ''}" x="${cx}" y="${H - 22}" text-anchor="middle">${d.k}</text><text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">n=${d.n}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

/* ----- generic horizontal bars (prevalence, importance) ----- */
function hbars(el, w, items, o = {}) {
  if (!items.length) return noData(el);
  const lw = w < 520 ? 148 : 172, rw = 54, rowH = 26, x0 = lw, x1 = w - rw, max = o.max || Math.max(...items.map(i => i.v), 1), H = items.length * rowH + 4;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(o.aria || 'Bars')}">`;
  items.forEach((it, k) => {
    const y = k * rowH + rowH / 2, len = (x1 - x0) * it.v / max, sel = it.sel;
    s += `<g class="${it.f ? 'mk' : ''}" ${it.f ? `data-f="${esc(it.f)}"` : ''} ${tipA(it.tip || it.label)}><rect class="hit" x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="${sel ? 'var(--accent-soft)' : 'transparent'}" rx="6"/>
      <text class="lb${sel ? ' sel' : ''}" x="6" y="${y + 4}">${esc(it.label)}</text>
      <rect${at('growx', k)} x="${x0}" y="${y - 6}" width="${Math.max(2, len)}" height="12" rx="3" fill="${o.color || 'var(--accent)'}"/>
      <text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${(o.fmt || (v => v.toFixed(0) + '%'))(it.v)}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}
function chartPrev(el, w) {
  const rows = view();
  if (!rows.length) return noData(el);
  const items = FACT.map((f, i) => { const c = rows.filter(r => r.f[i]).length; return { label: f.label, v: pct(c, rows.length), f: 'flag:' + f.key, sel: F.flags.get(f.key) === 1, tip: `<b>${esc(f.label)}</b><br>${c} of ${rows.length} records (${pct(c, rows.length).toFixed(1)}%)` }; });
  const male = rows.filter(r => r.sex).length;
  items.push({ label: 'Male', v: pct(male, rows.length), f: 'sex:1', sel: F.sex === 1, tip: `<b>Male</b><br>${male} of ${rows.length} records (${pct(male, rows.length).toFixed(1)}%)` });
  items.sort((a, b) => b.v - a.v);
  hbars(el, w, items, { max: 100, aria: 'Prevalence of each factor' });
}

/* ----- generic diverging bars (model odds ratios, correlations) ----- */
function divBars(el, w, items, o = {}) {
  if (!items.length) return noData(el);
  const lw = w < 520 ? 148 : 172, rw = 52, rowH = 26, top = 18, x0 = lw, x1 = w - rw, mid = (x0 + x1) / 2;
  const mx = o.max || Math.max(...items.map(i => Math.abs(i.v)), 0.1), H = top + items.length * rowH + 4;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(o.aria || 'Diverging bars')}">`;
  s += `<line class="gl" x1="${mid}" x2="${mid}" y1="${top - 6}" y2="${H - 2}" style="stroke:var(--muted)"/><text class="ax" x="${mid}" y="9" text-anchor="middle">${o.zero || 'no effect'}</text>`;
  items.forEach((it, k) => {
    const y = top + k * rowH + rowH / 2, len = (x1 - x0) / 2 * Math.abs(it.v) / mx, pos = it.v >= 0;
    s += `<g ${tipA(it.tip)}><rect x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="transparent"/>
      <text class="lb" x="6" y="${y + 4}">${esc(it.label)}</text>
      <rect ${ANIM ? `class="a-growx" style="--i:${k};transform-origin:${pos ? '0%' : '100%'} 50%"` : ''} x="${pos ? mid : mid - len}" y="${y - 6}" width="${Math.max(2, len)}" height="12" rx="3" fill="var(--${pos ? 'pos' : 'neg'})"/>
      <text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${o.fmt(it.v)}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}
/* ----- correlations ----- */
const VARS = [{ name: 'Sex (male)', short: 'Sex', get: r => r.sex }, { name: 'Age', short: 'Age', get: r => r.age }, ...FACT.map((f, i) => ({ name: f.label, short: SHORT[f.key], get: r => r.f[i], bin: true, key: f.key })), { name: 'Lung cancer', short: 'Cancer', get: r => r.y }];
function corrMatrix(rows) {
  const n = rows.length, cols = VARS.map(v => rows.map(v.get)), mean = cols.map(avg), sdv = cols.map((c, i) => Math.sqrt(avg(c.map(x => (x - mean[i]) ** 2))));
  return VARS.map((_, a) => VARS.map((__, b) => {
    if (!n || !sdv[a] || !sdv[b]) return a === b ? 1 : 0;
    let s = 0; for (let i = 0; i < n; i++) s += (cols[a][i] - mean[a]) * (cols[b][i] - mean[b]);
    return s / n / (sdv[a] * sdv[b]);
  }));
}
function chartHeat(el, w) {
  const rows = view();
  if (rows.length < 5) return noData(el);
  const M = corrMatrix(rows), n = VARS.length, lw = w < 560 ? 62 : 150, topM = w < 560 ? 62 : 74;
  const cs = Math.max(14, Math.min(36, (w - lw - 26) / n)), W = lw + cs * n + 26, H = topM + cs * n + 4;
  const wide = cs >= 30;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="Correlation heatmap">`;
  VARS.forEach((v, i) => {
    s += `<text class="ax" transform="translate(${lw + cs * i + cs / 2 + 4} ${topM - 6}) rotate(-50)" style="font-size:${cs < 20 ? 9.5 : 11}px">${esc(v.short)}</text>`;
    s += `<text class="ax" x="${lw - 6}" y="${topM + cs * i + cs / 2 + 4}" text-anchor="end" style="font-size:${cs < 20 ? 9.5 : 11.5}px">${esc(w < 560 ? v.short : v.name)}</text>`;
  });
  M.forEach((row, a) => row.forEach((val, b) => {
    const mix = Math.min(100, Math.abs(val) * 125), color = `color-mix(in srgb, var(--${val >= 0 ? 'pos' : 'neg'}) ${mix}%, var(--surface2))`;
    const tip = `<b>${esc(VARS[a].name)} × ${esc(VARS[b].name)}</b><br>r = ${val.toFixed(2)}`;
    const i = a + b;
    s += `<g ${tipA(tip)}><rect ${ANIM ? 'class="a-fade" ' : ''}x="${lw + cs * b + 1}" y="${topM + cs * a + 1}" width="${cs - 2}" height="${cs - 2}" rx="${cs > 20 ? 4 : 2}" style="${ANIM ? `--i:${(i / 3).toFixed(1)};` : ''}fill:${color}"/>`;
    if (wide && a !== b) s += `<text x="${lw + cs * b + cs / 2}" y="${topM + cs * a + cs / 2 + 4}" text-anchor="middle" style="font:500 10px var(--f-mono);fill:${Math.abs(val) > 0.45 ? 'var(--on-strong)' : 'var(--ink2)'};pointer-events:none">${val.toFixed(2).replace(/^(-?)0\./, '$1.')}</text>`;
    s += '</g>';
  }));
  const L = n - 1;
  s += `<rect x="${lw + 0.5}" y="${topM + cs * L + 0.5}" width="${cs * n - 1}" height="${cs - 1}" rx="4" fill="none" stroke="var(--ink)" stroke-width="1.5" opacity=".7"/><rect x="${lw + cs * L + 0.5}" y="${topM + 0.5}" width="${cs - 1}" height="${cs * n - 1}" rx="4" fill="none" stroke="var(--ink)" stroke-width="1.5" opacity=".7"/>`;
  el.innerHTML = s + '</svg>';
}
function targetCorr(rows) {
  const M = corrMatrix(rows), L = VARS.length - 1;
  return VARS.slice(0, L).map((v, i) => ({ label: v.name, v: M[i][L], bin: v.bin, idx: i }));
}
function chartCorr(el, w) {
  const rows = view();
  if (rows.length < 5) return noData(el);
  const items = targetCorr(rows).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map(i => ({ ...i, tip: `<b>${esc(i.label)}</b><br>r = ${i.v.toFixed(2)} with lung cancer` }));
  divBars(el, w, items, { fmt: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), zero: 'r = 0', aria: 'Correlation with lung cancer', max: Math.max(0.3, ...items.map(i => Math.abs(i.v))) });
}
function chartSmall(el, w) {
  const rows = view();
  if (rows.length < 10) return noData(el);
  const yes = rows.filter(r => r.y), no = rows.filter(r => !r.y);
  const top = targetCorr(rows).filter(i => i.bin || i.idx === 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 9);
  const cols = w >= 760 ? 3 : w >= 480 ? 2 : 1, cw = (w - (cols - 1) * 16) / cols, H = 150, m = { l: 4, r: 4, t: 18, b: 26 };
  const Y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
  const html = top.map((it, k) => {
    const v = VARS[it.idx], names = it.idx === 0 ? ['Female', 'Male'] : ['Absent', 'Present'];
    const share = (rs, val) => rs.length ? pct(rs.filter(r => v.get(r) === val).length, rs.length) : 0;
    const gw = (cw - m.l - m.r) / 2, bw = Math.min(34, gw * .34);
    let s = `<svg viewBox="0 0 ${cw} ${H}" role="img" aria-label="${esc(v.name)} by outcome">`;
    [0, 50, 100].forEach(g => { s += `<line class="gl" x1="${m.l}" x2="${cw - m.r}" y1="${Y(g)}" y2="${Y(g)}"/>`; });
    [0, 1].forEach(val => {
      const cx = m.l + gw * (val + .5), a = share(yes, val), b = share(no, val);
      [[a, 'pos', -1, `With lung cancer: ${a.toFixed(0)}% answered “${names[val]}”`], [b, 'neg', 1, `Without lung cancer: ${b.toFixed(0)}% answered “${names[val]}”`]].forEach(([pv, c, dir, tip], j) => {
        const x = cx + (dir < 0 ? -bw - 1.5 : 1.5);
        s += `<g ${tipA(`<b>${esc(v.name)}</b><br>${tip}`)}><rect${at('grow', k + val)} x="${x}" y="${Y(pv)}" width="${bw}" height="${Math.max(2, Y(0) - Y(pv))}" rx="3" fill="var(--${c})"/><text class="vl" x="${x + bw / 2}" y="${Y(pv) - 4}" text-anchor="middle" style="font-size:10.5px">${pv.toFixed(0)}</text></g>`;
      });
      s += `<text class="lb" x="${cx}" y="${H - 6}" text-anchor="middle" style="font-size:12px">${names[val]}</text>`;
    });
    return `<div class="sm"><h4>${esc(v.name)}<span>r = ${it.v >= 0 ? '+' : '−'}${Math.abs(it.v).toFixed(2)}</span></h4>${s}</svg></div>`;
  }).join('');
  el.innerHTML = `<div class="small-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${html}</div>`;
}

/* ----- active filters + slicers ----- */
function renderFilterChips() {
  const chips = [];
  if (F.sex !== null) chips.push(['sex', 'Sex: ' + (F.sex ? 'male' : 'female')]);
  if (F.band !== null) chips.push(['band', 'Age ' + BANDS[F.band]]);
  if (F.burden !== null) chips.push(['burden', F.burden + ' symptom' + (F.burden === 1 ? '' : 's')]);
  F.flags.forEach((v, k) => chips.push(['flag:' + k, FACT[FI[k]].label + (v ? ' present' : ' absent')]));
  $('#activeFilters').innerHTML = chips.map(([k, l]) => `<span class="fchip">${esc(l)}<button type="button" data-clear="${esc(k)}" aria-label="Remove filter ${esc(l)}">×</button></span>`).join('') + (chips.length > 1 ? '<button type="button" class="link-btn" data-clear="all">Clear all</button>' : '');
  $('#filterHint').hidden = chips.length > 0;
  $$('#slSex button').forEach(b => b.setAttribute('aria-pressed', String((F.sex === null ? '' : String(F.sex)) === b.dataset.v)));
  const sm = F.flags.get('SMOKING');
  $$('#slSmoke button').forEach(b => b.setAttribute('aria-pressed', String((sm === undefined ? '' : String(sm)) === b.dataset.v)));
}
function renderAnalytics() {
  if (!S.rows.length) return;
  renderFilterChips(); renderKPIs(); renderInsights(); renderHealth();
  charts.forEach(c => { if (c.el.closest('#view-analytics')) drawChart(c); });
}

/* =====================================================================
   7. Wiring
   ===================================================================== */
function renderAll() {
  setStatus(); renderResult();
  if (VIEW === 'analytics') renderAnalytics();
  updateTrainUI(); updateMini();
}
function updateMini() {
  const on = VIEW === 'check' && S.rows.length && Object.keys(S.models).length;
  $('#minibar').classList.toggle('on', !!on); document.body.classList.toggle('has-mini', !!on);
}
function moveInd() {
  const b = $('.tabs button[aria-selected="true"]'), ind = $('#tabInd');
  if (b) { ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; }
}
function setView(v, push) {
  VIEW = v;
  ['check', 'analytics'].forEach(n => {
    $('#view-' + n).hidden = n !== v;
    $('#tab-' + n).setAttribute('aria-selected', n === v ? 'true' : 'false');
  });
  if (push) { try { history.replaceState(null, '', '#' + v); } catch (e) { /* sandboxed */ } }
  moveInd(); updateMini();
  requestAnimationFrame(() => { if (v === 'analytics') renderAnalytics(); });
}
function setPage(p) {
  PAGE = p;
  $$('#subnav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.page === p)));
  ['overview', 'patterns', 'corr'].forEach(n => { $('#ap-' + n).hidden = n !== p; });
  requestAnimationFrame(renderAnalytics);
}
function toggleFilter(spec) {
  const i = spec.indexOf(':'), k = spec.slice(0, i), v = spec.slice(i + 1);
  if (k === 'band') F.band = F.band === +v ? null : +v;
  else if (k === 'sex') F.sex = F.sex === +v ? null : +v;
  else if (k === 'burden') F.burden = F.burden === +v ? null : +v;
  else if (k === 'flag') { F.flags.get(v) === 1 ? F.flags.delete(v) : F.flags.set(v, 1); }
  renderAnalytics();
}
function clearFilter(k) {
  if (k === 'all') { F.sex = F.band = F.burden = null; F.flags.clear(); }
  else if (k === 'sex') F.sex = null; else if (k === 'band') F.band = null; else if (k === 'burden') F.burden = null;
  else if (k.startsWith('flag:')) F.flags.delete(k.slice(5));
  renderAnalytics();
}
function showTip(e, html) {
  const t = $('#tip'); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, e.clientX + 14)) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, e.clientY + 14)) + 'px';
}
function readFile(f) {
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => { if (ingest(String(fr.result), { kind: 'upload', name: f.name })) toast('Loaded ' + f.name); };
  fr.readAsText(f);
}
function applyTheme(mode) {
  if (mode) document.documentElement.dataset.theme = mode;
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeBtn').innerHTML = dark
    ? '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor"/><path d="M10 1.5v2.2M10 16.3v2.2M1.5 10h2.2M16.3 10h2.2M4 4l1.5 1.5M14.5 14.5L16 16M4 16l1.5-1.5M14.5 5.5L16 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" fill="currentColor"/></svg>';
  return dark;
}
function wire() {
  $$('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view, true)));
  $$('#subnav button').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
  $('#dataBtn').addEventListener('click', () => { const p = $('#dataPanel'); p.hidden = !p.hidden; $('#dataBtn').setAttribute('aria-expanded', String(!p.hidden)); });
  $('#uploadBtn').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', e => readFile(e.target.files[0]));
  $('#dedupe').addEventListener('change', e => { S.dedupe = e.target.checked; if (S.rawText) ingest(S.rawText, { kind: S.source, name: S.info.name }, true); });
  $('#copyCsv').addEventListener('click', () => copyText(csvText(), `Copied ${S.rows.length} records as CSV`));
  $('#addRec').addEventListener('click', () => {
    const r = { age: P.age, sex: P.sex, f: [...P.f], y: +$('#addOutcome').value };
    r.band = bandOf(r.age); r.bur = r.f.slice(NL).reduce((a, b) => a + b, 0);
    S.rows.push(r); S.added++;
    afterData();
    toast('Record added. Charts and models are updating.');
  });
  $('#themeBtn').addEventListener('click', () => { const dark = applyTheme(); const next = dark ? 'light' : 'dark'; applyTheme(next); store.set('lrl-theme', next); });
  $('#view-analytics').addEventListener('click', e => {
    const c = e.target.closest('[data-clear]'); if (c) return clearFilter(c.dataset.clear);
    const m = e.target.closest('[data-f]'); if (m) toggleFilter(m.dataset.f);
  });
  $('#slSex').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; F.sex = b.dataset.v === '' ? null : +b.dataset.v; renderAnalytics(); });
  $('#slSmoke').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.dataset.v === '' ? F.flags.delete('SMOKING') : F.flags.set('SMOKING', +b.dataset.v); renderAnalytics(); });
  let tipTimer;
  document.addEventListener('pointermove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(e, t.dataset.tip); else $('#tip').hidden = true;
  });
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    clearTimeout(tipTimer);
    if (t) { showTip(e, t.dataset.tip); tipTimer = setTimeout(() => { $('#tip').hidden = true; }, 2500); } else $('#tip').hidden = true;
  });
  ['dragover', 'dragenter'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('drop-on'); }));
  ['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); document.body.classList.remove('drop-on'); }));
  window.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', moveInd);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInd);
  window.addEventListener('load', () => { moveInd(); setTimeout(moveInd, 400); });
}
function route() {
  const h = location.hash.replace('#', '');
  if (h === 'patterns' || h === 'correlations') { setView('analytics'); setPage(h === 'patterns' ? 'patterns' : 'corr'); }
  else setView(h === 'analytics' ? 'analytics' : 'check');
}

/* ---------- init ---------- */
(() => {
  const saved = store.get('lrl-theme'); if (saved === 'dark' || saved === 'light') applyTheme(saved); else applyTheme();
})();
buildForm(); buildKPIs();
mount('chOutcome', chartOutcome); mount('chHist', chartHist); mount('chAge', chartAge); mount('chSex', chartSex);
mount('chFactor', chartFactor); mount('chBurden', chartBurden); mount('chPrev', chartPrev);
mount('chHeat', chartHeat); mount('chCorr', chartCorr); mount('chSmall', chartSmall);
charts.forEach(c => ro.observe(c.el));
$('#lgFactor').innerHTML = '<span><i style="background:var(--pos)"></i>Factor present</span><span><i style="background:var(--surface);border:2.5px solid var(--neg)"></i>Factor absent</span>';
$('#lgSmall').innerHTML = '<span><i style="background:var(--pos)"></i>People with lung cancer</span><span><i style="background:var(--neg)"></i>People without</span>';
wire();
route();
boot();
})();
