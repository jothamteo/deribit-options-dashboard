/**
 * 25Δ Risk-Reversal and Butterfly term structures.
 *
 * For each expiry:
 *   1. Compute spot delta for every option (BS, r=q=0)
 *   2. Find the put with |Δ + 0.25| minimal
 *   3. Find the call with |Δ − 0.25| minimal
 *   4. RR = IV_25c − IV_25p
 *   5. BF = (IV_25c + IV_25p)/2 − IV_ATM
 *
 * IV_ATM comes from the SVI fit at k = 0, not a market-mid interpolation
 * (consistent with the term-structure module).
 *
 * Convention note: by industry convention, "25Δ put" means the put whose
 * absolute delta is 0.25 (so signed Δ = −0.25). We use the absolute value
 * when matching. Spot delta — not forward delta — to keep the convention
 * standard. See METHODOLOGY §6.
 *
 * @module skew
 */

import { bsDelta } from "./black_scholes.js";
import { sviIv } from "./svi.js";

/**
 * @typedef {object} SkewPoint
 * @property {number} expirationMs
 * @property {number} dte
 * @property {number} T
 * @property {number} forward
 * @property {number} atmIv
 * @property {number} ivCall25
 * @property {number} ivPut25
 * @property {number} deltaCall   actual delta of the matched 25Δ call (sanity)
 * @property {number} deltaPut    actual delta of the matched 25Δ put
 * @property {number} rr          IV_25c − IV_25p  (in vol points, decimal)
 * @property {number} bf          (IV_25c + IV_25p)/2 − IV_ATM
 */

/**
 * Build the 25Δ skew term structure from fitted slices. Skips slices where
 * we can't find a put with |Δ| ≥ 0.10 and a call with Δ ≥ 0.10 — this
 * happens for very-short-dated expiries or thin strike grids.
 *
 * @param {Array<import("./plots/iv_surface.js").ExpirySlice>} slices
 * @param {number} spot
 * @param {number} nowMs
 * @returns {Array<SkewPoint>}
 */
export function skewTermStructure(slices, spot, nowMs) {
  /** @type {SkewPoint[]} */
  const out = [];
  for (const s of slices) {
    if (!s.svi) continue;
    const atmIv = sviIv(0, s.svi, s.T);
    if (!Number.isFinite(atmIv)) continue;

    let bestCall = null, bestCallErr = Infinity;
    let bestPut = null, bestPutErr = Infinity;

    for (const p of s.points) {
      const delta = bsDelta(spot, p.strike, s.T, p.iv, p.type);
      if (!Number.isFinite(delta)) continue;
      if (p.type === "call") {
        const err = Math.abs(delta - 0.25);
        if (err < bestCallErr) { bestCallErr = err; bestCall = { delta, iv: p.iv, strike: p.strike }; }
      } else {
        const err = Math.abs(delta - (-0.25));
        if (err < bestPutErr) { bestPutErr = err; bestPut = { delta, iv: p.iv, strike: p.strike }; }
      }
    }
    if (!bestCall || !bestPut) continue;
    // Reject if the best match is too far — implies the strike grid is too
    // sparse to credibly speak about a 25Δ point. Threshold of 0.15 means we
    // accept anything in [10Δ, 40Δ] range as "close enough" to call 25Δ.
    if (bestCallErr > 0.15 || bestPutErr > 0.15) continue;

    const rr = bestCall.iv - bestPut.iv;
    const bf = (bestCall.iv + bestPut.iv) / 2 - atmIv;

    out.push({
      expirationMs: s.expirationMs,
      dte: (s.expirationMs - nowMs) / (86400 * 1000),
      T: s.T,
      forward: s.forward,
      atmIv,
      ivCall25: bestCall.iv,
      ivPut25: bestPut.iv,
      deltaCall: bestCall.delta,
      deltaPut: bestPut.delta,
      rr,
      bf,
    });
  }
  return out.sort((a, b) => a.expirationMs - b.expirationMs);
}
