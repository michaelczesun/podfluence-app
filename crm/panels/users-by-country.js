import { sb } from '/lib/supabase.js'
import { toast, modal, fmtNumber, fmtDateTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js'
import { makeBarChart, makeDonutChart } from '/lib/charts.js'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js'
import { countUp, fadeIn, skeletonLoader } from '/lib/animations.js'
import { drawer, glassCard, statHero } from '/lib/layout-extras.js'
import { showUserDetailModal } from '/lib/panel-actions.js'

function flagFromCode(code) {
  if (!code || code.length !== 2) return '🏳️'
  const cc = code.toUpperCase()
  const A = 0x1F1E6
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65)) + String.fromCodePoint(A + (cc.charCodeAt(1) - 65))
}

const COUNTRY_NAMES = {
  DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', US: 'USA', GB: 'Vereinigtes Königreich',
  FR: 'Frankreich', IT: 'Italien', ES: 'Spanien', NL: 'Niederlande', BE: 'Belgien',
  PL: 'Polen', CZ: 'Tschechien', SE: 'Schweden', NO: 'Norwegen', DK: 'Dänemark',
  FI: 'Finnland', IE: 'Irland', PT: 'Portugal', GR: 'Griechenland', HU: 'Ungarn',
  RO: 'Rumänien', BG: 'Bulgarien', HR: 'Kroatien', SI: 'Slowenien', SK: 'Slowakei',
  TR: 'Türkei', RU: 'Russland', UA: 'Ukraine', CA: 'Kanada', MX: 'Mexiko',
  BR: 'Brasilien', AR: 'Argentinien', CL: 'Chile', CO: 'Kolumbien', PE: 'Peru',
  AU: 'Australien', NZ: 'Neuseeland', JP: 'Japan', CN: 'China', KR: 'Südkorea',
  IN: 'Indien', ID: 'Indonesien', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippinen',
  SG: 'Singapur', MY: 'Malaysia', AE: 'VAE', SA: 'Saudi-Arabien', IL: 'Israel',
  ZA: 'Südafrika', EG: 'Ägypten', NG: 'Nigeria', KE: 'Kenia', MA: 'Marokko',
  LU: 'Luxemburg', LI: 'Liechtenstein', IS: 'Island', EE: 'Estland', LV: 'Lettland', LT: 'Litauen'
}

const REGION_MAP = {
  Europa: ['DE','AT','CH','GB','FR','IT','ES','NL','BE','PL','CZ','SE','NO','DK','FI','IE','PT','GR','HU','RO','BG','HR','SI','SK','TR','UA','LU','LI','IS','EE','LV','LT'],
  Nordamerika: ['US','CA','MX'],
  Südamerika: ['BR','AR','CL','CO','PE'],
  Asien: ['JP','CN','KR','IN','ID','TH','VN','PH','SG','MY','RU'],
  'Naher Osten': ['AE','SA','IL'],
  Afrika: ['ZA','EG','NG','KE','MA'],
  Ozeanien: ['AU','NZ']
}

function countryName(code) {
  return COUNTRY_NAMES[code?.toUpperCase()] || code || 'Unbekannt'
}

function regionOf(code) {
  if (!code) return 'Unbekannt'
  const c = code.toUpperCase()
  for (const [r, list] of Object.entries(REGION_MAP)) if (list.includes(c)) return r
  return 'Sonstige'
}

async function fetchCountries() {
  const { data, error } = await sb
    .from('users_by_country')
    .select('*')
    .limit(50000)
  if (error) throw error
  const byCode = new Map()
  for (const row of (data || [])) {
    const raw = (row.country_code || row.country || '').toString().trim()
    if (!raw) continue
    const code = raw.length === 2 ? raw.toUpperCase() : raw
    const entry = byCode.get(code) || { code, count: 0, recent: 0 }
    entry.count += (row.count || row.user_count || 1)
    if (row.created_at && (Date.now() - new Date(row.created_at).getTime()) < 30 * 86400000) entry.recent++
    byCode.set(code, entry)
  }
  return Array.from(byCode.values()).sort((a, b) => b.count - a.count)
}

