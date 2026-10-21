'use strict';
/* ---------- constants ---------- */
const DATA_URL = 'data/lung_cancer.csv';
const POLL_MS = 4000;
const LIFE = [['SMOKING','Smoking','Currently smoke, or have smoked regularly','Smoking'],['YELLOW_FINGERS','Yellow fingers','Yellow staining on fingers or nails','Fingers'],['ANXIETY','Anxiety','Often feel anxious or on edge','Anxiety'],['PEER_PRESSURE','Peer pressure','Influenced by people around you to smoke or drink','Peer'],['ALCOHOL CONSUMING','Alcohol consumption','Drink alcohol regularly','Alcohol'],['CHRONIC DISEASE','Chronic disease','A long-term illness such as asthma, COPD or diabetes','Chronic'],['ALLERGY','Allergy','Frequent allergic reactions','Allergy']];
const SYMP = [['FATIGUE','Fatigue','Tired most days without a clear reason','Fatigue'],['WHEEZING','Wheezing','A whistling sound when you breathe','Wheeze'],['COUGHING','Coughing','A cough that lingers or keeps coming back','Cough'],['SHORTNESS OF BREATH','Shortness of breath','Out of breath with light activity','Breath'],['SWALLOWING DIFFICULTY','Swallowing difficulty','Food feels stuck, or swallowing hurts','Swallow'],['CHEST PAIN','Chest pain','Ongoing pain or tightness in the chest','Chest']];
const FACT = [...LIFE.map(([key,label,help,short]) => ({key,label,help,short,group:'life'})), ...SYMP.map(([key,label,help,short]) => ({key,label,help,short,group:'symptom'}))];
const NF = FACT.length, NL = LIFE.length;
const FI = Object.fromEntries(FACT.map((f,i) => [f.key,i]));
const BANDS = ['Under 50','50–54','55–59','60–64','65–69','70–74','75+'];
const bandOf = a => a < 50 ? 0 : a < 55 ? 1 : a < 60 ? 2 : a < 65 ? 3 : a < 70 ? 4 : a < 75 ? 5 : 6;
const LOW_MAX = 35, HIGH_MIN = 65;
const MODELS = [{k:'lr',name:'Logistic regression',v:'--m1',dash:''},{k:'gbt',name:'Gradient boosting',v:'--m2',dash:'7 4'},{k:'mlp',name:'SMOTE + MLP',v:'--m3',dash:'2 4'}];
const REF_PAPER = { Accuracy: 93.55, Precision: 98.08, Recall: 94.44, 'F1-score': 96.23, 'ROC-AUC': 96.76 };
const REF_NOTEBOOK = { Accuracy: 91.30, Precision: 94.21, Recall: 93.69, 'F1-score': 95.00, 'ROC-AUC': 92.77 };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const avg = a => a.length ? a.reduce((x,y) => x + y, 0) / a.length : 0;
const pct = (a,b) => b ? 100 * a / b : 0;
const norm = s => String(s).replace(/[^a-z0-9]/gi,'').toUpperCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const niceMax = v => [4,8,12,16,20,24,28,32,40,48,60,80,100,120,160,200,240,300].find(s => s >= v) || Math.ceil(v/100)*100;
const clock = d => d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hexRgb = h => { h = h.replace('#',''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0,2,4].map(i => parseInt(h.substr(i,2),16)); };
const mixRgb = (a,b,t) => a.map((v,i) => Math.round(v + (b[i] - v) * t));
const rgbStr = a => `rgb(${a[0]},${a[1]},${a[2]})`;
const lumOf = a => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return .2126 * f(a[0]) + .7152 * f(a[1]) + .0722 * f(a[2]); };

/* ---------- state ---------- */
const S = { rows: [], info: null, model: null, scores: [], meanScore: 0, source: 'none', rawText: '', dedupe: true, fold: [], added: 0,
  lab: { res: {}, models: {}, prog: { gbt: 0, mlp: 0 }, imp: null, status: 'idle', run: 0, worker: null, timer: 0 } };
const F = { sex: null, band: null, burden: null, outcome: null, flags: new Set() };
const P = { age: 62, sex: 1, f: new Array(NF).fill(0), example: true };

const view = except => S.rows.filter(r =>
  (except === 'sex' || F.sex === null || r.sex === F.sex) &&
  (except === 'band' || F.band === null || r.band === F.band) &&
  (except === 'burden' || F.burden === null || r.bur === F.burden) &&
  (except === 'outcome' || F.outcome === null || r.y === F.outcome) &&
  (except === 'flags' || [...F.flags].every(k => r.f[FI[k]] === 1)));

