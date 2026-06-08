// charts.js — ApexCharts wrapper module
// Dark theme, violet primary (#8B5CF6), smooth fade-in animations, compact tooltips.
// All factories are async, await chart.render(), and return the chart instance
// so callers can chart.destroy() when needed.
//
// SHAPE-NORMALIZATION:
// Alle Chart-Factories akzeptieren BEIDE Shapes (alt + neu) sowie positional
// arrays als zweites Argument (z.B. makeSparkline(el, [1,2,3])).
//   - NEU (kanonisch): { categories:[], series:[{name,data}], colors, height }
//   - ALT (legacy):    { data:[{x:val,y:val}], x:'key', series:[{key,label,color}], color, labels, values }
//   - Donut NEU:       { labels:[], values:[], colors, height }
//   - Donut ALT:       { data:[{label,value,color}] }
// Charts bleiben NIEMALS leer wenn Daten in irgendeiner Form vorliegen.

const APEX_CDN = "https://esm.sh/apexcharts@3.49.1";

let _apexPromise = null;
async function loadApex() {
  if (!_apexPromise) {
    _apexPromise = import(APEX_CDN).then((m) => m.default || m);
  }
  return _apexPromise;
}

const PRIMARY = "#8B5CF6";
const PALETTE = ["#8B5CF6", "#A78BFA", "#C4B5FD", "#7C3AED", "#6D28D9", "#DDD6FE"];

// ─────────────────────────────────────────────────────────────────────────────
// Shape-Normalization Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Wenn das zweite Argument ein Array ist (positional), wickle es passend:
//   - Sparkline/Line/Area/Bar: array von numbers oder {x,y} → {series:[{name,data}]}
//   - Donut: array von {label,value,color} → {labels,values,colors}
function unwrapPositional(input, kind) {
  if (!Array.isArray(input)) return input || {};
  if (kind === "donut") {
    const labels = [];
    const values = [];
    const colors = [];
    for (const it of input) {
      if (it && typeof it === "object") {
        labels.push(it.label ?? it.name ?? it.key ?? "");
        values.push(Number(it.value ?? it.y ?? it.count ?? 0));
        if (it.color) colors.push(it.color);
      } else {
        values.push(Number(it) || 0);
        labels.push("");
      }
    }
    return { labels, values, colors: colors.length === input.length ? colors : undefined };
  }
  // numeric or {x,y} array → single series
  return { series: [{ name: "Series", data: input }] };
}

