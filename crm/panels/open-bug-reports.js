import { sb } from '/lib/supabase.js'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js'
import { makeAreaChart, makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader, slideInRight } from '/lib/animations.js'
import { drawer, glassCard, statHero } from '/lib/layout-extras.js'
import { resolveBugReport, showUserDetailModal } from '/lib/panel-actions.js'

const PRIO = {
  critical: { label: 'Kritisch', color: '#ff3b30', rank: 4 },
  high:     { label: 'Hoch',     color: '#ff9500', rank: 3 },
  medium:   { label: 'Mittel',   color: '#ffcc00', rank: 2 },
  low:      { label: 'Niedrig',  color: '#34c759', rank: 1 }
}

function prioBadge(p) {
  const meta = PRIO[p] || { label: p || '—', color: '#8e8e93', rank: 0 }
  return `<span class="prio-badge" data-prio="${p}" style="--prio-color:${meta.color}">
    <span class="prio-dot"></span>${meta.label}
  </span>`
}

function injectStyles() {
  if (document.getElementById('open-bug-reports-styles')) return
  const s = document.createElement('style')
  s.id = 'open-bug-reports-styles'
  s.textContent = `
    .obr-hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px}
    .obr-chart-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:18px}
    @media(max-width:900px){.obr-chart-grid{grid-template-columns:1fr}}
    .obr-section{padding:18px;border-radius:18px}
    .obr-section h3{margin:0 0 12px 0;font-size:15px;font-weight:600;letter-spacing:-.01em}
    .obr-table-wrap{overflow-x:auto;border-radius:14px}
    .prio-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:600;background:color-mix(in srgb, var(--prio-color) 14%, transparent);color:var(--prio-color);cursor:grab;user-select:none}
    .prio-badge:active{cursor:grabbing}
    .prio-dot{width:7px;height:7px;border-radius:50%;background:var(--prio-color);box-shadow:0 0 0 3px color-mix(in srgb, var(--prio-color) 25%, transparent)}
    .obr-row{transition:background .15s ease}
    .obr-row.dragging{opacity:.4}
    .obr-row.drop-target{background:color-mix(in srgb, var(--accent, #0a84ff) 8%, transparent)}
    .obr-resolve-btn{padding:6px 12px;border-radius:8px;border:1px solid color-mix(in srgb, var(--text,#fff) 14%, transparent);background:transparent;color:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s ease}
    .obr-resolve-btn:hover{background:#34c759;color:#fff;border-color:#34c759}
    .obr-user-link{color:var(--accent,#0a84ff);cursor:pointer;font-weight:500}
    .obr-user-link:hover{text-decoration:underline}
    .obr-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;gap:12px;color:var(--text-muted,#8e8e93)}
    .obr-empty-icon{width:64px;height:64px;border-radius:50%;background:color-mix(in srgb, #34c759 14%, transparent);color:#34c759;display:flex;align-items:center;justify-content:center;font-size:30px}
    .obr-error{display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px;text-align:center}
    .obr-error button{padding:8px 16px;border-radius:10px;border:none;background:var(--accent,#0a84ff);color:#fff;font-weight:600;cursor:pointer}
    .obr-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .obr-tool-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid color-mix(in srgb, var(--text,#fff) 12%, transparent);background:color-mix(in srgb, var(--text,#fff) 4%, transparent);color:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s ease}
    .obr-tool-btn:hover{background:color-mix(in srgb, var(--text,#fff) 10%, transparent);transform:translateY(-1px)}
    .obr-drag-handle{cursor:grab;opacity:.4;padding:4px;font-size:14px}
    .obr-drag-handle:active{cursor:grabbing}
    .obr-row:hover .obr-drag-handle{opacity:.8}
    .obr-resolve-form{display:flex;flex-direction:column;gap:14px;padding:4px}
    .obr-resolve-form label{font-size:12px;font-weight:600;color:var(--text-muted,#8e8e93);text-transform:uppercase;letter-spacing:.04em}
    .obr-resolve-form textarea{width:100%;min-height:130px;padding:12px;border-radius:12px;border:1px solid color-mix(in srgb, var(--text,#fff) 14%, transparent);background:color-mix(in srgb, var(--text,#fff) 4%, transparent);color:inherit;font-family:inherit;font-size:14px;resize:vertical}
    .obr-resolve-form textarea:focus{outline:none;border-color:var(--accent,#0a84ff)}
    .obr-resolve-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px;border-radius:12px;background:color-mix(in srgb, var(--text,#fff) 4%, transparent);font-size:13px}
    .obr-resolve-meta div span:first-child{display:block;font-size:11px;color:var(--text-muted,#8e8e93);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
    .obr-resolve-submit{padding:11px 16px;border-radius:11px;border:none;background:#34c759;color:#fff;font-weight:600;cursor:pointer;font-size:14px}
    .obr-resolve-submit:disabled{opacity:.5;cursor:not-allowed}
    .obr-desc{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted,#aaa)}
  `
  document.head.appendChild(s)
}

