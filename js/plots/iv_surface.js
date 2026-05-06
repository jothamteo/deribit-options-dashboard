/**
 * IV surface 3D plot + per-expiry slice grid.
 *
 * Surface: scatter3d in (k, days, IV) with a smooth SVI-fitted mesh trace.
 * Slices: one subplot per expiry showing market mids vs SVI fit, residual
 * RMSE annotated so the operator can tell at a glance which expiries fit
 * cleanly and which are noisy.
 *
 * @module plots/iv_surface
 */

import { svi, sviIv } from "../svi.js";

const CALL_COLOR = "#14b8a6";
const PUT_COLOR = "#f43f5e";
const FIT_COLOR = "#facc15";
const layoutBase = {
  paper_bgcolor: "#18181b",
  plot_bgcolor: "#18181b",
  font: { color: "#e4e4e7", family: "ui-monospace, monospace", size: 10 },
  margin: { t: 20, r: 10, b: 40, l: 50 },
};
const config = { displayModeBar: false, responsive: true };

/**
 * @typedef {object} ExpirySlice
 * @property {number} expirationMs
 * @property {number} T  years
 * @property {number} forward
 * @property {Array<{k: number, iv: number, type: "call"|"put", strike: number}>} points
 * @property {import("../svi.js").SviParams | null} svi
 * @property {{rmse: number, maxResid: number} | null} fit
 */

/**
 * 3D scatter of market mid IVs (colored by call/put), with SVI-fitted curves
 * drawn as line traces at constant T. We use scatter3d not mesh3d because
 * mesh3d's Delaunay triangulation produces ugly artefacts on sparse
 * non-grid data.
 *
 * @param {string} containerId
 * @param {Array<ExpirySlice>} slices
 * @param {number} nowMs
 */
export function renderIvSurface(containerId, slices, nowMs) {
  const callPts = { x: [], y: [], z: [], type: "scatter3d", mode: "markers", name: "calls",
                    marker: { color: CALL_COLOR, size: 3 }, hovertemplate: "k=%{x:.3f}<br>days=%{y:.1f}<br>IV=%{z:.3f}<extra>call</extra>" };
  const putPts = { x: [], y: [], z: [], type: "scatter3d", mode: "markers", name: "puts",
                   marker: { color: PUT_COLOR, size: 3 }, hovertemplate: "k=%{x:.3f}<br>days=%{y:.1f}<br>IV=%{z:.3f}<extra>put</extra>" };
  /** @type {Array<object>} */
  const fitTraces = [];

  for (const s of slices) {
    const days = (s.expirationMs - nowMs) / (86400 * 1000);
    for (const p of s.points) {
      (p.type === "call" ? callPts : putPts).x.push(p.k);
      (p.type === "call" ? callPts : putPts).y.push(days);
      (p.type === "call" ? callPts : putPts).z.push(p.iv);
    }
    if (s.svi) {
      const ks = s.points.map((p) => p.k).sort((a, b) => a - b);
      const kMin = ks[0], kMax = ks[ks.length - 1];
      const N = 40;
      const xs = [], ys = [], zs = [];
      for (let i = 0; i <= N; i++) {
        const k = kMin + ((kMax - kMin) * i) / N;
        xs.push(k); ys.push(days); zs.push(sviIv(k, s.svi, s.T));
      }
      fitTraces.push({
        x: xs, y: ys, z: zs,
        type: "scatter3d", mode: "lines",
        line: { color: FIT_COLOR, width: 4 },
        showlegend: false,
        hovertemplate: "SVI fit<br>k=%{x:.3f}<br>days=%{y:.1f}<br>IV=%{z:.3f}<extra></extra>",
      });
    }
  }

  const layout = {
    ...layoutBase,
    scene: {
      xaxis: { title: "log-moneyness  k", gridcolor: "#27272a", zerolinecolor: "#3f3f46", color: "#e4e4e7" },
      yaxis: { title: "days to expiry", gridcolor: "#27272a", zerolinecolor: "#3f3f46", color: "#e4e4e7" },
      zaxis: { title: "implied vol", gridcolor: "#27272a", zerolinecolor: "#3f3f46", color: "#e4e4e7" },
      bgcolor: "#18181b",
      camera: { eye: { x: 1.6, y: -1.6, z: 0.8 } },
    },
    legend: { orientation: "h", y: 1, x: 0 },
  };

  Plotly.react(containerId, [callPts, putPts, ...fitTraces], layout, config);
}

