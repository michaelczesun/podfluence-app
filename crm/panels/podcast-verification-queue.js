import { sb } from '/lib/supabase.js?v=20260608c'
import { toast, modal, confirmDialog, fmtNumber, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce, spinnerHtml } from '/lib/ui.js?v=20260608c'
import { makeDonutChart, makeBarChart, makeAreaChart } from '/lib/charts.js?v=20260608c'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608c'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608c'
import { drawer, segmentedControl, statHero, glassCard } from '/lib/layout-extras.js?v=20260608c'

const STATUS_LABELS = {
  pending: 'Ausstehend',
  rejected: 'Abgelehnt',
  verified: 'Verifiziert',
  all: 'Alle'
}

const STATUS_COLORS = {
  pending: '#f59e0b',
  rejected: '#ef4444',
  verified: '#10b981'
}

// Fetches ALL podcasts (no filter) for stats — no limit so counts are accurate.
async function fetchAllPodcasts() {
  const { data, error } = await sb
    .from('podcasts')
    .select('id, title, rss_url, cover_image, is_owner_verified, is_rss_verified, owner_email, owner_verified_at, owner_email_extracted_at, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

function statusBadge(status) {
  const color = STATUS_COLORS[status] || '#6b7280'
  const label = STATUS_LABELS[status] || status
  return `<span class="status-badge" style="background:${color}1a;color:${color};border:1px solid ${color}33;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;">${htmlEscape(label)}</span>`
}

function cardHtml(p) {
  const created = p.created_at ? fmtRelativeTime(p.created_at) : '—'
  const sentAt = p.verify_token_sent_at ? fmtRelativeTime(p.verify_token_sent_at) : 'Noch nicht gesendet'
  const reject = p.rejection_reason ? `<div class="reject-reason" style="margin-top:10px;padding:8px 10px;background:#ef44441a;border-left:3px solid #ef4444;border-radius:6px;font-size:12px;color:#fca5a5;">${iconHtml('alert-circle')} ${htmlEscape(p.rejection_reason)}</div>` : ''
  const cover = p.cover_image
    ? `<img src="${htmlEscape(p.cover_image)}" alt="" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#1a1a1a;">`
    : `<div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#2a2a2a,#1a1a1a);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${iconHtml('mic')}</div>`

  return `
  <div class="glass-card pod-card" data-id="${htmlEscape(p.id)}" style="padding:18px;border-radius:14px;display:flex;flex-direction:column;gap:14px;transition:transform .15s ease, box-shadow .15s ease;">
    <div style="display:flex;gap:14px;align-items:flex-start;">
      ${cover}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <h3 style="margin:0;font-size:15px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${htmlEscape(p.title || 'Ohne Titel')}</h3>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          ${statusBadge((p.is_owner_verified ? 'verified' : (p.is_rss_verified ? 'rss_only' : 'pending')))}
          <span style="font-size:11px;color:#888;">${created}</span>
        </div>
        <div style="font-size:12px;color:#aaa;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          ${iconHtml('mail')} <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${htmlEscape(p.owner_email || '—')}</span>
        </div>
        <a href="${htmlEscape(p.rss_url || '#')}" target="_blank" rel="noopener" style="font-size:11px;color:#60a5fa;display:inline-flex;align-items:center;gap:6px;text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${iconHtml('rss')} <span style="overflow:hidden;text-overflow:ellipsis;">${htmlEscape(p.rss_url || 'Kein RSS-Link')}</span>
        </a>
      </div>
    </div>
    <div style="font-size:11px;color:#666;display:flex;align-items:center;gap:6px;">
      ${iconHtml('send')} Verify-Mail: ${sentAt}
    </div>
    ${reject}
    <div class="card-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);">
      <button class="btn btn-sm act-send" data-id="${htmlEscape(p.id)}" style="flex:1;min-width:0;padding:8px 10px;background:#1e3a8a33;border:1px solid #3b82f655;color:#93c5fd;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
        ${iconHtml('send')} Verify-Mail
      </button>
      <button class="btn btn-sm act-force" data-id="${htmlEscape(p.id)}" style="flex:1;min-width:0;padding:8px 10px;background:#06402333;border:1px solid #10b98155;color:#6ee7b7;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
        ${iconHtml('check-circle')} Force-Verify
      </button>
      <button class="btn btn-sm act-reject" data-id="${htmlEscape(p.id)}" style="flex:1;min-width:0;padding:8px 10px;background:#7f1d1d33;border:1px solid #ef444455;color:#fca5a5;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;">
        ${iconHtml('x-circle')} Ablehnen
      </button>
      <button class="btn btn-sm act-details" data-id="${htmlEscape(p.id)}" style="padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#ccc;border-radius:8px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">
        ${iconHtml('more-horizontal')}
      </button>
    </div>
  </div>`
}

function emptyState(filter) {
  return `
  <div style="grid-column:1/-1;padding:60px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;">
    <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#10b98122,#10b98108);display:flex;align-items:center;justify-content:center;font-size:32px;color:#10b981;">
      ${iconHtml('check-circle')}
    </div>
    <h3 style="margin:0;color:#fff;font-size:18px;">Keine Podcasts in dieser Ansicht</h3>
    <p style="margin:0;color:#888;font-size:13px;max-width:380px;">
      ${filter === 'rejected' ? 'Aktuell sind keine abgelehnten Podcasts vorhanden.' : filter === 'pending' ? 'Alle Podcasts sind verifiziert. Saubere Arbeit.' : 'Es liegen keine Verifizierungs-Anfragen vor.'}
    </p>
  </div>`
}

function tableEmptyState() {
  return `
  <div style="grid-column:1/-1;padding:60px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;">
    <div style="width:72px;height:72px;border-radius:50%;background:rgba(16,185,129,.1);display:flex;align-items:center;justify-content:center;font-size:32px;color:#10b981;">
      ${iconHtml('check-circle')}
    </div>
    <h3 style="margin:0;color:#fff;font-size:18px;">Keine Podcasts in dieser Ansicht</h3>
    <p style="margin:0;color:#888;font-size:13px;max-width:380px;">Keine Podcasts mit diesem Status vorhanden.</p>
  </div>`
}

function errorState(msg, onRetry) {
  const id = 'err-retry-' + Math.random().toString(36).slice(2, 8)
  setTimeout(() => {
    const b = document.getElementById(id)
    if (b) b.onclick = onRetry
  }, 0)
  return `
  <div style="padding:48px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;">
    <div style="width:64px;height:64px;border-radius:50%;background:#ef44441a;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:28px;">${iconHtml('alert-triangle')}</div>
    <h3 style="margin:0;color:#fff;">Fehler beim Laden</h3>
    <p style="margin:0;color:#888;font-size:13px;">${htmlEscape(msg)}</p>
    <button id="${id}" class="btn" style="padding:10px 18px;background:#3b82f6;border:none;color:#fff;border-radius:8px;font-weight:500;cursor:pointer;">Erneut versuchen</button>
  </div>`
}

function mountErrorBox(container, err) {
  const id = 'mount-retry-' + Math.random().toString(36).slice(2, 8)
  container.innerHTML = `
    <div style="padding:48px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;">
      <div style="width:64px;height:64px;border-radius:50%;background:#ef44441a;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:28px;">${iconHtml ? iconHtml('alert-triangle') : '!'}</div>
      <h3 style="margin:0;color:#fff;">Panel konnte nicht geladen werden</h3>
      <p style="margin:0;color:#888;font-size:13px;max-width:480px;">${htmlEscape ? htmlEscape(String(err && err.message || err)) : String(err)}</p>
      <button id="${id}" style="padding:10px 18px;background:#3b82f6;border:none;color:#fff;border-radius:8px;font-weight:500;cursor:pointer;">Neu laden</button>
    </div>`
  const btn = document.getElementById(id)
  if (btn) btn.onclick = () => location.reload()
}

export default {
  id: 'podcast-verification-queue',
  title: 'Podcast-Verifizierung',
  category: 'admin_actions',

  async mount(container) {
    try {
      let currentFilter = 'pending'
      // allPodcasts holds the full unfiltered dataset for stats + client-side filtering.
      let allPodcasts = []

      container.innerHTML = `
        <div class="panel-shell" style="display:flex;flex-direction:column;gap:18px;padding:20px;">
          <div class="panel-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
            <div>
              <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">Podcast-Verifizierung</h2>
              <p style="margin:0;color:#888;font-size:13px;">Eingehende Podcast-Anmeldungen prüfen, freigeben oder ablehnen.</p>
            </div>
            <div class="toolbar" style="display:flex;gap:8px;align-items:center;">
              <button id="btn-refresh" class="btn" style="padding:8px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;border-radius:8px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button id="btn-pdf" class="btn" style="padding:8px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;border-radius:8px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">${iconHtml('file-text')} PDF</button>
              <button id="btn-csv" class="btn" style="padding:8px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;border-radius:8px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">${iconHtml('download')} CSV</button>
            </div>
          </div>

          <div id="hero-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
            <div class="pf-skeleton" style="height:90px;border-radius:10px;"></div>
          </div>

          <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;" id="chart-row">
            <div class="pf-skeleton" style="height:220px;border-radius:10px;"></div>
          </div>

          <div class="glass-card" style="padding:14px 16px;border-radius:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div id="filter-row"></div>
            <div style="color:#666;font-size:12px;" id="count-label"></div>
          </div>

          <div id="grid" class="card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;min-height:300px;">
            <div class="pf-skeleton" style="height:180px;border-radius:10px;"></div>
            <div class="pf-skeleton" style="height:180px;border-radius:10px;"></div>
            <div class="pf-skeleton" style="height:180px;border-radius:10px;"></div>
            <div class="pf-skeleton" style="height:180px;border-radius:10px;"></div>
          </div>
        </div>
      `

      const filterRow = container.querySelector('#filter-row')
      // segmentedControl(container, options[], activeKey, onChange) — positional args
      segmentedControl(
        filterRow,
        [
          { key: 'pending', label: 'Ausstehend' },
          { key: 'rejected', label: 'Abgelehnt' },
          { key: 'all', label: 'Alle' }
        ],
        currentFilter,
        (v) => {
          currentFilter = v
          // Filter-toggle: re-render from local data only, no new fetch.
          renderGrid()
        }
      )

      const grid = container.querySelector('#grid')
      const countLabel = container.querySelector('#count-label')
      const heroRow = container.querySelector('#hero-row')
      const chartRow = container.querySelector('#chart-row')

      // loadAll fetches once and populates allPodcasts. renderGrid/renderHero/renderCharts
      // all operate on that local array — no secondary fetches.
      async function loadAll() {
        try {
          grid.innerHTML = '<div class="pf-skeleton" style="height:180px;border-radius:10px;"></div>'.repeat(4)
          allPodcasts = await fetchAllPodcasts()
          renderHero()
          renderCharts()
          renderGrid()
        } catch (e) {
          console.error(e)
          grid.innerHTML = errorState(e.message || 'Unbekannter Fehler', loadAll)
          heroRow.innerHTML = ''
          chartRow.innerHTML = ''
        }
      }

      function renderHero() {
        const totalPending = allPodcasts.filter(s => (s.is_owner_verified !== true && s.is_rss_verified !== true)).length
        const totalRejected = allPodcasts.filter(s => false).length
        const totalVerified = allPodcasts.filter(s => s.is_owner_verified === true).length
        const last7 = allPodcasts.filter(s => s.created_at && (Date.now() - new Date(s.created_at).getTime()) < 7 * 86400000).length

        heroRow.innerHTML = `
          <div class="glass-card hero-stat" style="padding:18px;border-radius:14px;border-left:3px solid #f59e0b;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Wartet auf Prüfung</div>
            <div class="cu" data-val="${totalPending}" style="font-size:32px;font-weight:700;color:#f59e0b;">0</div>
          </div>
          <div class="glass-card hero-stat" style="padding:18px;border-radius:14px;border-left:3px solid #10b981;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Verifiziert</div>
            <div class="cu" data-val="${totalVerified}" style="font-size:32px;font-weight:700;color:#10b981;">0</div>
          </div>
          <div class="glass-card hero-stat" style="padding:18px;border-radius:14px;border-left:3px solid #ef4444;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Abgelehnt</div>
            <div class="cu" data-val="${totalRejected}" style="font-size:32px;font-weight:700;color:#ef4444;">0</div>
          </div>
          <div class="glass-card hero-stat" style="padding:18px;border-radius:14px;border-left:3px solid #60a5fa;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Neu (7 Tage)</div>
            <div class="cu" data-val="${last7}" style="font-size:32px;font-weight:700;color:#60a5fa;">0</div>
          </div>
        `
        // countUp(element, from, to, durationMs) — positional
        heroRow.querySelectorAll('.cu').forEach(el => {
          try { countUp(el, 0, parseInt(el.dataset.val) || 0, 800) }
          catch (_) { el.textContent = el.dataset.val }
        })
      }

      function renderCharts() {
        const days = 30
        const buckets = {}
        for (let i = 0; i < days; i++) {
          const d = new Date(Date.now() - i * 86400000)
          const k = d.toISOString().slice(0, 10)
          buckets[k] = 0
        }
        allPodcasts.forEach(s => {
          if (!s.created_at) return
          const k = s.created_at.slice(0, 10)
          if (k in buckets) buckets[k]++
        })
        const series = Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]))

        const counts = {
          pending: allPodcasts.filter(s => (s.is_owner_verified !== true && s.is_rss_verified !== true)).length,
          verified: allPodcasts.filter(s => s.is_owner_verified === true).length,
          rejected: allPodcasts.filter(s => false).length
        }

        chartRow.innerHTML = `
          <div class="glass-card" style="padding:16px;border-radius:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <h3 style="margin:0;font-size:14px;color:#ccc;font-weight:600;">Anmeldungen letzte 30 Tage</h3>
              <span style="font-size:11px;color:#666;">${fmtNumber(allPodcasts.length)} gesamt</span>
            </div>
            <div id="area-chart" style="height:200px;"></div>
          </div>
          <div class="glass-card" style="padding:16px;border-radius:14px;">
            <h3 style="margin:0 0 10px;font-size:14px;color:#ccc;font-weight:600;">Status-Verteilung</h3>
            <div id="donut-chart" style="height:200px;"></div>
          </div>
        `

        try {
          makeAreaChart(chartRow.querySelector('#area-chart'), {
            labels: series.map(s => s[0].slice(5)),
            data: series.map(s => s[1]),
            color: '#60a5fa'
          })
        } catch (e) { console.warn('chart', e) }

        try {
          makeDonutChart(chartRow.querySelector('#donut-chart'), {
            labels: ['Ausstehend', 'Verifiziert', 'Abgelehnt'],
            data: [counts.pending, counts.verified, counts.rejected],
            colors: ['#f59e0b', '#10b981', '#ef4444']
          })
        } catch (e) { console.warn('chart', e) }
      }

      // renderGrid filters allPodcasts client-side — no Supabase call.
      function renderGrid() {
        const pods = currentFilter === 'all'
          ? allPodcasts
          : allPodcasts.filter(p => (p.is_owner_verified ? 'verified' : (p.is_rss_verified ? 'rss_only' : 'pending')) === currentFilter)

        countLabel.textContent = `${fmtNumber(pods.length)} Einträge`

        if (!pods.length) {
          grid.innerHTML = tableEmptyState()
          return
        }
        grid.innerHTML = pods.map(cardHtml).join('')
        wireCards()
        try { fadeIn(grid, 300) } catch (_) {}
      }

      function wireCards() {
        grid.querySelectorAll('.act-send').forEach(b => b.onclick = () => sendVerifyMail(b.dataset.id))
        grid.querySelectorAll('.act-force').forEach(b => b.onclick = () => doForceVerify(b.dataset.id))
        grid.querySelectorAll('.act-reject').forEach(b => b.onclick = () => doReject(b.dataset.id))
        grid.querySelectorAll('.act-details').forEach(b => b.onclick = () => showDetails(b.dataset.id))
      }

      async function sendVerifyMail(id) {
        const p = allPodcasts.find(x => x.id === id)
        if (!p) return
        // confirmDialog(title, message, confirmLabel, danger) — positional
        const ok = await confirmDialog(
          'Verify-Mail senden?',
          `An ${htmlEscape(p.owner_email || '—')} für Podcast „${htmlEscape(p.title || '')}" senden?`,
          'Senden',
          false
        )
        if (!ok) return
        try {
          const { error } = await sb.functions.invoke('send-podcast-verification', { body: { p_id: id } })
          if (error) throw error
          toast('Verify-Mail gesendet', 'success')
          loadAll()
        } catch (e) {
          toast('Fehler beim Senden: ' + (e.message || 'unbekannt'), 'error')
        }
      }

      async function doForceVerify(id) {
        const p = allPodcasts.find(x => x.id === id)
        if (!p) return
        // confirmDialog(title, message, confirmLabel, danger) — positional
        const ok = await confirmDialog(
          'Manuell verifizieren?',
          `${htmlEscape(p.title || '')} ohne E-Mail-Bestätigung freischalten. Diese Aktion wird im Audit-Log vermerkt.`,
          'Verifizieren',
          false
        )
        if (!ok) return
        try {
          // FIX H1: Use podcast_id as parameter key (SECURITY DEFINER RPC admin_force_verify_podcast).
          const { error } = await sb.rpc('admin_force_verify_podcast', { podcast_id: id })
          if (error) throw error
          toast('Podcast verifiziert', 'success')
          loadAll()
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
        }
      }

      async function doReject(id) {
        const p = allPodcasts.find(x => x.id === id)
        if (!p) return
        // modal({ title, content, footer, width }) — no actions/onAction support.
        // Build footer DOM manually; use the returned { close } handle.
        const footerEl = document.createElement('div')
        footerEl.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'
        const cancelBtn = document.createElement('button')
        cancelBtn.textContent = 'Abbrechen'
        cancelBtn.style.cssText = 'padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#ccc;border-radius:8px;cursor:pointer;font-size:13px;'
        const rejectBtn = document.createElement('button')
        rejectBtn.textContent = 'Ablehnen'
        rejectBtn.style.cssText = 'padding:8px 14px;background:#7f1d1d;border:1px solid #ef444455;color:#fca5a5;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;'
        footerEl.appendChild(cancelBtn)
        footerEl.appendChild(rejectBtn)

        const contentEl = document.createElement('div')
        contentEl.style.cssText = 'display:flex;flex-direction:column;gap:12px;'
        contentEl.innerHTML = `
          <p style="margin:0;color:#aaa;font-size:13px;">Grund wird dem Owner per E-Mail mitgeteilt.</p>
          <div style="padding:10px 12px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;color:#ccc;">
            <strong>${htmlEscape(p.title || '')}</strong><br>
            <span style="color:#888;">${htmlEscape(p.owner_email || '')}</span>
          </div>
          <label style="font-size:12px;color:#aaa;">Ablehnungs-Grund</label>
          <textarea id="reject-reason-${htmlEscape(id)}" rows="4" placeholder="Z.B. RSS-Feed nicht erreichbar, Owner-E-Mail im Feed stimmt nicht überein, ..." style="width:100%;padding:10px;background:#0a0a0a;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
        `

        const { close } = modal({ title: 'Podcast ablehnen', content: contentEl, footer: footerEl, width: 520 })

        cancelBtn.onclick = () => close()
        rejectBtn.onclick = async () => {
          // Scope to contentEl to avoid hitting a textarea from another modal
          const reason = contentEl.querySelector(`#reject-reason-${id}`)?.value?.trim() || ''
          try {
            // FIX H2: Use SECURITY DEFINER RPC instead of direct .update() which is blocked by RLS.
            const { error } = await sb.rpc('admin_reject_podcast', { p_id: id, p_reason: reason || null })
            if (error) throw error
            // FIX M6: Surface mail-send errors instead of silently swallowing them.
            try {
              const { error: mailErr } = await sb.functions.invoke('send-podcast-verification', { body: { p_id: id, action: 'reject', reason } })
              if (mailErr) {
                console.warn('Ablehnungsmail Fehler:', mailErr)
                toast('Ablehnung gespeichert, aber Ablehnungsmail konnte nicht gesendet werden', 'warning')
              }
            } catch (mailEx) {
              console.warn('Ablehnungsmail Exception:', mailEx)
              toast('Ablehnung gespeichert, aber Ablehnungsmail konnte nicht gesendet werden', 'warning')
            }
            toast('Podcast abgelehnt', 'success')
            close()
            loadAll()
          } catch (e) {
            toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
          }
        }
      }

      function showDetails(id) {
        const p = allPodcasts.find(x => x.id === id)
        if (!p) return
        drawer({
          title: p.title || 'Podcast',
          width: 480,
          content: `
            <div style="display:flex;flex-direction:column;gap:16px;padding:4px;">
              <div style="display:flex;gap:14px;align-items:center;">
                ${p.cover_image ? `<img src="${htmlEscape(p.cover_image)}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;">` : `<div style="width:80px;height:80px;border-radius:12px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:28px;">${iconHtml('mic')}</div>`}
                <div>
                  <h3 style="margin:0 0 6px;color:#fff;">${htmlEscape(p.title || '')}</h3>
                  ${statusBadge((p.is_owner_verified ? 'verified' : (p.is_rss_verified ? 'rss_only' : 'pending')))}
                </div>
              </div>
              <div class="kv-list" style="display:flex;flex-direction:column;gap:10px;">
                <div style="display:flex;justify-content:space-between;gap:12px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;">
                  <span style="color:#888;font-size:12px;">Owner-E-Mail</span>
                  <span style="color:#fff;font-size:12px;text-align:right;">${htmlEscape(p.owner_email || '—')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;">
                  <span style="color:#888;font-size:12px;">RSS-Feed</span>
                  <a href="${htmlEscape(p.rss_url || '#')}" target="_blank" style="color:#60a5fa;font-size:12px;text-align:right;overflow:hidden;text-overflow:ellipsis;max-width:280px;">${htmlEscape(p.rss_url || '—')}</a>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;">
                  <span style="color:#888;font-size:12px;">Eingereicht</span>
                  <span style="color:#fff;font-size:12px;">${p.created_at ? fmtDateTime(p.created_at) : '—'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:12px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;">
                  <span style="color:#888;font-size:12px;">Verify-Mail zuletzt</span>
                  <span style="color:#fff;font-size:12px;">${p.verify_token_sent_at ? fmtDateTime(p.verify_token_sent_at) : 'Nie'}</span>
                </div>
                ${p.rejection_reason ? `
                <div style="padding:12px;background:#ef44441a;border-left:3px solid #ef4444;border-radius:6px;">
                  <div style="color:#fca5a5;font-size:11px;text-transform:uppercase;margin-bottom:4px;">Ablehnungsgrund</div>
                  <div style="color:#fff;font-size:13px;">${htmlEscape(p.rejection_reason)}</div>
                </div>` : ''}
              </div>
              <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="dr-send" style="flex:1;padding:10px;background:#1e3a8a;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:13px;">${iconHtml('send')} Verify-Mail</button>
                <button class="dr-force" style="flex:1;padding:10px;background:#064023;border:none;color:#6ee7b7;border-radius:8px;cursor:pointer;font-size:13px;">${iconHtml('check-circle')} Force-Verify</button>
                <button class="dr-reject" style="flex:1;padding:10px;background:#7f1d1d;border:none;color:#fca5a5;border-radius:8px;cursor:pointer;font-size:13px;">${iconHtml('x-circle')} Ablehnen</button>
              </div>
            </div>
          `,
          onMount: (el) => {
            el.querySelector('.dr-send').onclick = () => sendVerifyMail(id)
            el.querySelector('.dr-force').onclick = () => doForceVerify(id)
            el.querySelector('.dr-reject').onclick = () => doReject(id)
          }
        })
      }

      container.querySelector('#btn-refresh').onclick = () => { toast('Aktualisiere…'); loadAll() }
      container.querySelector('#btn-csv').onclick = () => {
        try {
          // exportCsv(rows, columns, filename) — pass null for columns to auto-derive
          exportCsv(
            allPodcasts.map(p => ({
              title: p.title,
              rss_url: p.rss_url,
              owner_email: p.owner_email,
              status: (p.is_owner_verified ? 'verified' : (p.is_rss_verified ? 'rss_only' : 'pending')),
              created_at: p.created_at,
              rejection_reason: p.rejection_reason || ''
            })),
            null,
            `podcast-verifizierung-${currentFilter}-${new Date().toISOString().slice(0, 10)}.csv`
          )
        } catch (e) { toast('CSV-Export fehlgeschlagen', 'error') }
      }
      container.querySelector('#btn-pdf').onclick = () => {
        try { exportPanelAsPdf(container, { title: 'Podcast-Verifizierung' }) }
        catch (e) { toast('PDF-Export fehlgeschlagen', 'error') }
      }

      loadAll()
      try { fadeIn(container, 400) } catch (_) {}
    } catch (err) {
      console.error('[podcast-verification-queue] mount failed', err)
      mountErrorBox(container, err)
    }
  }
}