// Normalisiere xy/categorical input zu {categories, series:[{name,data}], colors}
function normalizeXY(input) {
  const o = { ...input };

  // 1) Legacy: { data:[{x,y}], color }  oder  { data:[{[xKey]:..., [seriesKey]:...}], x:'date', series:[{key,label,color}] }
  if (Array.isArray(o.data) && (!o.series || !Array.isArray(o.series) || !o.series.length || typeof o.series[0]?.data === "undefined")) {
    const rows = o.data;
    // Sub-case A: rows sind {x,y}
    if (rows.length && typeof rows[0] === "object" && "x" in rows[0] && "y" in rows[0]) {
      o.categories = o.categories || rows.map((r) => r.x);
      o.series = [{ name: o.name || "Series", data: rows.map((r) => Number(r.y) || 0) }];
      if (o.color && !o.colors) o.colors = [o.color];
    }
    // Sub-case B: rows + xKey + series-defs mit {key,label,color}
    else if (typeof o.x === "string" && Array.isArray(o.series) && o.series.length && "key" in (o.series[0] || {})) {
      const xKey = o.x;
      const seriesDefs = o.series;
      o.categories = rows.map((r) => r[xKey]);
      const newSeries = seriesDefs.map((s) => ({
        name: s.label || s.name || s.key,
        data: rows.map((r) => Number(r[s.key]) || 0),
      }));
      const cols = seriesDefs.map((s) => s.color).filter(Boolean);
      o.series = newSeries;
      if (cols.length === seriesDefs.length && !o.colors) o.colors = cols;
    }
    // Sub-case C: rows numerisch oder einfache scalars
    else if (rows.length && (typeof rows[0] === "number" || typeof rows[0] !== "object")) {
      o.series = [{ name: o.name || "Series", data: rows.map(Number) }];
    }
    // Sub-case D: rows mit {label,value} → bar-ähnlich
    else if (rows.length && typeof rows[0] === "object" && ("label" in rows[0] || "name" in rows[0]) && ("value" in rows[0] || "count" in rows[0])) {
      o.categories = o.categories || rows.map((r) => r.label ?? r.name);
      o.series = [{ name: o.name || "Series", data: rows.map((r) => Number(r.value ?? r.count) || 0) }];
      const cols = rows.map((r) => r.color).filter(Boolean);
      if (cols.length === rows.length && !o.colors) o.colors = cols;
    }
  }

  // 2) Legacy: { labels:[], data:[] } oder { labels:[], values:[] } für area/bar/line
  if (!o.categories && Array.isArray(o.labels) && (Array.isArray(o.data) || Array.isArray(o.values))) {
    o.categories = o.labels;
    const vals = Array.isArray(o.values) ? o.values : o.data;
    if (!o.series || !Array.isArray(o.series) || !o.series.length) {
      o.series = [{ name: o.name || "Series", data: (vals || []).map((v) => Number(v) || 0) }];
    }
  }

  // 3) color (single) → colors (array)
  if (o.color && !o.colors) o.colors = [o.color];

  // 4) series-Normalisierung: stelle sicher dass jedes series-Element {name,data} ist
  if (Array.isArray(o.series)) {
    o.series = o.series.map((s, i) => {
      if (s && typeof s === "object" && Array.isArray(s.data)) {
        return { name: s.name || s.label || s.key || `Series ${i + 1}`, data: s.data };
      }
      if (Array.isArray(s)) return { name: `Series ${i + 1}`, data: s };
      if (typeof s === "number") {
        // flat number array got wrapped — undo
        return null;
      }
      return s;
    }).filter(Boolean);
  }

  // 5) Edge: series ist ein flaches Number-Array (z.B. series:[1,2,3])
  if (Array.isArray(input.series) && input.series.length && typeof input.series[0] === "number") {
    o.series = [{ name: "Series", data: input.series.map(Number) }];
  }

  return o;
}

// Normalisiere Donut-Input zu {labels, values, colors}
function normalizeDonut(input) {
  const o = { ...input };
  // Legacy: { data:[{label,value,color}] }
  if (Array.isArray(o.data) && (!o.labels || !o.values)) {
    const rows = o.data;
    const labels = [];
    const values = [];
    const cols = [];
    for (const r of rows) {
      if (r && typeof r === "object") {
        labels.push(r.label ?? r.name ?? r.key ?? "");
        values.push(Number(r.value ?? r.y ?? r.count ?? 0));
        if (r.color) cols.push(r.color);
      } else {
        values.push(Number(r) || 0);
        labels.push("");
      }
    }
    o.labels = o.labels || labels;
    o.values = o.values || values;
    if (cols.length === rows.length && !o.colors) o.colors = cols;
  }
  // Legacy: { series:[numbers] }
  if (!o.values && Array.isArray(o.series) && typeof o.series[0] === "number") {
    o.values = o.series.map(Number);
  }
  // Legacy: { series:[{name,data:[n]}] } → erstes data-elem
  if (!o.values && Array.isArray(o.series) && o.series[0] && Array.isArray(o.series[0].data)) {
    o.values = o.series.map((s) => Number(s.data?.[0] ?? s.data) || 0);
    if (!o.labels) o.labels = o.series.map((s) => s.name || "");
  }
  if (!Array.isArray(o.labels)) o.labels = [];
  if (!Array.isArray(o.values)) o.values = [];
  return o;
}

