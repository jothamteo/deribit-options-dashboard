/**
 * ATM IV term structure (log-x days) and 25Δ RR/BF term-structure charts.
 *
 * @module plots/term_structure_chart
 */

const ATM_COLOR = "#facc15";
const RR_COLOR = "#f43f5e";
const BF_COLOR = "#14b8a6";

const layoutBase = {
  paper_bgcolor: "#18181b",
  plot_bgcolor: "#18181b",
  font: { color: "#e4e4e7", family: "ui-monospace, monospace", size: 11 },
  margin: { t: 20, r: 20, b: 50, l: 60 },
};
const config = { displayModeBar: false, responsive: true };

/**
 * @param {string} containerId
 * @param {Array<import("../term_structure.js").TermPoint>} term
 */
export function renderAtmTermStructure(containerId, term) {
  const dtes = term.map((p) => p.dte);
  const ivs = term.map((p) => p.atmIv);

  const trace = {
    x: dtes,
    y: ivs,
    type: "scatter",
    mode: "lines+markers",
    line: { color: ATM_COLOR, width: 2 },
    marker: { color: ATM_COLOR, size: 6 },
    hovertemplate: "%{x:.1f}d<br>ATM IV=%{y:.2%}<extra></extra>",
    name: "ATM IV",
  };

  const layout = {
    ...layoutBase,
    xaxis: {
      title: "days to expiry (log)",
      type: "log",
      gridcolor: "#27272a",
      zerolinecolor: "#3f3f46",
    },
    yaxis: {
      title: "ATM implied vol",
      tickformat: ".0%",
      gridcolor: "#27272a",
      zerolinecolor: "#3f3f46",
    },
    showlegend: false,
  };

  Plotly.react(containerId, [trace], layout, config);
}

/**
 * Side-by-side RR and BF lines on a shared days-to-expiry axis (linear x —
 * RR/BF magnitudes are easier to read without log compression).
 *
 * @param {string} containerId
 * @param {Array<import("../skew.js").SkewPoint>} skew
 */
export function renderSkewTermStructure(containerId, skew) {
  const dtes = skew.map((p) => p.dte);
  const rrs = skew.map((p) => p.rr);
  const bfs = skew.map((p) => p.bf);

  const traces = [
    {
      x: dtes, y: rrs, type: "scatter", mode: "lines+markers",
      line: { color: RR_COLOR, width: 2 }, marker: { color: RR_COLOR, size: 6 },
      name: "25Δ RR",
      hovertemplate: "%{x:.1f}d<br>RR=%{y:+.2%}<extra></extra>",
    },
    {
      x: dtes, y: bfs, type: "scatter", mode: "lines+markers",
      line: { color: BF_COLOR, width: 2 }, marker: { color: BF_COLOR, size: 6 },
      name: "25Δ BF",
      hovertemplate: "%{x:.1f}d<br>BF=%{y:+.2%}<extra></extra>",
    },
  ];

  const layout = {
    ...layoutBase,
    xaxis: {
      title: "days to expiry",
      gridcolor: "#27272a",
      zerolinecolor: "#3f3f46",
    },
    yaxis: {
      title: "vol points",
      tickformat: "+.1%",
      gridcolor: "#27272a",
      zerolinecolor: "#3f3f46",
    },
    legend: { orientation: "h", y: 1.1, x: 0 },
    shapes: [
      // zero baseline — RR sign tells you which way the smile is sloping
      {
        type: "line",
        x0: dtes[0] ?? 0,
        x1: dtes[dtes.length - 1] ?? 0,
        y0: 0, y1: 0,
        line: { color: "#52525b", width: 1, dash: "dot" },
      },
    ],
  };

  Plotly.react(containerId, traces, layout, config);
}
