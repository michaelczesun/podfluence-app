import { sb } from '/lib/supabase.js?v=20260608f'
import { toast, confirmDialog, fmtNumber, fmtRelativeTime, htmlEscape, iconHtml, spinnerHtml } from '/lib/ui.js?v=20260608f'
import { makeBarChart, makeDonutChart, makeRadialBar } from '/lib/charts.js?v=20260608f'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608f'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608f'
import { drawer } from '/lib/layout-extras.js?v=20260608f'

const TOTAL_BYTES = 1024 * 1024 * 1024 // 1 GB Free-Tier
const WARN_THRESHOLD = 0.7

function fmtBytes(n) {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

function pct(used, total) {
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 1000) / 10)
}

async function fetchBuckets() {
  const { data, error } = await sb.storage.listBuckets()
  if (error) throw error
  return data || []
}

// FIX #2: Ordner-Erkennung ausschließlich über item.metadata === null && item.id === null.
// Dateinamen-Heuristik (includes('.')) entfernt — Dateien ohne Extension werden nicht mehr
// fälschlicherweise als Verzeichnis behandelt.
async function fetchBucketContents(bucketName, prefix = '', acc = [], depth = 0) {
  if (depth > 4) return acc
  try {
    const { data, error } = await sb.storage.from(bucketName).list(prefix, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' }
    })
    if (error) throw error
    for (const item of (data || [])) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.metadata === null && item.id === null) {
        // Echter Ordner: rekursiv durchsuchen
        await fetchBucketContents(bucketName, path, acc, depth + 1)
      } else {
        acc.push({
          name: item.name,
          path,
          size: item.metadata?.size || 0,
          mime: item.metadata?.mimetype || '—',
          updated: item.updated_at || item.created_at,
          bucket: bucketName
        })
      }
    }
  } catch (e) {
    console.warn('[storage-ops] list failed', bucketName, prefix, e)
  }
  return acc
}

