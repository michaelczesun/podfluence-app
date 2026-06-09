import { sb } from '/lib/supabase.js?v=20260608n'
import { toast, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608n'
import { fadeIn } from '/lib/animations.js?v=20260608n'

// ---------------------------------------------------------------------------
// App-Settings Panel
// Spiegel der App-Konfig: Werte werden aus public.app_settings via RPC
// `admin_settings_list` geladen und per `admin_setting_set` zurückgeschrieben.
// Schema-Erwartung (RPC-Output):
//   { key, value, value_type, category, description, updated_at, updated_by, updater_username }
// ---------------------------------------------------------------------------

const REFRESH_MS = 60_000

const CATEGORY_META = {
  features:   { label: 'Features',    icon: 'sparkles',  accent: '#8b5cf6' },
  limits:     { label: 'Limits',      icon: 'gauge',     accent: '#3b82f6' },
  bot:        { label: 'Bot',         icon: 'bot',       accent: '#22c55e' },
  verify:     { label: 'Verify',      icon: 'shield',    accent: '#f59e0b' },
  newsletter: { label: 'Newsletter',  icon: 'mail',      accent: '#ec4899' },
  other:      { label: 'Sonstiges',   icon: 'settings',  accent: '#6b7280' }
}

function styles() {
  return `<style>
    .panel-shell{padding:24px;min-height:100%;color:#fff}
    .panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;flex-wrap:wrap}
    .panel-head h2{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}
    .panel-head .sub{font-size:13px;color:var(--text-muted,#9CA3AF);margin-top:4px}
    .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .toolbar button{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#e2e2ea;font-size:13px;font-family:inherit;cursor:pointer;transition:all .15s}
    .toolbar button:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14)}
    .toolbar button:disabled{opacity:.5;cursor:not-allowed}
    .live-dot{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#22c55e;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
    .live-dot::before{content:'';width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;animation:pulseDot 1.6s ease-in-out infinite}
    @keyframes pulseDot{0%,100%{opacity:1}50%{opacity:.4}}

    .skeleton-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
    .skel-card{height:160px;border-radius:16px;background:linear-gradient(140deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.06);animation:skelPulse 1.6s ease-in-out infinite}
    @keyframes skelPulse{0%,100%{opacity:.5}50%{opacity:.85}}

    .cat-grid{display:grid;grid-template-columns:1fr;gap:18px}
    .cat-card{position:relative;padding:22px;border-radius:18px;background:var(--surface-elev,linear-gradient(140deg,rgba(255,255,255,.04),rgba(255,255,255,.01)));border:1px solid var(--border-subtle,rgba(255,255,255,.06));overflow:hidden}
    .cat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent,#8b5cf6)}
    .cat-head{display:flex;align-items:center;gap:10px;margin-bottom:18px}
    .cat-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb, var(--accent,#8b5cf6) 18%, transparent);color:var(--accent,#8b5cf6)}
    .cat-title{font-size:15px;font-weight:600;letter-spacing:-.01em}
    .cat-count{margin-left:auto;font-size:11px;color:var(--text-muted,#9CA3AF);text-transform:uppercase;letter-spacing:.08em}

    .settings-table{width:100%;border-collapse:separate;border-spacing:0}
    .settings-table th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#9CA3AF);text-align:left;padding:6px 10px;font-weight:600;border-bottom:1px solid rgba(255,255,255,.06)}
    .settings-table td{padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px;vertical-align:top}
    .settings-table tr:last-child td{border-bottom:none}
    .settings-table tr.dirty td{background:rgba(139,92,246,.07)}

    .row-key{font-weight:600;color:#fff;font-family:'SF Mono','Monaco',monospace;font-size:12.5px}
    .row-desc{font-size:12px;color:var(--text-muted,#9CA3AF);margin-top:3px;line-height:1.45;max-width:380px}
    .row-meta{font-size:11px;color:var(--text-dim,#6B7280);margin-top:6px}

    .val-input{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;min-width:160px;max-width:280px;width:100%}
    .val-input:focus{outline:none;border-color:rgba(139,92,246,.6);background:rgba(255,255,255,.06)}
    .val-textarea{min-height:60px;font-family:'SF Mono','Monaco',monospace;font-size:12px;resize:vertical}
    .val-type{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim,#6B7280);margin-bottom:4px;display:block}

    /* toggle */
    .tog{position:relative;display:inline-block;width:42px;height:24px;cursor:pointer}
    .tog input{opacity:0;width:0;height:0;position:absolute}
    .tog-track{position:absolute;inset:0;background:rgba(255,255,255,.1);border-radius:999px;border:1px solid rgba(255,255,255,.08);transition:background .2s}
    .tog input:checked + .tog-track{background:rgba(139,92,246,.85);border-color:rgba(139,92,246,.5)}
    .tog-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none}
    .tog input:checked ~ .tog-thumb{transform:translateX(18px)}

    .btn-save{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .15s;box-shadow:0 4px 12px rgba(139,92,246,.3)}
    .btn-save:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(139,92,246,.45)}
    .btn-save:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
    .btn-reset{background:transparent;color:var(--text-muted,#9CA3AF);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 12px;font-size:12px;font-family:inherit;cursor:pointer;margin-left:6px}
    .btn-reset:hover{color:#fff;border-color:rgba(255,255,255,.16)}

    .empty{padding:40px;text-align:center;color:var(--text-muted,#9CA3AF);font-size:14px}
    .error-state{padding:30px;text-align:center;color:#F87171;font-size:14px;border:1px solid rgba(248,113,113,.2);border-radius:14px;background:rgba(248,113,113,.05)}

    @media (max-width:700px){
      .settings-table thead{display:none}
      .settings-table tr{display:block;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.05)}
      .settings-table td{display:block;padding:6px 0;border:none}
    }
  </style>`
}

function toolbarHtml() {
  return `<div class="toolbar">
    <span class="live-dot">Live</span>
    <button id="btn-refresh" type="button">${iconHtml ? iconHtml('refresh') : '↺'} Aktualisieren</button>
  </div>`
}

function errorState(e) {
  return `${styles()}<div class="panel-shell">
    <div class="panel-head"><div><h2>App-Settings</h2><div class="sub">Fehler beim Laden</div></div></div>
    <div class="error-state">${htmlEscape(e?.message || String(e))}</div>
  </div>`
}

// Coerce raw RPC value into a primitive matching value_type
function parseValue(raw, type) {
  if (raw === null || raw === undefined) return null
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const s = String(raw).toLowerCase().trim()
    return s === 'true' || s === '1' || s === 't' || s === 'yes'
  }
  if (type === 'number' || type === 'integer' || type === 'int' || type === 'float') {
    if (typeof raw === 'number') return raw
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'json' || type === 'object' || type === 'array') {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) } catch (_) { return raw }
    }
    return raw
  }
  // string default
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