/* ---------- CSV -> rows ---------- */
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
    const shift = (!nums.includes(0) && nums.includes(2)) ? 1 : 0;
    return nums.map(v => (v - shift) === 1 ? 1 : 0);
  };
  const bins = FACT.map(f => binary(f.key)), target = binary('LUNG_CANCER');
  const sexCol = col('GENDER'), ageCol = col('AGE');
  let rows = [], invalid = 0;
  raw.forEach((_, i) => {
    const age = Number(ageCol[i]);
    if (!Number.isFinite(age) || age <= 0) { invalid++; return; }
    rows.push(mkRow(age, /^m/i.test(sexCol[i]) ? 1 : 0, bins.map(b => b[i]), target[i]));
  });
  const total = rows.length;
  let dupes = 0;
  if (dedupe) {
    const seen = new Set();
    rows = rows.filter(r => { const k = r.age + '|' + r.sex + '|' + r.f.join('') + '|' + r.y; if (seen.has(k)) { dupes++; return false; } seen.add(k); return true; });
  }
  if (rows.length < 20) throw new Error('Need at least 20 valid rows to train the models.');
  return { rows, info: { rawCount: total + invalid, invalid, dupes } };
}
function mkRow(age, sex, f, y) {
  return { age, sex, f, y, band: bandOf(age), bur: f.slice(NL).reduce((a,b) => a + b, 0) };
}
function rowsToCSV() {
  const head = ['GENDER','AGE',...FACT.map(f => f.key),'LUNG_CANCER'];
  return [head.join(','), ...S.rows.map(r => [r.sex ? 'MALE' : 'FEMALE', r.age, ...r.f, r.y ? 'YES' : 'NO'].join(','))].join('\n') + '\n';
}

