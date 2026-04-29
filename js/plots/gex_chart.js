/**
 * GEX visualizations: bar chart by strike + curve of total GEX vs hypothetical
 * spot with zero-gamma flip annotated.
 *
 * @module plots/gex_chart
 */

const CALL_COLOR = "#14b8a6";
const PUT_COLOR = "#f43f5e";
const FLIP_COLOR = "#facc15";
const SPOT_COLOR = "#a1a1aa";
const MAXPAIN_COLOR = "#a78bfa";

const layoutBase = {
  paper_bgcolor: "#18181b",
  plot_bgcolor: "#18181b",
  font: { color: "#e4e4e7", family: "ui-monospace, monospace", size: 11 },
  margin: { t: 30, r: 20, b: 50, l: 70 },
  xaxis: { gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
  yaxis: { gridcolor: "#27272a", zerolinecolor: "#3f3f46" },
};

const config = { displayModeBar: false, responsive: true };

/**
 * Render the bar chart of GEX by strike, split into call and put components.
 *
 * @param {string} containerId
 * @param {Array<{strike: number, gex: number, callGex: number, putGex: number}>} byStrike
 * @param {{spot: number, flip: number | null, maxPain?: number | null}} markers
 */
export function renderGexByStrike(containerId, byStrike, markers) {
  const strikes = byStrike.map((r) => r.strike);
  const calls = byStrike.map((r) => r.callGex);
  const puts = byStrike.map((r) => r.putGex);

  const traces = [
    {
      x: strikes,
      y: calls,
      type: "bar",
      name: "calls",
      marker: { color: CALL_COLOR },
      hovertemplate: "K=%{x}<br>call GEX=%{y:.2s}<extra></extra>",
    },
    {
      x: strikes,
      y: puts,
      type: "bar",
      name: "puts",
      marker: { color: PUT_COLOR },
      hovertemplate: "K=%{x}<br>put GEX=%{y:.2s}<extra></extra>",
    },
  ];

  const shapes = [];
  const annotations = [];
  if (Number.isFinite(markers.spot)) {
    shapes.push(vline(markers.spot, SPOT_COLOR, "dash"));
    annotations.push(vlabel(markers.spot, "spot", SPOT_COLOR, 0.95));
  }
  if (markers.flip != null) {
    shapes.push(vline(markers.flip, FLIP_COLOR, "dot"));
    annotations.push(vlabel(markers.flip, "flip", FLIP_COLOR, 0.85));
  }
  if (markers.maxPain != null) {
    shapes.push(vline(markers.maxPain, MAXPAIN_COLOR, "dashdot"));
    annotations.push(vlabel(markers.maxPain, "max pain", MAXPAIN_COLOR, 0.75));
  }

  const layout = {
    ...layoutBase,
    barmode: "relative",
    xaxis: { ...layoutBase.xaxis, title: "strike" },
    yaxis: { ...layoutBase.yaxis, title: "GEX ($/1% spot move)" },
    legend: { orientation: "h", y: 1.1, x: 0 },
    shapes,
    annotations,
  };

  Plotly.react(containerId, traces, layout, config);
}

/**
 * Render the cumulative GEX vs hypothetical spot curve.
 *
 * @param {string} containerId
 * @param {Array<{spot: number, gex: number}>} curve
 * @param {{spot: number, flip: number | null}} markers
 */
export function renderGexVsSpot(containerId, curve, markers) {
  const xs = curve.map((p) => p.spot);
  const ys = curve.map((p) => p.gex);

  const traces = [
    {
      x: xs,
      y: ys,
      type: "scatter",
      mode: "lines",
      line: { color: CALL_COLOR, width: 2 },
      name: "total GEX",
      hovertemplate: "spot=%{x:,.0f}<br>GEX=%{y:.2s}<extra></extra>",
    },
  ];

  const shapes = [
    // zero line — extra weight, helps the eye find the flip
    {
      type: "line",
      x0: xs[0], x1: xs[xs.length - 1],
      y0: 0, y1: 0,
      line: { color: "#52525b", width: 1 },
    },
  ];
  const annotations = [];
  if (Number.isFinite(markers.spot)) {
    shapes.push(vline(markers.spot, SPOT_COLOR, "dash"));
    annotations.push(vlabel(markers.spot, "spot", SPOT_COLOR, 0.95));
  }
  if (markers.flip != null) {
    shapes.push(vline(markers.flip, FLIP_COLOR, "dot"));
    annotations.push(vlabel(markers.flip, `flip ${markers.flip.toFixed(0)}`, FLIP_COLOR, 0.85));
  }

  const layout = {
    ...layoutBase,
    xaxis: { ...layoutBase.xaxis, title: "hypothetical spot" },
    yaxis: { ...layoutBase.yaxis, title: "total GEX" },
    showlegend: false,
    shapes,
    annotations,
  };

  Plotly.react(containerId, traces, layout, config);
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
 * @param {number} y  in paper coords (0..1)
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