function serializeValue(displayValue, type) {
  if (type === 'boolean') return !!displayValue
  if (type === 'number' || type === 'integer' || type === 'int' || type === 'float') {
    const n = Number(displayValue)
    if (!Number.isFinite(n)) throw new Error('Ungültige Zahl')
    return n
  }
  if (type === 'json' || type === 'object' || type === 'array') {
    if (typeof displayValue === 'string') {
      try { return JSON.parse(displayValue) }
      catch (e) { throw new Error('Ungültiges JSON: ' + e.message) }
    }
    return displayValue
  }
  return String(displayValue ?? '')
}

function valueEditorHtml(setting, currentValue) {
  const t = (setting.value_type || 'string').toLowerCase()
  const key = htmlEscape(setting.key)
  if (t === 'boolean') {
    return `<label class="tog" data-key="${key}">
      <input type="checkbox" class="val-bool" ${currentValue ? 'checked' : ''} />
      <span class="tog-track"></span>
      <span class="tog-thumb"></span>
    </label>
    <span class="val-type">boolean</span>`
  }
  if (t === 'number' || t === 'integer' || t === 'int' || t === 'float') {
    return `<span class="val-type">${htmlEscape(t)}</span>
      <input type="number" class="val-input val-num" data-key="${key}" value="${htmlEscape(String(currentValue ?? ''))}" step="${t === 'float' ? 'any' : '1'}" />`
  }
  if (t === 'json' || t === 'object' || t === 'array') {
    const s = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2)
    return `<span class="val-type">${htmlEscape(t)}</span>
      <textarea class="val-input val-textarea val-json" data-key="${key}">${htmlEscape(s ?? '')}</textarea>`
  }
  // string
  return `<span class="val-type">string</span>
    <input type="text" class="val-input val-str" data-key="${key}" value="${htmlEscape(String(currentValue ?? ''))}" />`
}

