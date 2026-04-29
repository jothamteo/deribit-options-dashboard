/**
 * Deribit public REST API client.
 *
 * All endpoints used here are public (no auth). CORS is enabled by Deribit, so
 * the browser fetches directly. Reference: https://docs.deribit.com/
 *
 * Public-tier rate limits are generous (~20 requests/sec), but we track our
 * call budget anyway — recruiters check ops thinking. The header counter is
 * exposed via getCallStats() for the UI to display.
 *
 * @module deribit
 */

const BASE_URL = "https://www.deribit.com/api/v2";

const INSTRUMENTS_CACHE_KEY = "deribit:instruments:BTC:option";
const FUTURES_INSTRUMENTS_CACHE_KEY = "deribit:instruments:BTC:future";
const INSTRUMENTS_TTL_MS = 5 * 60 * 1000;

const _stats = { totalCalls: 0, lastCallTs: 0, errors: 0 };

/**
 * Internal fetch helper. Wraps every Deribit call in JSON-RPC-style error
 * surfacing and updates rate-limit stats. Throws on network error or non-2xx.
 *
 * @param {string} path  Path including leading slash, e.g. "/public/get_instruments"
 * @param {Record<string, string|number|boolean>} [params]
 * @returns {Promise<unknown>} The `result` field of the Deribit JSON-RPC envelope
 */
async function _get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  );
  const url = `${BASE_URL}${path}${qs.toString() ? "?" + qs : ""}`;

  _stats.totalCalls += 1;
  _stats.lastCallTs = Date.now();

  let resp;
  try {
    resp = await fetch(url, { method: "GET" });
  } catch (err) {
    _stats.errors += 1;
    throw new Error(`Deribit network error: ${err.message}`);
  }

  if (!resp.ok) {
    _stats.errors += 1;
    throw new Error(`Deribit HTTP ${resp.status} on ${path}`);
  }

  const body = await resp.json();
  if (body.error) {
    _stats.errors += 1;
    throw new Error(`Deribit API error ${body.error.code}: ${body.error.message}`);
  }
  return body.result;
}

/**
 * List of all live BTC option instruments.
 *
 * Cached in sessionStorage for 5 min. Instrument list only changes when new
 * expiries list — refreshing every 30s with the rest of the dashboard is
 * wasteful, and Deribit returns ~500–1500 rows.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getInstruments() {
  const cached = sessionStorage.getItem(INSTRUMENTS_CACHE_KEY);
  if (cached) {
    try {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < INSTRUMENTS_TTL_MS) return data;
    } catch {
      /* fall through to refetch */
    }
  }
  const data = await _get("/public/get_instruments", {
    currency: "BTC",
    kind: "option",
    expired: false,
  });
  sessionStorage.setItem(
    INSTRUMENTS_CACHE_KEY,
    JSON.stringify({ ts: Date.now(), data })
  );
  return data;
}

/**
 * Bulk book summary for all BTC options. One call gives mark_iv, OI, last,
 * bid/ask for every live option — much cheaper than per-instrument /ticker.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getBookSummary() {
  return _get("/public/get_book_summary_by_currency", {
    currency: "BTC",
    kind: "option",
  });
}

/**
 * Spot reference price (BTC index).
 *
 * @returns {Promise<number>}
 */
export async function getIndexPrice() {
  const r = await _get("/public/get_index_price", { index_name: "btc_usd" });
  return r.index_price;
}

/**
 * List of live BTC futures, used to extract per-expiry forward prices for SVI
 * log-moneyness k = log(K/F). Cached in sessionStorage for 5 min — futures
 * listings only change at quarterly roll, so refetching every 30s is wasteful.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getFutures() {
  const cached = sessionStorage.getItem(FUTURES_INSTRUMENTS_CACHE_KEY);
  if (cached) {
    try {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < INSTRUMENTS_TTL_MS) return data;
    } catch {
      /* fall through */
    }
  }
  const data = await _get("/public/get_instruments", {
    currency: "BTC",
    kind: "future",
    expired: false,
  });
  sessionStorage.setItem(
    FUTURES_INSTRUMENTS_CACHE_KEY,
    JSON.stringify({ ts: Date.now(), data })
  );
  return data;
}

/**
 * Bulk book summary for BTC futures (mark prices used as forward F).
 *
 * @returns {Promise<Array<object>>}
 */
export async function getFuturesBookSummary() {
  return _get("/public/get_book_summary_by_currency", {
    currency: "BTC",
    kind: "future",
  });
}

/**
 * Per-instrument ticker. Returns full greeks. Avoid in hot paths — use
 * getBookSummary + locally-computed BS greeks instead.
 *
 * @param {string} instrumentName
 * @returns {Promise<object>}
 */
export async function getTicker(instrumentName) {
  return _get("/public/ticker", { instrument_name: instrumentName });
}

/**
 * Snapshot of the API call budget. The dashboard renders this in the header
 * so the operator (or recruiter) sees we're not abusing the public endpoint.
 *
 * @returns {{totalCalls: number, lastCallTs: number, errors: number}}
 */
export function getCallStats() {
  return { ..._stats };
}

/**
 * Clear the instruments caches (options + futures). Useful for the test
 * page and for forcing a refetch if the operator suspects stale data.
 */
export function clearInstrumentsCache() {
  sessionStorage.removeItem(INSTRUMENTS_CACHE_KEY);
  sessionStorage.removeItem(FUTURES_INSTRUMENTS_CACHE_KEY);
}
