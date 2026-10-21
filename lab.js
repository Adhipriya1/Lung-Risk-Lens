'use strict';
/* Model lab engine. Every function here is self-contained (only calls siblings) so the same source
   runs inside a Web Worker (built from Function.toString) or on the main thread as a fallback. */

function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---- gradient boosted trees (Newton boosting, logistic loss) ---- */
function gbtTree(node, x) { while (node.v === undefined) node = x[node.f] <= node.t ? node.l : node.r; return node.v; }
function gbtPredict(m, x) { let z = m.f0; for (const t of m.trees) z += m.lr * gbtTree(t, x); return 1 / (1 + Math.exp(-z)); }
function gbtFit(X, y, w, opt) {
  opt = opt || {};
  const T = opt.trees || 80, lr = opt.lr || 0.1, maxD = opt.depth || 3, minLeaf = opt.minLeaf || 4, lam = opt.lam || 1;
  const n = X.length, d = X[0].length;
  let sw = 0, sy = 0;
  for (let i = 0; i < n; i++) { sw += w[i]; sy += w[i] * y[i]; }
  const p0 = Math.min(.999, Math.max(.001, sy / sw)), f0 = Math.log(p0 / (1 - p0));
  const F = new Array(n).fill(f0), trees = [], imp = new Array(d).fill(0);
  const ths = [];
  for (let j = 0; j < d; j++) {
    const u = [...new Set(X.map(r => r[j]))].sort((a, b) => a - b), t = [];
    for (let k = 0; k < u.length - 1; k++) t.push((u[k] + u[k + 1]) / 2);
    const step = Math.ceil(t.length / 40) || 1;
    ths.push(t.filter((_, k) => k % step === 0));
  }
  for (let t = 0; t < T; t++) {
    const g = new Array(n), h = new Array(n);
    for (let i = 0; i < n; i++) { const p = 1 / (1 + Math.exp(-F[i])); g[i] = w[i] * (p - y[i]); h[i] = w[i] * p * (1 - p); }
    const build = (idx, depth) => {
      let G = 0, H = 0;
      for (const i of idx) { G += g[i]; H += h[i]; }
      const leaf = { v: -G / (H + lam) };
      if (depth >= maxD || idx.length < 2 * minLeaf) return leaf;
      const base = G * G / (H + lam);
      let best = null, bg = 1e-6;
      for (let j = 0; j < d; j++) {
        for (const th of ths[j]) {
          let GL = 0, HL = 0, nl = 0;
          for (const i of idx) if (X[i][j] <= th) { GL += g[i]; HL += h[i]; nl++; }
          const nr = idx.length - nl;
          if (nl < minLeaf || nr < minLeaf) continue;
          const GR = G - GL, HR = H - HL, gain = GL * GL / (HL + lam) + GR * GR / (HR + lam) - base;
          if (gain > bg) { bg = gain; best = { j, th }; }
        }
      }
      if (!best) return leaf;
      imp[best.j] += bg;
      const L = [], R = [];
      for (const i of idx) (X[i][best.j] <= best.th ? L : R).push(i);
      return { f: best.j, t: best.th, l: build(L, depth + 1), r: build(R, depth + 1) };
    };
    const tree = build(Array.from({ length: n }, (_, i) => i), 0);
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += lr * gbtTree(tree, X[i]);
  }
  return { f0, lr, trees, imp };
}

/* ---- SMOTE: synthesise minority samples by interpolating between k nearest minority neighbours ---- */
function smote(X, y, k, rnd) {
  const i1 = [], i0 = [];
  y.forEach((v, i) => (v ? i1 : i0).push(i));
  const minI = i1.length < i0.length ? i1 : i0, maj = minI === i1 ? i0 : i1, minLab = minI === i1 ? 1 : 0;
  const need = maj.length - minI.length, XS = X.map(r => r.slice()), YS = y.slice();
  if (minI.length < 2 || need <= 0) return { X: XS, y: YS };
  const kk = Math.min(k, minI.length - 1);
  const dist = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) * (a[j] - b[j]); return s; };
  const nb = minI.map(a => minI.filter(b => b !== a).map(b => [dist(X[a], X[b]), b]).sort((p, q) => p[0] - q[0]).slice(0, kk).map(p => p[1]));
  for (let s = 0; s < need; s++) {
    const ai = Math.floor(rnd() * minI.length), a = minI[ai], b = nb[ai][Math.floor(rnd() * kk)], u = rnd();
    XS.push(X[a].map((v, j) => v + u * (X[b][j] - v)));
    YS.push(minLab);
  }
  return { X: XS, y: YS };
}