function readEditorValue(rowEl, type) {
  const t = (type || 'string').toLowerCase()
  if (t === 'boolean') {
    return rowEl.querySelector('.val-bool')?.checked === true
  }
  if (t === 'number' || t === 'integer' || t === 'int' || t === 'float') {
    const v = rowEl.querySelector('.val-num')?.value
    return v === '' ? null : Number(v)
  }
  if (t === 'json' || t === 'object' || t === 'array') {
    return rowEl.querySelector('.val-json')?.value ?? ''
  }
  return rowEl.querySelector('.val-str')?.value ?? ''
}

function groupByCategory(settings) {
  const groups = {}
  for (const s of settings) {
    const cat = (s.category || 'other').toLowerCase()
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(s)
  }
  // sort settings within each group by key
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => String(a.key).localeCompare(String(b.key)))
  }
  return groups
}

function renderCategory(catKey, items) {
  const meta = CATEGORY_META[catKey] || CATEGORY_META.other
  const rowsHtml = items.map(s => {
    const parsed = parseValue(s.value, s.value_type)
    const updated = s.updated_at ? fmtRelativeTime(s.updated_at) : '—'
    const updater = s.updater_username || s.updated_by || '—'
    return `<tr data-key="${htmlEscape(s.key)}" data-type="${htmlEscape((s.value_type || 'string').toLowerCase())}">
      <td>
        <div class="row-key">${htmlEscape(s.key)}</div>
        ${s.description ? `<div class="row-desc">${htmlEscape(s.description)}</div>` : ''}
        <div class="row-meta">Zuletzt: ${htmlEscape(updated)} · von ${htmlEscape(updater)}</div>
      </td>
      <td style="min-width:220px">
        ${valueEditorHtml(s, parsed)}
      </td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-save" data-action="save" disabled>${iconHtml ? iconHtml('save') : '💾'} Speichern</button>
        <button class="btn-reset" data-action="reset" disabled>Reset</button>
      </td>
    </tr>`
  }).join('')

  return `<section class="cat-card" style="--accent:${meta.accent}">
    <div class="cat-head">
      <div class="cat-icon">${iconHtml ? iconHtml(meta.icon) : '⚙'}</div>
      <div class="cat-title">${htmlEscape(meta.label)}</div>
      <div class="cat-count">${items.length} Einstellung${items.length === 1 ? '' : 'en'}</div>
    </div>
    <table class="settings-table">
      <thead>
        <tr><th>Schlüssel</th><th>Wert</th><th></th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </section>`
}

function renderBody(body, settings) {
  if (!settings.length) {
    body.innerHTML = `<div class="empty">
      <div style="font-size:42px;margin-bottom:14px;opacity:.55">${iconHtml ? iconHtml('settings') : '⚙'}</div>
      <div style="font-size:15px;color:#fff;font-weight:600;margin-bottom:6px">Noch keine App-Settings angelegt</div>
      <div style="max-width:420px;margin:0 auto 16px;line-height:1.5">Die Tabelle <code>public.app_settings</code> ist leer. Sobald Einträge angelegt sind, erscheinen sie hier kategorisiert mit Live-Edit.</div>
      <button class="btn-save" id="btn-empty-reload">${iconHtml ? iconHtml('refresh') : '↺'} Neu laden</button>
    </div>`
    body.querySelector('#btn-empty-reload')?.addEventListener('click', () => {
      if (typeof body._reload === 'function') body._reload()
    })
    return
  }
  const groups = groupByCategory(settings)
  // Preserve known category order
  const order = ['features', 'limits', 'bot', 'verify', 'newsletter']
  const rest = Object.keys(groups).filter(k => !order.includes(k)).sort()
  const ordered = [...order.filter(k => groups[k]), ...rest]

  body.innerHTML = `<div class="cat-grid">
    ${ordered.map(k => renderCategory(k, groups[k])).join('')}
  </div>`

  wireRows(body, settings)
}

