/**
 * Entry point. Refresh loop, header, context strip, and per-feature dispatch.
 *
 * @module main
 */

import {
  getInstruments,
  getBookSummary,
  getIndexPrice,
  getFutures,
  getFuturesBookSummary,
  getCallStats,
} from "./deribit.js";
import {
  joinInstrumentsAndBook,
  gexByStrike,
  gexCurve,
  findZeroGammaFlip,
  oiStats,
} from "./gex.js";
import { buildForwardCurve, forwardAt } from "./forwards.js";
import { fitSvi } from "./svi.js";
import { yearsToExpiry } from "./black_scholes.js";
import {
  renderGexByStrike,
  renderGexVsSpot,
} from "./plots/gex_chart.js";
import {
  renderIvSurface,
  renderIvSlices,
} from "./plots/iv_surface.js";
import { atmTermStructure } from "./term_structure.js";
import { skewTermStructure } from "./skew.js";
import {
  renderAtmTermStructure,
  renderSkewTermStructure,
} from "./plots/term_structure_chart.js";
import { maxPainPerExpiry } from "./max_pain.js";
import { renderMaxPain } from "./plots/max_pain_chart.js";

const REFRESH_MS = 30_000;

const lastUpdated = document.getElementById("last-updated");
const apiBudget = document.getElementById("api-budget");
const pauseBtn = document.getElementById("pause");
const contextStrip = document.getElementById("context-strip");

let paused = false;

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "resume refresh" : "pause refresh";
  pauseBtn.classList.toggle("bg-rose-700", paused);
  pauseBtn.classList.toggle("bg-zinc-800", !paused);
});

function renderApiBudget() {
  const s = getCallStats();
  apiBudget.textContent = `api calls: ${s.totalCalls}${s.errors ? ` (${s.errors} err)` : ""}`;
}
setInterval(renderApiBudget, 1000);
renderApiBudget();

// Max-pain UI state — kept across ticks so the active tab survives a refresh.
let mpActiveExpiryMs = null;
let mpLastExpirySet = "";
let mpLastSpot = NaN;
/** @type {Array<import("./max_pain.js").ExpiryPain>} */
let mpLastSlices = [];

function renderMaxPainPanel(painSlices, spot) {
  mpLastSlices = painSlices;
  mpLastSpot = spot;

  const tabsEl = document.getElementById("max-pain-tabs");
  const chartEl = document.getElementById("max-pain-chart");
  if (!tabsEl || !chartEl) return;

  if (painSlices.length === 0) {
    tabsEl.innerHTML = "";
    chartEl.innerHTML = `<div class="text-zinc-500 text-sm font-mono p-4">no expiries with options</div>`;
    return;
  }

  // Default active expiry: the nearest one (first in sorted order)
  if (mpActiveExpiryMs == null || !painSlices.find((p) => p.expirationMs === mpActiveExpiryMs)) {
    mpActiveExpiryMs = painSlices[0].expirationMs;
  }

  // Only rebuild tab DOM if the expiry set changed (avoid flicker)
  const expirySetKey = painSlices.map((p) => p.expirationMs).join(",");
  if (expirySetKey !== mpLastExpirySet) {
    tabsEl.innerHTML = "";
    for (const p of painSlices) {
      const btn = document.createElement("button");
      btn.dataset.exp = String(p.expirationMs);
      btn.className = "px-2.5 py-1 rounded font-mono text-xs border border-zinc-800";
      btn.textContent = `${p.dte.toFixed(1)}d`;
      btn.title = new Date(p.expirationMs).toISOString();
      btn.addEventListener("click", () => {
        mpActiveExpiryMs = p.expirationMs;
        applyMaxPainTabs();
        const active = mpLastSlices.find((s) => s.expirationMs === mpActiveExpiryMs);
        if (active) renderMaxPain("max-pain-chart", active, mpLastSpot);
      });
      tabsEl.appendChild(btn);
    }
    mpLastExpirySet = expirySetKey;
  }
  applyMaxPainTabs();

  const active = painSlices.find((p) => p.expirationMs === mpActiveExpiryMs);
  if (active) renderMaxPain("max-pain-chart", active, spot);
}

