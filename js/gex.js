/**
 * Dealer Gamma Exposure (GEX).
 *
 * Per-option contribution:
 *   GEX_i = Γ_i · OI_i · contractSize · S² · 0.01 · ε_i
 * where ε_i = +1 for calls, −1 for puts (SqueezeMetrics canonical sign:
 * dealers net-short calls, net-long puts). The S² · 0.01 factor converts
 * Γ (dollar-gamma per share per dollar move) to the conventional GEX unit:
 * dollar gamma per 1% spot move.
 *
 * Aggregation: sum across all live options at each strike, regardless of
 * expiry. Zero-gamma flip: scan hypothetical spots over ±20% in 0.5% steps
 * and find the sign change in cumulative GEX.
 *
 * SqueezeMetrics caveat for Deribit: the dealer-positioning assumption is
 * derived from SPX flow circa 2015–17 and is more brittle on a venue with
 * significant prop / retail flow. See METHODOLOGY §3.3.
 *
 * @module gex
 */

import { bsGamma, yearsToExpiry } from "./black_scholes.js";

const DEFAULT_CONTRACT_SIZE = 1;
const FLIP_SCAN_RANGE = 0.20;
// 1% steps → 41 scan points across ±20%. Was 0.5%/81 points; the flip
// resolution is bottlenecked by the linear interp in findZeroGammaFlip
// anyway, not by the grid spacing — so this halves CPU per tick at no
// visual cost.
const FLIP_SCAN_STEP = 0.01;

/**
 * @typedef {object} OptionRow
 * @property {string} instrument_name
 * @property {number} strike
 * @property {"call"|"put"} option_type
 * @property {number} expiration_ms     expiration_timestamp in milliseconds
 * @property {number} oi                open_interest, contracts
 * @property {number} markIv            mark_iv as decimal (Deribit returns %; caller must /100)
 * @property {number} [contractSize]    defaults to 1 for BTC options
 */

/**
 * Join /get_instruments and /get_book_summary_by_currency rows by
 * instrument_name into the OptionRow shape used by the GEX functions. Drops
 * rows with non-positive OI, missing mark_iv, or expired (T <= 0).
 *
 * @param {Array<object>} instruments  from getInstruments()
 * @param {Array<object>} book          from getBookSummary()
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<OptionRow>}
 */
export function joinInstrumentsAndBook(instruments, book, nowMs = Date.now()) {
  const byName = new Map(book.map((b) => [b.instrument_name, b]));
  /** @type {Array<OptionRow>} */
  const out = [];
  for (const inst of instruments) {
    const b = byName.get(inst.instrument_name);
    if (!b) continue;
    if (!Number.isFinite(b.open_interest) || b.open_interest <= 0) continue;
    if (!Number.isFinite(b.mark_iv) || b.mark_iv <= 0) continue;
    if (inst.expiration_timestamp <= nowMs) continue;
    out.push({
      instrument_name: inst.instrument_name,
      strike: inst.strike,
      option_type: inst.option_type,
      expiration_ms: inst.expiration_timestamp,
      oi: b.open_interest,
      markIv: b.mark_iv / 100,
      contractSize: inst.contract_size ?? DEFAULT_CONTRACT_SIZE,
    });
  }
  return out;
}

/**
 * Per-option GEX contribution at a given spot. Uses the SqueezeMetrics sign
 * (+calls, −puts).
 *
 * @param {OptionRow} opt
 * @param {number} spot
 * @param {number} [nowMs=Date.now()]
 * @returns {number}  GEX contribution (NaN if BS inputs invalid)
 */
export function perOptionGex(opt, spot, nowMs = Date.now()) {
  const T = yearsToExpiry(opt.expiration_ms, nowMs);
  if (T <= 0) return 0;
  const gamma = bsGamma(spot, opt.strike, T, opt.markIv);
  if (!Number.isFinite(gamma)) return 0;
  const sign = opt.option_type === "call" ? 1 : -1;
  const cs = opt.contractSize ?? DEFAULT_CONTRACT_SIZE;
  return sign * gamma * opt.oi * cs * spot * spot * 0.01;
}

/**
 * Aggregate GEX by strike across all expiries at a given spot.
 *
 * @param {Array<OptionRow>} options
 * @param {number} spot
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<{strike: number, gex: number, callGex: number, putGex: number}>}
 *   sorted ascending by strike
 */
export function gexByStrike(options, spot, nowMs = Date.now()) {
  /** @type {Map<number, {call: number, put: number}>} */
  const m = new Map();
  for (const opt of options) {
    const c = m.get(opt.strike) ?? { call: 0, put: 0 };
    const contrib = perOptionGex(opt, spot, nowMs);
    if (opt.option_type === "call") c.call += contrib;
    else c.put += contrib;
    m.set(opt.strike, c);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a - b)
    .map(([strike, v]) => ({
      strike,
      gex: v.call + v.put,
      callGex: v.call,
      putGex: v.put,
    }));
}

/**
 * Total GEX summed across all strikes and options at a given hypothetical spot.
 *
 * @param {Array<OptionRow>} options
 * @param {number} spot
 * @param {number} [nowMs=Date.now()]
 * @returns {number}
 */
export function totalGex(options, spot, nowMs = Date.now()) {
  let s = 0;
  for (const opt of options) s += perOptionGex(opt, spot, nowMs);
  return s;
}

/**
 * Total GEX as a function of hypothetical spot. Scans baselineSpot × (1 ± range)
 * in step increments. Used to draw the curve and locate the zero-gamma flip.
 *
 * @param {Array<OptionRow>} options
 * @param {number} baselineSpot
 * @param {number} [range=0.20]
 * @param {number} [step=0.005]
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<{spot: number, gex: number}>}
 */
export function gexCurve(options, baselineSpot, range = FLIP_SCAN_RANGE, step = FLIP_SCAN_STEP, nowMs = Date.now()) {
  /** @type {Array<{spot: number, gex: number}>} */
  const out = [];
  // Inclusive endpoints; +1e-9 prevents floating-point endpoint drift
  for (let f = -range; f <= range + 1e-9; f += step) {
    const spot = baselineSpot * (1 + f);
    out.push({ spot, gex: totalGex(options, spot, nowMs) });
  }
  return out;
}

/**
 * Find the zero-gamma flip level by locating the first sign change in the
 * curve and linearly interpolating between the bracketing points. Returns
 * null if no sign change is found in the scan range (rare — usually means
 * the dealer book is one-sided and you should widen the scan).
 *
 * @param {Array<{spot: number, gex: number}>} curve
 * @returns {number | null}
 */
export function findZeroGammaFlip(curve) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (a.gex === 0) return a.spot;
    if (b.gex === 0) return b.spot;
    if (Math.sign(a.gex) !== Math.sign(b.gex)) {
      // linear interpolation: spot at which GEX = 0
      const t = -a.gex / (b.gex - a.gex);
      return a.spot + t * (b.spot - a.spot);
    }
  }
  return null;
}

/**
 * Aggregate stats for the dashboard's context strip.
 *
 * @param {Array<OptionRow>} options
 * @returns {{callOi: number, putOi: number, putCallRatioOi: number, totalOi: number, totalCount: number}}
 */
export function oiStats(options) {
  let callOi = 0, putOi = 0;
  for (const opt of options) {
    if (opt.option_type === "call") callOi += opt.oi;
    else putOi += opt.oi;
  }
  return {
    callOi,
    putOi,
    totalOi: callOi + putOi,
    putCallRatioOi: callOi > 0 ? putOi / callOi : NaN,
    totalCount: options.length,
  };
}
