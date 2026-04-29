/**
 * Max-pain calculation per expiry.
 *
 * For each candidate underlying price S* at expiry:
 *
 *   pain(S*) = Σ_calls OI_c · max(0, S* − K_c)  +  Σ_puts OI_p · max(0, K_p − S*)
 *
 * The max-pain strike is argmin pain(S*), evaluated over the listed strikes
 * for that expiry. This is the strike at which option holders collectively
 * lose the most premium — and at which writers (notionally dealers) retain
 * the most. The "magnetism" interpretation is folklore; we plot the curve
 * because the *shape* of pain(S*) is informative regardless of folk theory.
 *
 * @module max_pain
 */

/**
 * @typedef {object} PainPoint
 * @property {number} strike
 * @property {number} pain
 */

/**
 * @typedef {object} ExpiryPain
 * @property {number} expirationMs
 * @property {number} dte
 * @property {number} maxPainStrike
 * @property {number} maxPainValue   pain at max-pain strike (the minimum)
 * @property {number} totalCallOi
 * @property {number} totalPutOi
 * @property {Array<PainPoint>} curve
 */

/**
 * Build per-expiry max-pain curves from the joined options list.
 *
 * @param {Array<import("./gex.js").OptionRow>} opts
 * @param {number} nowMs
 * @returns {Array<ExpiryPain>}
 */
export function maxPainPerExpiry(opts, nowMs) {
  /** @type {Map<number, Array<import("./gex.js").OptionRow>>} */
  const byExpiry = new Map();
  for (const o of opts) {
    const arr = byExpiry.get(o.expiration_ms) ?? [];
    arr.push(o);
    byExpiry.set(o.expiration_ms, arr);
  }

  /** @type {Array<ExpiryPain>} */
  const out = [];
  for (const [expirationMs, group] of byExpiry) {
    const strikes = [...new Set(group.map((o) => o.strike))].sort((a, b) => a - b);
    if (strikes.length === 0) continue;

    let totalCallOi = 0, totalPutOi = 0;
    for (const o of group) {
      if (o.option_type === "call") totalCallOi += o.oi;
      else totalPutOi += o.oi;
    }

    /** @type {Array<PainPoint>} */
    const curve = strikes.map((sStar) => ({ strike: sStar, pain: painAt(group, sStar) }));

    let mpStrike = curve[0].strike, mpValue = curve[0].pain;
    for (const pt of curve) {
      if (pt.pain < mpValue) {
        mpValue = pt.pain;
        mpStrike = pt.strike;
      }
    }

    out.push({
      expirationMs,
      dte: (expirationMs - nowMs) / (86400 * 1000),
      maxPainStrike: mpStrike,
      maxPainValue: mpValue,
      totalCallOi,
      totalPutOi,
      curve,
    });
  }
  return out.sort((a, b) => a.expirationMs - b.expirationMs);
}

/**
 * Pain at a single candidate underlying.
 *
 * @param {Array<import("./gex.js").OptionRow>} group
 * @param {number} sStar
 * @returns {number}
 */
export function painAt(group, sStar) {
  let pain = 0;
  for (const o of group) {
    if (o.option_type === "call") {
      pain += o.oi * Math.max(0, sStar - o.strike);
    } else {
      pain += o.oi * Math.max(0, o.strike - sStar);
    }
  }
  return pain;
}
