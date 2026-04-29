/**
 * SVI volatility surface fit (Gatheral 2004 raw parameterization).
 *
 *   w(k) = a + b · (ρ · (k − m) + √((k − m)² + σ²))
 *
 * where w(k) is total variance (= IV² · T) at log-moneyness k = ln(K / F).
 *
 * Five parameters per expiry: {a, b, ρ, m, σ}. We fit by least squares on
 * total variance (not IV — variance is the natural quantity for SVI; fitting
 * in IV space biases short-dated tails). No-arb constraints are enforced via
 * soft-penalty terms in the objective:
 *
 *   b ≥ 0,    |ρ| < 1,    σ > 0,    a + b·σ·√(1 − ρ²) ≥ 0
 *
 * The optimizer is Nelder-Mead (downhill simplex) hand-rolled below. We
 * deliberately avoid scipy, scipy-via-pyodide, fmin libraries, etc., to keep
 * the dashboard pure-browser and zero-dep.
 *
 * Reference: Gatheral, J. (2004), _A parsimonious arbitrage-free implied
 * volatility parameterization with application to the valuation of volatility
 * derivatives_.
 *
 * @module svi
 */

const PENALTY_WEIGHT = 1e6;

/**
 * @typedef {object} SviParams
 * @property {number} a
 * @property {number} b
 * @property {number} rho
 * @property {number} m
 * @property {number} sigma
 */

/**
 * Total variance w(k) = a + b·(ρ·(k−m) + √((k−m)² + σ²))
 *
 * @param {number} k
 * @param {SviParams} p
 * @returns {number}
 */
export function svi(k, p) {
  const dk = k - p.m;
  return p.a + p.b * (p.rho * dk + Math.sqrt(dk * dk + p.sigma * p.sigma));
}

/**
 * Implied vol at log-moneyness k for a given expiry T.
 * IV(k) = √(w(k) / T). Returns NaN if w(k) ≤ 0 (shouldn't happen on a
 * properly-fitted SVI, but the no-arb penalty is soft so guard anyway).
 *
 * @param {number} k
 * @param {SviParams} p
 * @param {number} T  years
 * @returns {number}
 */
export function sviIv(k, p, T) {
  const w = svi(k, p);
  return w > 0 && T > 0 ? Math.sqrt(w / T) : NaN;
}

/**
 * Sum of squared residuals on total variance, plus no-arb penalty.
 *
 * @param {SviParams} p
 * @param {Array<{k: number, w: number}>} pts
 * @returns {number}
 */
function lossWithPenalty(p, pts) {
  let sse = 0;
  for (const pt of pts) {
    const r = svi(pt.k, p) - pt.w;
    sse += r * r;
  }
  // Soft constraints — squared violations
  const pen =
    Math.max(0, -p.b) ** 2 +
    Math.max(0, Math.abs(p.rho) - 0.999) ** 2 +
    Math.max(0, 1e-6 - p.sigma) ** 2 +
    Math.max(0, -(p.a + p.b * p.sigma * Math.sqrt(1 - p.rho * p.rho))) ** 2;
  return sse + PENALTY_WEIGHT * pen;
}

/**
 * Heuristic seed: the market sample's argmin sets m, the min variance sets a,
 * a rough slope sets b, ρ defaults to a slight smirk (-0.3), σ to 0.1. This
 * gives Nelder-Mead a sane start point — without it the simplex wanders and
 * the fit becomes non-deterministic.
 *
 * @param {Array<{k: number, w: number}>} pts
 * @returns {SviParams}
 */
function seed(pts) {
  const sorted = [...pts].sort((a, b) => a.w - b.w);
  const minPt = sorted[0];
  const maxPt = sorted[sorted.length - 1];
  const a = Math.max(1e-6, minPt.w * 0.9);
  const b = Math.max(0.01, (maxPt.w - minPt.w) / Math.max(1e-3, Math.abs(maxPt.k - minPt.k)));
  return { a, b, rho: -0.3, m: minPt.k, sigma: 0.1 };
}

/**
 * Fit raw SVI to a set of (k, w) points. Returns the fitted parameters plus
 * fit diagnostics (RMSE on w, max abs residual, iteration count). The caller
 * should surface RMSE / max-resid in the UI so a wide fit is visually
 * obvious.
 *
 * @param {Array<{k: number, w: number}>} pts  must have length ≥ 5
 * @param {object} [opts]
 * @param {SviParams} [opts.initial]
 * @param {number} [opts.maxIter=2000]
 * @param {number} [opts.tol=1e-10]
 * @returns {{params: SviParams, rmse: number, maxResid: number, iter: number, converged: boolean}}
 */
