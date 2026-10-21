/* ML engine. Pure functions only, so the whole factory can be stringified into a Web Worker
   (or run on the main thread as a fallback). Models are plain data, safe to postMessage. */
function makeML(NF) {
  'use strict';
  const D = NF + 2;                       // inputs: age (z-scored), sex, NF binary factors
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sig = z => 1 / (1 + Math.exp(-z));
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function ageStats(rows) {
    const ages = rows.map(r => r.age), mean = avg(ages);
    return { mean, sd: Math.sqrt(avg(ages.map(a => (a - mean) ** 2))) || 1 };
  }
  const vec = (r, m) => { const v = new Array(D); v[0] = (r.age - m.mean) / m.sd; v[1] = r.sex; for (let i = 0; i < NF; i++) v[2 + i] = r.f[i]; return v; };
  function balW(y) {
    const n = y.length, np = y.reduce((a, b) => a + b, 0), nn = n - np;
    const wp = np ? n / (2 * np) : 1, wn = nn ? n / (2 * nn) : 1;
    return y.map(v => v ? wp : wn);
  }

  /* ---- 1. LightGBM-style gradient-boosted trees (logistic loss, Newton leaves, balanced weights) ---- */
  function fitGBM(rows, o = {}) {
    const rounds = o.rounds || 80, lr = o.lr || 0.1, maxD = o.depth || 3, minLeaf = o.minLeaf || 5, lam = 1;
    const m = ageStats(rows), X = rows.map(r => vec(r, m)), y = rows.map(r => r.y), n = rows.length, w = balW(y);
    const F = new Float64Array(n), g = new Float64Array(n), h = new Float64Array(n), imp = new Float64Array(D), trees = [];
    const all = Array.from({ length: n }, (_, i) => i);
    function build(idx, depth) {
      let G = 0, H = 0;
      for (const i of idx) { G += g[i]; H += h[i]; }
      const leaf = { v: -G / (H + lam) };
      if (depth >= maxD || idx.length < 2 * minLeaf) return leaf;
      const parent = G * G / (H + lam);
      let best = { gain: 1e-6 };
      for (let j = 1; j < D; j++) {
        let GL = 0, HL = 0, nL = 0;
        for (const i of idx) if (X[i][j] <= 0.5) { GL += g[i]; HL += h[i]; nL++; }
        const nR = idx.length - nL;
        if (nL < minLeaf || nR < minLeaf) continue;
        const gain = GL * GL / (HL + lam) + (G - GL) * (G - GL) / (H - HL + lam) - parent;
        if (gain > best.gain) best = { gain, j, t: 0.5 };
      }
      const s = idx.slice().sort((a, b) => X[a][0] - X[b][0]);
      let GL = 0, HL = 0;
      for (let k = 0; k < s.length - 1; k++) {
        GL += g[s[k]]; HL += h[s[k]];
        const nL = k + 1, nR = s.length - nL;
        if (nL < minLeaf || nR < minLeaf || X[s[k]][0] === X[s[k + 1]][0]) continue;
        const gain = GL * GL / (HL + lam) + (G - GL) * (G - GL) / (H - HL + lam) - parent;
        if (gain > best.gain) best = { gain, j: 0, t: (X[s[k]][0] + X[s[k + 1]][0]) / 2 };
      }
      if (best.j === undefined) return leaf;
      imp[best.j] += best.gain;
      const L = [], R = [];
      for (const i of idx) (X[i][best.j] <= best.t ? L : R).push(i);
      return { j: best.j, t: best.t, l: build(L, depth + 1), r: build(R, depth + 1) };
    }
    const walk = (node, x) => { while (node.l) node = x[node.j] <= node.t ? node.l : node.r; return node.v; };
    for (let t = 0; t < rounds; t++) {
      for (let i = 0; i < n; i++) { const p = sig(F[i]); g[i] = w[i] * (p - y[i]); h[i] = Math.max(1e-6, w[i] * p * (1 - p)); }
      const tree = build(all, 0);
      trees.push(tree);
      for (let i = 0; i < n; i++) F[i] += lr * walk(tree, X[i]);
    }
    return { type: 'gbm', mean: m.mean, sd: m.sd, lr, trees, imp: Array.from(imp) };
  }
  function predGBM(m, r) {
    const x = vec(r, m); let z = 0;
    for (const t of m.trees) { let node = t; while (node.l) node = x[node.j] <= node.t ? node.l : node.r; z += m.lr * node.v; }
    return sig(z);
  }

  /* ---- 2. K-Means SMOTE + MLP (64-32, ReLU, Adam) ---- */
  const dist2 = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += (a[d] - b[d]) ** 2; return s; };
  function kmeans(X, k, rnd, iters = 40) {
    const n = X.length, dim = X[0].length; k = Math.min(k, n);
    const C = [], used = new Set();
    while (C.length < k) { const i = Math.floor(rnd() * n); if (!used.has(i)) { used.add(i); C.push(X[i].slice()); } }
    const lab = new Int32Array(n).fill(-1);
    for (let it = 0; it < iters; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const d = dist2(X[i], C[c]); if (d < bd) { bd = d; best = c; } }
        if (lab[i] !== best) { lab[i] = best; changed = true; }
      }
      if (!changed) break;
      const sum = Array.from({ length: k }, () => new Array(dim).fill(0)), cnt = new Array(k).fill(0);
      for (let i = 0; i < n; i++) { cnt[lab[i]]++; for (let d = 0; d < dim; d++) sum[lab[i]][d] += X[i][d]; }
      for (let c = 0; c < k; c++) if (cnt[c]) for (let d = 0; d < dim; d++) C[c][d] = sum[c][d] / cnt[c];
    }
    return lab;
  }
  // SMOTE inside one group of minority points: interpolate towards one of the kn nearest neighbours.
  function smoteWithin(pts, count, rnd, kn) {
    const out = [];
    if (pts.length < 2) return out;
    const k = Math.min(kn, pts.length - 1);
    const nb = pts.map((p, i) => pts.map((q, j) => [dist2(p, q), j]).filter(x => x[1] !== i).sort((a, b) => a[0] - b[0]).slice(0, k).map(x => x[1]));
    for (let s = 0; s < count; s++) {
      const i = Math.floor(rnd() * pts.length), j = nb[i][Math.floor(rnd() * k)], t = rnd();
      out.push(pts[i].map((v, d) => v + t * (pts[j][d] - v)));
    }
    return out;
  }
  // K-Means SMOTE: cluster everything, keep clusters that contain enough minority points,
  // give sparser clusters more synthetic samples, then SMOTE inside each chosen cluster.
  function kmeansSmote(X, y, rnd, o = {}) {
    const clusters = o.clusters || 8, kn = o.kNeighbors || 2;
    const n1 = y.reduce((a, b) => a + b, 0), n0 = y.length - n1, cls = n1 < n0 ? 1 : 0, need = Math.abs(n1 - n0);
    if (!need) return { X, y };
    const lab = kmeans(X, clusters, rnd), groups = [];
    for (let c = 0; c < clusters; c++) {
      const pts = []; for (let i = 0; i < X.length; i++) if (lab[i] === c && y[i] === cls) pts.push(X[i]);
      if (pts.length <= kn) continue;                       // too few minority points to interpolate
      let tot = 0, m = 0;
      for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) if (i !== j) { tot += Math.sqrt(dist2(pts[i], pts[j])); m++; }
      const avgD = tot / m;
      groups.push({ pts, sparsity: Math.pow(avgD, X[0].length) / pts.length });
    }
    let synth = [];
    if (groups.length) {
      const sumSp = groups.reduce((a, g) => a + g.sparsity, 0);
      let left = need;
      groups.forEach((g, i) => {
        const cnt = i === groups.length - 1 ? left : Math.min(left, Math.round(need * g.sparsity / sumSp));
        left -= cnt; synth = synth.concat(smoteWithin(g.pts, cnt, rnd, kn));
      });
    } else {                                                // fallback: plain SMOTE over all minority points
      const pts = []; for (let i = 0; i < X.length; i++) if (y[i] === cls) pts.push(X[i]);
      synth = smoteWithin(pts, need, rnd, 5);
    }
    return { X: X.concat(synth), y: y.concat(synth.map(() => cls)) };
  }
  function fitMLP(rows, o = {}) {
    const h1 = o.h1 || 64, h2 = o.h2 || 32, epochs = o.epochs || 200, lr = o.lr || 0.004, bs = 32, alpha = 1e-4;
    const rnd = mulberry(o.seed || 7);
    const m = ageStats(rows);
    let X = rows.map(r => vec(r, m)), y = rows.map(r => r.y);
    ({ X, y } = kmeansSmote(X, y, rnd));
    const n = X.length;
    const randn = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const init = (len, sc) => { const a = new Float64Array(len); for (let i = 0; i < len; i++) a[i] = randn() * sc; return a; };
    const P = { W1: init(h1 * D, Math.sqrt(2 / D)), b1: new Float64Array(h1), W2: init(h2 * h1, Math.sqrt(2 / h1)), b2: new Float64Array(h2), W3: init(h2, Math.sqrt(2 / h2)), b3: new Float64Array(1) };
    const keys = Object.keys(P), G = {}, M = {}, V = {};
    keys.forEach(k => { G[k] = new Float64Array(P[k].length); M[k] = new Float64Array(P[k].length); V[k] = new Float64Array(P[k].length); });
    const a1 = new Float64Array(h1), a2 = new Float64Array(h2), d2 = new Float64Array(h2), d1 = new Float64Array(h1);
    const order = Array.from({ length: n }, (_, i) => i);
    let step = 0;
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      for (let b = 0; b < n; b += bs) {
        const end = Math.min(n, b + bs), cnt = end - b;
        keys.forEach(k => G[k].fill(0));
        for (let q = b; q < end; q++) {
          const idx = order[q], x = X[idx];
          for (let j = 0; j < h1; j++) { let s = P.b1[j]; const off = j * D; for (let k = 0; k < D; k++) s += P.W1[off + k] * x[k]; a1[j] = s > 0 ? s : 0; }
          for (let i2 = 0; i2 < h2; i2++) { let s = P.b2[i2]; const off = i2 * h1; for (let j = 0; j < h1; j++) s += P.W2[off + j] * a1[j]; a2[i2] = s > 0 ? s : 0; }
          let z = P.b3[0]; for (let i2 = 0; i2 < h2; i2++) z += P.W3[i2] * a2[i2];
          const dz = sig(z) - y[idx];
          G.b3[0] += dz;
          for (let i2 = 0; i2 < h2; i2++) { G.W3[i2] += dz * a2[i2]; d2[i2] = a2[i2] > 0 ? dz * P.W3[i2] : 0; }
          d1.fill(0);
          for (let i2 = 0; i2 < h2; i2++) {
            const dd = d2[i2]; if (!dd) continue;
            G.b2[i2] += dd; const off = i2 * h1;
            for (let j = 0; j < h1; j++) { G.W2[off + j] += dd * a1[j]; d1[j] += dd * P.W2[off + j]; }
          }
          for (let j = 0; j < h1; j++) {
            const dd = a1[j] > 0 ? d1[j] : 0; if (!dd) continue;
            G.b1[j] += dd; const off = j * D;
            for (let k = 0; k < D; k++) G.W1[off + k] += dd * x[k];
          }
        }
        step++;
        const c1 = 1 - Math.pow(0.9, step), c2 = 1 - Math.pow(0.999, step);
        for (const k of keys) {
          const p = P[k], gg = G[k], mm = M[k], vv = V[k], reg = k[0] === 'W' ? alpha : 0;
          for (let t = 0; t < p.length; t++) {
            const gr = gg[t] / cnt + reg * p[t];
            mm[t] = 0.9 * mm[t] + 0.1 * gr; vv[t] = 0.999 * vv[t] + 0.001 * gr * gr;
            p[t] -= lr * (mm[t] / c1) / (Math.sqrt(vv[t] / c2) + 1e-8);
          }
        }
      }
    }
    return { type: 'mlp', mean: m.mean, sd: m.sd, h1, h2, P };
  }
  function predMLP(m, r) {
    const x = vec(r, m), { h1, h2, P } = m;
    const a1 = new Float64Array(h1), a2 = new Float64Array(h2);
    for (let j = 0; j < h1; j++) { let s = P.b1[j]; const off = j * D; for (let k = 0; k < D; k++) s += P.W1[off + k] * x[k]; a1[j] = s > 0 ? s : 0; }
    for (let i = 0; i < h2; i++) { let s = P.b2[i]; const off = i * h1; for (let j = 0; j < h1; j++) s += P.W2[off + j] * a1[j]; a2[i] = s > 0 ? s : 0; }
    let z = P.b3[0]; for (let i = 0; i < h2; i++) z += P.W3[i] * a2[i];
    return sig(z);
  }

  function predict(m, r) { return m.type === 'gbm' ? predGBM(m, r) : predMLP(m, r); }

  /* fit the final models (no cross-validation needed any more) */
  const FIT = { gbm: r => fitGBM(r), mlp: r => fitMLP(r) };
  function trainAll(rows, progress, only) {
    const out = { models: {} };
    for (const key of (only || ['gbm', 'mlp'])) { out.models[key] = FIT[key](rows); if (progress) progress({ key }); }
    return out;
  }
  // cross-validation helper, used only by the offline test script
  function cvScores(rows, key, k = 5) {
    const rnd = mulberry(42), fold = new Array(rows.length);
    [1, 0].forEach(cls => { const ids = []; rows.forEach((r, i) => { if (r.y === cls) ids.push(i); }); for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } ids.forEach((id, n) => { fold[id] = n % k; }); });
    const oof = new Array(rows.length);
    for (let f = 0; f < k; f++) { const m = FIT[key](rows.filter((_, i) => fold[i] !== f)); rows.forEach((r, i) => { if (fold[i] === f) oof[i] = predict(m, r); }); }
    return oof;
  }
  return { predict, trainAll, cvScores };
}