async function fetchData() {
  const { data: open, error: e1 } = await sb
    .from('bug_reports')
    .select('id, created_at, title, description, priority, status, user_id, device_info, app_version, category')
    .neq('status', 'resolved')
    .order('created_at', { ascending: false })
    .limit(500)
  if (e1) throw e1

  const since = new Date(Date.now() - 14 * 86400e3).toISOString()
  const { data: trend } = await sb
    .from('bug_reports')
    .select('created_at, status, priority')
    .gte('created_at', since)

  const sinceLast = new Date(Date.now() - 7 * 86400e3).toISOString()
  const sincePrev = new Date(Date.now() - 14 * 86400e3).toISOString()
  const lastWeek = (trend || []).filter(r => r.created_at >= sinceLast).length
  const prevWeek = (trend || []).filter(r => r.created_at >= sincePrev && r.created_at < sinceLast).length
  const change = prevWeek === 0 ? (lastWeek > 0 ? 100 : 0) : Math.round(((lastWeek - prevWeek) / prevWeek) * 100)

  const userIds = [...new Set((open || []).map(r => r.user_id).filter(Boolean))]
  let userMap = {}
  if (userIds.length) {
    const { data: us } = await sb.from('users').select('id, username, display_name, email').in('id', userIds)
    userMap = Object.fromEntries((us || []).map(u => [u.id, u]))
  }

  return { open: open || [], trend: trend || [], change, lastWeek, prevWeek, userMap }
}

function buildTrendSeries(trend) {
  const days = 14
  const buckets = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3)
    const key = d.toISOString().slice(0, 10)
    buckets[key] = 0
  }
  for (const r of trend) {
    const key = (r.created_at || '').slice(0, 10)
    if (key in buckets) buckets[key]++
  }
  return Object.entries(buckets).map(([date, count]) => ({ x: date, y: count }))
}

function buildPrioDistribution(open) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const r of open) {
    const p = r.priority in counts ? r.priority : 'medium'
    counts[p]++
  }
  return Object.entries(counts).map(([k, v]) => ({
    label: PRIO[k].label, value: v, color: PRIO[k].color
  }))
}