/**
 * Grid of per-expiry slice charts. Renders into containerId by injecting one
 * div per expiry and calling Plotly.react on each. Caller is responsible for
 * calling this AFTER the container is in the DOM.
 *
 * @param {string} containerId
 * @param {Array<ExpirySlice>} slices
 * @param {number} nowMs
 */
export function renderIvSlices(containerId, slices, nowMs) {
  const root = document.getElementById(containerId);
  if (!root) return;

  // Clear and rebuild — slice count can change between refreshes (new expiry)
  root.innerHTML = "";
  const grid = document.createElement("div");
  // Lock to grid-cols-2 (mobile) / lg:grid-cols-3 (desktop). Avoids the
  // xl: breakpoint at 1280px which was racing with Plotly's responsive
  // resize and letting one card escape its column width.
  // overflow-hidden + min-w-0 on each card prevents Plotly's internal
  // width calc from blowing past the grid track.
  grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3";
  root.appendChild(grid);

  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const days = (s.expirationMs - nowMs) / (86400 * 1000);
    const card = document.createElement("div");
    card.className = "bg-zinc-900 border border-zinc-800 rounded p-2 overflow-hidden min-w-0";

    const header = document.createElement("div");
    header.className = "flex items-baseline justify-between mb-1 text-xs font-mono";
    header.innerHTML = `
      <span class="text-zinc-300 font-bold">${days.toFixed(1)}d</span>
      <span class="text-zinc-500">F=${s.forward.toFixed(0)}</span>
      <span class="${s.fit && s.fit.rmse < 0.001 ? "text-teal-400" : "text-amber-400"}">
        ${s.fit ? `rmse w=${s.fit.rmse.toExponential(2)}` : "no fit"}
      </span>
    `;
    card.appendChild(header);

    const plotDiv = document.createElement("div");
    plotDiv.id = `${containerId}-slice-${i}`;
    plotDiv.className = "h-44 w-full";
    card.appendChild(plotDiv);

    grid.appendChild(card);

    const callPts = s.points.filter((p) => p.type === "call");
    const putPts = s.points.filter((p) => p.type === "put");

    const traces = [
      { x: callPts.map((p) => p.k), y: callPts.map((p) => p.iv),
        type: "scatter", mode: "markers", name: "call", marker: { color: CALL_COLOR, size: 5 } },
      { x: putPts.map((p) => p.k), y: putPts.map((p) => p.iv),
        type: "scatter", mode: "markers", name: "put", marker: { color: PUT_COLOR, size: 5 } },
    ];
    if (s.svi) {
      const ks = s.points.map((p) => p.k).sort((a, b) => a - b);
      const kMin = ks[0], kMax = ks[ks.length - 1];
      const N = 60;
      const xs = [], ys = [];
      for (let j = 0; j <= N; j++) {
        const k = kMin + ((kMax - kMin) * j) / N;
        xs.push(k); ys.push(sviIv(k, s.svi, s.T));
      }
      traces.push({ x: xs, y: ys, type: "scatter", mode: "lines",
                    name: "SVI", line: { color: FIT_COLOR, width: 2 } });
    }

    const layout = {
      ...layoutBase,
      margin: { t: 5, r: 5, b: 30, l: 40 },
      xaxis: { title: "k", gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
      yaxis: { title: "IV", gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
      showlegend: false,
    };
    Plotly.react(plotDiv.id, traces, layout, config);
  }
}