/* ---- small MLP (ReLU, Adam, BCE) ---- */
function mlpPredict(m, xr) {
  const x = xr.slice(); x[0] = (x[0] - m.mean) / m.sd;
  const { d, H1, H2 } = m, a1 = new Float64Array(H1), a2 = new Float64Array(H2);
  for (let j = 0; j < H1; j++) { let s = m.b1[j]; for (let k = 0; k < d; k++) s += x[k] * m.W1[k * H1 + j]; a1[j] = s > 0 ? s : 0; }
  for (let q = 0; q < H2; q++) { let s = m.b2[q]; for (let j = 0; j < H1; j++) s += a1[j] * m.W2[j * H2 + q]; a2[q] = s > 0 ? s : 0; }
  let z = m.b3[0];
  for (let q = 0; q < H2; q++) z += a2[q] * m.W3[q];
  return 1 / (1 + Math.exp(-z));
}
function mlpTrain(Xr, y, rnd, opt) {
  opt = opt || {};
  const H1 = opt.h1 || 32, H2 = opt.h2 || 16, epochs = opt.epochs || 120, lr = opt.lr || 0.004, bs = opt.bs || 32, l2 = 1e-4;
  const d = Xr[0].length;
  const ages = Xr.map(r => r[0]), mean = ages.reduce((a, b) => a + b, 0) / ages.length;
  const sd = Math.sqrt(ages.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ages.length) || 1;
  const Xz = Xr.map(r => { const x = r.slice(); x[0] = (x[0] - mean) / sd; return x; });
  const bal = smote(Xz, y, 5, rnd), X = bal.X, Y = bal.y, n = X.length;
  const randn = () => (rnd() + rnd() + rnd() - 1.5) * 2;
  const mk = (len, fan) => { const a = new Float64Array(len), s = Math.sqrt(2 / fan); for (let i = 0; i < len; i++) a[i] = randn() * s; return a; };
  const W1 = mk(d * H1, d), b1 = new Float64Array(H1), W2 = mk(H1 * H2, H1), b2 = new Float64Array(H2), W3 = mk(H2, H2), b3 = new Float64Array(1);
  const P = [W1, b1, W2, b2, W3, b3];
  const G = P.map(a => new Float64Array(a.length)), M1 = P.map(a => new Float64Array(a.length)), M2 = P.map(a => new Float64Array(a.length));
  const a1 = new Float64Array(H1), a2 = new Float64Array(H2), da1 = new Float64Array(H1), da2 = new Float64Array(H2);
  const order = Array.from({ length: n }, (_, i) => i);
  let step = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (let s0 = 0; s0 < n; s0 += bs) {
      const e0 = Math.min(n, s0 + bs), B = e0 - s0;
      G.forEach(g => g.fill(0));
      for (let t = s0; t < e0; t++) {
        const x = X[order[t]], yi = Y[order[t]];
        for (let j = 0; j < H1; j++) { let s = b1[j]; for (let k = 0; k < d; k++) s += x[k] * W1[k * H1 + j]; a1[j] = s > 0 ? s : 0; }
        for (let q = 0; q < H2; q++) { let s = b2[q]; for (let j = 0; j < H1; j++) s += a1[j] * W2[j * H2 + q]; a2[q] = s > 0 ? s : 0; }
        let z = b3[0];
        for (let q = 0; q < H2; q++) z += a2[q] * W3[q];
        const dz = (1 / (1 + Math.exp(-z)) - yi) / B;
        G[5][0] += dz;
        for (let q = 0; q < H2; q++) { G[4][q] += dz * a2[q]; da2[q] = a2[q] > 0 ? dz * W3[q] : 0; G[3][q] += da2[q]; }
        for (let j = 0; j < H1; j++) {
          let s = 0;
          for (let q = 0; q < H2; q++) { G[2][j * H2 + q] += a1[j] * da2[q]; s += da2[q] * W2[j * H2 + q]; }
          da1[j] = a1[j] > 0 ? s : 0; G[1][j] += da1[j];
        }
        for (let k = 0; k < d; k++) { const xk = x[k]; if (xk !== 0) for (let j = 0; j < H1; j++) G[0][k * H1 + j] += xk * da1[j]; }
      }
      step++;
      const c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
      for (let p = 0; p < P.length; p++) {
        const a = P[p], g = G[p], m1 = M1[p], m2 = M2[p], reg = (p === 0 || p === 2 || p === 4) ? l2 : 0;
        for (let i = 0; i < a.length; i++) {
          const gi = g[i] + reg * a[i];
          m1[i] = 0.9 * m1[i] + 0.1 * gi; m2[i] = 0.999 * m2[i] + 0.001 * gi * gi;
          a[i] -= lr * (m1[i] / c1) / (Math.sqrt(m2[i] / c2) + 1e-8);
        }
      }
    }
  }
  return { d, H1, H2, mean, sd, W1, b1, W2, b2, W3, b3 };
}