function wireRows(body, settings) {
  const byKey = new Map(settings.map(s => [s.key, s]))

  body.querySelectorAll('tr[data-key]').forEach(tr => {
    const key = tr.dataset.key
    const type = tr.dataset.type
    const setting = byKey.get(key)
    const initial = parseValue(setting.value, setting.value_type)
    const saveBtn = tr.querySelector('button[data-action="save"]')
    const resetBtn = tr.querySelector('button[data-action="reset"]')

    const checkDirty = () => {
      let current
      try { current = readEditorValue(tr, type) } catch (_) { current = null }
      let dirty = false
      if (type === 'boolean') {
        dirty = !!current !== !!initial
      } else if (type === 'json' || type === 'object' || type === 'array') {
        const initStr = typeof initial === 'string' ? initial : JSON.stringify(initial)
        dirty = String(current ?? '') !== String(initStr ?? '')
      } else if (type === 'number' || type === 'integer' || type === 'int' || type === 'float') {
        dirty = Number(current) !== Number(initial)
      } else {
        dirty = String(current ?? '') !== String(initial ?? '')
      }
      tr.classList.toggle('dirty', dirty)
      saveBtn.disabled = !dirty
      resetBtn.disabled = !dirty
    }

    const debounced = debounce ? debounce(checkDirty, 80) : checkDirty
    tr.querySelectorAll('input, textarea').forEach(inp => {
      inp.addEventListener('input', debounced)
      inp.addEventListener('change', debounced)
    })

    resetBtn.addEventListener('click', () => {
      const boolInp = tr.querySelector('.val-bool')
      if (boolInp) boolInp.checked = !!initial
      const numInp = tr.querySelector('.val-num')
      if (numInp) numInp.value = initial ?? ''
      const strInp = tr.querySelector('.val-str')
      if (strInp) strInp.value = initial ?? ''
      const jsonInp = tr.querySelector('.val-json')
      if (jsonInp) jsonInp.value = typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2)
      checkDirty()
    })

    saveBtn.addEventListener('click', async () => {
      let raw
      try { raw = readEditorValue(tr, type) }
      catch (e) { toast('Lesefehler: ' + e.message, 'error'); return }

      let serialized
      try { serialized = serializeValue(raw, type) }
      catch (e) { toast(e.message, 'error'); return }

      saveBtn.disabled = true
      saveBtn.innerHTML = '⏳ Speichert…'
      try {
        const { error } = await sb.rpc('admin_settings_set', {
          p_key: key,
          p_value: serialized
        })
        if (error) throw error
        toast(`„${key}" gespeichert`, 'success')
        // Update local initial baseline
        setting.value = serialized
        // Trigger reload to refresh updated_at / updater
        if (typeof body._reload === 'function') body._reload()
      } catch (e) {
        toast('Speichern fehlgeschlagen: ' + (e.message || String(e)), 'error')
        saveBtn.disabled = false
      }
      saveBtn.innerHTML = (iconHtml ? iconHtml('save') : '💾') + ' Speichern'
    })
  })
}