function applyMaxPainTabs() {
  const tabsEl = document.getElementById("max-pain-tabs");
  if (!tabsEl) return;
  for (const btn of tabsEl.querySelectorAll("button")) {
    const isActive = Number(btn.dataset.exp) === mpActiveExpiryMs;
    btn.classList.toggle("bg-violet-600", isActive);
    btn.classList.toggle("text-white", isActive);
    btn.classList.toggle("bg-zinc-900", !isActive);
    btn.classList.toggle("text-zinc-400", !isActive);
    btn.classList.toggle("hover:bg-zinc-800", !isActive);
  }
}

function renderContextStrip(spot, oi, flip) {
  const pct = (n) => Number.isFinite(n) ? n.toFixed(2) : "—";
  const fmtUsd = (n) => Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
  const fmt = (n) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

  contextStrip.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 font-mono text-sm">
      <div>
        <div class="text-zinc-500 text-xs uppercase tracking-wider">BTC spot</div>
        <div class="text-2xl font-bold text-zinc-100">${fmtUsd(spot)}</div>
      </div>
      <div>
        <div class="text-zinc-500 text-xs uppercase tracking-wider">Total OI (contracts)</div>
        <div class="text-2xl font-bold text-zinc-100">${fmt(oi.totalOi)}</div>
        <div class="text-xs text-zinc-500">
          <span class="text-teal-400">calls ${fmt(oi.callOi)}</span> /
          <span class="text-rose-400">puts ${fmt(oi.putOi)}</span>
        </div>
      </div>
      <div>
        <div class="text-zinc-500 text-xs uppercase tracking-wider">P/C ratio (OI)</div>
        <div class="text-2xl font-bold text-zinc-100">${pct(oi.putCallRatioOi)}</div>
      </div>
      <div>
        <div class="text-zinc-500 text-xs uppercase tracking-wider">Live options</div>
        <div class="text-2xl font-bold text-zinc-100">${fmt(oi.totalCount)}</div>
      </div>
      <div>
        <div class="text-zinc-500 text-xs uppercase tracking-wider">Zero-gamma flip</div>
        <div class="text-2xl font-bold ${flip != null ? "text-amber-400" : "text-zinc-500"}">${flip != null ? fmtUsd(flip) : "—"}</div>
        <div class="text-xs text-zinc-500">${flip != null && Number.isFinite(spot) ? `Δ vs spot: ${((flip - spot) / spot * 100).toFixed(2)}%` : ""}</div>
      </div>
    </div>
  `;
}

/**
 * Group options by expiry, fit SVI per expiry, and return slices ready for
 * the IV surface and slice-grid renderers. Drops slices with < 5 points
 * (not enough for a stable 5-param fit).
 *
 * @param {Array<import("./gex.js").OptionRow>} opts
 * @param {Array<import("./forwards.js").FuturePoint>} fwdCurve
 * @param {number} spot
 * @param {number} nowMs
 * @returns {Array<import("./plots/iv_surface.js").ExpirySlice>}
 */
function buildSlices(opts, fwdCurve, spot, nowMs) {
  /** @type {Map<number, import("./plots/iv_surface.js").ExpirySlice>} */
  const byExpiry = new Map();
  for (const o of opts) {
    const T = yearsToExpiry(o.expiration_ms, nowMs);
    if (T <= 0) continue;
    const F = forwardAt(fwdCurve, o.expiration_ms, spot);
    if (!Number.isFinite(F) || F <= 0) continue;
    const k = Math.log(o.strike / F);
    const slice = byExpiry.get(o.expiration_ms) ?? {
      expirationMs: o.expiration_ms,
      T,
      forward: F,
      points: [],
      svi: null,
      fit: null,
    };
    slice.points.push({ k, iv: o.markIv, type: o.option_type, strike: o.strike });
    byExpiry.set(o.expiration_ms, slice);
  }

  const slices = [...byExpiry.values()].sort((a, b) => a.expirationMs - b.expirationMs);
  for (const s of slices) {
    if (s.points.length < 5) continue;
    // SVI fits total variance w(k) = IV² · T
    const ptsW = s.points.map((p) => ({ k: p.k, w: p.iv * p.iv * s.T }));
    const fit = fitSvi(ptsW);
    s.svi = fit.params;
    s.fit = { rmse: fit.rmse, maxResid: fit.maxResid };
  }
  return slices;
}

/**
 * Progressive render: GEX paints as soon as its 3 fetches resolve; the IV
 * surface waits for all 5. Each path has its own error boundary so a slow or
 * failing futures fetch never blocks the GEX panel — that was the Phase-3
 * regression.
 */
async function tick() {
  if (paused) return;
  const t0 = performance.now();

  // Fire all 5 fetches in parallel, share the first 3 across both render paths
  const spotP = getIndexPrice();
  const instsP = getInstruments();
  const bookP = getBookSummary();
  const futInstP = getFutures();
  const futBookP = getFuturesBookSummary();

  // ── GEX render path (only needs spot + options) ────────────────────────
  const gexPromise = Promise.all([spotP, instsP, bookP])
    .then(([spot, instruments, book]) => {
      const opts = joinInstrumentsAndBook(instruments, book);
      const oi = oiStats(opts);
      const byStrike = gexByStrike(opts, spot);
      const curve = gexCurve(opts, spot);
      const flip = findZeroGammaFlip(curve);

      // Max pain — only depends on options + spot, no SVI/futures
      const nowMs = Date.now();
      const painSlices = maxPainPerExpiry(opts, nowMs);
      // Annotate the GEX bar chart with the nearest-expiry max-pain strike —
      // most actionable single number for the typical reader.
      const nearestMaxPain = painSlices.length > 0 ? painSlices[0].maxPainStrike : null;

      renderContextStrip(spot, oi, flip);
      renderGexByStrike("gex-by-strike", byStrike, { spot, flip, maxPain: nearestMaxPain });
      renderGexVsSpot("gex-vs-spot", curve, { spot, flip });
      renderMaxPainPanel(painSlices, spot);

      return { spot, opts };
    })
    .catch((err) => {
      console.error("GEX render failed:", err);
      contextStrip.innerHTML = `<div class="text-rose-400 text-sm font-mono">GEX error: ${err.message}</div>`;
      throw err;
    });

  // ── IV surface + term structure + skew render path (needs futures) ─────
  const ivPromise = Promise.all([gexPromise, futInstP, futBookP])
    .then(([{ spot, opts }, futureInst, futureBook]) => {
      const fwdCurve = buildForwardCurve(futureInst, futureBook);
      const nowMs = Date.now();
      const slices = buildSlices(opts, fwdCurve, spot, nowMs);

      // Render the cheap 2D charts first — slice grid + term structure + skew —
      // then defer the heavy 3D scatter to the next animation frame so it
      // doesn't block above-fold paint.
      renderIvSlices("iv-slices", slices, nowMs);

      const term = atmTermStructure(slices, nowMs);
      const skew = skewTermStructure(slices, spot, nowMs);
      renderAtmTermStructure("term-structure", term);
      renderSkewTermStructure("skew", skew);

      requestAnimationFrame(() => {
        renderIvSurface("iv-surface", slices, nowMs);
      });
    })
    .catch((err) => {
      console.error("IV render failed:", err);
      const slicesEl = document.getElementById("iv-slices");
      if (slicesEl) {
        slicesEl.innerHTML = `<div class="text-amber-400 text-sm font-mono">IV surface error: ${err.message}</div>`;
      }
    });

  // Wait for both paths to settle — one error doesn't poison the other.
  // Stamp the timestamp based on the GEX path's outcome (the visible-above-fold one).
  const [gexResult] = await Promise.allSettled([gexPromise, ivPromise]);
  const ms = (performance.now() - t0).toFixed(0);

  if (gexResult.status === "fulfilled") {
    lastUpdated.textContent =
      `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC  (${ms}ms)`;
    lastUpdated.classList.remove("text-rose-500");
    lastUpdated.classList.add("text-zinc-400");
  } else {
    lastUpdated.textContent = `tick failed (${ms}ms): ${gexResult.reason?.message ?? "unknown"}`;
    lastUpdated.classList.remove("text-zinc-400");
    lastUpdated.classList.add("text-rose-500");
  }
}

/**
 * Plotly is loaded with `defer`. Module scripts also defer, and deferred
 * scripts execute in document order, so Plotly *should* be defined by the
 * time this module runs. But on slow connections the script tag could still
 * be in flight when the first tick fires. Cheap poll until it's there.
 */
async function waitForPlotly(timeoutMs = 10_000) {
  const start = performance.now();
  while (typeof window.Plotly === "undefined") {
    if (performance.now() - start > timeoutMs) {
      throw new Error("Plotly failed to load within 10s");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

(async () => {
  await waitForPlotly();
  await tick();
  setInterval(tick, REFRESH_MS);
})();

export function isPaused() {
  return paused;
}
