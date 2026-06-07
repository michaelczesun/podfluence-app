// lib/export.js — hozd CRM Export Utilities
// PDF / CSV / JSON / PNG export helpers.
// CDN dependencies are loaded on-demand via dynamic import from esm.sh.

const JSPDF_CDN = 'https://esm.sh/jspdf@2.5.1';
const HTML2CANVAS_CDN = 'https://esm.sh/html2canvas@1.4.1';

let _jspdfPromise = null;
let _html2canvasPromise = null;

async function loadJsPDF() {
  if (!_jspdfPromise) {
    _jspdfPromise = import(/* @vite-ignore */ JSPDF_CDN).then(
      (mod) => mod.jsPDF || mod.default?.jsPDF || mod.default
    );
  }
  return _jspdfPromise;
}

async function loadHtml2Canvas() {
  if (!_html2canvasPromise) {
    _html2canvasPromise = import(/* @vite-ignore */ HTML2CANVAS_CDN).then(
      (mod) => mod.default || mod
    );
  }
  return _html2canvasPromise;
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

function isoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeSlug(s) {
  return String(s || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Build a final filename with ISO date prefix and `hozd-crm_` namespace.
 * Example: prefixFilename('users-list.pdf') -> '2026-06-07_hozd-crm_users-list.pdf'
 * If the input already contains a date prefix, it's preserved as given.
 */
export function prefixFilename(filename, ext) {
  const today = isoDate();
  let name = String(filename || 'export').trim();

  // If caller passed an explicit ext, ensure it's appended.
  if (ext && !name.toLowerCase().endsWith('.' + ext.toLowerCase())) {
    name = `${name}.${ext}`;
  }

  // If already prefixed with our pattern, return as is.
  if (/^\d{4}-\d{2}-\d{2}_hozd-crm[_-]/i.test(name)) return name;

  // Strip a leading "hozd-crm_" if user already added it (we'll re-add cleanly).
  name = name.replace(/^hozd-crm[_-]/i, '');

  // Split name and extension
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extPart = dot > 0 ? name.slice(dot) : '';

  return `${today}_hozd-crm_${sanitizeSlug(base)}${extPart}`;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

/**
 * Export a panel (DOM element) as PDF.
 * Renders via html2canvas, drops into A4 landscape jsPDF, paginates when tall.
 *
 * @param {HTMLElement} panelElement
 * @param {string} filename
 * @param {object} [options]
 * @param {string} [options.panelTitle] - Title used in header. Defaults to data-title / inner h1-h3 text.
 * @param {number} [options.scale=2]   - html2canvas scale (sharpness).
 * @param {string} [options.background='#ffffff']
 */
export async function exportPanelAsPdf(panelElement, filename, options = {}) {
  if (!panelElement) throw new Error('exportPanelAsPdf: panelElement is required');

  const [jsPDF, html2canvas] = await Promise.all([loadJsPDF(), loadHtml2Canvas()]);

  const scale = options.scale ?? 2;
  const background = options.background ?? '#ffffff';
  const panelTitle =
    options.panelTitle ||
    panelElement.dataset?.title ||
    panelElement.querySelector('h1,h2,h3,.panel-title')?.textContent?.trim() ||
    'Export';

  const canvas = await html2canvas(panelElement, {
    scale,
    backgroundColor: background,
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();   // 297mm
  const pageH = pdf.internal.pageSize.getHeight();  // 210mm

  // Header layout
  const marginX = 10;
  const headerH = 14;
  const footerH = 8;
  const contentTop = headerH + 2;
  const contentH = pageH - contentTop - footerH;
  const contentW = pageW - marginX * 2;

  const drawHeader = (pageNum, pageCount) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`hozd CRM — ${panelTitle}`, marginX, 9);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(110, 110, 110);
    const dateStr = new Date().toLocaleString('de-DE');
    pdf.text(dateStr, pageW - marginX, 9, { align: 'right' });

    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.2);
    pdf.line(marginX, headerH, pageW - marginX, headerH);

    // Footer
    pdf.setFontSize(8);
    pdf.setTextColor(140, 140, 140);
    pdf.text(`Seite ${pageNum} / ${pageCount}`, pageW / 2, pageH - 4, { align: 'center' });
  };

  // Compute pixels per mm in source canvas (canvas is contentW wide).
  const pxPerMm = canvas.width / contentW;
  const pageContentPx = Math.floor(contentH * pxPerMm);
  const pageCount = Math.max(1, Math.ceil(canvas.height / pageContentPx));

  for (let p = 0; p < pageCount; p++) {
    if (p > 0) pdf.addPage();

    const sliceY = p * pageContentPx;
    const sliceH = Math.min(pageContentPx, canvas.height - sliceY);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      canvas,
      0, sliceY, canvas.width, sliceH,
      0, 0, canvas.width, sliceH
    );

    const imgData = sliceCanvas.toDataURL('image/png');
    const imgHmm = sliceH / pxPerMm;

    drawHeader(p + 1, pageCount);
    pdf.addImage(imgData, 'PNG', marginX, contentTop, contentW, imgHmm, undefined, 'FAST');
  }

  const finalName = prefixFilename(filename, 'pdf');
  pdf.save(finalName);
  return finalName;
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Normalize newlines
  s = s.replace(/\r\n?/g, '\n');
  if (/[",;\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Generate a CSV (Excel-friendly, UTF-8 BOM, ; separator) and trigger download.
 *
 * @param {Array<object>} rows
 * @param {Array<{key:string,label?:string,format?:(v:any,row:object)=>any}>|Array<string>} columns
 * @param {string} filename
 */
export function exportCsv(rows, columns, filename) {
  if (!Array.isArray(rows)) rows = [];
  if (!Array.isArray(columns) || columns.length === 0) {
    // Auto-derive columns from first row.
    const first = rows[0] || {};
    columns = Object.keys(first).map((k) => ({ key: k, label: k }));
  }
  const cols = columns.map((c) =>
    typeof c === 'string' ? { key: c, label: c } : { label: c.key, ...c }
  );

  const sep = ';';
  const header = cols.map((c) => csvEscape(c.label ?? c.key)).join(sep);
  const lines = rows.map((row) =>
    cols
      .map((c) => {
        const raw = row?.[c.key];
        const val = typeof c.format === 'function' ? c.format(raw, row) : raw;
        return csvEscape(val);
      })
      .join(sep)
  );

  const csv = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const finalName = prefixFilename(filename, 'csv');
  triggerDownload(blob, finalName);
  return finalName;
}

// ---------------------------------------------------------------------------
// JSON Export
// ---------------------------------------------------------------------------

export function exportJson(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const finalName = prefixFilename(filename, 'json');
  triggerDownload(blob, finalName);
  return finalName;
}

// ---------------------------------------------------------------------------
// Chart (ApexCharts) PNG Export
// ---------------------------------------------------------------------------

async function dataUriToBlob(dataUri) {
  // dataUri can be either a string ("data:image/png;base64,...") or { imgURI }
  if (dataUri && typeof dataUri === 'object' && dataUri.imgURI) {
    dataUri = dataUri.imgURI;
  }
  if (!dataUri || typeof dataUri !== 'string') {
    throw new Error('exportChartAsPng: invalid dataURI from chart');
  }
  // Fast path via fetch (works on data: URIs in modern browsers).
  try {
    const res = await fetch(dataUri);
    return await res.blob();
  } catch (_) {
    // Manual decode fallback
    const [meta, b64] = dataUri.split(',');
    const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
}

/**
 * Export an ApexCharts chart instance as PNG.
 * @param {{dataURI: Function}} chartInstance - Apex chart instance.
 * @param {string} filename
 */
export async function exportChartAsPng(chartInstance, filename) {
  if (!chartInstance || typeof chartInstance.dataURI !== 'function') {
    throw new Error('exportChartAsPng: chartInstance.dataURI() not available');
  }
  const result = await chartInstance.dataURI();
  const blob = await dataUriToBlob(result);
  const finalName = prefixFilename(filename, 'png');
  triggerDownload(blob, finalName);
  return finalName;
}

// ---------------------------------------------------------------------------
// Export selected table rows
// ---------------------------------------------------------------------------

/**
 * Look for checked checkboxes inside a panel's table, extract their row data,
 * and export as CSV or JSON.
 *
 * Row data is extracted in this order of preference:
 *  1. <tr data-row='{...json...}'>  (parsed)
 *  2. all `[data-col]` cells in the row
 *  3. all `<td>` text contents, keyed by header (<th>) or "col_N"
 *
 * @param {HTMLElement} panelEl
 * @param {'csv'|'json'} format
 * @param {object} [options]
 * @param {string} [options.filename='selected-rows']
 * @param {Array<{key:string,label?:string}>} [options.columns]
 * @returns {{filename:string, rows:Array<object>}|null}
 */
export function exportSelectedRows(panelEl, format = 'csv', options = {}) {
  if (!panelEl) throw new Error('exportSelectedRows: panelEl required');

  const checked = Array.from(
    panelEl.querySelectorAll('table input[type="checkbox"]:checked, tbody input[type="checkbox"]:checked')
  ).filter((cb) => {
    // Skip "select all" master checkbox (typically lives in <thead>)
    return !cb.closest('thead') && !cb.hasAttribute('data-select-all');
  });

  if (checked.length === 0) {
    console.warn('[export] no rows selected');
    return null;
  }

  // Determine header labels once
  const table = checked[0].closest('table');
  const headerCells = table ? Array.from(table.querySelectorAll('thead th')) : [];
  const headerLabels = headerCells.map((th, i) => {
    const key = th.dataset?.col || th.textContent.trim() || `col_${i}`;
    return { key, label: th.textContent.trim() || key };
  });

  const rows = checked
    .map((cb) => {
      const tr = cb.closest('tr');
      if (!tr) return null;

      // 1) data-row JSON
      if (tr.dataset?.row) {
        try {
          return JSON.parse(tr.dataset.row);
        } catch (_) {
          /* fall through */
        }
      }

      // 2) [data-col] cells
      const colCells = tr.querySelectorAll('[data-col]');
      if (colCells.length > 0) {
        const obj = {};
        colCells.forEach((c) => {
          obj[c.dataset.col] = c.dataset.value ?? c.textContent.trim();
        });
        // include row-level data-* attributes too
        Object.entries(tr.dataset || {}).forEach(([k, v]) => {
          if (k !== 'row') obj[k] = v;
        });
        return obj;
      }

      // 3) fallback: each <td> keyed by header label
      const tds = Array.from(tr.querySelectorAll('td'));
      const obj = {};
      tds.forEach((td, i) => {
        // skip checkbox cell
        if (td.querySelector('input[type="checkbox"]')) return;
        const headerIdx = i;
        const meta = headerLabels[headerIdx];
        const key = meta?.key || `col_${i}`;
        obj[key] = td.textContent.trim();
      });
      return obj;
    })
    .filter(Boolean);

  const baseName = options.filename || 'selected-rows';
  const fmt = String(format || 'csv').toLowerCase();

  if (fmt === 'json') {
    const finalName = exportJson(rows, baseName);
    return { filename: finalName, rows };
  }

  // CSV
  let columns = options.columns;
  if (!columns) {
    if (headerLabels.length > 0) {
      // Filter out header columns whose key never appears in the rows.
      const keysInRows = new Set();
      rows.forEach((r) => Object.keys(r).forEach((k) => keysInRows.add(k)));
      columns = headerLabels.filter((h) => keysInRows.has(h.key));
      if (columns.length === 0) columns = headerLabels;
    } else {
      const first = rows[0] || {};
      columns = Object.keys(first).map((k) => ({ key: k, label: k }));
    }
  }
  const finalName = exportCsv(rows, columns, baseName);
  return { filename: finalName, rows };
}

// ---------------------------------------------------------------------------
// Default export bundle
// ---------------------------------------------------------------------------

export default {
  exportPanelAsPdf,
  exportCsv,
  exportJson,
  exportChartAsPng,
  exportSelectedRows,
  prefixFilename,
};
