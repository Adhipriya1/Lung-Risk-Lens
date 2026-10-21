'use strict';
/* ================= chart registry + animation ================= */
const charts = [];
function mount(id, fn, viewName) { const c = { id, el: document.getElementById(id), fn, view: viewName, w: 0, seen: false }; charts.push(c); return c; }
function replay(el, dur) {
  if (reduceMotion) return;
  el.style.setProperty('--dur', dur + 'ms');
  el.classList.remove('play'); void el.offsetWidth; el.classList.add('play');
}
function drawChart(c, mode) {
  const w = c.el.clientWidth;
  if (!w) return;
  c.w = w; c.fn(c.el, w);
  if (mode && c.seen) replay(c.el, mode === 'full' ? 850 : 320);
}
function redrawChart(id) { const c = charts.find(x => x.id === id); if (c) drawChart(c, null); }
function renderCharts(viewName, mode) { charts.filter(c => c.view === viewName).forEach(c => drawChart(c, mode)); }
const io = new IntersectionObserver(entries => entries.forEach(en => {
  const c = charts.find(x => x.el === en.target);
  if (c && en.isIntersecting && !c.seen) { c.seen = true; if (c.el.clientWidth) { drawChart(c, null); replay(c.el, 850); } }
}), { threshold: .12 });
const ro = new ResizeObserver(() => charts.forEach(c => { const w = c.el.clientWidth; if (w && w !== c.w) drawChart(c, null); }));
function armView(v) { charts.filter(c => c.view === v).forEach(c => { c.seen = false; io.unobserve(c.el); io.observe(c.el); }); }

