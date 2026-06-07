// charts.js — ApexCharts wrapper module
// Dark theme, violet primary (#8B5CF6), smooth fade-in animations, compact tooltips.
// All factories are async, await chart.render(), and return the chart instance
// so callers can chart.destroy() when needed.

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

// Shared base config — dark theme, no axis grid lines, compact tooltip,
// 600ms easeOutCubic fade-in.
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

export async function makeLineChart(
  container,
  { series, categories, height = 240, colors = [PRIMARY], smooth = true } = {}
) {
  const opts = baseOptions({ height });
  opts.chart.type = "line";
  opts.series = Array.isArray(series) && typeof series[0] === "object" ? series : [{ name: "Series", data: series || [] }];
  opts.xaxis.categories = categories || [];
  opts.stroke = { curve: smooth ? "smooth" : "straight", width: 2 };
  mergeColors(opts, colors);
  return build(container, opts);
}

export async function makeBarChart(
  container,
  { series, categories, height = 240, horizontal = false, colors } = {}
) {
  const opts = baseOptions({ height });
  opts.chart.type = "bar";
  opts.series = Array.isArray(series) && typeof series[0] === "object" ? series : [{ name: "Series", data: series || [] }];
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

export async function makeAreaChart(
  container,
  { series, categories, height = 240, colors = [PRIMARY] } = {}
) {
  const opts = baseOptions({ height });
  opts.chart.type = "area";
  opts.series = Array.isArray(series) && typeof series[0] === "object" ? series : [{ name: "Series", data: series || [] }];
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

export async function makeDonutChart(
  container,
  { labels, values, height = 300, colors } = {}
) {
  const opts = baseOptions({ height });
  opts.chart.type = "donut";
  opts.series = values || [];
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
            label: "Gesamt",
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

export async function makeHeatmap(
  container,
  { series, height = 280, colors = [PRIMARY] } = {}
) {
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

export async function makeSparkline(
  container,
  { values, height = 60, color = PRIMARY } = {}
) {
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