function renderUsersFromCountryEmptyState() {
  return `
    <div class="glass-card" style="padding:24px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px">
      ${iconHtml('alert')}
      <div style="font-size:.9rem;color:var(--text-muted,#9aa0a6)">Daten kommen sobald die Tabelle <strong>profiles</strong> angelegt ist</div>
    </div>
  `
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <button class="btn btn-ghost" data-act="refresh">${iconHtml('refresh')} Aktualisieren</button>
      <button class="btn btn-ghost" data-act="pdf">${iconHtml('file-text')} PDF</button>
      <button class="btn btn-ghost" data-act="csv">${iconHtml('download')} CSV</button>
      <div class="toolbar-spacer"></div>
      <div class="segmented" data-view-switch>
        <button class="seg-btn is-active" data-view="list">Liste</button>
        <button class="seg-btn" data-view="map">Karte</button>
        <button class="seg-btn" data-view="regions">Regionen</button>
      </div>
    </div>
  `
}

function renderHero(countries) {
  const totalUsers = countries.reduce((s, c) => s + c.count, 0)
  const totalCountries = countries.length
  const top = countries[0]
  const recent = countries.reduce((s, c) => s + c.recent, 0)
  return `
    <div class="hero-grid">
      <div class="hero-card glass-card">
        <div class="hero-label">User gesamt</div>
        <div class="hero-value" data-countup="${totalUsers}">0</div>
        <div class="hero-sub">${fmtNumber(recent)} neu in 30 Tagen</div>
      </div>
      <div class="hero-card glass-card">
        <div class="hero-label">Länder erreicht</div>
        <div class="hero-value" data-countup="${totalCountries}">0</div>
        <div class="hero-sub">${Object.keys(REGION_MAP).length} Regionen abgedeckt</div>
      </div>
      <div class="hero-card glass-card">
        <div class="hero-label">Top-Land</div>
        <div class="hero-value" style="font-size:1.6rem">${top ? flagFromCode(top.code) + ' ' + countryName(top.code) : '–'}</div>
        <div class="hero-sub">${top ? fmtNumber(top.count) + ' User' : 'Keine Daten'}</div>
      </div>
    </div>
  `
}

function renderCountryList(countries) {
  if (!countries.length) return renderEmpty()
  const max = countries[0]?.count || 1
  const rows = countries.slice(0, 50).map(c => {
    const pct = Math.max(2, Math.round((c.count / max) * 100))
    return `
      <div class="country-row" data-country="${htmlEscape(c.code)}" role="button" tabindex="0">
        <div class="country-flag">${flagFromCode(c.code)}</div>
        <div class="country-meta">
          <div class="country-name">${htmlEscape(countryName(c.code))}</div>
          <div class="country-sub">${htmlEscape(c.code)} · ${regionOf(c.code)}</div>
        </div>
        <div class="country-bar-wrap">
          <div class="country-bar" style="width:${pct}%"></div>
        </div>
        <div class="country-count">
          <div class="country-count-main">${fmtNumber(c.count)}</div>
          ${c.recent ? `<div class="country-count-sub">+${fmtNumber(c.recent)} / 30T</div>` : ''}
        </div>
        <div class="country-chev">${iconHtml('chevron-right')}</div>
      </div>
    `
  }).join('')
  return `<div class="country-list">${rows}</div>`
}

function renderMap(countries) {
  const max = countries[0]?.count || 1
  const tiles = countries.slice(0, 60).map(c => {
    const intensity = Math.max(0.15, Math.min(1, c.count / max))
    return `
      <div class="map-tile" style="--intensity:${intensity.toFixed(2)}" data-country="${htmlEscape(c.code)}" role="button" tabindex="0" title="${htmlEscape(countryName(c.code))} — ${fmtNumber(c.count)} User">
        <div class="map-tile-flag">${flagFromCode(c.code)}</div>
        <div class="map-tile-code">${htmlEscape(c.code)}</div>
        <div class="map-tile-count">${fmtNumber(c.count)}</div>
      </div>
    `
  }).join('')
  return `
    <div class="map-legend">
      <span class="map-legend-label">Wenig</span>
      <div class="map-legend-gradient"></div>
      <span class="map-legend-label">Viel</span>
    </div>
    <div class="choropleth-grid">${tiles || '<div class="muted">Keine Länderdaten</div>'}</div>
  `
}

function renderRegions(countries) {
  const byRegion = new Map()
  for (const c of countries) {
    const r = regionOf(c.code)
    byRegion.set(r, (byRegion.get(r) || 0) + c.count)
  }
  const regions = Array.from(byRegion.entries()).sort((a, b) => b[1] - a[1])
  return `
    <div class="region-grid">
      <div class="region-chart-wrap glass-card">
        <div class="card-title">Verteilung nach Region</div>
        <div id="region-donut" class="chart-wrap"></div>
      </div>
      <div class="region-list glass-card">
        <div class="card-title">Regionen</div>
        ${regions.map(([r, n]) => `
          <div class="region-row">
            <div class="region-name">${htmlEscape(r)}</div>
            <div class="region-count">${fmtNumber(n)}</div>
          </div>
        `).join('') || '<div class="muted">Keine Daten</div>'}
      </div>
    </div>
  `
}

function renderEmpty() {
  return `
    <div class="empty-state">
      <div class="empty-icon">${iconHtml('globe')}</div>
      <div class="empty-title">Noch keine Länderdaten</div>
      <div class="empty-sub">Sobald User ihr Land im Profil hinterlegen, erscheint hier die Weltkarte.</div>
    </div>
  `
}

function renderError(err) {
  return `
    <div class="error-state glass-card">
      <div class="error-icon">${iconHtml('alert-triangle')}</div>
      <div class="error-title">Fehler beim Laden</div>
      <div class="error-sub">${htmlEscape(err?.message || 'Unbekannter Fehler')}</div>
      <button class="btn btn-primary" data-act="retry">Erneut versuchen</button>
    </div>
  `
}

const styles = `
<style data-panel="users-by-country">
.panel-shell{display:flex;flex-direction:column;gap:18px;padding:16px}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.panel-head h2{font-size:1.4rem;font-weight:700;margin:0;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.toolbar-spacer{flex:1;min-width:8px}
.segmented{display:inline-flex;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:3px}
.seg-btn{padding:6px 14px;border-radius:7px;background:transparent;color:var(--text-muted,#9aa0a6);border:0;cursor:pointer;font-size:.85rem;font-weight:500;transition:all .15s}
.seg-btn.is-active{background:rgba(255,255,255,.09);color:var(--text,#fff);box-shadow:0 1px 2px rgba(0,0,0,.2)}
.hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.hero-card{padding:18px 20px;border-radius:14px}
.hero-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#9aa0a6);margin-bottom:8px}
.hero-value{font-size:2.1rem;font-weight:700;letter-spacing:-.02em;line-height:1}
.hero-sub{font-size:.82rem;color:var(--text-muted,#9aa0a6);margin-top:6px}
.glass-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);backdrop-filter:blur(20px);border-radius:14px}
.card-title{font-size:.85rem;font-weight:600;color:var(--text-muted,#9aa0a6);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em}
.section{padding:18px}
.country-list{display:flex;flex-direction:column;gap:2px;padding:8px}
.country-row{display:grid;grid-template-columns:46px 1fr 2fr auto 24px;gap:14px;align-items:center;padding:12px 14px;border-radius:10px;cursor:pointer;transition:background .14s}
.country-row:hover{background:rgba(255,255,255,.05)}
.country-row:focus-visible{outline:2px solid var(--accent,#6366f1);outline-offset:-2px}
.country-flag{font-size:1.6rem;line-height:1}
.country-name{font-weight:600;font-size:.95rem}
.country-sub{font-size:.75rem;color:var(--text-muted,#9aa0a6);margin-top:2px}
.country-bar-wrap{height:8px;background:rgba(255,255,255,.05);border-radius:99px;overflow:hidden}
.country-bar{height:100%;background:linear-gradient(90deg,#6366f1,#a855f7);border-radius:99px;transition:width .4s cubic-bezier(.2,.8,.2,1)}
.country-count{text-align:right}
.country-count-main{font-weight:700;font-size:1rem;font-variant-numeric:tabular-nums}
.country-count-sub{font-size:.7rem;color:#10b981;margin-top:2px}
.country-chev{color:var(--text-muted,#9aa0a6);opacity:.5}
.country-row:hover .country-chev{opacity:1;transform:translateX(2px)}
.map-legend{display:flex;align-items:center;gap:10px;justify-content:flex-end;padding:0 18px 12px}
.map-legend-label{font-size:.72rem;color:var(--text-muted,#9aa0a6)}
.map-legend-gradient{width:140px;height:8px;border-radius:4px;background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(168,85,247,.95))}
.choropleth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;padding:14px}
.map-tile{position:relative;padding:14px 10px;border-radius:12px;background:linear-gradient(135deg,rgba(99,102,241,calc(var(--intensity)*.28)),rgba(168,85,247,calc(var(--intensity)*.42)));border:1px solid rgba(255,255,255,calc(var(--intensity)*.18 + .04));cursor:pointer;text-align:center;transition:transform .18s,box-shadow .18s}
.map-tile:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(99,102,241,.25)}
.map-tile:focus-visible{outline:2px solid var(--accent,#6366f1);outline-offset:2px}
.map-tile-flag{font-size:1.8rem;line-height:1}
.map-tile-code{font-weight:700;font-size:.78rem;margin-top:6px;letter-spacing:.04em}
.map-tile-count{font-size:.72rem;color:var(--text-muted,#cbd5e1);margin-top:2px;font-variant-numeric:tabular-nums}
.region-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px}
@media(max-width:720px){.region-grid{grid-template-columns:1fr}}
.region-chart-wrap,.region-list{padding:18px}
.chart-wrap{min-height:260px}
.region-row{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.05)}
.region-row:last-child{border-bottom:0}
.region-name{font-weight:500}
.region-count{font-weight:700;font-variant-numeric:tabular-nums}
.empty-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:60px 20px;text-align:center}
.empty-icon{font-size:2.4rem;opacity:.5}
.empty-title{font-weight:600;font-size:1.05rem}
.empty-sub{color:var(--text-muted,#9aa0a6);font-size:.88rem;max-width:360px}
.error-state{padding:30px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.error-icon{font-size:2rem;color:#ef4444}
.error-title{font-weight:600;font-size:1rem}
.error-sub{color:var(--text-muted,#9aa0a6);font-size:.85rem}
.muted{color:var(--text-muted,#9aa0a6);text-align:center;padding:30px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:var(--text,#fff);cursor:pointer;font-size:.85rem;font-weight:500;transition:all .15s}
.btn:hover{background:rgba(255,255,255,.07)}
.btn-primary{background:linear-gradient(135deg,#6366f1,#a855f7);border-color:transparent}
.btn-primary:hover{filter:brightness(1.1)}
.drawer-user-row{display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;cursor:pointer;transition:background .14s}
.drawer-user-row:hover{background:rgba(255,255,255,.05)}
.drawer-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:.85rem;flex-shrink:0;background-size:cover;background-position:center}
.drawer-user-meta{flex:1;min-width:0}
.drawer-user-name{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drawer-user-sub{font-size:.75rem;color:var(--text-muted,#9aa0a6);margin-top:2px}
.badge-mini{display:inline-block;padding:1px 6px;border-radius:99px;font-size:.65rem;font-weight:600;margin-left:6px}
.badge-mini.verified{background:rgba(16,185,129,.18);color:#10b981}
.badge-mini.premium{background:rgba(245,158,11,.18);color:#f59e0b}
</style>
`

export default {
  id: 'users-by-country',
  title: 'User-Weltkarte',
  category: 'growth',

  async mount(container) {
    try {
    if (!document.querySelector('style[data-panel="users-by-country"]')) {
      document.head.insertAdjacentHTML('beforeend', styles)
    }

    container.innerHTML = `
      <div class="panel-shell">
        <div class="panel-head">
          <h2>${iconHtml('globe')} User-Weltkarte</h2>
          ${renderToolbar()}
        </div>
        <div id="hero-slot"></div>
        <div class="glass-card section" id="body-slot"></div>
      </div>
    `

    const heroSlot = container.querySelector('#hero-slot')
    const bodySlot = container.querySelector('#body-slot')

    try { skeletonLoader(heroSlot, { rows: 1, height: 100 }) } catch(_) { heroSlot.innerHTML = '' }
    try { skeletonLoader(bodySlot, { rows: 6, height: 38 }) } catch(_) { bodySlot.innerHTML = '' }

    const state = { view: 'list', countries: [] }

    const renderBody = () => {
      if (!state.countries.length) { bodySlot.innerHTML = renderEmpty(); return }
      if (state.view === 'list') bodySlot.innerHTML = renderCountryList(state.countries)
      else if (state.view === 'map') bodySlot.innerHTML = renderMap(state.countries)
      else if (state.view === 'regions') {
        bodySlot.innerHTML = renderRegions(state.countries)
        const wrap = bodySlot.querySelector('#region-donut')
        if (wrap) {
          const byRegion = new Map()
          for (const c of state.countries) {
            const r = regionOf(c.code)
            byRegion.set(r, (byRegion.get(r) || 0) + c.count)
          }
          const entries = Array.from(byRegion.entries()).sort((a, b) => b[1] - a[1])
          try {
            makeDonutChart(wrap, {
              labels: entries.map(e => e[0]),
              values: entries.map(e => e[1])
            })
          } catch(e) {
            wrap.innerHTML = '<div class="muted">Chart nicht verfügbar</div>'
          }
        }
      }
    }

    const animateHero = () => {
      heroSlot.querySelectorAll('[data-countup]').forEach(el => {
        const target = Number(el.dataset.countup) || 0
        try { countUp(el, target, { duration: 900 }) } catch(_) { el.textContent = fmtNumber(target) }
      })
    }

    const load = async () => {
      try {
        const countries = await fetchCountries()
        state.countries = countries
        heroSlot.innerHTML = renderHero(countries)
        animateHero()
        renderBody()
        try { fadeIn(container, { duration: 300 }) } catch(_) {}
      } catch (err) {
        console.error('[users-by-country] load failed', err)
        bodySlot.innerHTML = renderError(err)
        heroSlot.innerHTML = ''
      }
    }

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]')
      if (btn) {
        const act = btn.dataset.act
        if (act === 'refresh') { toast('Aktualisiere…'); await load(); toast('Aktualisiert') }
        else if (act === 'pdf') { try { await exportPanelAsPdf(container, { title: 'User-Weltkarte' }) } catch(err){ toast('PDF-Export fehlgeschlagen', 'error') } }
        else if (act === 'csv') {
          try {
            exportCsv('users-by-country.csv', state.countries.map(c => ({
              code: c.code, land: countryName(c.code), region: regionOf(c.code), user_count: c.count, neu_30d: c.recent
            })))
          } catch(err){ toast('CSV-Export fehlgeschlagen', 'error') }
        }
        else if (act === 'retry') { await load() }
        return
      }

      const seg = e.target.closest('[data-view]')
      if (seg) {
        container.querySelectorAll('[data-view]').forEach(s => s.classList.remove('is-active'))
        seg.classList.add('is-active')
        state.view = seg.dataset.view
        renderBody()
        return
      }

      const cRow = e.target.closest('[data-country]')
      if (cRow) {
        openCountryDrawer(cRow.dataset.country)
        return
      }
    })

    container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const cRow = e.target.closest('[data-country]')
        if (cRow) { e.preventDefault(); openCountryDrawer(cRow.dataset.country) }
      }
    })

    async function openCountryDrawer(code) {
      const title = `${flagFromCode(code)} ${countryName(code)}`
      let dr
      try {
        dr = drawer({
          title,
          width: 460,
          content: `<div id="cd-body"><div class="muted">Lade User…</div></div>`
        })
      } catch (_) {
        modal({ title, body: `<div id="cd-body"><div class="muted">Lade User…</div></div>` })
      }
      const body = document.querySelector('#cd-body')
      if (!body) return
      try {
        const meta = state.countries.find(c => c.code === code)
        body.innerHTML = `
          <div style="padding:10px 14px;display:flex;gap:18px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px">
            <div><div style="font-size:.72rem;color:#9aa0a6;text-transform:uppercase;letter-spacing:.05em">Gesamt</div><div style="font-weight:700;font-size:1.2rem">${fmtNumber(meta?.count || 0)}</div></div>
            <div><div style="font-size:.72rem;color:#9aa0a6;text-transform:uppercase;letter-spacing:.05em">Neu 30T</div><div style="font-weight:700;font-size:1.2rem;color:#10b981">+${fmtNumber(meta?.recent || 0)}</div></div>
            <div><div style="font-size:.72rem;color:#9aa0a6;text-transform:uppercase;letter-spacing:.05em">Region</div><div style="font-weight:700;font-size:.95rem;padding-top:4px">${htmlEscape(regionOf(code))}</div></div>
          </div>
          ${renderUsersFromCountryEmptyState()}
        `
      } catch (err) {
        body.innerHTML = renderError(err)
      }
    }

    await load()
    } catch (mountErr) {
      console.error('[users-by-country] mount failed', mountErr)
      try {
        container.innerHTML = `
          <div class="panel-shell">
            <div class="error-state glass-card">
              <div class="error-icon">!</div>
              <div class="error-title">Panel konnte nicht geladen werden</div>
              <div class="error-sub">${(mountErr && mountErr.message) ? mountErr.message.replace(/[<>&]/g, '') : 'Unbekannter Fehler'}</div>
            </div>
          </div>
        `
      } catch (_) {}
    }
  }
}
