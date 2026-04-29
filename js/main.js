/**
 * Entry point. Phase 0 only wires the API call counter so the header reads
 * something. Per-feature loaders land in Phase 2 onwards.
 *
 * @module main
 */

import { getCallStats } from "./deribit.js";

const lastUpdated = document.getElementById("last-updated");
const apiBudget = document.getElementById("api-budget");
const pauseBtn = document.getElementById("pause");

let paused = false;

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "resume refresh" : "pause refresh";
  pauseBtn.classList.toggle("bg-rose-700", paused);
  pauseBtn.classList.toggle("bg-zinc-800", !paused);
});

function renderStats() {
  const s = getCallStats();
  apiBudget.textContent = `api calls: ${s.totalCalls}${s.errors ? ` (${s.errors} err)` : ""}`;
}

setInterval(renderStats, 1000);
renderStats();

// Phase-0 placeholder — later phases register tick handlers here.
export function isPaused() {
  return paused;
}

export function markUpdated() {
  lastUpdated.textContent = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
