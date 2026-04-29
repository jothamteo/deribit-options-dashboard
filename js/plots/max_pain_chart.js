/**
 * Max-pain bar chart for a single expiry. Highlights the max-pain strike
 * (argmin) in amber and overlays a current-spot vertical line.
 *
 * @module plots/max_pain_chart
 */

const BAR_COLOR = "#71717a";
const ARGMIN_COLOR = "#a78bfa";
const SPOT_COLOR = "#a1a1aa";

const layoutBase = {
  paper_bgcolor: "#18181b",
  plot_bgcolor: "#18181b",
  font: { color: "#e4e4e7", family: "ui-monospace, monospace", size: 11 },
  margin: { t: 20, r: 20, b: 50, l: 70 },
  xaxis: { gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
  yaxis: { gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
};
const config = { displayModeBar: false, responsive: true };

/**
 * @param {string} containerId
 * @param {import("../max_pain.js").ExpiryPain} expiry
 * @param {number} spot
 */
export function renderMaxPain(containerId, expiry, spot) {
  const colors = expiry.curve.map((p) =>
    p.strike === expiry.maxPainStrike ? ARGMIN_COLOR : BAR_COLOR
  );

  const trace = {
    x: expiry.curve.map((p) => p.strike),
    y: expiry.curve.map((p) => p.pain),
    type: "bar",
    marker: { color: colors },
    hovertemplate: "K=%{x:,.0f}<br>pain=%{y:,.0f}<extra></extra>",
  };

  const shapes = [];
  const annotations = [];
  if (Number.isFinite(spot)) {
    shapes.push(vline(spot, SPOT_COLOR, "dash"));
    annotations.push(vlabel(spot, "spot", SPOT_COLOR, 0.95));
  }
  shapes.push(vline(expiry.maxPainStrike, ARGMIN_COLOR, "dot"));
  annotations.push(
    vlabel(expiry.maxPainStrike, `max pain ${expiry.maxPainStrike.toLocaleString()}`, ARGMIN_COLOR, 0.85)
  );

  const layout = {
    ...layoutBase,
    xaxis: { ...layoutBase.xaxis, title: "candidate underlying  S*" },
    yaxis: { ...layoutBase.yaxis, title: "total pain (OI · |S* − K|)" },
    showlegend: false,
    shapes,
    annotations,
  };

  Plotly.react(containerId, [trace], layout, config);
}

/**
 * @param {number} x
 * @param {string} color
 * @param {"solid"|"dash"|"dot"|"dashdot"} dash
 */
function vline(x, color, dash) {
  return {
    type: "line",
    x0: x, x1: x,
    yref: "paper",
    y0: 0, y1: 1,
    line: { color, width: 1, dash },
  };
}
/**
 * @param {number} x
 * @param {string} text
 * @param {string} color
 * @param {number} y
 */
function vlabel(x, text, color, y) {
  return {
    x, xref: "x",
    y, yref: "paper",
    text,
    showarrow: false,
    font: { color, size: 10, family: "ui-monospace, monospace" },
    bgcolor: "#18181b",
    bordercolor: color,
    borderwidth: 1,
    borderpad: 2,
  };
}
