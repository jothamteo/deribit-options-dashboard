/**
 * Per-expiry forward price extraction.
 *
 * For each option expiry timestamp, we want the forward F used in
 * k = ln(K / F). Deribit lists futures alongside options; the most accurate
 * forward for a 28-Jun expiry is the mark price of BTC-28JUN26. When an
 * option expiry doesn't match any listed future exactly, we linearly
 * interpolate the futures curve in time.
 *
 * Why this matters: using spot S in place of F shifts every smile
 * horizontally by ln(F/S) — the basis. The shift is smooth in T, so within
 * a single expiry the smile shape is unchanged. But across expiries, mixing
 * spot-based and forward-based moneyness contaminates term-structure
 * comparisons (slope, ATM IV, skew).
 *
 * @module forwards
 */

/**
 * @typedef {object} FuturePoint
 * @property {number} expirationMs
 * @property {number} forward
 */

/**
 * Build a sorted forward curve from Deribit futures instruments + book
 * summary. Skips perpetuals (no expiry) and rows with non-positive mark.
 *
 * @param {Array<object>} futureInstruments
 * @param {Array<object>} futureBook
 * @returns {Array<FuturePoint>}
 */
export function buildForwardCurve(futureInstruments, futureBook) {
  const byName = new Map(futureBook.map((b) => [b.instrument_name, b]));
  /** @type {FuturePoint[]} */
  const points = [];
  for (const inst of futureInstruments) {
    if (inst.settlement_period === "perpetual") continue;
    if (!Number.isFinite(inst.expiration_timestamp)) continue;
    const b = byName.get(inst.instrument_name);
    if (!b) continue;
    const mark = b.mark_price;
    if (!Number.isFinite(mark) || mark <= 0) continue;
    points.push({ expirationMs: inst.expiration_timestamp, forward: mark });
  }
  points.sort((a, b) => a.expirationMs - b.expirationMs);
  return points;
}

/**
 * Forward at an arbitrary expiry timestamp. Exact match returns that
 * future's mark; otherwise linearly interpolates between the bracketing
 * points. Outside the curve range, extrapolates from the nearest endpoint
 * (flat — preferable to hallucinating a slope from two distant points).
 *
 * @param {Array<FuturePoint>} curve
 * @param {number} expiryMs
 * @param {number} [spotFallback]  if provided, returned when curve is empty
 * @returns {number}  NaN if no curve and no fallback
 */
export function forwardAt(curve, expiryMs, spotFallback) {
  if (curve.length === 0) return Number.isFinite(spotFallback) ? spotFallback : NaN;
  if (curve.length === 1) return curve[0].forward;

  if (expiryMs <= curve[0].expirationMs) return curve[0].forward;
  if (expiryMs >= curve[curve.length - 1].expirationMs) return curve[curve.length - 1].forward;

  // Binary search the bracketing pair
  let lo = 0, hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].expirationMs <= expiryMs) lo = mid;
    else hi = mid;
  }
  const a = curve[lo], b = curve[hi];
  if (a.expirationMs === expiryMs) return a.forward;
  const t = (expiryMs - a.expirationMs) / (b.expirationMs - a.expirationMs);
  return a.forward + t * (b.forward - a.forward);
}