const noData = (el, msg) => { el.innerHTML = `<div class="nodata">${msg || 'No records match these filters.'}</div>`; };
const tipAttr = html => `data-tip="${esc(html)}"`;
const dimClass = on => on ? ' dim' : '';
function corr(a, b) {
  const n = a.length; if (n < 3) return 0;
  const ma = avg(a), mb = avg(b); let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

/* ================= analytics: KPIs, quality ================= */
const KPI = [['n', 'Records in view'], ['rate', 'Lung cancer rate'], ['age', 'Average age'], ['bur', 'Symptoms per person']];
function buildKPIs() {
  $('#kpis').innerHTML = KPI.map(([k, label], i) => `<div class="kpi rise" style="--i:${i}"><span class="eyebrow">${label}</span><span class="n" id="kv-${k}">0</span><span class="s" id="ks-${k}"></span></div>`).join('');
}
function renderKPIs() {
  const v = view(), all = S.rows, n = v.length, yes = v.filter(r => r.y).length;
  const rateAll = pct(all.filter(r => r.y).length, all.length);
  setNum($('#kv-n'), n);
  $('#ks-n').textContent = `of ${all.length} in the dataset`;
  setNum($('#kv-rate'), n ? pct(yes, n) : NaN, 1, '%');
  $('#ks-rate').textContent = `${yes} positive · overall ${rateAll.toFixed(1)}%`;
  setNum($('#kv-age'), n ? avg(v.map(r => r.age)) : NaN, 1);
  $('#ks-age').textContent = `overall ${avg(all.map(r => r.age)).toFixed(1)}`;
  setNum($('#kv-bur'), n ? avg(v.map(r => r.bur)) : NaN, 1);
  $('#ks-bur').textContent = `of 6 · overall ${avg(all.map(r => r.bur)).toFixed(1)}`;
}
function renderQuality() {
  if (!S.info) return;
  const all = S.rows, n = all.length, rate = pct(all.filter(r => r.y).length, n), bal = Math.min(rate, 100 - rate);
  const ok = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" fill="var(--low)"/><path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const warn = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1.6L15.2 14H.8z" fill="var(--mod)"/><path d="M8 6v4M8 11.7v.1" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const items = [
    [ok, `<b>${n}</b> records, <b>16</b> columns`, '1 numeric (age), 14 yes/no fields, 1 outcome'],
    [S.info.invalid ? warn : ok, S.info.invalid ? `<b>${S.info.invalid}</b> rows skipped` : 'No missing or invalid values', S.info.invalid ? 'Rows with an unreadable age were left out' : 'Every field has a usable value'],
    [ok, S.info.dupes ? `<b>${S.info.dupes}</b> duplicate rows removed` : 'No duplicate rows', S.info.dupes ? `${S.info.rawCount} rows in the file, ${n} kept` : 'Each record is unique'],
    [bal >= 30 ? ok : warn, `Outcome is <b>${rate.toFixed(0)}%</b> positive`, bal >= 30 ? 'Reasonably balanced' : 'Imbalanced, so all models weight the two outcomes equally']
  ];
  $('#quality').innerHTML = items.map(([ic, t, s], i) => `<div class="q-row rise" style="--i:${i}">${ic}<div><span>${t}</span><small>${s}</small></div></div>`).join('');
}

/* ================= analytics charts ================= */
function chartDonut(el, w) {
  const rows = view('outcome');
  if (!rows.length) return noData(el);
  const yes = rows.filter(r => r.y).length, no = rows.length - yes, n = rows.length;
  const size = Math.min(210, w), R = 76, cx = 100, cy = 100, sw = 26;
  const p = a => [cx + R * Math.sin(a), cy - R * Math.cos(a)];
  const seg = (a0, a1, col, y, label, cnt) => {
    const dim = dimClass(F.outcome !== null && F.outcome !== y), tip = `<b>${label}</b><br>${cnt} records (${pct(cnt, n).toFixed(1)}%)`;
    if (cnt === 0) return '';
    if (cnt === n) return `<circle class="mk g-d${dim}" pathLength="1" data-f="outcome:${y}" ${tipAttr(tip)} cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `<path class="mk g-d${dim}" pathLength="1" data-f="outcome:${y}" ${tipAttr(tip)} d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${(a1 - a0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
  };
  const g = .03, aY = 2 * Math.PI * yes / n;
  const svg = `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="Outcome split">
    ${seg(g, Math.max(g, aY - g), 'var(--pos)', 1, 'Lung cancer', yes)}${seg(aY + g, 2 * Math.PI - g, 'var(--neg)', 0, 'No lung cancer', no)}
    <text x="100" y="104" text-anchor="middle" class="dn-n">${pct(yes, n).toFixed(0)}%</text><text x="100" y="124" text-anchor="middle" class="ax">lung cancer</text></svg>`;
  const leg = (y, col, label, cnt) => `<button type="button" class="dl-row${dimClass(F.outcome !== null && F.outcome !== y)}" data-f="outcome:${y}"><i style="background:${col}"></i><span>${label}</span><b class="mono">${cnt}</b><small class="mono">${pct(cnt, n).toFixed(1)}%</small></button>`;
  el.innerHTML = `<div class="donut">${svg}<div class="dleg">${leg(1, 'var(--pos)', 'Lung cancer', yes)}${leg(0, 'var(--neg)', 'No lung cancer', no)}<p class="hint">${n} records in view</p></div></div>`;
}

function chartAgeHist(el, w) {
  const rows = view();
  if (!rows.length) { $('#ageStats').innerHTML = ''; return noData(el); }
  const ages = rows.map(r => r.age).sort((a, b) => a - b), n = ages.length;
  const mean = avg(ages), sd = Math.sqrt(avg(ages.map(a => (a - mean) ** 2))), med = n % 2 ? ages[(n - 1) / 2] : (ages[n / 2 - 1] + ages[n / 2]) / 2;
  const bw = 5, lo = Math.floor(ages[0] / bw) * bw, hi = Math.ceil((ages[n - 1] + 1) / bw) * bw, nb = (hi - lo) / bw;
  const counts = new Array(nb).fill(0);
  ages.forEach(a => { counts[Math.min(nb - 1, Math.floor((a - lo) / bw))]++; });
  const h = (1.06 * (sd || 1) * Math.pow(n, -.2)), kde = [];
  for (let x = lo; x <= hi; x += .5) { let s = 0; ages.forEach(a => { const z = (x - a) / h; s += Math.exp(-.5 * z * z); }); kde.push([x, s / (n * h * Math.sqrt(2 * Math.PI)) * n * bw]); }
  const H = 230, m = { l: 34, r: 8, t: 22, b: 30 };
  const max = niceMax(Math.max(...counts, ...kde.map(k => k[1]))), x = v => m.l + (w - m.l - m.r) * (v - lo) / (hi - lo), y = v => m.t + (H - m.t - m.b) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Age distribution">`;
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
  counts.forEach((c, i) => {
    const x0 = x(lo + i * bw) + 1, bwid = x(lo + (i + 1) * bw) - x(lo + i * bw) - 2;
    s += `<rect class="g-y" style="--i:${i}" x="${x0}" y="${y(c)}" width="${bwid}" height="${Math.max(0, y(0) - y(c))}" rx="3" fill="var(--accent)" opacity=".85" ${tipAttr(`<b>Age ${lo + i * bw}–${lo + (i + 1) * bw - 1}</b><br>${c} records`)}/>`;
    if (!(w < 460 && i % 2)) s += `<text class="ax" x="${x(lo + i * bw)}" y="${H - 10}" text-anchor="middle">${lo + i * bw}</text>`;
  });
  s += `<path class="g-d" pathLength="1" d="${kde.map((k, i) => (i ? 'L' : 'M') + x(k[0]).toFixed(1) + ' ' + y(k[1]).toFixed(1)).join('')}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
  const mk = (v, lab, anchor, dx) => `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t - 4}" y2="${y(0)}" stroke="var(--ink2)" stroke-width="1.5" stroke-dasharray="4 4"/><text class="vl" x="${x(v) + dx}" y="${m.t - 8}" text-anchor="${anchor}">${lab}</text>`;
  s += mk(mean, 'mean ' + mean.toFixed(1), 'end', -4) + mk(med, 'median ' + med.toFixed(1), 'start', 4);
  el.innerHTML = s + '</svg>';
  $('#ageStats').innerHTML = [['Min', ages[0]], ['Max', ages[n - 1]], ['Mean', mean.toFixed(1)], ['Median', med.toFixed(1)], ['Std dev', sd.toFixed(1)]].map(([k, v]) => `<div><span>${k}</span><b class="mono">${v}</b></div>`).join('');
}

function chartAge(el, w) {
  const rows = view('band');
  if (!rows.length) return noData(el);
  const H = 250, m = { l: 34, r: 6, t: 26, b: 30 };
  const bands = BANDS.map((b, i) => { const rs = rows.filter(r => r.band === i), yes = rs.filter(r => r.y).length; return { b, i, n: rs.length, yes, no: rs.length - yes }; });
  const max = niceMax(Math.max(...bands.map(x => x.n), 1)), y = v => m.t + (H - m.t - m.b) * (1 - v / max);
  const slot = (w - m.l - m.r) / bands.length, bwid = Math.min(46, slot * .62);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Outcome by age band">`;
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
  bands.forEach(b => {
    const cx = m.l + slot * (b.i + .5), x0 = cx - bwid / 2, rate = pct(b.yes, b.n);
    const tip = `<b>${b.b}</b><br>Lung cancer: ${b.yes} (${rate.toFixed(0)}%)<br>No lung cancer: ${b.no}<br>${b.n} records`;
    s += `<g class="mk${dimClass(F.band !== null && F.band !== b.i)}" data-f="band:${b.i}" ${tipAttr(tip)}><rect class="hit" x="${cx - slot / 2}" y="${m.t - 16}" width="${slot}" height="${H - m.t - m.b + 16}" fill="transparent"/>`;
    if (b.yes) s += `<rect class="g-y" style="--i:${b.i}" x="${x0}" y="${y(b.yes)}" width="${bwid}" height="${y(0) - y(b.yes)}" rx="3" fill="var(--pos)"/>`;
    if (b.no) { const t = y(b.n), bot = b.yes ? y(b.yes) - 2 : y(0); s += `<rect class="g-y" style="--i:${b.i}" x="${x0}" y="${t}" width="${bwid}" height="${Math.max(1, bot - t)}" rx="3" fill="var(--neg)"/>`; }
    if (b.n) s += `<text class="vl g-f" style="--i:${b.i + 4}" x="${cx}" y="${y(b.n) - 6}" text-anchor="middle">${rate.toFixed(0)}%</text>`;
    s += `<text class="lb${F.band === b.i ? ' sel' : ''}" x="${cx}" y="${H - 8}" text-anchor="middle">${slot < 60 ? b.b.replace('Under ', '<').replace(/–\d+/, '') : b.b}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

function chartSex(el, w) {
  const rows = view('sex');
  if (!rows.length) return noData(el);
  const items = [{ v: 0, name: 'Female' }, { v: 1, name: 'Male' }].map(o => { const rs = rows.filter(r => r.sex === o.v); return { ...o, n: rs.length, yes: rs.filter(r => r.y).length }; });
  const rowH = 64, H = rowH * 2 + 6;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate by sex">`;
  items.forEach((o, i) => {
    const y0 = i * rowH + 4, rate = pct(o.yes, o.n), yesW = w * rate / 100;
    const tip = `<b>${o.name}</b><br>Lung cancer: ${o.yes} (${rate.toFixed(0)}%)<br>No lung cancer: ${o.n - o.yes}<br>${o.n} records`;
    s += `<g class="mk${dimClass(F.sex !== null && F.sex !== o.v)}" data-f="sex:${o.v}" ${tipAttr(tip)}><rect class="hit" x="0" y="${y0 - 4}" width="${w}" height="${rowH - 4}" fill="transparent" rx="8"/>
      <text class="lb${F.sex === o.v ? ' sel' : ''}" x="0" y="${y0 + 14}">${o.name}</text><text class="vl" x="${w}" y="${y0 + 14}" text-anchor="end">${o.n ? rate.toFixed(0) + '%' : '–'} · n=${o.n}</text>`;
    if (o.n) {
      if (o.yes) s += `<rect class="g-x" style="--i:${i}" x="0" y="${y0 + 22}" width="${Math.max(3, yesW - (o.n > o.yes ? 1 : 0))}" height="14" rx="3" fill="var(--pos)"/>`;
      if (o.n > o.yes) s += `<rect class="g-x" style="--i:${i}" x="${yesW + 1}" y="${y0 + 22}" width="${Math.max(3, w - yesW - 1)}" height="14" rx="3" fill="var(--neg)"/>`;
    }
    s += '</g>';
  });
  const st = (v, f) => { const rs = rows.filter(r => r.sex === v); return rs.length ? f(rs) : '–'; };
  const sm = r => Math.round(pct(r.filter(x => x.f[0]).length, r.length)) + '%';
  el.innerHTML = s + `</svg><div class="statlist"><div class="row head"><span>In view</span><b>Female</b><b>Male</b></div>
    <div class="row"><span>Average age</span><b>${st(0, r => avg(r.map(x => x.age)).toFixed(1))}</b><b>${st(1, r => avg(r.map(x => x.age)).toFixed(1))}</b></div>
    <div class="row"><span>Symptoms per person</span><b>${st(0, r => avg(r.map(x => x.bur)).toFixed(1))}</b><b>${st(1, r => avg(r.map(x => x.bur)).toFixed(1))}</b></div>
    <div class="row"><span>Smokers</span><b>${st(0, sm)}</b><b>${st(1, sm)}</b></div></div>`;
}

function chartPrev(el, w) {
  const rows = view('flags');
  if (!rows.length) return noData(el);
  const n = rows.length;
  const items = [...FACT.map((f, i) => ({ label: f.label, key: f.key, c: rows.filter(r => r.f[i]).length })), { label: 'Male', key: 'MALE', c: rows.filter(r => r.sex).length }].sort((a, b) => b.c - a.c);
  const lw = w < 520 ? 124 : 172, rw = w < 420 ? 62 : 96, x0 = lw, x1 = w - rw, rowH = 28, H = items.length * rowH + 4;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="How common each factor is">`;
  items.forEach((o, k) => {
    const y = k * rowH + rowH / 2, p = pct(o.c, n), sel = o.key === 'MALE' ? F.sex === 1 : F.flags.has(o.key), anyF = F.flags.size > 0 || F.sex !== null;
    const tip = `<b>${esc(o.label)}</b><br>${o.c} of ${n} records (${p.toFixed(1)}%)`;
    s += `<g class="mk${dimClass(anyF && !sel)}" data-f="${o.key === 'MALE' ? 'sex:1' : 'flag:' + esc(o.key)}" ${tipAttr(tip)}><rect class="hit" x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="${sel ? 'var(--accent-soft)' : 'transparent'}" rx="6"/>
      <text class="lb${sel ? ' sel' : ''}" x="6" y="${y + 4}">${esc(o.label)}</text>
      <rect x="${x0}" y="${y - 6}" width="${x1 - x0}" height="12" rx="4" fill="var(--surface2)"/>
      <rect class="g-x" style="--i:${k}" x="${x0}" y="${y - 6}" width="${Math.max(2, (x1 - x0) * p / 100)}" height="12" rx="4" fill="var(--accent)"/>
      <text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${p.toFixed(0)}%${w < 420 ? '' : ' · ' + o.c}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

function chartFactor(el, w) {
  const rows = view('flags');
  if (!rows.length) return noData(el);
  const lw = w < 520 ? 124 : 172, rw = w < 420 ? 0 : 58, x0 = lw, x1 = w - rw - 10, rowH = 28, topM = 22;
  const stat = FACT.map((f, i) => {
    const on = rows.filter(r => r.f[i] === 1), off = rows.filter(r => r.f[i] === 0);
    const ron = pct(on.filter(r => r.y).length, on.length), roff = pct(off.filter(r => r.y).length, off.length);
    return { f, i, on: on.length, off: off.length, ron, roff, gap: (on.length && off.length) ? ron - roff : -999 };
  }).sort((a, b) => b.gap - a.gap);
  const rates = stat.filter(o => o.gap > -999).flatMap(o => [o.ron, o.roff]);
  const lo = rates.length ? Math.max(0, Math.floor((Math.min(...rates) - 4) / 20) * 20) : 0;
  const H = topM + stat.length * rowH + 6, X = v => x0 + (x1 - x0) * (v - lo) / (100 - lo);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate with and without each factor">`;
  for (let v = lo; v <= 100; v += (100 - lo > 60 ? 25 : 10)) s += `<line class="gl" x1="${X(v)}" x2="${X(v)}" y1="${topM - 6}" y2="${H - 4}"/><text class="ax" x="${X(v)}" y="10" text-anchor="middle">${v}%</text>`;
  stat.forEach((o, k) => {
    const y = topM + k * rowH + rowH / 2, sel = F.flags.has(o.f.key), small = o.on < 5 || o.off < 5;
    const tip = `<b>${esc(o.f.label)}</b><br>Present: ${o.on ? o.ron.toFixed(0) + '%' : '–'} with lung cancer (n=${o.on})<br>Absent: ${o.off ? o.roff.toFixed(0) + '%' : '–'} (n=${o.off})` + (small ? '<br>Small group, read with care' : '');
    s += `<g class="mk" data-f="flag:${esc(o.f.key)}" ${tipAttr(tip)}><rect class="hit" x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="${sel ? 'var(--accent-soft)' : 'transparent'}" rx="6"/><text class="lb${sel ? ' sel' : ''}" x="6" y="${y + 4}">${esc(o.f.label)}</text>`;
    if (o.on && o.off) {
      s += `<line class="g-x" style="--i:${k};transform-origin:${X(o.roff)}px ${y}px" x1="${X(o.roff)}" x2="${X(o.ron)}" y1="${y}" y2="${y}" stroke="var(--muted)" stroke-width="2" opacity=".6"/>
        <circle class="g-f" style="--i:${k}" cx="${X(o.roff)}" cy="${y}" r="6" fill="var(--surface)" stroke="var(--neg)" stroke-width="2.5"/>
        <circle class="g-f" style="--i:${k + 2}" cx="${X(o.ron)}" cy="${y}" r="6" fill="var(--pos)" stroke="var(--surface)" stroke-width="2"${small ? ' opacity=".5"' : ''}/>`;
      if (rw) s += `<text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${o.gap >= 0 ? '+' : '−'}${Math.abs(o.gap).toFixed(0)} pts</text>`;
    } else s += `<text class="ax" x="${x0 + 6}" y="${y + 4}">no comparison in view</text>`;
    s += '</g>';
  });
  el.innerHTML = s + '</svg>';
}

function chartTop9(el, w) {
  const rows = view('outcome');
  if (!rows.length) return noData(el);
  const ys = rows.map(r => r.y), nY = ys.filter(v => v).length, nN = rows.length - nY;
  if (!nY || !nN) return noData(el, 'Needs both outcomes in view. Clear the outcome filter.');
  const feats = [{ label: 'Sex', lo: 'Female', hi: 'Male', get: r => r.sex }, ...FACT.map((f, i) => ({ label: f.label, lo: 'No', hi: 'Yes', get: r => r.f[i] }))];
  feats.forEach(f => { f.r = corr(rows.map(f.get), ys); });
  const top = feats.sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 9);
  const cols = w >= 760 ? 3 : w >= 480 ? 2 : 1;
  const mini = (f, idx) => {
    const W = 230, H = 160, m = { l: 30, b: 28, t: 14 }, y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(f.label)} by outcome">`;
    [0, 50, 100].forEach(v => { s += `<line class="gl" x1="${m.l}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 4}" y="${y(v) + 3}" text-anchor="end" style="font-size:9px">${v}</text>`; });
    [0, 1].forEach(v => {
      const cx = m.l + (W - m.l - 4) * (v ? .75 : .25), bwid = 24;
      const pY = pct(rows.filter(r => r.y && f.get(r) === v).length, nY), pN = pct(rows.filter(r => !r.y && f.get(r) === v).length, nN);
      [[pY, 'var(--pos)', -bwid - 2, 'with lung cancer'], [pN, 'var(--neg)', 2, 'without lung cancer']].forEach(([p, c, dx, lab], q) => {
        s += `<rect class="g-y" style="--i:${idx + q}" x="${cx + dx}" y="${y(p)}" width="${bwid}" height="${Math.max(1, y(0) - y(p))}" rx="3" fill="${c}" ${tipAttr(`<b>${esc(f.label)}: ${v ? f.hi : f.lo}</b><br>${p.toFixed(0)}% of records ${lab}`)}/><text class="vl g-f" style="--i:${idx + q + 3};font-size:10px" x="${cx + dx + bwid / 2}" y="${y(p) - 4}" text-anchor="middle">${p.toFixed(0)}</text>`;
      });
      s += `<text class="lb" x="${cx}" y="${H - 8}" text-anchor="middle" style="font-size:11.5px">${v ? f.hi : f.lo}</text>`;
    });
    return `<div class="mini"><h5>${esc(f.label)} <small class="mono">r ${f.r >= 0 ? '+' : '−'}${Math.abs(f.r).toFixed(2)}</small></h5>${s}</svg></div>`;
  };
  el.innerHTML = `<div class="mini-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${top.map(mini).join('')}</div><div class="legend"><span><i style="background:var(--pos)"></i>Share of lung cancer cases</span><span><i style="background:var(--neg)"></i>Share of non-cases</span></div>`;
}

function chartBurden(el, w) {
  const rows = view('burden');
  if (!rows.length) return noData(el);
  const H = 330, m = { l: 34, r: 6, t: 24, b: 40 }, y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
  const data = [0, 1, 2, 3, 4, 5, 6].map(k => { const rs = rows.filter(r => r.bur === k); return { k, n: rs.length, rate: pct(rs.filter(r => r.y).length, rs.length), yes: rs.filter(r => r.y).length }; });
  const slot = (w - m.l - m.r) / 7, bwid = Math.min(30, slot * .64);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lung cancer rate by number of symptoms">`;
  [0, 50, 100].forEach(v => { s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`; });
  data.forEach(d => {
    const cx = m.l + slot * (d.k + .5);
    const tip = `<b>${d.k} symptom${d.k === 1 ? '' : 's'}</b><br>${d.n ? d.rate.toFixed(0) + '% with lung cancer' : 'No records'}<br>${d.yes} of ${d.n} records`;
    s += `<g class="mk${dimClass(F.burden !== null && F.burden !== d.k)}" data-f="burden:${d.k}" ${tipAttr(tip)}><rect class="hit" x="${cx - slot / 2}" y="${m.t - 14}" width="${slot}" height="${H - m.t - m.b + 14}" fill="transparent"/>`;
    if (d.n) s += `<rect class="g-y" style="--i:${d.k}" x="${cx - bwid / 2}" y="${y(d.rate)}" width="${bwid}" height="${Math.max(2, y(0) - y(d.rate))}" rx="3" fill="var(--pos)"/><text class="vl g-f" style="--i:${d.k + 3}" x="${cx}" y="${y(d.rate) - 6}" text-anchor="middle">${d.rate.toFixed(0)}</text>`;
    s += `<text class="lb${F.burden === d.k ? ' sel' : ''}" x="${cx}" y="${H - 22}" text-anchor="middle">${d.k}</text><text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">n=${d.n}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

/* correlation matrix */
function corrVars() {
  return [{ label: 'Male', short: 'Male', get: r => r.sex }, { label: 'Age', short: 'Age', get: r => r.age }, ...FACT.map((f, i) => ({ label: f.label, short: f.short, get: r => r.f[i] })), { label: 'Lung cancer', short: 'Cancer', get: r => r.y }];
}
function divColor(v) {
  const base = hexRgb(cssv('--surface2') || '#f6f9fa'), pos = hexRgb(cssv('--pos')), neg = hexRgb(cssv('--neg'));
  return mixRgb(base, v >= 0 ? pos : neg, Math.min(1, Math.abs(v)) * .95);
}
function chartHeat(el, w) {
  const rows = view();
  if (rows.length < 5) return noData(el);
  const vars = corrVars(), n = vars.length, cols = vars.map(v => rows.map(v.get));
  const labW = 130, c = Math.max(26, Math.min(42, Math.floor((w - labW - 10) / n))), topM = 84, W = labW + n * c + 10, H = topM + n * c + 4;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:none" role="img" aria-label="Correlation matrix">`;
  vars.forEach((v, j) => { s += `<text class="lb" style="font-size:11.5px" transform="translate(${labW + j * c + c / 2 + 3},${topM - 8}) rotate(-45)">${esc(v.short)}</text>`; });
  vars.forEach((vi, i) => {
    s += `<text class="lb" style="font-size:11.5px" x="${labW - 8}" y="${topM + i * c + c / 2 + 4}" text-anchor="end">${esc(vi.label)}</text>`;
    vars.forEach((vj, j) => {
      const r = i === j ? 1 : corr(cols[i], cols[j]), rgb = divColor(r), ink = lumOf(rgb) > .42 ? '#10222A' : '#FFFFFF';
      s += `<g class="g-f" style="--i:${(i + j) / 2}"><rect x="${labW + j * c + 1}" y="${topM + i * c + 1}" width="${c - 2}" height="${c - 2}" rx="4" fill="${rgbStr(rgb)}" ${tipAttr(`<b>${esc(vi.label)} × ${esc(vj.label)}</b><br>correlation ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`)}/>`;
      if (c >= 32) s += `<text x="${labW + j * c + c / 2}" y="${topM + i * c + c / 2 + 3.5}" text-anchor="middle" style="font:500 9.5px var(--f-mono);fill:${ink};pointer-events:none">${i === j ? '' : (r >= 0 ? '' : '−') + Math.abs(r).toFixed(2).replace(/^0/, '')}</text>`;
      s += '</g>';
    });
  });
  el.innerHTML = s + `</svg><div class="grad"><span>−1</span><i></i><span>+1</span></div>`;
}
function chartCorr(el, w) {
  const rows = view('outcome');
  if (rows.length < 5) return noData(el);
  const ys = rows.map(r => r.y);
  if (!ys.some(v => v) || ys.every(v => v)) return noData(el, 'Needs both outcomes in view. Clear the outcome filter.');
  const items = corrVars().slice(0, -1).map(v => ({ label: v.label, v: corr(rows.map(v.get), ys) })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  divergingBars(el, w, items, v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), 1, tipFn => tipFn);
}
function divergingBars(el, w, items, fmtVal, fixedMax, tipFn) {
  const lw = w < 520 ? 124 : 150, rw = 52, rowH = 26, topM = 4, x0 = lw, x1 = w - rw, mid = (x0 + x1) / 2;
  const mx = fixedMax || Math.max(...items.map(i => Math.abs(i.v)), 1), H = topM + items.length * rowH + 4;
  let s = `<svg viewBox="0 0 ${w} ${H}">`;
  s += `<line x1="${mid}" x2="${mid}" y1="${topM}" y2="${H - 2}" stroke="var(--muted)"/>`;
  items.forEach((o, k) => {
    const y = topM + k * rowH + rowH / 2, len = (x1 - x0) / 2 * Math.abs(o.v) / mx, pos = o.v >= 0;
    s += `<g ${tipAttr(`<b>${esc(o.label)}</b><br>${o.tip || fmtVal(o.v)}`)}><rect x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="transparent"/>
      <text class="lb" x="6" y="${y + 4}">${esc(o.label)}</text>
      <rect class="g-x" style="--i:${k};transform-origin:${mid}px ${y}px" x="${pos ? mid : mid - len}" y="${y - 6}" width="${Math.max(2, len)}" height="12" rx="3" fill="var(--${pos ? 'pos' : 'neg'})"/>
      <text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${fmtVal(o.v)}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

/* ================= risk check charts ================= */
function chartStanding(el, w) {
  if (!S.model || !S.scores.length) return noData(el, 'Waiting for data.');
  const H = 170, m = { l: 8, r: 8, t: 22, b: 26 }, nb = 10;
  const bins = Array.from({ length: nb }, () => ({ yes: 0, no: 0 }));
  S.scores.forEach((s, i) => { const b = Math.min(nb - 1, Math.floor(s / 10)); if (S.rows[i].y) bins[b].yes++; else bins[b].no++; });
  const max = niceMax(Math.max(...bins.map(b => b.yes + b.no), 1)), y = v => m.t + (H - m.t - m.b) * (1 - v / max), slot = (w - m.l - m.r) / nb, bwid = slot - 4;
  const zone = (a, b, c) => `<rect x="${m.l + slot * a / 10}" y="${m.t - 12}" width="${slot * (b - a) / 10}" height="${H - m.t - m.b + 12}" fill="var(--${c})" opacity=".09"/>`;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Distribution of risk scores">${zone(0, LOW_MAX, 'low')}${zone(LOW_MAX, HIGH_MIN, 'mod')}${zone(HIGH_MIN, 100, 'high')}`;
  bins.forEach((b, i) => {
    const x0 = m.l + slot * i + 2, tot = b.yes + b.no;
    const tip = `<b>Score ${i * 10}–${i * 10 + 10}</b><br>${tot} records<br>${b.yes} with lung cancer, ${b.no} without`;
    if (b.yes) s += `<rect class="g-y" style="--i:${i}" x="${x0}" y="${y(b.yes)}" width="${bwid}" height="${y(0) - y(b.yes)}" rx="3" fill="var(--pos)" ${tipAttr(tip)}/>`;
    if (b.no) { const t = y(tot), bot = b.yes ? y(b.yes) - 2 : y(0); s += `<rect class="g-y" style="--i:${i}" x="${x0}" y="${t}" width="${bwid}" height="${Math.max(1, bot - t)}" rx="3" fill="var(--neg)" ${tipAttr(tip)}/>`; }
    s += `<text class="ax" x="${m.l + slot * i}" y="${H - 8}" text-anchor="middle">${i * 10}</text>`;
  });
  s += `<text class="ax" x="${w - m.r}" y="${H - 8}" text-anchor="middle">100</text><line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(0)}" y2="${y(0)}"/></svg><div class="marker" id="standMark"><span>You</span></div>`;
  el.innerHTML = s; el._m = m;
  placeMarker();
}
function placeMarker() {
  const el = $('#chStanding'), mk = $('#standMark');
  if (!el || !mk || !el._m || S.lastScore === undefined) return;
  mk.style.left = `calc(${el._m.l}px + (100% - ${el._m.l + el._m.r}px) * ${Math.max(0, Math.min(100, S.lastScore)) / 100})`;
  mk.firstElementChild.textContent = 'You ' + Math.round(S.lastScore);
}
function updateStanding(score) {
  S.lastScore = score;
  placeMarker();
  const n = S.scores.length, below = S.scores.filter(s => s < score).length;
  const near = S.rows.filter((r, i) => Math.abs(S.scores[i] - score) <= 10), nearY = near.filter(r => r.y).length;
  $('#standingText').innerHTML = `Higher than <b>${Math.round(pct(below, n))}%</b> of the ${n} records.` + (near.length ? ` Of the ${near.length} records scoring within 10 points of you, <b>${Math.round(pct(nearY, near.length))}%</b> had lung cancer.` : '');
}
function chartRadar(el, w) {
  if (!S.rows.length) return noData(el, 'Waiting for data.');
  const pos = S.rows.filter(r => r.y), neg = S.rows.filter(r => !r.y);
  const size = Math.min(w, 420), cx = w / 2, cy = size / 2 + 6, R = size / 2 - 52, N = NF;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N, pt = (i, v) => [cx + R * v * Math.cos(ang(i)), cy + R * v * Math.sin(ang(i))];
  const prev = rs => FACT.map((f, i) => rs.length ? rs.filter(r => r.f[i]).length / rs.length : 0);
  const pp = prev(pos), pn = prev(neg), me = P.f;
  const poly = (vals, col, fill, sw, i0) => `<polygon class="g-s" style="--i:${i0};transform-origin:${cx}px ${cy}px" points="${vals.map((v, i) => pt(i, v).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="${fill}" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  let s = `<svg viewBox="0 0 ${w} ${size + 12}" role="img" aria-label="Your profile compared with positive and negative cases">`;
  [.25, .5, .75, 1].forEach(r => { s += `<polygon points="${FACT.map((f, i) => pt(i, r).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--line)"/>`; });
  FACT.forEach((f, i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.2), c = Math.cos(ang(i));
    s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/><text class="ax" style="font-size:10px;font-family:var(--f-body)" x="${lx}" y="${ly + 3}" text-anchor="${Math.abs(c) < .25 ? 'middle' : c > 0 ? 'start' : 'end'}">${f.short}</text>`;
  });
  s += poly(pn, 'var(--neg)', 'color-mix(in srgb, var(--neg) 14%, transparent)', 2, 0) + poly(pp, 'var(--pos)', 'color-mix(in srgb, var(--pos) 16%, transparent)', 2, 1) + poly(me.map(v => v), 'var(--accent)', 'color-mix(in srgb, var(--accent) 26%, transparent)', 2.5, 2);
  FACT.forEach((f, i) => { const [x, y] = pt(i, 1); s += `<circle cx="${x}" cy="${y}" r="11" fill="transparent" ${tipAttr(`<b>${esc(f.label)}</b><br>Positive cases: ${(pp[i] * 100).toFixed(0)}%<br>Negative cases: ${(pn[i] * 100).toFixed(0)}%<br>You: ${me[i] ? 'yes' : 'no'}`)}/>`; });
  el.innerHTML = s + '</svg>';
}

/* ================= model lab ================= */
const labReady = () => Object.keys(S.lab.res).length > 0;
function buildLabStatus() {
  $('#labStatus').innerHTML = MODELS.map(m => `<div class="ls-row" id="ls-${m.k}"><span class="ls-name"><i style="background:var(${m.v})"></i>${m.name}</span><div class="ls-bar"><i style="--c:var(${m.v})"></i></div><span class="ls-t mono">…</span></div>`).join('') + '<button type="button" class="btn small" id="labRetrain">Retrain</button>';
  $('#lgModels').innerHTML = MODELS.map(m => `<span><i style="background:var(${m.v})"></i>${m.name}</span>`).join('');
  $('#labRetrain').onclick = () => { if (S.model) { S.lab.res = { lr: S.lab.res.lr }; startLab(); } };
}
function updateLabStatus() {
  MODELS.forEach(m => {
    const row = $('#ls-' + m.k); if (!row) return;
    const done = !!S.lab.res[m.k], p = m.k === 'lr' ? 1 : S.lab.prog[m.k];
    row.querySelector('.ls-bar i').style.width = (done ? 100 : p * 100) + '%';
    row.querySelector('.ls-t').textContent = done ? 'Done' : S.lab.status === 'running' ? (p > 0 ? Math.round(p * 100) + '%' : 'Waiting') : '–';
    row.classList.toggle('done', done);
  });
  const n = S.rows.length;
  $('#labSub').textContent = `${n} records, stratified 5-fold cross-validation, retrained automatically when the data changes.`;
}
function onLabUpdate(stageDone) {
  updateLabStatus();
  renderConsensus();
  if (stageDone) { renderCharts('lab', 'full'); renderRef(); renderCM(); if (S.lab.status === 'done') { /* all models ready */ } renderResult && S.model && !$('#view-check').hidden && renderConsensus(); }
}
function skeleton(el, msg) { el.innerHTML = `<div class="skel"><i></i><span>${msg}</span></div>`; }
const METRICS = [['acc', 'Accuracy'], ['prec', 'Precision'], ['rec', 'Recall'], ['f1', 'F1-score'], ['auc', 'ROC-AUC']];
function chartMetrics(el, w) {
  if (!labReady()) return skeleton(el, 'Training models…');
  const H = 290, m = { l: 34, r: 6, t: 24, b: 30 }, y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
  const slot = (w - m.l - m.r) / METRICS.length, bwid = Math.min(30, slot / 4.2);
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Model performance comparison">`;
  [0, 25, 50, 75, 100].forEach(v => { s += `<line class="gl" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  METRICS.forEach(([k, label], gi) => {
    const cx = m.l + slot * (gi + .5);
    MODELS.forEach((md, mi) => {
      const r = S.lab.res[md.k]; if (!r) return;
      const v = r[k] * 100, x0 = cx + (mi - 1) * (bwid + 3) - bwid / 2;
      s += `<rect class="g-y" style="--i:${gi * 3 + mi}" x="${x0}" y="${y(v)}" width="${bwid}" height="${y(0) - y(v)}" rx="3" fill="var(${md.v})" ${tipAttr(`<b>${label}</b><br>${md.name}: ${v.toFixed(1)}%`)}/><text class="vl g-f" style="--i:${gi * 3 + mi + 4};font-size:${bwid < 22 ? 9 : 10.5}px" x="${x0 + bwid / 2}" y="${y(v) - 5}" text-anchor="middle">${Math.round(v)}</text>`;
    });
    s += `<text class="lb" x="${cx}" y="${H - 8}" text-anchor="middle">${label}</text>`;
  });
  el.innerHTML = s + '</svg>';
}
function chartRoc(el, w) {
  if (!labReady()) return skeleton(el, 'Training models…');
  const size = Math.min(w, 340), H = size + 30, m = { l: 38, r: 10, t: 10, b: 36 }, pw = size - m.l - m.r, ph = size - m.t - m.b;
  const X = v => m.l + pw * v, Y = v => m.t + ph * (1 - v);
  const shape = (i, x, y, c) => i === 0 ? `<circle cx="${x}" cy="${y}" r="5.5" fill="${c}" stroke="var(--surface)" stroke-width="2"/>` : i === 1 ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${c}" stroke="var(--surface)" stroke-width="2" transform="rotate(45 ${x} ${y})"/>` : `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="1.5" fill="${c}" stroke="var(--surface)" stroke-width="2"/>`;
  let s = `<svg viewBox="0 0 ${w} ${H}" style="max-width:${size}px" role="img" aria-label="ROC curves">`;
  [0, .5, 1].forEach(v => { s += `<line class="gl" x1="${m.l}" x2="${m.l + pw}" y1="${Y(v)}" y2="${Y(v)}"/><line class="gl" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}"/><text class="ax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text><text class="ax" x="${X(v)}" y="${m.t + ph + 16}" text-anchor="middle">${v}</text>`; });
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/><text class="ax" x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle">False positive rate</text>`;
  MODELS.forEach((md, i) => {
    const r = S.lab.res[md.k]; if (!r) return;
    s += `<path class="g-d" pathLength="1" d="${r.roc.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('')}" fill="none" stroke="var(${md.v})" stroke-width="2.5" stroke-linejoin="round"/>`;
    s += `<g class="g-f" style="--i:${i + 12}" ${tipAttr(`<b>${md.name}</b><br>ROC-AUC ${r.auc.toFixed(3)}<br>At the 0.5 cut-off: sensitivity ${(r.rec * 100).toFixed(0)}%, specificity ${(r.spec * 100).toFixed(0)}%`)}>${shape(i, X(1 - r.spec), Y(r.rec), `var(${md.v})`)}</g>`;
  });
  el.innerHTML = s + `</svg><div class="legend roc-leg">${MODELS.map((md, i) => S.lab.res[md.k] ? `<span><svg width="14" height="14" viewBox="0 0 14 14">${shape(i, 7, 7, `var(${md.v})`)}</svg>${md.name} <b class="mono">${S.lab.res[md.k].auc.toFixed(3)}</b></span>` : '').join('')}</div><p class="hint">Markers show each model at the 0.5 cut-off.</p>`;
}
function renderCM() {
  const el = $('#cmGrid'); if (!el) return;
  el.innerHTML = MODELS.map((md, mi) => {
    const r = S.lab.res[md.k];
    if (!r) return `<div class="cm"><h5><i style="background:var(${md.v})"></i>${md.name}</h5><div class="skel"><i></i><span>Training…</span></div></div>`;
    const c = r.cm, cells = [[c.tn, c.tn + c.fp, 'ok'], [c.fp, c.tn + c.fp, 'bad'], [c.fn, c.fn + c.tp, 'bad'], [c.tp, c.fn + c.tp, 'ok']];
    return `<div class="cm rise" style="--i:${mi};--c:var(${md.v})"><h5><i style="background:var(${md.v})"></i>${md.name}</h5>
      <div class="cm-body"><span></span><span class="cm-h">Predicted no</span><span class="cm-h">Predicted yes</span>
      <span class="cm-r">Actual no</span>${cells.slice(0, 2).map(x => `<div class="cm-c ${x[2]}" style="--t:${x[2] === 'ok' ? Math.max(.12, x[0] / (x[1] || 1)) : Math.max(.04, x[0] / (x[1] || 1) * .6)}"><b class="mono">${x[0]}</b><small>${pct(x[0], x[1]).toFixed(0)}%</small></div>`).join('')}
      <span class="cm-r">Actual yes</span>${cells.slice(2).map(x => `<div class="cm-c ${x[2]}" style="--t:${x[2] === 'ok' ? Math.max(.12, x[0] / (x[1] || 1)) : Math.max(.04, x[0] / (x[1] || 1) * .6)}"><b class="mono">${x[0]}</b><small>${pct(x[0], x[1]).toFixed(0)}%</small></div>`).join('')}</div></div>`;
  }).join('');
}
function chartImp(el, w) {
  if (!S.lab.imp) return skeleton(el, 'Training gradient boosting…');
  const names = ['Age', 'Male', ...FACT.map(f => f.label)], tot = S.lab.imp.reduce((a, b) => a + b, 0) || 1;
  const items = S.lab.imp.map((v, i) => ({ label: names[i], p: v / tot * 100 })).sort((a, b) => b.p - a.p);
  const lw = w < 520 ? 124 : 172, rw = 52, rowH = 26, x0 = lw, x1 = w - rw, mx = Math.max(...items.map(i => i.p), 1), H = items.length * rowH + 4;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Gradient boosting feature importance">`;
  items.forEach((o, k) => {
    const y = k * rowH + rowH / 2;
    s += `<g ${tipAttr(`<b>${esc(o.label)}</b><br>${o.p.toFixed(1)}% of split gain`)}><rect x="0" y="${y - rowH / 2}" width="${w}" height="${rowH}" fill="transparent"/><text class="lb" x="6" y="${y + 4}">${esc(o.label)}</text><rect x="${x0}" y="${y - 6}" width="${x1 - x0}" height="12" rx="4" fill="var(--surface2)"/><rect class="g-x" style="--i:${k}" x="${x0}" y="${y - 6}" width="${Math.max(2, (x1 - x0) * o.p / mx)}" height="12" rx="4" fill="var(--m2)"/><text class="vl" x="${w - 2}" y="${y + 4}" text-anchor="end">${o.p.toFixed(1)}%</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}
function chartOdds(el, w) {
  if (!S.model) return noData(el, 'Waiting for data.');
  const b = S.model.beta;
  const items = [{ label: 'Age (per 10 yrs)', v: b[0] / S.model.sd * 10 }, { label: 'Male', v: b[1] }, ...FACT.map((f, i) => ({ label: f.label, v: b[2 + i] }))].sort((a, c) => Math.abs(c.v) - Math.abs(a.v)).map(o => ({ ...o, tip: `Odds ratio ×${Math.exp(o.v).toFixed(2)}` }));
  divergingBars(el, w, items, v => '×' + Math.exp(v).toFixed(1), null);
}
function renderRef() {
  const el = $('#refTable'); if (!el) return;
  const live = S.lab.res.mlp, map = { Accuracy: 'acc', Precision: 'prec', Recall: 'rec', 'F1-score': 'f1', 'ROC-AUC': 'auc' };
  const cell = v => v === undefined ? '<span class="mono">…</span>' : `<div class="rt-c"><span class="mono">${v.toFixed(2)}%</span><i style="width:${v}%"></i></div>`;
  el.innerHTML = `<table class="rt"><thead><tr><th>Metric</th><th>Reference paper</th><th>Your notebook</th><th>Live SMOTE + MLP</th></tr></thead><tbody>` + Object.keys(REF_PAPER).map((k, i) => `<tr class="rise" style="--i:${i}"><th scope="row">${k}</th><td>${cell(REF_PAPER[k])}</td><td>${cell(REF_NOTEBOOK[k])}</td><td>${cell(live ? live[map[k]] * 100 : undefined)}</td></tr>`).join('') + '</tbody></table><p class="hint">The notebook column uses K-Means SMOTE with an MLP. The live column uses plain SMOTE with a smaller MLP, so small differences are expected.</p>';
}

/* ================= analytics filter chips + render ================= */
function renderFilterChips() {
  const chips = [];
  if (F.sex !== null) chips.push(['sex', F.sex ? 'Male' : 'Female']);
  if (F.band !== null) chips.push(['band', 'Age ' + BANDS[F.band]]);
  if (F.burden !== null) chips.push(['burden', F.burden + ' symptom' + (F.burden === 1 ? '' : 's')]);
  if (F.outcome !== null) chips.push(['outcome', F.outcome ? 'Lung cancer' : 'No lung cancer']);
  F.flags.forEach(k => chips.push(['flag:' + k, FACT[FI[k]].label + ' present']));
  $('#activeFilters').innerHTML = chips.map(([k, l]) => `<span class="fchip">${esc(l)}<button type="button" data-clear="${esc(k)}" aria-label="Remove filter ${esc(l)}">×</button></span>`).join('') + (chips.length > 1 ? '<button type="button" class="link-btn" data-clear="all">Clear all</button>' : '');
  $('#filterStrip').hidden = chips.length === 0;
  $('#filterHint').hidden = chips.length > 0;
}
function renderAnalytics(mode) { renderFilterChips(); renderKPIs(); renderCharts('analytics', mode || 'quick'); }
function renderLab(mode) { updateLabStatus(); renderCharts('lab', mode || 'quick'); renderRef(); renderCM(); }

/* ================= mount ================= */
function initCharts() {
  buildKPIs(); buildLabStatus();
  mount('chDonut', chartDonut, 'analytics'); mount('chAgeHist', chartAgeHist, 'analytics'); mount('chAge', chartAge, 'analytics');
  mount('chSex', chartSex, 'analytics'); mount('chPrev', chartPrev, 'analytics'); mount('chBurden', chartBurden, 'analytics');
  mount('chFactor', chartFactor, 'analytics'); mount('chTop9', chartTop9, 'analytics'); mount('chHeat', chartHeat, 'analytics'); mount('chCorr', chartCorr, 'analytics');
  mount('chStanding', chartStanding, 'check'); mount('chRadar', chartRadar, 'check');
  mount('chMetrics', chartMetrics, 'lab'); mount('chRoc', chartRoc, 'lab'); mount('chImp', chartImp, 'lab'); mount('chOdds', chartOdds, 'lab');
  charts.forEach(c => ro.observe(c.el));
}