/* ---- cross-validated run: GBT first, then SMOTE+MLP; posts progress and results ---- */
function labRun(rows, fold, k, post) {
  const X = rows.map(r => [r.age, r.sex, ...r.f]), y = rows.map(r => r.y), n = rows.length;
  const wts = idx => {
    const np = idx.filter(i => y[i]).length, nn = idx.length - np;
    const wp = np ? idx.length / (2 * np) : 1, wn = nn ? idx.length / (2 * nn) : 1;
    return idx.map(i => y[i] ? wp : wn);
  };
  const all = Array.from({ length: n }, (_, i) => i);
  const split = f => { const tr = [], te = []; for (let i = 0; i < n; i++) (fold[i] === f ? te : tr).push(i); return { tr, te }; };

  const oofG = new Array(n);
  for (let f = 0; f < k; f++) {
    const { tr, te } = split(f);
    const g = gbtFit(tr.map(i => X[i]), tr.map(i => y[i]), wts(tr));
    te.forEach(i => { oofG[i] = gbtPredict(g, X[i]); });
    post({ type: 'progress', model: 'gbt', done: f + 1, of: k + 1 });
  }
  const gFull = gbtFit(X, all.map(i => y[i]), wts(all));
  post({ type: 'stage', model: 'gbt', oof: oofG, fit: gFull, imp: gFull.imp });
  post({ type: 'progress', model: 'gbt', done: k + 1, of: k + 1 });

  const oofM = new Array(n);
  for (let f = 0; f < k; f++) {
    const { tr, te } = split(f);
    const m = mlpTrain(tr.map(i => X[i]), tr.map(i => y[i]), mulberry32(1000 + f));
    te.forEach(i => { oofM[i] = mlpPredict(m, X[i]); });
    post({ type: 'progress', model: 'mlp', done: f + 1, of: k + 1 });
  }
  const mFull = mlpTrain(X, y, mulberry32(7));
  post({ type: 'stage', model: 'mlp', oof: oofM, fit: mFull });
  post({ type: 'progress', model: 'mlp', done: k + 1, of: k + 1 });
  post({ type: 'done' });
}

const LAB_FUNCS = [mulberry32, gbtTree, gbtPredict, gbtFit, smote, mlpPredict, mlpTrain, labRun];
function labWorkerSource() {
  return LAB_FUNCS.map(f => f.toString()).join('\n') + '\nonmessage = function (e) { var d = e.data; labRun(d.rows, d.fold, d.k, function (m) { postMessage(m); }); };';
}