function renderTable(rows, userMap) {
  if (!rows.length) {
    return `<div class="obr-empty">
      <div class="obr-empty-icon">${iconHtml ? iconHtml('check') : '✓'}</div>
      <div style="font-size:16px;font-weight:600;color:var(--text,#fff)">Alles sauber.</div>
      <div>Keine offenen Bug-Reports — gute Arbeit.</div>
    </div>`
  }
  const prioOptions = Object.keys(PRIO)
  return `
    <div class="obr-table-wrap">
      <table class="data-table" id="obr-table">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th>Priorität</th>
            <th>Titel</th>
            <th>Kategorie</th>
            <th>Melder</th>
            <th>Gemeldet</th>
            <th style="width:120px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const u = userMap[r.user_id]
            const uName = u ? (u.display_name || u.username || u.email) : (r.user_id ? 'Unbekannt' : 'Anonym')
            return `<tr class="obr-row" data-id="${r.id}" data-prio="${r.priority || 'medium'}" draggable="true">
              <td><span class="obr-drag-handle">⋮⋮</span></td>
              <td>
                <select class="obr-prio-select" data-id="${r.id}" style="background:transparent;border:none;color:inherit;cursor:pointer;font:inherit">
                  ${prioOptions.map(p => `<option value="${p}" ${p === (r.priority || 'medium') ? 'selected' : ''}>${PRIO[p].label}</option>`).join('')}
                </select>
                ${prioBadge(r.priority || 'medium')}
              </td>
              <td>
                <div style="font-weight:600">${htmlEscape(r.title || '(ohne Titel)')}</div>
                ${r.description ? `<div class="obr-desc">${htmlEscape(r.description.slice(0, 120))}</div>` : ''}
              </td>
              <td>${htmlEscape(r.category || '—')}</td>
              <td>${u ? `<span class="obr-user-link" data-uid="${r.user_id}">${htmlEscape(uName)}</span>` : htmlEscape(uName)}</td>
              <td title="${fmtDateTime(r.created_at)}">${fmtRelativeTime(r.created_at)}</td>
              <td><button class="obr-resolve-btn" data-id="${r.id}">Lösen</button></td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>
  `
}

function wireTable(root, rows, userMap, refresh) {
  root.querySelectorAll('.obr-resolve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const row = rows.find(r => String(r.id) === String(id))
      if (row) openResolveDrawer(row, userMap[row.user_id], refresh)
    })
  })
  root.querySelectorAll('.obr-user-link').forEach(el => {
    el.addEventListener('click', () => {
      if (typeof showUserDetailModal === 'function') {
        showUserDetailModal(el.dataset.uid)
      } else {
        toast('User-Detail in Vorbereitung.', 'info')
      }
    })
  })
  root.querySelectorAll('.obr-prio-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id
      const newPrio = sel.value
      try {
        const { error } = await sb.from('bug_reports').update({ priority: newPrio }).eq('id', id)
        if (error) throw error
        toast(`Priorität auf "${PRIO[newPrio].label}" gesetzt`, 'success')
        refresh()
      } catch (err) {
        toast('Fehler: ' + (err.message || err), 'error')
      }
    })
  })

  const tbody = root.querySelector('#obr-table tbody')
  if (!tbody) return
  let dragId = null
  tbody.querySelectorAll('.obr-row').forEach(tr => {
    tr.addEventListener('dragstart', (e) => {
      dragId = tr.dataset.id
      tr.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging')
      tbody.querySelectorAll('.drop-target').forEach(t => t.classList.remove('drop-target'))
    })
    tr.addEventListener('dragover', (e) => {
      e.preventDefault()
      tbody.querySelectorAll('.drop-target').forEach(t => t.classList.remove('drop-target'))
      tr.classList.add('drop-target')
    })
    tr.addEventListener('drop', async (e) => {
      e.preventDefault()
      tr.classList.remove('drop-target')
      if (!dragId || dragId === tr.dataset.id) return
      const targetPrio = tr.dataset.prio
      try {
        const { error } = await sb.from('bug_reports').update({ priority: targetPrio }).eq('id', dragId)
        if (error) throw error
        toast(`Priorität übernommen: "${PRIO[targetPrio].label}"`, 'success')
        refresh()
      } catch (err) {
        toast('Fehler: ' + (err.message || err), 'error')
      }
    })
  })
}

function openResolveDrawer(row, user, refresh) {
  const uName = user ? (user.display_name || user.username || user.email) : (row.user_id ? 'Unbekannt' : 'Anonym')
  const content = `
    <div class="obr-resolve-form">
      <div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px">${htmlEscape(row.title || '(ohne Titel)')}</div>
        ${prioBadge(row.priority || 'medium')}
      </div>

      <div class="obr-resolve-meta">
        <div><span>Melder</span><span>${htmlEscape(uName)}</span></div>
        <div><span>Gemeldet</span><span>${fmtDateTime(row.created_at)}</span></div>
        <div><span>Kategorie</span><span>${htmlEscape(row.category || '—')}</span></div>
        <div><span>App-Version</span><span>${htmlEscape(row.app_version || '—')}</span></div>
      </div>

      ${row.description ? `<div>
        <label>Beschreibung</label>
        <div style="padding:12px;border-radius:12px;background:color-mix(in srgb, var(--text,#fff) 4%, transparent);font-size:13px;white-space:pre-wrap;max-height:200px;overflow:auto">${htmlEscape(row.description)}</div>
      </div>` : ''}

      <div>
        <label for="obr-resolution">Lösungs-Notiz (intern)</label>
        <textarea id="obr-resolution" placeholder="Was wurde gefixt? Commit/PR-Link, betroffener Code, Workaround…"></textarea>
      </div>

      <button class="obr-resolve-submit" id="obr-resolve-submit">
        Als gelöst markieren
      </button>
    </div>
  `
  const d = drawer({ title: 'Bug lösen', content, width: 520 })
  setTimeout(() => {
    const ta = document.getElementById('obr-resolution')
    const btn = document.getElementById('obr-resolve-submit')
    if (ta) ta.focus()
    if (btn) btn.addEventListener('click', async () => {
      const resolution = ((ta && ta.value) || '').trim()
      if (!resolution) {
        toast('Bitte Lösungs-Notiz angeben.', 'error')
        if (ta) ta.focus()
        return
      }
      btn.disabled = true
      btn.textContent = 'Speichern…'
      try {
        if (typeof resolveBugReport === 'function') {
          await resolveBugReport(row.id, resolution)
        } else {
          const { error } = await sb.from('bug_reports').update({
            status: 'resolved',
            resolution,
            resolved_at: new Date().toISOString()
          }).eq('id', row.id)
          if (error) throw error
        }
        toast('Bug als gelöst markiert.', 'success')
        if (d && typeof d.close === 'function') d.close()
        refresh()
      } catch (err) {
        btn.disabled = false
        btn.textContent = 'Als gelöst markieren'
        toast('Fehler: ' + (err.message || err), 'error')
      }
    })
  }, 50)
}

export default {
  id: 'open-bug-reports',
  title: 'Offene Bug-Reports',
  category: 'overview',
  async mount(container) {
    try {
      injectStyles()
      container.innerHTML = `
        <div class="panel-shell" id="obr-shell">
          <div class="panel-head">
            <div>
              <h2 style="margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em">Offene Bug-Reports</h2>
              <div style="font-size:13px;color:var(--text-muted,#8e8e93);margin-top:2px">Live-Übersicht aller ungelösten Meldungen</div>
            </div>
            <div class="obr-toolbar">
              <button class="obr-tool-btn" id="obr-refresh">${iconHtml ? iconHtml('refresh') : '🔄'} Aktualisieren</button>
              <button class="obr-tool-btn" id="obr-pdf">${iconHtml ? iconHtml('file-text') : '📄'} PDF</button>
              <button class="obr-tool-btn" id="obr-csv">${iconHtml ? iconHtml('download') : '💾'} CSV</button>
            </div>
          </div>
          <div class="panel-body" id="obr-body">
            <div class="obr-hero-grid" id="obr-hero">${skeletonLoader ? skeletonLoader({ count: 3, height: 110 }) : (spinnerHtml ? spinnerHtml() : 'Lade…')}</div>
            <div class="obr-chart-grid" id="obr-charts">${skeletonLoader ? skeletonLoader({ count: 2, height: 240 }) : ''}</div>
            <div id="obr-list">${skeletonLoader ? skeletonLoader({ count: 6, height: 48 }) : ''}</div>
          </div>
        </div>
      `

      const body = container.querySelector('#obr-body')
      let state = { open: [], userMap: {} }

      const render = async () => {
        try {
          const data = await fetchData()
          state = data
          const { open, trend, change, lastWeek, userMap } = data

          const heroEl = container.querySelector('#obr-hero')
          const critCount = open.filter(r => r.priority === 'critical').length
          const oldest = open.length ? open[open.length - 1] : null
          const oldestDays = oldest ? Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86400e3) : 0
          const changeLabel = change > 0 ? `+${change}% vs. Vorwoche` : `${change}% vs. Vorwoche`
          const changeKind = change > 0 ? 'negative' : 'positive'
          heroEl.innerHTML = `
            ${statHero({ label: 'Offen gesamt', value: open.length, change: changeLabel, trend: changeKind, icon: 'bug' })}
            ${statHero({ label: 'Kritisch', value: critCount, change: critCount > 0 ? 'Sofort beheben' : 'Keine kritischen', trend: critCount > 0 ? 'negative' : 'positive', icon: 'alert-triangle' })}
            ${statHero({ label: 'Neu (7 Tage)', value: lastWeek, change: `Älteste: ${oldestDays} Tg.`, trend: 'neutral', icon: 'clock' })}
          `
          heroEl.querySelectorAll('.stat-hero-value, .hero-value, [data-stat-value]').forEach((el, i) => {
            const vals = [open.length, critCount, lastWeek]
            if (countUp && vals[i] != null) countUp(el, vals[i])
          })

          const chartsEl = container.querySelector('#obr-charts')
          chartsEl.innerHTML = `
            <div class="obr-section glass-card">
              <h3>Neue Reports — letzte 14 Tage</h3>
              <div id="obr-chart-trend" style="height:240px"></div>
            </div>
            <div class="obr-section glass-card">
              <h3>Priorität-Verteilung</h3>
              <div id="obr-chart-prio" style="height:240px"></div>
            </div>
          `
          try {
            makeAreaChart(chartsEl.querySelector('#obr-chart-trend'), {
              data: buildTrendSeries(trend),
              color: '#0a84ff',
              yLabel: 'Reports'
            })
          } catch (_) {}
          try {
            makeDonutChart(chartsEl.querySelector('#obr-chart-prio'), {
              data: buildPrioDistribution(open),
              centerLabel: open.length + ' offen'
            })
          } catch (_) {}

          const sorted = [...open].sort((a, b) => {
            const ra = (PRIO[a.priority] || { rank: 0 }).rank
            const rb = (PRIO[b.priority] || { rank: 0 }).rank
            if (rb !== ra) return rb - ra
            return new Date(b.created_at) - new Date(a.created_at)
          })

          const listEl = container.querySelector('#obr-list')
          listEl.innerHTML = `<div class="obr-section glass-card">
            <h3>Offene Reports (${open.length}) — Drag&Drop oder Dropdown zum Ändern der Priorität</h3>
            ${renderTable(sorted, userMap)}
          </div>`
          wireTable(listEl, sorted, userMap, render)

          if (fadeIn) fadeIn(body)
        } catch (err) {
          body.innerHTML = `
            <div class="obr-error glass-card">
              <div style="font-size:48px">⚠️</div>
              <div style="font-size:16px;font-weight:600">Daten konnten nicht geladen werden</div>
              <div style="color:var(--text-muted,#8e8e93);font-size:13px">${htmlEscape(err.message || String(err))}</div>
              <button id="obr-retry">Erneut versuchen</button>
            </div>
          `
          const retry = body.querySelector('#obr-retry')
          if (retry) retry.addEventListener('click', render)
        }
      }

      const refreshBtn = container.querySelector('#obr-refresh')
      if (refreshBtn) refreshBtn.addEventListener('click', () => {
        toast('Aktualisiere…', 'info')
        render()
      })
      const pdfBtn = container.querySelector('#obr-pdf')
      if (pdfBtn) pdfBtn.addEventListener('click', async () => {
        try {
          await exportPanelAsPdf({
            title: 'Offene Bug-Reports',
            subtitle: `Stand: ${fmtDateTime(new Date().toISOString())} · ${state.open.length} offen`,
            element: container.querySelector('#obr-shell'),
            rows: state.open.map(r => ({
              Priorität: (PRIO[r.priority] || {}).label || r.priority,
              Titel: r.title || '',
              Kategorie: r.category || '',
              Gemeldet: fmtDateTime(r.created_at),
              App: r.app_version || ''
            }))
          })
          toast('PDF erstellt.', 'success')
        } catch (err) {
          toast('PDF-Fehler: ' + (err.message || err), 'error')
        }
      })
      const csvBtn = container.querySelector('#obr-csv')
      if (csvBtn) csvBtn.addEventListener('click', () => {
        try {
          exportCsv({
            filename: `open-bug-reports-${new Date().toISOString().slice(0, 10)}.csv`,
            rows: state.open.map(r => ({
              id: r.id,
              priority: r.priority,
              title: r.title,
              description: r.description,
              category: r.category,
              user_id: r.user_id,
              created_at: r.created_at,
              app_version: r.app_version
            }))
          })
          toast('CSV exportiert.', 'success')
        } catch (err) {
          toast('CSV-Fehler: ' + (err.message || err), 'error')
        }
      })

      await render()
    } catch (mountErr) {
      container.innerHTML = `
        <div class="obr-error glass-card" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px;text-align:center">
          <div style="font-size:48px">⚠️</div>
          <div style="font-size:16px;font-weight:600">Panel konnte nicht initialisiert werden</div>
          <div style="color:var(--text-muted,#8e8e93);font-size:13px">${(mountErr && (mountErr.message || String(mountErr))) || 'Unbekannter Fehler'}</div>
        </div>
      `
    }
  }
}