async function triggerRecompress(bucketName) {
  try {
    const { data, error } = await sb.functions.invoke('recompress-storage', {
      body: { bucket: bucketName }
    })
    if (error) throw error
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

async function deleteFile(bucket, path) {
  const { error } = await sb.storage.from(bucket).remove([path])
  if (error) throw error
}

function renderError(body, msg, retry) {
  body.innerHTML = `
    <div class="glass-card empty-state">
      <div class="empty-icon">${iconHtml('alert-triangle')}</div>
      <h3>Konnte Storage nicht laden</h3>
      <p>Fehler: ${htmlEscape(msg || 'Unbekannter Fehler')}</p>
      <button class="btn btn-primary" id="retryBtn">Erneut versuchen</button>
    </div>`
  body.querySelector('#retryBtn')?.addEventListener('click', retry)
}

function renderEmpty(body) {
  body.innerHTML = `
    <div class="glass-card empty-state">
      <div class="empty-icon">${iconHtml('database')}</div>
      <h3>Keine Buckets gefunden</h3>
      <p>Es sind aktuell keine Storage-Buckets konfiguriert.</p>
    </div>`
}

function renderSkeleton(body) {
  try {
    const skel = skeletonLoader()
    if (typeof skel === 'string') {
      body.innerHTML = skel
      return
    }
    if (skel instanceof Node) {
      body.appendChild(skel)
      return
    }
  } catch {}
  // Fallback
  body.innerHTML = `
    <div class="glass-card" style="padding:24px;text-align:center">
      ${spinnerHtml()} <span class="muted">Lade Storage-Daten…</span>
    </div>`
}

function renderTotalHero(body, totalUsed) {
  const usedPct = pct(totalUsed, TOTAL_BYTES)
  const warn = usedPct >= WARN_THRESHOLD * 100
  const heroEl = document.createElement('div')
  heroEl.className = 'glass-card hero-row'
  heroEl.innerHTML = `
    <div class="hero-grid">
      <div class="hero-stat">
        <div class="hero-label">Gesamt belegt</div>
        <div class="hero-value" id="totalUsedVal">0 B</div>
        <div class="hero-sub">${fmtBytes(TOTAL_BYTES)} Free-Tier</div>
      </div>
      <div class="hero-stat">
        <div class="hero-label">Auslastung</div>
        <div class="hero-value ${warn ? 'is-warn' : ''}" id="totalPctVal">0%</div>
        <div class="progress-bar"><div class="progress-fill ${warn ? 'is-warn' : ''}" style="width:0%" id="totalProg"></div></div>
      </div>
      <div class="hero-stat">
        <div class="hero-label">Status</div>
        <div class="hero-badge ${warn ? 'badge-warn' : 'badge-ok'}">
          ${warn ? iconHtml('alert-triangle') + ' Speicher knapp' : iconHtml('check') + ' OK'}
        </div>
        <div class="hero-sub">${warn ? 'Recompress empfohlen' : 'Innerhalb sicherer Zone'}</div>
      </div>
    </div>`
  body.appendChild(heroEl)

  try {
    countUp(heroEl.querySelector('#totalUsedVal'), 0, totalUsed, 900, (v) => fmtBytes(v))
    countUp(heroEl.querySelector('#totalPctVal'), 0, usedPct, 900, (v) => `${v.toFixed(1)}%`)
  } catch {
    heroEl.querySelector('#totalUsedVal').textContent = fmtBytes(totalUsed)
    heroEl.querySelector('#totalPctVal').textContent = `${usedPct.toFixed(1)}%`
  }
  setTimeout(() => {
    const p = heroEl.querySelector('#totalProg')
    if (p) p.style.width = `${usedPct}%`
  }, 50)

  if (warn) {
    const warnBox = document.createElement('div')
    warnBox.className = 'warn-banner'
    warnBox.innerHTML = `${iconHtml('alert-triangle')} <strong>Achtung:</strong> Über 70% des Free-Tier belegt (${usedPct.toFixed(1)}%). Recompress älterer Bilder einplanen.`
    body.appendChild(warnBox)
  }
}

// FIX #1: renderJobStatus und fetchJobStatus entfernt — Tabelle storage_recompress_jobs
// existiert nicht im Schema. Sektion erzeugte false expectation. Wird wieder eingebaut
// sobald die Tabelle angelegt ist.

function renderAllFilesDrawer(files, bucketName, onAction) {
  const wrap = document.createElement('div')
  const sorted = [...files].sort((a, b) => b.size - a.size)
  wrap.innerHTML = `
    <div class="drawer-toolbar">
      <input type="search" placeholder="Filter…" class="input" id="ftFilter" />
      <span class="muted small">${sorted.length} Dateien</span>
    </div>
    <table class="data-table hover">
      <thead><tr><th>Pfad</th><th class="num">Größe</th><th class="num">Aktualisiert</th><th></th></tr></thead>
      <tbody id="ftBody">
        ${sorted.map(f => `
          <tr data-path="${htmlEscape(f.path)}" data-search="${htmlEscape(f.path.toLowerCase())}">
            <td class="file-name" title="${htmlEscape(f.path)}">${htmlEscape(f.path)}</td>
            <td class="num"><strong>${fmtBytes(f.size)}</strong></td>
            <td class="num muted small">${f.updated ? fmtRelativeTime(f.updated) : '—'}</td>
            <td class="row-actions">
              <button class="btn btn-icon btn-ghost" data-act="del" title="Löschen">${iconHtml('trash')}</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`

  wrap.querySelector('#ftFilter').addEventListener('input', (ev) => {
    const q = ev.target.value.toLowerCase().trim()
    wrap.querySelectorAll('#ftBody tr').forEach(tr => {
      tr.style.display = (!q || tr.dataset.search.includes(q)) ? '' : 'none'
    })
  })

  // FIX #4 (low): ev.currentTarget.closest('tr') statt ev.target.closest('tr')
  wrap.querySelectorAll('[data-act="del"]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const tr = ev.currentTarget.closest('tr')
      const path = tr?.dataset.path
      if (!path) return
      const ok = await confirmDialog(
        'Datei löschen?',
        path,
        'Löschen',
        true
      )
      if (!ok) return
      try {
        await deleteFile(bucketName, path)
        toast('Gelöscht', 'success')
        tr.remove()
        onAction()
      } catch (e) { toast(`Fehler: ${e.message}`, 'error') }
    })
  })

  return wrap
}

// FIX #3: Radial-Chart gegen TOTAL_BYTES (Free-Tier-Gesamt) statt willkürlichem localTotal.
// sublabel zeigt Anteil an 1 GB Free-Tier explizit an.
function renderBucketCard(bucket, files, totalUsed, onAction) {
  const used = files.reduce((a, b) => a + (b.size || 0), 0)
  const fileCount = files.length
  const usedPct = pct(used, TOTAL_BYTES)
  const top = [...files].sort((a, b) => b.size - a.size).slice(0, 10)

  const card = document.createElement('div')
  card.className = 'glass-card bucket-card'
  const radialId = `radial-${bucket.id || bucket.name}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  card.innerHTML = `
    <div class="bucket-head">
      <div>
        <h3>${iconHtml('hard-drive')} ${htmlEscape(bucket.name)}</h3>
        <div class="muted small">${fmtNumber(fileCount)} Dateien · ${bucket.public ? 'public' : 'private'}</div>
      </div>
      <div class="bucket-actions">
        <button class="btn btn-secondary btn-sm" data-act="export">${iconHtml('download')} CSV</button>
        <button class="btn btn-primary btn-sm" data-act="recompress">${iconHtml('zap')} Recompress</button>
      </div>
    </div>
    <div class="bucket-body">
      <div class="bucket-radial" id="${radialId}"></div>
      <div class="bucket-info">
        <div class="info-row"><span class="muted">Belegt</span><strong>${fmtBytes(used)}</strong></div>
        <div class="info-row"><span class="muted">Dateien</span><strong>${fmtNumber(fileCount)}</strong></div>
        <div class="info-row"><span class="muted">Ø Größe</span><strong>${fmtBytes(fileCount ? used / fileCount : 0)}</strong></div>
      </div>
    </div>
    <div class="bucket-top">
      <div class="card-head">
        <h4>${iconHtml('list')} Größte Dateien</h4>
        <button class="btn btn-ghost btn-sm" data-act="all">${iconHtml('arrow-right')} Alle ansehen</button>
      </div>
      ${top.length === 0 ? `
        <div class="empty-mini">
          <div class="empty-icon-sm">${iconHtml('inbox')}</div>
          <p class="muted small">Bucket ist leer.</p>
        </div>` : `
        <table class="data-table compact hover">
          <thead><tr><th>Datei</th><th>Typ</th><th class="num">Größe</th><th class="num">Aktualisiert</th><th></th></tr></thead>
          <tbody>
            ${top.map(f => `
              <tr data-path="${htmlEscape(f.path)}">
                <td class="file-name" title="${htmlEscape(f.path)}">${htmlEscape(f.name)}</td>
                <td><span class="mime-chip">${htmlEscape((f.mime || '—').split('/').pop() || '—')}</span></td>
                <td class="num"><strong>${fmtBytes(f.size)}</strong></td>
                <td class="num muted small">${f.updated ? fmtRelativeTime(f.updated) : '—'}</td>
                <td class="row-actions">
                  <button class="btn btn-icon btn-ghost" data-row-act="delete" title="Löschen">${iconHtml('trash')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>`

  try {
    makeRadialBar(card.querySelector(`#${radialId}`), {
      value: usedPct,
      label: `${usedPct.toFixed(1)}%`,
      sublabel: `von 1 GB Free-Tier`,
      color: usedPct > 70 ? '#ff5b5b' : usedPct > 40 ? '#ffb547' : '#5be3a4'
    })
  } catch {
    const el = card.querySelector(`#${radialId}`)
    if (el) el.innerHTML = `<div class="muted">${usedPct.toFixed(1)}% v. 1 GB</div>`
  }

  card.querySelector('[data-act="export"]').addEventListener('click', () => {
    try {
      exportCsv(files.map(f => ({
        path: f.path, name: f.name, size: f.size, mime: f.mime, updated: f.updated
      })), [], `storage-${bucket.name}.csv`)
      toast(`CSV exportiert (${fileCount} Dateien)`)
    } catch (e) {
      toast(`Export-Fehler: ${e.message}`, 'error')
    }
  })

  card.querySelector('[data-act="recompress"]').addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Recompress: ${bucket.name}`,
      `Alle Bilder im Bucket "${bucket.name}" neu komprimieren? Das kann je nach Anzahl mehrere Minuten dauern.`,
      'Starten',
      false
    )
    if (!ok) return
    const btn = card.querySelector('[data-act="recompress"]')
    btn.disabled = true
    btn.innerHTML = `${spinnerHtml()} Läuft…`
    const res = await triggerRecompress(bucket.name)
    btn.disabled = false
    btn.innerHTML = `${iconHtml('zap')} Recompress`
    if (res.ok) {
      toast(`Job für "${bucket.name}" gestartet`, 'success')
      onAction()
    } else {
      toast(`Fehler: ${res.error}`, 'error')
    }
  })

  card.querySelector('[data-act="all"]').addEventListener('click', () => {
    try {
      drawer({
        title: `Alle Dateien · ${bucket.name}`,
        width: 720,
        content: renderAllFilesDrawer(files, bucket.name, onAction)
      })
    } catch (e) {
      toast(`Drawer-Fehler: ${e.message}`, 'error')
    }
  })

  // FIX #4 (low, bucket-top table): ev.currentTarget.closest('tr') für deterministisches Verhalten
  card.querySelectorAll('[data-row-act="delete"]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const tr = ev.currentTarget.closest('tr')
      const path = tr?.dataset.path
      if (!path) return
      const ok = await confirmDialog(
        'Datei löschen?',
        `${path}\n\nDieser Vorgang ist endgültig.`,
        'Löschen',
        true
      )
      if (!ok) return
      try {
        await deleteFile(bucket.name, path)
        toast('Datei gelöscht', 'success')
        tr.remove()
      } catch (e) {
        toast(`Fehler: ${e.message}`, 'error')
      }
    })
  })

  return card
}

function renderDistribution(body, bucketSummaries) {
  if (!bucketSummaries.length) return
  const card = document.createElement('div')
  card.className = 'glass-card chart-card'
  card.innerHTML = `
    <div class="card-head">
      <h3>${iconHtml('pie-chart')} Verteilung nach Bucket</h3>
      <span class="muted small">Belegung &amp; Dateianzahl</span>
    </div>
    <div class="chart-grid">
      <div id="distDonut" class="chart-half"></div>
      <div id="distBar" class="chart-half"></div>
    </div>`
  body.appendChild(card)
  try {
    makeDonutChart(card.querySelector('#distDonut'), {
      labels: bucketSummaries.map(b => b.name),
      values: bucketSummaries.map(b => b.used),
      formatter: (v) => fmtBytes(v)
    })
  } catch {}
  try {
    makeBarChart(card.querySelector('#distBar'), {
      labels: bucketSummaries.map(b => b.name),
      values: bucketSummaries.map(b => b.count),
      label: 'Dateien'
    })
  } catch {}
}

export default {
  id: 'storage-ops',
  title: 'Storage & Cleanup',
  category: 'admin_actions',
  async mount(container) {
    try {
      container.innerHTML = `
        <div class="panel-shell storage-ops-panel">
          <div class="panel-head">
            <div>
              <h2>${iconHtml('database')} Storage &amp; Cleanup</h2>
              <p class="muted small">Bucket-Auslastung, größte Dateien &amp; Recompress-Steuerung</p>
            </div>
            <div class="toolbar">
              <button class="btn btn-secondary" id="refreshBtn">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button class="btn btn-secondary" id="pdfBtn">${iconHtml('file-text')} PDF</button>
              <button class="btn btn-secondary" id="csvBtn">${iconHtml('download')} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="body"></div>
        </div>`

      const body = container.querySelector('#body')

      const load = async () => {
        renderSkeleton(body)

        let buckets = []
        try {
          buckets = await fetchBuckets()
        } catch (e) {
          return renderError(body, e.message, load)
        }

        if (!buckets.length) {
          body.innerHTML = ''
          return renderEmpty(body)
        }

        // FIX #3 (separate try/catch): fetchBucketContents isoliert von potenziellem
        // Job-Fetch — Bucket-Daten werden trotzdem gerendert wenn Job-Fetch fehlschlägt.
        // (fetchJobStatus entfernt — Tabelle existiert noch nicht; kein separater catch nötig)
        let contents = []
        try {
          contents = await Promise.all(buckets.map(b => fetchBucketContents(b.name)))
        } catch (e) {
          return renderError(body, e.message, load)
        }

        const bucketSummaries = buckets.map((b, i) => ({
          ...b,
          files: contents[i] || [],
          used: (contents[i] || []).reduce((a, f) => a + (f.size || 0), 0),
          count: (contents[i] || []).length
        }))
        const totalUsed = bucketSummaries.reduce((a, s) => a + s.used, 0)
        const allFiles = bucketSummaries.flatMap(s => s.files.map(f => ({ ...f, bucket: s.name })))

        container._exportPayload = { bucketSummaries, totalUsed, allFiles }

        body.innerHTML = ''

        renderTotalHero(body, totalUsed)
        renderDistribution(body, bucketSummaries)

        const grid = document.createElement('div')
        grid.className = 'bucket-grid'
        body.appendChild(grid)
        for (const b of bucketSummaries) {
          grid.appendChild(renderBucketCard(b, b.files, totalUsed, load))
        }

        try { fadeIn(body) } catch {}
      }

      container.querySelector('#refreshBtn').addEventListener('click', () => {
        toast('Wird aktualisiert…')
        load()
      })

      container.querySelector('#csvBtn').addEventListener('click', () => {
        const p = container._exportPayload
        // FIX (low): 'warning' statt 'error' für nicht-kritischen Zustand
        if (!p) return toast('Noch keine Daten geladen', 'warning')
        try {
          exportCsv(p.allFiles.map(f => ({
            bucket: f.bucket, path: f.path, size: f.size, mime: f.mime, updated: f.updated
          })), [], 'storage-overview.csv')
          toast(`${p.allFiles.length} Zeilen exportiert`, 'success')
        } catch (e) {
          toast(`CSV-Fehler: ${e.message}`, 'error')
        }
      })

      container.querySelector('#pdfBtn').addEventListener('click', async () => {
        try {
          await exportPanelAsPdf(container, 'Storage & Cleanup')
          toast('PDF erstellt', 'success')
        } catch (e) {
          toast(`PDF-Fehler: ${e.message}`, 'error')
        }
      })

      await load()
    } catch (e) {
      console.error('[storage-ops] mount failed', e)
      container.innerHTML = `
        <div class="glass-card empty-state" style="margin:24px">
          <div class="empty-icon">${iconHtml ? iconHtml('alert-triangle') : '⚠'}</div>
          <h3>Panel konnte nicht geladen werden</h3>
          <p>Fehler: ${htmlEscape ? htmlEscape(e.message || String(e)) : (e.message || String(e))}</p>
          <button class="btn btn-primary" onclick="location.reload()">Seite neu laden</button>
        </div>`
    }
  }
}
