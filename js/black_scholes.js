/**
 * Black-Scholes pricing and greeks. Pure functions, no side effects.
 *
 * Conventions:
 *   S — spot
 *   K — strike
 *   T — time to expiry in YEARS (use 365.25 days/year for crypto consistency)
 *   sigma — annualized implied volatility, decimal (0.65, not 65)
 *   r — risk-free rate (default 0 for BTC; see METHODOLOGY §1.4)
 *   q — continuous dividend yield (default 0; BTC has no dividend)
 *
 * All formulas: Hull, Options Futures and Other Derivatives, 11ed §15–17.
 *
 * @module black_scholes
 */

/**
 * Standard normal CDF via Abramowitz-Stegun 26.2.17. Max abs error ~7.5e-8,
 * well below any IV-fitting precision we need.
 *
 * @param {number} x
 * @returns {number}
 */
export function normCdf(x) {
  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const w =
    1 -
    normPdf(x) *
      (a1 * k + a2 * k ** 2 + a3 * k ** 3 + a4 * k ** 4 + a5 * k ** 5);
  return x >= 0 ? w : 1 - w;
}

/**
 * Standard normal PDF, ϕ(x) = (1/√(2π)) · e^(-x²/2).
 *
 * @param {number} x
 * @returns {number}
 */
export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * d1 = (ln(S/K) + (r − q + σ²/2) T) / (σ √T)
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number}
 */
function d1(S, K, T, sigma, r = 0, q = 0) {
  return (
    (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) /
    (sigma * Math.sqrt(T))
  );
}

/**
 * d2 = d1 − σ √T
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number}
 */
function d2(S, K, T, sigma, r = 0, q = 0) {
  return d1(S, K, T, sigma, r, q) - sigma * Math.sqrt(T);
}

/**
 * Guard against degenerate inputs that would produce NaN or Inf greeks.
 * Returns null when the inputs are not pricable; caller decides what to do.
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @returns {boolean} true if inputs are valid
 */
function valid(S, K, T, sigma) {
  return (
    Number.isFinite(S) &&
    Number.isFinite(K) &&
    Number.isFinite(T) &&
    Number.isFinite(sigma) &&
    S > 0 &&
    K > 0 &&
    T > 0 &&
    sigma > 0
  );
}

/**
 * BS gamma. Same for call and put.
 *
 *   Γ = e^(-qT) · ϕ(d1) / (S σ √T)
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number} Gamma per share, or NaN on invalid input
 */
export function bsGamma(S, K, T, sigma, r = 0, q = 0) {
  if (!valid(S, K, T, sigma)) return NaN;
  const D1 = d1(S, K, T, sigma, r, q);
  return (Math.exp(-q * T) * normPdf(D1)) / (S * sigma * Math.sqrt(T));
}

/**
 * BS delta. Pass type="call" or type="put".
 *
 *   Δ_call = e^(-qT) · N(d1)
 *   Δ_put  = e^(-qT) · (N(d1) − 1)
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {"call"|"put"} type
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number}
 */
export function bsDelta(S, K, T, sigma, type, r = 0, q = 0) {
  if (!valid(S, K, T, sigma)) return NaN;
  const D1 = d1(S, K, T, sigma, r, q);
  const eqT = Math.exp(-q * T);
  return type === "call" ? eqT * normCdf(D1) : eqT * (normCdf(D1) - 1);
}

/**
 * BS vega. Same for call and put. Per 1.0 absolute change in σ; divide by 100
 * if you want "per 1 vol point".
 *
 *   ν = S · e^(-qT) · ϕ(d1) · √T
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number}
 */
export function bsVega(S, K, T, sigma, r = 0, q = 0) {
  if (!valid(S, K, T, sigma)) return NaN;
  const D1 = d1(S, K, T, sigma, r, q);
  return S * Math.exp(-q * T) * normPdf(D1) * Math.sqrt(T);
}

/**
 * BS price.
 *
 *   C = S e^(-qT) N(d1) − K e^(-rT) N(d2)
 *   P = K e^(-rT) N(-d2) − S e^(-qT) N(-d1)
 *
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {"call"|"put"} type
 * @param {number} [r=0]
 * @param {number} [q=0]
 * @returns {number}
 */
export function bsPrice(S, K, T, sigma, type, r = 0, q = 0) {
  if (!valid(S, K, T, sigma)) return NaN;
  const D1 = d1(S, K, T, sigma, r, q);
  const D2 = d2(S, K, T, sigma, r, q);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  if (type === "call") {
    return S * eqT * normCdf(D1) - K * erT * normCdf(D2);
  }
  return K * erT * normCdf(-D2) - S * eqT * normCdf(-D1);
}

/**
 * Year fraction to expiry given expiry timestamp in ms. Uses 365.25 days/yr.
 *
 * @param {number} expiryMs
 * @param {number} [nowMs=Date.now()]
 * @returns {number}
 */
export function yearsToExpiry(expiryMs, nowMs = Date.now()) {
  return (expiryMs - nowMs) / (365.25 * 86400 * 1000);
}
