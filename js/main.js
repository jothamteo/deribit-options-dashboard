/**
 * Entry point. Refresh loop, header, context strip, and per-feature dispatch.
 *
 * Phase 2 wires up the GEX panel + context strip. Later phases register
 * additional render hooks here.
 *
 * @module main
 */

import {
  getInstruments,
  getBookSummary,
  getIndexPrice,
  getCallStats,
} from "./deribit.js";
import {
  joinInstrumentsAndBook,
  gexByStrike,
  gexCurve,
  findZeroGammaFlip,
  oiStats,
} from "./gex.js";
import {
  renderGexByStrike,
  renderGexVsSpot,
} from "./plots/gex_chart.js";

const REFRESH_MS = 30_000;

const lastUpdated = document.getElementById("last-updated");
const apiBudget = document.getElementById("api-budget");
const pauseBtn = document.getElementById("pause");
const contextStrip = document.getElementById("context-strip");

let paused = false;
let lastSpot = NaN;

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

async function tick() {
  if (paused) return;
  try {
    const [spot, instruments, book] = await Promise.all([
      getIndexPrice(),
      getInstruments(),
      getBookSummary(),
    ]);

    lastSpot = spot;
    const opts = joinInstrumentsAndBook(instruments, book);
    const oi = oiStats(opts);

    const byStrike = gexByStrike(opts, spot);
    const curve = gexCurve(opts, spot);
    const flip = findZeroGammaFlip(curve);

    renderContextStrip(spot, oi, flip);
    renderGexByStrike("gex-by-strike", byStrike, { spot, flip });
    renderGexVsSpot("gex-vs-spot", curve, { spot, flip });

    lastUpdated.textContent =
      new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    lastUpdated.classList.remove("text-rose-500");
    lastUpdated.classList.add("text-zinc-400");
  } catch (err) {
    lastUpdated.textContent = `error: ${err.message}`;
    lastUpdated.classList.remove("text-zinc-400");
    lastUpdated.classList.add("text-rose-500");
    console.error(err);
  }
}

// Kick off
tick();
setInterval(tick, REFRESH_MS);

export function isPaused() {
  return paused;
}