// Sparkline-Normalisierung: akzeptiert array, {values}, {data}, {series:[{data}]}
function normalizeSpark(input) {
  if (Array.isArray(input)) return { values: input.map((v) => Number(v) || 0) };
  const o = { ...(input || {}) };
  if (!Array.isArray(o.values)) {
    if (Array.isArray(o.data)) {
      o.values = o.data.map((v) => (typeof v === "object" && v ? Number(v.y ?? v.value) || 0 : Number(v) || 0));
    } else if (Array.isArray(o.series) && o.series[0]) {
      const s0 = o.series[0];
      o.values = Array.isArray(s0) ? s0.map(Number) : Array.isArray(s0.data) ? s0.data.map(Number) : [];
    } else {
      o.values = [];
    }
  }
  return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base
// ─────────────────────────────────────────────────────────────────────────────

function baseOptions({ height = 240 } = {}) {
  return {
    chart: {
      height,
      background: "transparent",
      foreColor: "#E5E7EB",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: {
        enabled: true,
        easing: "easeOutCubic",
        speed: 600,
        animateGradually: { enabled: true, delay: 80 },
        dynamicAnimation: { enabled: true, speed: 350 },
      },
    },
    theme: { mode: "dark" },
    colors: [PRIMARY],
    grid: {
      show: true,
      borderColor: "transparent",
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: false } },
      padding: { top: 0, right: 8, bottom: 0, left: 8 },
    },
    xaxis: {
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: "#9CA3AF", fontSize: "11px" } },
    },
    yaxis: {
      labels: { style: { colors: "#9CA3AF", fontSize: "11px" } },
    },
    tooltip: {
      theme: "dark",
      style: { fontSize: "11px" },
      marker: { show: true },
      x: { show: true },
    },
    legend: {
      labels: { colors: "#E5E7EB" },
      fontSize: "12px",
      markers: { width: 8, height: 8, radius: 4 },
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2 },
  };
}

function mergeColors(opts, colors) {
  if (Array.isArray(colors) && colors.length) opts.colors = colors;
  return opts;
}

async function build(container, options) {
  const ApexCharts = await loadApex();
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) throw new Error("charts: container not found");
  const chart = new ApexCharts(el, options);
  await chart.render();
  return chart;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factories
// ─────────────────────────────────────────────────────────────────────────────

