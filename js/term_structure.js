/**
 * ATM IV term structure.
 *
 * For each fitted SVI slice, ATM IV = √(w(0) / T), evaluated at log-moneyness
 * k = 0 (i.e. at the forward F, not the spot). We use the SVI fit, not a
 * linear interpolation of market mids, because the at-the-money mark is not
 * always on a listed strike (F sits between two strikes), and the fit gives
 * a smooth, mathematically consistent curve. See METHODOLOGY §5.
 *
 * @module term_structure
 */

import { sviIv } from "./svi.js";

/**
 * @typedef {object} TermPoint
 * @property {number} expirationMs
 * @property {number} dte           days to expiry
 * @property {number} T             years
 * @property {number} forward
 * @property {number} atmIv
 */

/**
 * Build the ATM IV term structure from fitted slices.
 *
 * @param {Array<import("./plots/iv_surface.js").ExpirySlice>} slices
 * @param {number} nowMs
 * @returns {Array<TermPoint>}  sorted ascending by expiry
 */
export function atmTermStructure(slices, nowMs) {
  /** @type {TermPoint[]} */
  const out = [];
  for (const s of slices) {
    if (!s.svi) continue;
    const atm = sviIv(0, s.svi, s.T);
    if (!Number.isFinite(atm)) continue;
    out.push({
      expirationMs: s.expirationMs,
      dte: (s.expirationMs - nowMs) / (86400 * 1000),
      T: s.T,
      forward: s.forward,
      atmIv: atm,
    });
  }
  return out.sort((a, b) => a.expirationMs - b.expirationMs);
}