export function fitSvi(pts, opts = {}) {
  const { maxIter = 2000, tol = 1e-10 } = opts;
  if (pts.length < 5) {
    return {
      params: { a: NaN, b: NaN, rho: NaN, m: NaN, sigma: NaN },
      rmse: NaN, maxResid: NaN, iter: 0, converged: false,
    };
  }
  const start = opts.initial ?? seed(pts);

  // Pack {a, b, rho, m, sigma} → vec5
  const x0 = [start.a, start.b, start.rho, start.m, start.sigma];
  const fn = (x) => lossWithPenalty(unpack(x), pts);
  const result = nelderMead(x0, fn, { maxIter, tol });
  const params = unpack(result.x);

  // Diagnostics computed without penalty (so RMSE reflects real fit quality)
  let sse = 0, maxResid = 0;
  for (const pt of pts) {
    const r = Math.abs(svi(pt.k, params) - pt.w);
    sse += r * r;
    if (r > maxResid) maxResid = r;
  }
  const rmse = Math.sqrt(sse / pts.length);

  return { params, rmse, maxResid, iter: result.iter, converged: result.converged };
}

/**
 * @param {number[]} x
 * @returns {SviParams}
 */
function unpack(x) {
  return { a: x[0], b: x[1], rho: x[2], m: x[3], sigma: x[4] };
}

// ─── Nelder-Mead (downhill simplex) ───────────────────────────────────────

/**
 * Nelder-Mead simplex method, hand-rolled. Coefficients per Nelder & Mead
 * (1965): reflection α=1, expansion γ=2, contraction β=0.5, shrink σ=0.5.
 *
 * @param {number[]} x0       initial point, length n
 * @param {(x: number[]) => number} f
 * @param {{maxIter?: number, tol?: number, simplexInitStep?: number}} opts
 * @returns {{x: number[], fx: number, iter: number, converged: boolean}}
 */
export function nelderMead(x0, f, opts = {}) {
  const { maxIter = 2000, tol = 1e-10, simplexInitStep = 0.05 } = opts;
  const n = x0.length;

  // Build initial simplex: x0 plus n perturbed copies (one per axis)
  const simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const xi = x0.slice();
    xi[i] = xi[i] === 0 ? simplexInitStep : xi[i] * (1 + simplexInitStep);
    simplex.push(xi);
  }
  /** @type {number[]} */
  let fvals = simplex.map(f);

  let iter = 0;
  for (; iter < maxIter; iter++) {
    // Sort by fvalue ascending — best first
    const order = fvals.map((_, i) => i).sort((a, b) => fvals[a] - fvals[b]);
    const sortedSimplex = order.map((i) => simplex[i]);
    const sortedF = order.map((i) => fvals[i]);
    for (let i = 0; i < simplex.length; i++) {
      simplex[i] = sortedSimplex[i];
      fvals[i] = sortedF[i];
    }

    // Convergence: spread of f-values
    const fmin = fvals[0], fmax = fvals[n];
    if (Math.abs(fmax - fmin) < tol) {
      return { x: simplex[0], fx: fvals[0], iter, converged: true };
    }

    // Centroid of best n points (exclude worst)
    const xbar = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) xbar[j] += simplex[i][j];
    }
    for (let j = 0; j < n; j++) xbar[j] /= n;

    const xworst = simplex[n];
    const fworst = fvals[n];
    const fbest = fvals[0];
    const fSecondWorst = fvals[n - 1];

    // Reflection: x_r = xbar + 1·(xbar − xworst)
    const xr = xbar.map((v, j) => v + (v - xworst[j]));
    const fr = f(xr);

    if (fr < fbest) {
      // Expansion
      const xe = xbar.map((v, j) => v + 2 * (v - xworst[j]));
      const fe = f(xe);
      if (fe < fr) {
        simplex[n] = xe; fvals[n] = fe;
      } else {
        simplex[n] = xr; fvals[n] = fr;
      }
    } else if (fr < fSecondWorst) {
      simplex[n] = xr; fvals[n] = fr;
    } else {
      // Contraction
      let xc, fc;
      if (fr < fworst) {
        // outside contraction
        xc = xbar.map((v, j) => v + 0.5 * (v - xworst[j]));
      } else {
        // inside contraction
        xc = xbar.map((v, j) => v - 0.5 * (v - xworst[j]));
      }
      fc = f(xc);
      if (fc < Math.min(fr, fworst)) {
        simplex[n] = xc; fvals[n] = fc;
      } else {
        // Shrink: x_i ← xbest + 0.5 (x_i − xbest)
        const xbest = simplex[0];
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => xbest[j] + 0.5 * (v - xbest[j]));
          fvals[i] = f(simplex[i]);
        }
      }
    }
  }
  return { x: simplex[0], fx: fvals[0], iter, converged: false };
}