/* ---------- logistic regression (L2, balanced classes) ---------- */
function solve(A, b) {
  const n = b.length, M = A.map((r,i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / (M[i][i] || 1e-12); }
  return x;
}
const featVec = (r, m) => [(r.age - m.mean) / m.sd, r.sex, ...r.f];
function fit(rows, lam = 1) {
  const n = rows.length, ages = rows.map(r => r.age), mean = avg(ages);
  const sd = Math.sqrt(avg(ages.map(a => (a-mean)**2))) || 1, m = { mean, sd };
  const X = rows.map(r => featVec(r, m)), y = rows.map(r => r.y);
  const np = y.reduce((a,b) => a + b, 0), nn = n - np;
  const wp = np ? n / (2*np) : 1, wn = nn ? n / (2*nn) : 1, w = y.map(v => v ? wp : wn);
  const d = NF + 2, b = new Array(d + 1).fill(0);
  for (let it = 0; it < 60; it++) {
    const g = new Array(d + 1).fill(0), H = Array.from({length: d + 1}, () => new Array(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const xa = X[i].concat(1);
      let z = 0; for (let j = 0; j <= d; j++) z += b[j] * xa[j];
      const p = 1 / (1 + Math.exp(-z)), e = w[i] * (p - y[i]), s = w[i] * p * (1 - p);
      for (let j = 0; j <= d; j++) { g[j] += e * xa[j]; for (let k = 0; k <= d; k++) H[j][k] += s * xa[j] * xa[k]; }
    }
    for (let j = 0; j < d; j++) { g[j] += lam * b[j]; H[j][j] += lam; }
    H[d][d] += 1e-6;
    const step = solve(H, g);
    let mx = 0;
    for (let j = 0; j <= d; j++) { b[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-8) break;
  }
  m.beta = b;
  return m;
}
function predict(m, r) {
  const x = featVec(r, m), d = x.length;
  let z = m.beta[d];
  for (let j = 0; j < d; j++) z += m.beta[j] * x[j];
  return 1 / (1 + Math.exp(-z));
}
const scoreOf = r => S.model ? predict(S.model, r) * 100 : NaN;

function makeFolds(rows, k = 5) {
  const rnd = mulberry32(42), fold = new Array(rows.length);
  [1, 0].forEach(cls => {
    const ids = rows.map((r,i) => i).filter(i => rows[i].y === cls);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    ids.forEach((id, n) => { fold[id] = n % k; });
  });
  return fold;
}
function cvLR(rows, fold, k = 5) {
  const oof = new Array(rows.length);
  for (let f = 0; f < k; f++) {
    const m = fit(rows.filter((_, i) => fold[i] !== f));
    rows.forEach((r, i) => { if (fold[i] === f) oof[i] = predict(m, r); });
  }
  return oof;
}
function evalOOF(oof, y) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  oof.forEach((p, i) => { const pr = p >= .5 ? 1 : 0; if (y[i] && pr) tp++; else if (y[i]) fn++; else if (pr) fp++; else tn++; });
  const prec = tp / ((tp + fp) || 1), rec = tp / ((tp + fn) || 1), spec = tn / ((tn + fp) || 1);
  const ord = oof.map((p, i) => [p, y[i]]).sort((a, b) => b[0] - a[0]);
  const Pn = y.filter(v => v).length, Nn = y.length - Pn;
  let tpc = 0, fpc = 0, auc = 0, pf = 0, pt = 0;
  const roc = [[0, 0]];
  for (let i = 0; i < ord.length; i++) {
    if (ord[i][1]) tpc++; else fpc++;
    if (i === ord.length - 1 || ord[i + 1][0] !== ord[i][0]) {
      const fx = fpc / (Nn || 1), ty = tpc / (Pn || 1);
      auc += (fx - pf) * (ty + pt) / 2; pf = fx; pt = ty; roc.push([fx, ty]);
    }
  }
  return { acc: (tp + tn) / y.length, prec, rec, spec, f1: 2 * prec * rec / ((prec + rec) || 1), auc, cm: { tp, tn, fp, fn }, roc, n: y.length };
}

/* ---------- retrain everything for the current rows ---------- */
function retrain() {
  const np = S.rows.filter(r => r.y).length;
  S.lab.res = {}; S.lab.models = {}; S.lab.imp = null;
  if (np === 0 || np === S.rows.length) { S.model = null; S.scores = []; S.meanScore = 0; S.lab.status = 'idle'; return; }
  S.model = fit(S.rows);
  S.fold = makeFolds(S.rows, 5);
  S.lab.res.lr = evalOOF(cvLR(S.rows, S.fold, 5), S.rows.map(r => r.y));
  S.scores = S.rows.map(scoreOf);
  S.meanScore = avg(S.scores);
  clearTimeout(S.lab.timer);
  S.lab.timer = setTimeout(startLab, 350);
}
function startLab() {
  if (S.lab.worker) { try { S.lab.worker.terminate(); } catch (e) { /* ignore */ } S.lab.worker = null; }
  if (!S.model) return;
  const id = ++S.lab.run, k = 5;
  S.lab.status = 'running'; S.lab.prog = { gbt: 0, mlp: 0 };
  S.lab.res = { lr: S.lab.res.lr }; S.lab.models = {}; S.lab.imp = null;
  const y = S.rows.map(r => r.y);
  const rows = S.rows.map(r => ({ age: r.age, sex: r.sex, f: r.f, y: r.y }));
  const onMsg = m => {
    if (id !== S.lab.run) return;
    if (m.type === 'progress') { S.lab.prog[m.model] = m.done / m.of; }
    else if (m.type === 'stage') { S.lab.res[m.model] = evalOOF(m.oof, y); S.lab.models[m.model] = m.fit; if (m.imp) S.lab.imp = m.imp; }
    else if (m.type === 'done') { S.lab.status = 'done'; }
    onLabUpdate(m.type === 'stage' || m.type === 'done');
  };
  onLabUpdate(false);
  try {
    const w = new Worker(URL.createObjectURL(new Blob([labWorkerSource()], { type: 'text/javascript' })));
    S.lab.worker = w;
    w.onmessage = e => onMsg(e.data);
    w.onerror = () => { S.lab.worker = null; setTimeout(() => labRun(rows, S.fold, k, onMsg), 30); };
    w.postMessage({ rows, fold: S.fold, k });
  } catch (e) {
    setTimeout(() => labRun(rows, S.fold, k, onMsg), 30);
  }
}

/* ---------- small UI utilities ---------- */
function setNum(el, v, dec = 0, suf = '', pre = '') {
  if (!el) return;
  const fmt = x => pre + x.toFixed(dec) + suf;
  if (!Number.isFinite(v)) { el.textContent = '–'; el._v = 0; return; }
  const from = Number.isFinite(el._v) ? el._v : 0;
  el._v = v;
  cancelAnimationFrame(el._raf);
  if (reduceMotion || from === v) { el.textContent = fmt(v); return; }
  const t0 = performance.now(), dur = 700;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (v - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function showTip(e, html) {
  const t = $('#tip'); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, e.clientX + 14)) + 'px';
  t.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, e.clientY + 14)) + 'px';
}
function growBars(container) {
  requestAnimationFrame(() => requestAnimationFrame(() => { container.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w; }); }));
}