export default {
  id: 'app-settings',
  title: 'App-Settings',
  category: 'admin_actions',

  async mount(container, opts = {}) {
    // opts.role wird vom Top-Router (_tab-system.js → mountSubPanel → crm/index.html)
    // durchgereicht. Owner+Admin haben in permissions.json 'rw' auf system.settings,
    // sollten also NIE einen client-seitigen Block hier sehen. Wenn die RPC
    // trotzdem einen admin_required-Error zurückgibt, ist das ein DB-seitiger
    // Bug (admin_role_check kennt 'owner' nicht).
    const callerRole = opts?.role || null
    let refreshTimer = null
    let rtCh = null

    try {
      container.innerHTML = `${styles()}<div class="panel-shell">
        <div class="panel-head">
          <div>
            <h2>App-Settings</h2>
            <div class="sub" id="last-upd">Lädt …</div>
          </div>
          ${toolbarHtml()}
        </div>
        <div class="panel-body" id="body">
          <div class="skeleton-grid">${[1,2,3,4].map(()=>`<div class="skel-card"></div>`).join('')}</div>
        </div>
      </div>`

      try { fadeIn(container) } catch (_) {}

      const body = container.querySelector('#body')
      const lastUpd = container.querySelector('#last-upd')
      const refreshBtn = container.querySelector('#btn-refresh')

      const load = async () => {
        try {
          const { data, error } = await sb.rpc('admin_settings_list')
          if (error) {
            // Spezialfall: RPC wirft 'admin_required' obwohl Caller owner ist.
            // Das ist ein DB-seitiger Bug (require_admin() prüft NUR auf
            // admin_users.role IN ('admin','support',...) und kennt 'owner'
            // nicht). Wir fangen das ab, damit der Fehler im UI klar gemeldet
            // wird statt als generischer Postgres-Fehler durchzurutschen.
            const msg = String(error.message || '')
            if (callerRole === 'owner' && /admin_required|admin required|not.*admin/i.test(msg)) {
              throw new Error(
                `RPC admin_settings_list verweigert owner-Zugriff (` +
                `"${msg}"). DB-Funktion require_admin() muss owner-Rolle ` +
                `whitelisten. Workaround: User im admin_users-Table auf ` +
                `role='admin' setzen.`
              )
            }
            throw error
          }
          const settings = (data || []).map(r => ({
            key: r.key,
            value: r.value,
            value_type: r.value_type || 'string',
            category: r.category || 'other',
            description: r.description || '',
            updated_at: r.updated_at,
            updated_by: r.updated_by,
            updater_username: r.updater_username
          }))
          renderBody(body, settings)
          body._reload = load
          lastUpd.textContent = `${settings.length} Einstellung${settings.length === 1 ? '' : 'en'} · aktualisiert ${fmtDateTime(new Date().toISOString())}`
        } catch (e) {
          body.innerHTML = `<div class="error-state">Fehler beim Laden: ${htmlEscape(e.message || String(e))}<br><br>
            <button class="btn-save" id="btn-retry">↺ Erneut versuchen</button></div>`
          body.querySelector('#btn-retry')?.addEventListener('click', load)
          lastUpd.textContent = 'Fehler'
        }
      }

      refreshBtn?.addEventListener('click', () => load())

      await load()

      refreshTimer = setInterval(load, REFRESH_MS)

      // Realtime: react to external changes on app_settings.
      // Debounced: bursts of edits (z.B. Bot-Cron der mehrere Keys schreibt)
      // sollen NICHT jeweils ein RPC-Reload auslösen — sonst Panel laggt
      // wie die App-Community-Card (siehe 8.6.26-Beschwerde).
      const debouncedLoad = debounce ? debounce(() => load(), 1500) : (() => load())
      try {
        rtCh = sb.channel('app-settings-rt')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => {
            debouncedLoad()
          })
          .subscribe()
      } catch (_) { rtCh = null }

      return () => {
        if (refreshTimer) clearInterval(refreshTimer)
        if (rtCh) { try { sb.removeChannel(rtCh) } catch (_) {} }
      }
    } catch (e) {
      container.innerHTML = errorState(e)
      return () => {
        if (refreshTimer) clearInterval(refreshTimer)
        if (rtCh) { try { sb.removeChannel(rtCh) } catch (_) {} }
      }
    }
  }
}