export async function makeLineChart(container, input = {}) {
  const cfg = normalizeXY(unwrapPositional(input, "xy"));
  const { series, categories, height = 240, colors = [PRIMARY], smooth = true, stacked = false } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "line";
  if (stacked) opts.chart.stacked = true;
  opts.series = Array.isArray(series) && series.length ? series : [{ name: "Series", data: [] }];
  opts.xaxis.categories = categories || [];
  opts.stroke = { curve: smooth ? "smooth" : "straight", width: 2 };
  // Wenn Series mixed types haben (line+area), Apex respektiert series[].type;
  // damit gefüllte Areas mit gradient gerendert werden, fill type 'gradient' setzen.
  const hasArea = Array.isArray(series) && series.some(s => s && s.type === "area");
  if (hasArea) {
    opts.fill = {
      type: series.map(s => (s && s.type === "area") ? "gradient" : "solid"),
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 100] },
    };
    // Stroke pro Series: area-series ohne sichtbare Linie (nur Fläche), line-series 2px
    opts.stroke = {
      curve: smooth ? "smooth" : "straight",
      width: series.map(s => (s && s.type === "area") ? 0 : 2),
    };
  }
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeBarChart(container, input = {}) {
  const cfg = normalizeXY(unwrapPositional(input, "xy"));
  const { series, categories, height = 240, horizontal = false, colors } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "bar";
  opts.series = Array.isArray(series) && series.length ? series : [{ name: "Series", data: [] }];
  opts.xaxis.categories = categories || [];
  opts.plotOptions = {
    bar: {
      horizontal,
      borderRadius: 6,
      borderRadiusApplication: "end",
      columnWidth: "55%",
    },
  };
  opts.stroke = { show: true, width: 0, colors: ["transparent"] };
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeAreaChart(container, input = {}) {
  const cfg = normalizeXY(unwrapPositional(input, "xy"));
  const { series, categories, height = 240, colors = [PRIMARY] } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "area";
  opts.series = Array.isArray(series) && series.length ? series : [{ name: "Series", data: [] }];
  opts.xaxis.categories = categories || [];
  opts.stroke = { curve: "smooth", width: 2 };
  opts.fill = {
    type: "gradient",
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0.05,
      stops: [0, 100],
    },
  };
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeDonutChart(container, input = {}) {
  const cfg = normalizeDonut(unwrapPositional(input, "donut"));
  const { labels, values, height = 300, colors, centerLabel } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "donut";
  opts.series = (values || []).map((v) => Number(v) || 0);
  opts.labels = labels || [];
  delete opts.xaxis;
  delete opts.yaxis;
  delete opts.grid;
  opts.stroke = { width: 0 };
  opts.plotOptions = {
    pie: {
      donut: {
        size: "68%",
        labels: {
          show: true,
          name: { color: "#E5E7EB", fontSize: "12px" },
          value: { color: "#FFFFFF", fontSize: "20px", fontWeight: 600 },
          total: {
            show: true,
            label: centerLabel || "Gesamt",
            color: "#9CA3AF",
            formatter: (w) =>
              w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString("de-DE"),
          },
        },
      },
    },
  };
  opts.legend = {
    ...opts.legend,
    position: "bottom",
  };
  mergeColors(opts, colors || PALETTE);
  return build(container, opts);
}

export async function makeRadialBar(
  container,
  { value, label, height = 200, colors = [PRIMARY] } = {}
) {
  const opts = baseOptions({ height });
  opts.chart.type = "radialBar";
  opts.series = [Number(value) || 0];
  opts.labels = [label || ""];
  delete opts.xaxis;
  delete opts.yaxis;
  delete opts.grid;
  opts.stroke = { lineCap: "round" };
  opts.plotOptions = {
    radialBar: {
      hollow: { size: "62%", background: "transparent" },
      track: { background: "rgba(139,92,246,0.15)", strokeWidth: "100%" },
      dataLabels: {
        name: { color: "#9CA3AF", fontSize: "12px", offsetY: 18 },
        value: {
          color: "#FFFFFF",
          fontSize: "22px",
          fontWeight: 600,
          offsetY: -8,
          formatter: (v) => `${Math.round(v)}%`,
        },
      },
    },
  };
  opts.fill = {
    type: "gradient",
    gradient: {
      shade: "dark",
      type: "horizontal",
      gradientToColors: ["#C4B5FD"],
      stops: [0, 100],
    },
  };
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeHeatmap(container, input = {}) {
  const cfg = Array.isArray(input) ? { series: input } : (input || {});
  const { series, height = 280, colors = [PRIMARY] } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "heatmap";
  opts.series = series || [];
  opts.stroke = { width: 1, colors: ["#0B0B0F"] };
  opts.plotOptions = {
    heatmap: {
      radius: 4,
      enableShades: true,
      shadeIntensity: 0.6,
      colorScale: {
        ranges: [
          { from: 0, to: 0, color: "#1F1B2E", name: "0" },
          { from: 1, to: 25, color: "#3B2A66", name: "niedrig" },
          { from: 26, to: 60, color: "#6D28D9", name: "mittel" },
          { from: 61, to: 100, color: "#8B5CF6", name: "hoch" },
        ],
      },
    },
  };
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeSparkline(container, input = {}, maybeOpts) {
  // Backwards compat: makeSparkline(el, [1,2,3], {color, height})
  let cfg = normalizeSpark(input);
  if (maybeOpts && typeof maybeOpts === "object") {
    cfg = { ...cfg, ...maybeOpts };
  }
  const { values, height = 60, color = PRIMARY } = cfg;
  const opts = baseOptions({ height });
  opts.chart.type = "line";
  opts.chart.sparkline = { enabled: true };
  opts.series = [{ name: "", data: values || [] }];
  opts.stroke = { curve: "smooth", width: 2 };
  opts.tooltip = {
    theme: "dark",
    style: { fontSize: "11px" },
    fixed: { enabled: false },
    x: { show: false },
    marker: { show: false },
  };
  opts.colors = [color];
  return build(container, opts);
}

export default {
  makeLineChart,
  makeBarChart,
  makeAreaChart,
  makeDonutChart,
  makeRadialBar,
  makeHeatmap,
  makeSparkline,
};
