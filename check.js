'use strict';
/* ================= Risk check view ================= */
const tierOf = s => s < LOW_MAX ? 'low' : s < HIGH_MIN ? 'mod' : 'high';
const TIER = {
  low: { label: 'Lower risk', advice: 'Few of the indicators match the positive cases in your data. Keep an eye out for new or lasting symptoms.', icon: '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
  mod: { label: 'Moderate risk', advice: 'Several indicators overlap with positive cases. A check-up is a reasonable next step.', icon: '<path d="M8 1.8L15 14H1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.2v4M8 12v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  high: { label: 'Higher risk', advice: 'Many indicators match positive cases in your data. Please speak with a doctor about proper screening.', icon: '<path d="M5 1h6l4 4v6l-4 4H5l-4-4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 4.8v4.2M8 11.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' }
};
const tierPill = (tk, small) => `<span class="tier-pill ${tk}${small ? ' sm' : ''}"><svg viewBox="0 0 16 16" width="${small ? 13 : 16}" height="${small ? 13 : 16}" aria-hidden="true">${TIER[tk].icon}</svg>${TIER[tk].label}</span>`;
const profileRow = () => ({ age: P.age, sex: P.sex, f: P.f });
let step = 0, saved = [], simActs = [];

/* ---------- form ---------- */
function qRow(f, i) {
  return `<div class="qrow"><div class="qtxt"><b>${esc(f.label)}</b><span>${esc(f.help)}</span></div>
    <div class="yn" role="radiogroup" aria-label="${esc(f.label)}">
      <label><input type="radio" name="q${i}" id="q${i}n" value="0" data-i="${i}"><span>No</span></label>
      <label><input type="radio" name="q${i}" id="q${i}y" value="1" data-i="${i}"><span>Yes</span></label>
    </div></div>`;
}
function buildForm() {
  $('#rowsLife').innerHTML = FACT.map((f, i) => f.group === 'life' ? qRow(f, i) : '').join('');
  $('#rowsSymp').innerHTML = FACT.map((f, i) => f.group === 'symptom' ? qRow(f, i) : '').join('');
  $('#form').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.i !== undefined) P.f[+t.dataset.i] = +t.value;
    else if (t.name === 'sex') P.sex = +t.value;
    else if (t.id === 'ageNum') setAge(t.value);
    markEdited(); renderResult();
  });
  $('#ageRange').addEventListener('input', e => { setAge(e.target.value); markEdited(); renderResult(); });
  $('#ageNum').addEventListener('input', e => { if (e.target.value !== '') { setAge(e.target.value, true); markEdited(); renderResult(); } });
  $('#ageMinus').onclick = () => { setAge(P.age - 1); markEdited(); renderResult(); };
  $('#agePlus').onclick = () => { setAge(P.age + 1); markEdited(); renderResult(); };
  const preset = (age, sex, on) => { P.age = age; P.sex = sex; P.f = FACT.map(f => on.includes(f.key) ? 1 : 0); syncForm(); markEdited(); renderResult(); };
  $('#presetLow').onclick = () => preset(45, 0, ['ALLERGY']);
  $('#presetHigh').onclick = () => preset(68, 1, ['SMOKING','ALCOHOL CONSUMING','CHRONIC DISEASE','FATIGUE','WHEEZING','COUGHING','CHEST PAIN','SWALLOWING DIFFICULTY']);
  $('#presetClear').onclick = () => preset(55, 0, []);
  $$('#stepper button').forEach(b => b.addEventListener('click', () => setStep(+b.dataset.step)));
  $('#btnBack').onclick = () => setStep(step - 1);
  $('#btnNext').onclick = () => { if (step < 2) setStep(step + 1); else $('#resultCard').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); };
  P.f = FACT.map(f => ['SMOKING','FATIGUE','COUGHING','WHEEZING','ANXIETY'].includes(f.key) ? 1 : 0);
  syncForm(); setStep(0);
}
function setStep(n) {
  step = Math.max(0, Math.min(2, n));
  [0, 1, 2].forEach(i => { $('#step' + i).hidden = i !== step; });
  $$('#stepper button').forEach(b => { const i = +b.dataset.step; b.classList.toggle('done', i < step); if (i === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  $('#stepFill').style.width = (step / 2 * 100) + '%';
  $('#stepText').textContent = `Step ${step + 1} of 3`;
  $('#btnBack').disabled = step === 0;
  $('#btnNext').textContent = step === 2 ? 'See my score' : 'Next';
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
  FACT.forEach((f, i) => { $('#q' + i + (P.f[i] ? 'y' : 'n')).checked = true; });
}
function markEdited() {
  if (P.example) { P.example = false; $('#exampleNote').textContent = 'Answers stay in this browser. The score updates as you change them.'; }
}

/* ---------- gauge ---------- */
function buildGauge() {
  const cx = 150, cy = 140, R = 112;
  const pt = s => { const a = Math.PI * (1 - s / 100); return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
  const arc = (a, b) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const g = .9;
  $('#gauge').innerHTML = `<div class="halo"></div><svg viewBox="0 0 300 184" role="img" aria-label="Risk score gauge">
    <path class="gs" data-t="low" d="${arc(g, LOW_MAX - g)}" stroke="var(--low)"/>
    <path class="gs" data-t="mod" d="${arc(LOW_MAX + g, HIGH_MIN - g)}" stroke="var(--mod)"/>
    <path class="gs" data-t="high" d="${arc(HIGH_MIN + g, 100 - g)}" stroke="var(--high)"/>
    <g id="needle" style="transform-origin:${cx}px ${cy}px;transform:rotate(-90deg)"><circle cx="${cx}" cy="${cy - R}" r="12" class="knob"/></g>
    <text id="gNum" x="${cx}" y="${cy - 12}" text-anchor="middle" class="gnum">0</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="ax">out of 100</text>
    <text x="${pt(0)[0]}" y="${cy + 34}" text-anchor="middle" class="ax">0</text>
    <text x="${pt(LOW_MAX)[0] - 2}" y="${pt(LOW_MAX)[1] - 20}" text-anchor="middle" class="ax">${LOW_MAX}</text>
    <text x="${pt(HIGH_MIN)[0] + 2}" y="${pt(HIGH_MIN)[1] - 20}" text-anchor="middle" class="ax">${HIGH_MIN}</text>
    <text x="${pt(100)[0]}" y="${cy + 34}" text-anchor="middle" class="ax">100</text></svg>`;
}
function updateGauge(score, tk) {
  $$('#gauge .gs').forEach(p => p.classList.toggle('off', p.dataset.t !== tk));
  const n = $('#needle');
  const rot = Math.max(0, Math.min(100, score)) * 1.8 - 90;
  if (n) requestAnimationFrame(() => { n.style.transform = `rotate(${rot}deg)`; });
  setNum($('#gNum'), score);
}

/* ---------- result ---------- */
function renderResult() {
  const card = $('#resultCard');
  if (!S.model) {
    $('#tier').innerHTML = ''; $('#advice').textContent = 'The data needs both positive and negative cases before a score can be calculated.';
    $('#drivers').innerHTML = ''; return;
  }
  const me = profileRow(), score = scoreOf(me), tk = tierOf(score), t = TIER[tk];
  card.dataset.tier = tk;
  updateGauge(score, tk);
  $('#tier').innerHTML = tierPill(tk);
  $('#advice').textContent = t.advice;
  $('#cvNote').textContent = S.lab.res.lr ? `This model scored ${S.lab.res.lr.auc.toFixed(2)} ROC-AUC and ${(S.lab.res.lr.acc * 100).toFixed(0)}% accuracy in cross-validation on ${S.rows.length} records.` : '';

  // drivers
  const items = [];
  FACT.forEach((f, i) => {
    if (!P.f[i]) return;
    items.push({ label: f.label, d: score - scoreOf({ ...me, f: P.f.map((v, j) => j === i ? 0 : v) }) });
  });
  const ageAlt = scoreOf({ ...me, age: S.model.mean });
  if (Math.abs(score - ageAlt) >= 1) items.push({ label: `Age ${P.age} vs average ${Math.round(S.model.mean)}`, d: score - ageAlt });
  items.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const topItems = items.slice(0, 6), mx = Math.max(5, ...topItems.map(x => Math.abs(x.d)));
  $('#drivers').innerHTML = topItems.length ? topItems.map((x, i) => {
    const w = Math.min(50, 50 * Math.abs(x.d) / mx);
    return `<div class="drv" style="--i:${i}"><span>${esc(x.label)}</span><div class="bar"><i class="${x.d >= 0 ? 'up' : 'dn'}" style="width:0" data-w="${w}%"></i></div><b>${x.d >= 0 ? '+' : '−'}${Math.abs(x.d).toFixed(0)}</b></div>`;
  }).join('') + '<p class="hint">Points gained or lost if that item were removed.</p>' : '<p class="empty">No factors or symptoms selected yet.</p>';
  growBars($('#drivers'));

  // mini bar (phones)
  setNum($('#miniNum'), score);
  $('#miniTier').innerHTML = tierPill(tk, true);

  updateStanding(score);
  redrawChart('chRadar');
  renderSim(me, score);
  renderConsensus(me, score);
  renderNext(tk, score);
  renderSaved();
}

/* ---------- what-if ---------- */
function renderSim(me, score) {
  const acts = [];
  const set = (key, val) => () => { P.f[FI[key]] = val; };
  if (P.f[FI['SMOKING']]) acts.push({ label: 'Stop smoking', alt: { ...me, f: me.f.map((v, j) => j === FI['SMOKING'] ? 0 : v) }, apply: set('SMOKING', 0) });
  if (P.f[FI['ALCOHOL CONSUMING']]) acts.push({ label: 'Stop drinking alcohol', alt: { ...me, f: me.f.map((v, j) => j === FI['ALCOHOL CONSUMING'] ? 0 : v) }, apply: set('ALCOHOL CONSUMING', 0) });
  if (P.f.slice(NL).some(v => v)) acts.push({ label: 'All symptoms clear up', alt: { ...me, f: me.f.map((v, j) => j >= NL ? 0 : v) }, apply: () => { for (let j = NL; j < NF; j++) P.f[j] = 0; } });
  acts.push({ label: 'Ten years from now', alt: { ...me, age: me.age + 10 }, apply: () => { P.age = Math.min(100, P.age + 10); } });
  simActs = acts;
  $('#simList').innerHTML = acts.map((a, i) => {
    const s2 = scoreOf(a.alt), d = s2 - score, cls = d < -0.5 ? 'good' : d > 0.5 ? 'bad' : 'flat';
    return `<div class="sim-row" style="--i:${i}"><div><b>${a.label}</b><span class="sim-s"><span class="mono">${Math.round(score)}</span> → <span class="mono">${Math.round(s2)}</span></span></div><span class="delta ${cls}">${d > 0.5 ? '+' : d < -0.5 ? '−' : ''}${Math.abs(d) < 0.5 ? 'no change' : Math.abs(d).toFixed(0)}</span><button type="button" class="btn small" data-sim="${i}">Try it</button></div>`;
  }).join('');
}

/* ---------- second opinions ---------- */
function buildConsensus() {
  $('#consensus').innerHTML = `<div class="cons">` + MODELS.map(m => `<div class="cons-row" id="cs-${m.k}"><span class="cs-name"><i style="background:var(${m.v})"></i>${m.name}</span><div class="cs-track"><span class="seg l"></span><span class="seg m"></span><span class="seg h"></span><b class="cs-mark" style="left:0%;--c:var(${m.v})"></b></div><span class="cs-val mono">–</span></div>`).join('') + `</div><p id="csNote" class="cs-note"></p><div class="mini-prog" id="csProg" hidden><i></i></div>`;
}
function modelScores(me) {
  const x = [me.age, me.sex, ...me.f];
  return {
    lr: scoreOf(me),
    gbt: S.lab.models.gbt ? gbtPredict(S.lab.models.gbt, x) * 100 : null,
    mlp: S.lab.models.mlp ? mlpPredict(S.lab.models.mlp, x) * 100 : null
  };
}
function renderConsensus(me, score) {
  if (!$('#cs-lr')) return;
  me = me || profileRow();
  const sc = modelScores(me);
  MODELS.forEach(m => {
    const v = sc[m.k], row = $('#cs-' + m.k);
    row.querySelector('.cs-mark').style.left = (v === null ? 0 : Math.max(0, Math.min(100, v))) + '%';
    row.classList.toggle('wait', v === null);
    const el = row.querySelector('.cs-val');
    if (v === null) el.textContent = '…'; else setNum(el, v);
  });
  const ready = MODELS.filter(m => sc[m.k] !== null);
  const note = $('#csNote'), prog = $('#csProg');
  if (ready.length === 3) {
    const tiers = new Set(MODELS.map(m => tierOf(sc[m.k])));
    note.textContent = tiers.size === 1 ? `All three models agree: ${TIER[[...tiers][0]].label.toLowerCase()}.` : 'The models disagree on the risk band. Treat this result with extra caution.';
    prog.hidden = true;
  } else {
    const p = (S.lab.prog.gbt + S.lab.prog.mlp) / 2;
    note.textContent = S.lab.status === 'running' ? 'Training the other two models on your data…' : '';
    prog.hidden = S.lab.status !== 'running';
    prog.firstElementChild.style.width = (p * 100) + '%';
  }
}

/* ---------- next steps ---------- */
const WARN_SIGNS = ['A cough that lasts more than three weeks or changes', 'Coughing up blood', 'Unexplained weight loss or loss of appetite', 'Chest pain that does not settle', 'Hoarseness, or trouble swallowing', 'Breathlessness that is new or getting worse'];
function renderNext(tk, score) {
  const flagged = FACT.filter((f, i) => P.f[i] && ['CHEST PAIN','SWALLOWING DIFFICULTY','SHORTNESS OF BREATH','COUGHING','WHEEZING'].includes(f.key)).map(f => f.label.toLowerCase());
  const smoker = P.f[FI['SMOKING']];
  const head = { low: 'Nothing here suggests urgency. Keep up regular check-ups and report any change.', mod: 'Book a routine visit and share this list of answers with your doctor.', high: 'Arrange a visit with a doctor soon. They can decide whether imaging or other tests make sense.' }[tk];
  $('#nextSteps').innerHTML = `
    <div class="next-lead ${tk}"><b>${TIER[tk].label}</b><span>${head}</span></div>
    ${flagged.length ? `<p class="next-flag"><b>You reported ${flagged.join(', ')}.</b> Mention ${flagged.length > 1 ? 'these' : 'this'} to a doctor, especially if ${flagged.length > 1 ? 'they have' : 'it has'} lasted more than a few weeks.</p>` : ''}
    <h4>Warning signs worth a prompt visit</h4>
    <ul>${WARN_SIGNS.map(s => `<li>${s}</li>`).join('')}</ul>
    <h4>Ways to lower risk</h4>
    <ul>${smoker ? '<li><b>Stopping smoking is the biggest single change.</b> Ask a doctor or local quitline about support.</li>' : '<li>Avoid starting to smoke and stay away from second-hand smoke.</li>'}
      <li>Limit alcohol and keep chronic conditions such as asthma or COPD under review.</li>
      <li>If you are 50 or older and a long-term smoker, ask whether low-dose CT screening applies to you.</li></ul>`;
}

/* ---------- save / compare ---------- */
function loadSaved() { try { saved = JSON.parse(localStorage.getItem('lrl-saved') || '[]') || []; } catch (e) { saved = []; } }
function persistSaved() { try { localStorage.setItem('lrl-saved', JSON.stringify(saved)); } catch (e) { /* storage unavailable */ } }
function renderSaved() {
  const el = $('#savedList');
  if (!saved.length) { el.innerHTML = '<p class="empty">Nothing saved yet. Use “Save to compare”, change an answer, then save again to see the two side by side.</p>'; return; }
  el.innerHTML = saved.map((s, i) => `<div class="sv-row" style="--i:${i}"><b class="sv-l">${s.label}</b><div class="sv-mid"><span>${s.age}, ${s.sex ? 'male' : 'female'} · ${s.f.filter(v => v).length} factors</span><div class="sv-bar"><i class="${tierOf(s.score)}" style="width:${Math.max(3, s.score)}%"></i></div></div><span class="mono sv-n">${Math.round(s.score)}</span><button type="button" class="btn small" data-load="${i}">Load</button><button type="button" class="x" data-del="${i}" aria-label="Remove ${s.label}">×</button></div>`).join('');
}
function saveProfile() {
  if (!S.model) return;
  if (saved.length >= 4) saved.shift();
  const used = new Set(saved.map(s => s.label)), label = 'ABCDEFGH'.split('').find(c => !used.has(c));
  saved.push({ label, age: P.age, sex: P.sex, f: P.f.slice(), score: scoreOf(profileRow()) });
  persistSaved(); renderSaved(); toast(`Saved as profile ${label}`);
}
function copySummary() {
  const me = profileRow(), score = scoreOf(me), tk = tierOf(score);
  const on = FACT.filter((f, i) => P.f[i]).map(f => f.label.toLowerCase());
  const text = `Lung Risk Lens: score ${Math.round(score)}/100 (${TIER[tk].label.toLowerCase()}). ${P.age}-year-old ${P.sex ? 'male' : 'female'}. Reported: ${on.length ? on.join(', ') : 'no factors or symptoms'}. Screening aid only, not a diagnosis.`;
  const done = () => toast('Summary copied');
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); toast(ok ? 'Summary copied' : 'Copy was blocked here'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
function addRecord(y) {
  if (!S.model) return;
  const r = mkRow(P.age, P.sex, P.f.slice(), y); r.session = true;
  S.rows.push(r); S.added++;
  retrain(); renderAll('full');
  const pill = $('#livePill'); pill.classList.remove('flash'); void pill.offsetWidth; pill.classList.add('flash');
  toast(`Added to the data: ${S.rows.length} records now. Charts and models are updating.`);
}
function initCheckEvents() {
  $('#btnSave').onclick = saveProfile;
  $('#btnCopy').onclick = copySummary;
  $('#recYes').onclick = () => addRecord(1);
  $('#recNo').onclick = () => addRecord(0);
  $('#miniBtn').onclick = () => $('#resultCard').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  $('#simList').addEventListener('click', e => {
    const b = e.target.closest('[data-sim]'); if (!b) return;
    const a = simActs[+b.dataset.sim]; a.apply(); syncForm(); markEdited(); renderResult(); toast(`Applied: ${a.label.toLowerCase()}`);
  });
  $('#savedList').addEventListener('click', e => {
    const l = e.target.closest('[data-load]'), d = e.target.closest('[data-del]');
    if (l) { const s = saved[+l.dataset.load]; P.age = s.age; P.sex = s.sex; P.f = s.f.slice(); syncForm(); markEdited(); renderResult(); }
    if (d) { saved.splice(+d.dataset.del, 1); persistSaved(); renderSaved(); }
  });
}
