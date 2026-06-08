import { sb } from '/lib/supabase.js?v=20260608j'
import { toast, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml } from '/lib/ui.js?v=20260608k'
import { fadeIn } from '/lib/animations.js?v=20260608j'

// ---------------------------------------------------------------------------
// System Top-Tab
// Aggregiert mehrere System-/Admin-Subpanels in einem Tab-Container:
//   - Settings   → bestehendes Panel `app-settings`
//   - Tasks      → bestehendes Panel `tasks-inbox`
//   - Audit      → bestehendes Panel `audit-log`
//   - API-Health → NEU: Card-Liste mit Probe-Status aller Admin-RPCs
//   - Backups    → NEU: Placeholder „Coming soon"
//
// Sub-Panels werden lazy gemountet (erstes Aktivieren lädt + mountet).
// Beim Wechsel bleibt der vorherige Sub-Mount aktiv (für Hin-und-Her-Wechsel
// ohne Reload). Beim Unmount des Top-Tabs werden ALLE Sub-Cleanups gerufen.
// ---------------------------------------------------------------------------

const SUB_TABS = [
  { key: 'settings',   label: 'Settings',   icon: 'settings',  panel: 'app-settings' },
  { key: 'tasks',      label: 'Tasks',      icon: 'inbox',     panel: 'tasks-inbox' },
  { key: 'audit',      label: 'Audit',      icon: 'shield',    panel: 'audit-log' },
  { key: 'api-health', label: 'API-Health', icon: 'gauge',     panel: null /* inline */ },
  { key: 'backups',    label: 'Backups',    icon: 'database',  panel: null /* inline */ }
]

// Liste aller Admin-/CRM-RPCs (siehe schema_truth_discovery.md)
// Argumente werden absichtlich konservativ gewählt — Goal: minimaler Probe-Call,
// der ein 2xx (oder erwarteten Permission-Fehler) zurückgibt.
const ADMIN_RPCS = [
  // Stats / Series
  { name: 'admin_db_live_stats',         args: {},                              group: 'Stats' },
  { name: 'admin_daily_series',          args: { p_metric: 'signups', p_days: 7 }, group: 'Stats' },
  { name: 'admin_user_type_split',       args: {},                              group: 'Stats' },
  { name: 'admin_build_versions',        args: {},                              group: 'Stats' },
  { name: 'onboarding_funnel_stats',     args: {},                              group: 'Stats' },
  // Users
  { name: 'admin_users_list_full',       args: { p_limit: 1, p_offset: 0 },     group: 'Users' },
  { name: 'admin_users_list_filtered',   args: { p_limit: 1, p_offset: 0 },     group: 'Users' },
  { name: 'admin_impersonate_snapshot',  args: { p_user_id: '00000000-0000-0000-0000-000000000000' }, group: 'Users', expectsError: true },
  // Actions
  { name: 'admin_set_user_flag',         args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_flag: 'is_verified', p_value: false }, group: 'Actions', expectsError: true },
  { name: 'admin_ban_user',              args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_reason: 'probe' }, group: 'Actions', expectsError: true },
  { name: 'admin_set_premium',           args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_days: 0 }, group: 'Actions', expectsError: true },
  { name: 'admin_bulk_verify',           args: { p_user_ids: [] },              group: 'Actions' },
  { name: 'admin_log_action',            args: { action: 'probe', target_type: 'system', target_id: 'health', meta: {} }, group: 'Actions' },
  { name: 'admin_set_podcast_featured',  args: { p_podcast_id: '00000000-0000-0000-0000-000000000000', p_value: false }, group: 'Actions', expectsError: true },
  // Audit / Logs
  { name: 'admin_audit_recent',          args: { p_limit: 1 },                  group: 'Audit' },
  // CRM
  { name: 'crm_trending_podcasters',     args: { p_limit: 1 },                  group: 'CRM' },
  { name: 'admin_leads_list',            args: {},                              group: 'CRM' },
  { name: 'admin_lead_upsert',           args: { p_email: 'probe@example.invalid', p_status: 'new' }, group: 'CRM', expectsError: true },
  { name: 'admin_user_notes_list',       args: { p_user_id: '00000000-0000-0000-0000-000000000000' }, group: 'CRM' },
  { name: 'admin_user_note_add',         args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_note: 'probe' }, group: 'CRM', expectsError: true },
  // Tasks / Settings / Team
  { name: 'admin_tasks_list',            args: {},                              group: 'System' },
  { name: 'admin_settings_list',         args: {},                              group: 'System' },
  { name: 'admin_setting_set',           args: { p_key: '__probe_nonexistent__', p_value: null }, group: 'System', expectsError: true },
  { name: 'admin_team_list',             args: {},                              group: 'System' },
  { name: 'admin_team_set_role',         args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_role: 'support' }, group: 'System', expectsError: true },
  // Listening
  { name: 'friend_listening_activity',   args: { p_limit: 1 },                  group: 'Listening' },
  { name: 'community_listening_now',     args: { p_limit: 1 },                  group: 'Listening' }
]

function styles() {
  return `<style>
    .sys-shell{padding:24px;min-height:100%;color:#fff}
    .sys-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;flex-wrap:wrap}
    .sys-head h2{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}
    .sys-head .sub{font-size:13px;color:var(--text-muted,#9CA3AF);margin-top:4px}

    .sys-subtabs{display:flex;gap:4px;padding:4px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;margin-bottom:18px;overflow-x:auto;scrollbar-width:none}
    .sys-subtabs::-webkit-scrollbar{display:none}
    .sys-subtab{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:10px;background:transparent;border:none;color:var(--text-muted,#9CA3AF);font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .15s}
    .sys-subtab:hover{color:#fff;background:rgba(255,255,255,.04)}
    .sys-subtab.active{background:linear-gradient(135deg,rgba(139,92,246,.18),rgba(124,58,237,.12));color:#fff;box-shadow:inset 0 0 0 1px rgba(139,92,246,.35)}
    .sys-subtab .ic{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;opacity:.85}

    .sys-pane{display:none;animation:sysFadeIn .25s ease both}
    .sys-pane.active{display:block}
    @keyframes sysFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

    .sys-loading{padding:60px;text-align:center;color:var(--text-muted,#9CA3AF);font-size:14px}
    .sys-error{padding:24px;border:1px solid rgba(248,113,113,.25);background:rgba(248,113,113,.06);color:#fca5a5;border-radius:14px;font-size:13.5px}

    /* API-Health */
    .api-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap}
    .api-toolbar .summary{font-size:13px;color:var(--text-muted,#9CA3AF)}
    .api-toolbar .summary .ok{color:#22c55e;font-weight:600}
    .api-toolbar .summary .err{color:#f87171;font-weight:600}
    .api-toolbar .summary .pending{color:#fbbf24;font-weight:600}
    .api-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#e2e2ea;font-size:13px;font-family:inherit;cursor:pointer;transition:all .15s}
    .api-btn:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14)}
    .api-btn:disabled{opacity:.5;cursor:not-allowed}

    .api-group{margin-bottom:22px}
    .api-group-head{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted,#9CA3AF);font-weight:600;margin-bottom:10px;padding-left:4px}
    .api-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
    .api-card{position:relative;padding:14px 16px;border-radius:12px;background:linear-gradient(140deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.06);transition:border-color .2s, background .2s}
    .api-card.ok{border-color:rgba(34,197,94,.32);background:linear-gradient(140deg,rgba(34,197,94,.07),rgba(34,197,94,.015))}
    .api-card.err{border-color:rgba(248,113,113,.32);background:linear-gradient(140deg,rgba(248,113,113,.06),rgba(248,113,113,.015))}
    .api-card.pending{border-color:rgba(251,191,36,.28)}
    .api-card .top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
    .api-card .nm{font-family:'SF Mono','Monaco',monospace;font-size:12.5px;font-weight:600;color:#fff;word-break:break-all}
    .api-card .badge{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
    .api-card.ok .badge{background:rgba(34,197,94,.16);color:#4ade80}
    .api-card.err .badge{background:rgba(248,113,113,.16);color:#fca5a5}
    .api-card.pending .badge{background:rgba(251,191,36,.16);color:#fbbf24}
    .api-card.pending .badge::before{content:'';width:8px;height:8px;border-radius:50%;background:#fbbf24;animation:apiPulse 1.2s ease-in-out infinite}
    @keyframes apiPulse{0%,100%{opacity:.4}50%{opacity:1}}
    .api-card .meta{font-size:11.5px;color:var(--text-muted,#9CA3AF);margin-top:4px;line-height:1.45}
    .api-card .err-msg{font-family:'SF Mono','Monaco',monospace;font-size:10.5px;color:#fca5a5;margin-top:6px;padding:6px 8px;background:rgba(0,0,0,.25);border-radius:6px;word-break:break-word;max-height:60px;overflow:auto}
    .api-card .rt{font-variant-numeric:tabular-nums;color:var(--text-dim,#6B7280);font-size:11px}

    /* Backups placeholder */
    .placeholder{padding:60px 28px;text-align:center;border-radius:18px;background:linear-gradient(140deg,rgba(255,255,255,.03),rgba(255,255,255,.01));border:1px dashed rgba(255,255,255,.1)}
    .placeholder .icon{font-size:42px;margin-bottom:14px;opacity:.7}
    .placeholder h3{font-size:18px;font-weight:600;margin:0 0 6px}
    .placeholder p{font-size:13px;color:var(--text-muted,#9CA3AF);margin:0;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.55}

    /* Mobile: prevent overflow, single-column API grid */
    @media (max-width: 767px){
      .sys-shell{padding:12px}
      .api-grid{grid-template-columns:1fr}
      .api-card .nm{font-size:11.5px}
    }
  </style>`
}

function head() {
  return `<div class="sys-head">
    <div>
      <h2>System</h2>
      <div class="sub">Settings, Aufgaben, Audit, API-Status &amp; Backups</div>
    </div>
  </div>`
}

function subtabsHtml() {
  return `<div class="sys-subtabs" role="tablist">
    ${SUB_TABS.map((t, i) => `
      <button class="sys-subtab ${i === 0 ? 'active' : ''}" data-key="${t.key}" role="tab">
        <span class="ic">${iconHtml ? iconHtml(t.icon) : ''}</span>
        <span>${htmlEscape(t.label)}</span>
      </button>
    `).join('')}
  </div>`
}

function panesHtml() {
  return SUB_TABS.map((t, i) => `
    <div class="sys-pane ${i === 0 ? 'active' : ''}" data-key="${t.key}">
      <div class="sys-loading">Lädt …</div>
    </div>
  `).join('')
}

// ---------- API-Health renderer ----------

function apiHealthShell() {
  return `<div>
    <div class="api-toolbar">
      <div class="summary" id="api-summary">
        <span class="pending">${ADMIN_RPCS.length} ausstehend</span>
      </div>
      <button class="api-btn" id="api-rerun">${iconHtml ? iconHtml('refresh') : '↺'} Erneut prüfen</button>
    </div>
    <div id="api-groups"></div>
  </div>`
}

function groupRpcs() {
  const groups = {}
  for (const rpc of ADMIN_RPCS) {
    const g = rpc.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(rpc)
  }
  // Stable group order
  const order = ['Stats', 'Users', 'Actions', 'Audit', 'CRM', 'System', 'Listening', 'Other']
  return order.filter(k => groups[k]).map(k => ({ name: k, items: groups[k] }))
}

function renderApiGroups(host, state) {
  const groups = groupRpcs()
  host.innerHTML = groups.map(g => `
    <section class="api-group">
      <div class="api-group-head">${htmlEscape(g.name)} · ${g.items.length}</div>
      <div class="api-grid">
        ${g.items.map(rpc => {
          const r = state[rpc.name]
          const cls = r?.status === 'ok' ? 'ok' : r?.status === 'err' ? 'err' : 'pending'
          const badge = r?.status === 'ok' ? 'OK'
                      : r?.status === 'err' ? (r.code ? `Fehler ${htmlEscape(String(r.code))}` : 'Fehler')
                      : 'Prüft …'
          const rt = r?.rtMs != null ? `${r.rtMs}ms` : ''
          const errBlock = r?.status === 'err' && r.message
            ? `<div class="err-msg">${htmlEscape(r.message)}</div>` : ''
          return `<div class="api-card ${cls}" data-rpc="${htmlEscape(rpc.name)}">
            <div class="top">
              <span class="nm">${htmlEscape(rpc.name)}</span>
              <span class="badge">${badge}</span>
            </div>
            <div class="meta">
              <span class="rt">${rt}</span>
              ${rpc.expectsError ? ' · <span style="opacity:.7">probe-args, Fehler erwartet</span>' : ''}
            </div>
            ${errBlock}
          </div>`
        }).join('')}
      </div>
    </section>
  `).join('')
}

function updateSummary(summaryEl, state) {
  const vals = Object.values(state)
  const ok = vals.filter(v => v.status === 'ok').length
  const err = vals.filter(v => v.status === 'err').length
  const pending = ADMIN_RPCS.length - vals.length
  summaryEl.innerHTML = `
    <span class="ok">${ok} OK</span> ·
    <span class="err">${err} Fehler</span>
    ${pending > 0 ? ` · <span class="pending">${pending} ausstehend</span>` : ''}
    · <span style="color:var(--text-dim,#6B7280)">${ADMIN_RPCS.length} gesamt</span>`
}

async function probeRpc(rpc) {
  const t0 = performance.now()
  try {
    const { error } = await sb.rpc(rpc.name, rpc.args || {})
    const rtMs = Math.round(performance.now() - t0)
    if (error) {
      // expectsError: probe args are deliberately invalid; treat a Postgres-side
      // validation error as „RPC erreichbar" → OK.
      if (rpc.expectsError && error.code && /^(P|22|23|42)/.test(String(error.code))) {
        return { status: 'ok', rtMs, code: error.code, message: 'erreichbar (probe-args ablehnt)' }
      }
      return {
        status: 'err',
        rtMs,
        code: error.code || '',
        message: error.message || String(error)
      }
    }
    return { status: 'ok', rtMs }
  } catch (e) {
    const rtMs = Math.round(performance.now() - t0)
    return { status: 'err', rtMs, code: '', message: e?.message || String(e) }
  }
}

async function mountApiHealth(container) {
  container.innerHTML = apiHealthShell()
  const host = container.querySelector('#api-groups')
  const summary = container.querySelector('#api-summary')
  const rerunBtn = container.querySelector('#api-rerun')

  const state = {}
  renderApiGroups(host, state)

  let cancelled = false
  const run = async () => {
    if (rerunBtn) { rerunBtn.disabled = true; rerunBtn.innerHTML = '⏳ Prüft …' }
    for (const k of Object.keys(state)) delete state[k]
    renderApiGroups(host, state)
    updateSummary(summary, state)

    // Probe in kleinen Batches (4 parallel), damit DB nicht überrannt wird.
    const BATCH = 4
    for (let i = 0; i < ADMIN_RPCS.length; i += BATCH) {
      if (cancelled) return
      const batch = ADMIN_RPCS.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(probeRpc))
      batch.forEach((rpc, j) => { state[rpc.name] = results[j] })
      renderApiGroups(host, state)
      updateSummary(summary, state)
    }
    if (rerunBtn) { rerunBtn.disabled = false; rerunBtn.innerHTML = (iconHtml ? iconHtml('refresh') : '↺') + ' Erneut prüfen' }
  }

  rerunBtn?.addEventListener('click', () => run())
  await run()

  return () => { cancelled = true }
}

// ---------- Backups placeholder ----------

function mountBackups(container) {
  container.innerHTML = `<div class="placeholder">
    <div class="icon">${iconHtml ? iconHtml('database') : '🗄'}</div>
    <h3>Backups — Coming soon</h3>
    <p>
      Geplant: tägliche Snapshots von <code>users</code>, <code>podcasts</code>,
      <code>updates</code> und <code>app_settings</code> als JSONL in Storage,
      mit Restore-Vorschau und PITR-Hinweis. Aktuell nutzt Podfluence die
      Supabase-Plattform-Backups (Pro-Tier, 7 Tage PITR).
    </p>
  </div>`
  return () => {}
}

// ---------- Sub-panel loader (lazy import + mount) ----------

const CACHE_BUST = '20260608f'

async function mountSubPanel(paneEl, panelId, opts = {}) {
  try {
    const mod = await import(`./${panelId}.js?v=${CACHE_BUST}`)
    const panel = mod.default || mod
    if (!panel || typeof panel.mount !== 'function') {
      throw new Error(`Panel „${panelId}" exportiert kein mount()`)
    }
    paneEl.innerHTML = '' // remove "Lädt …"
    // opts (role, access, permissions) durchreichen — sonst weiß das Sub-Panel
    // nichts vom Caller-Kontext und kann z.B. admin_required-Errors nicht
    // sinnvoll einordnen.
    const cleanup = await panel.mount(paneEl, opts)
    return typeof cleanup === 'function' ? cleanup : () => {}
  } catch (e) {
    paneEl.innerHTML = `<div class="sys-error">
      Fehler beim Laden von „${htmlEscape(panelId)}":<br>${htmlEscape(e?.message || String(e))}
    </div>`
    return () => {}
  }
}

// ---------------------------------------------------------------------------
// Panel export
// ---------------------------------------------------------------------------

export default {
  id: 'system',
  title: 'System',
  category: 'admin_actions',

  async mount(container, opts = {}) {
    // mounted: key → cleanup fn (null = mount in progress)
    const mounted = new Map()
    let activeKey = SUB_TABS[0].key
    // sub aus dem Top-Level-Router (crm/index.html): zweites Hash-Segment
    // #system/<sub>?... — der Router liest das und übergibt es als opts.sub.
    const routedSub = (opts && typeof opts.sub === 'string') ? opts.sub.trim() : ''

    container.innerHTML = `${styles()}<div class="sys-shell">
      ${head()}
      ${subtabsHtml()}
      ${panesHtml()}
    </div>`

    try { fadeIn(container) } catch (_) {}

    const tabBtns = Array.from(container.querySelectorAll('.sys-subtab'))
    const panes   = Array.from(container.querySelectorAll('.sys-pane'))

    function paneFor(key) {
      return panes.find(p => p.dataset.key === key)
    }

    async function ensureMounted(key) {
      if (mounted.has(key)) return
      mounted.set(key, null) // mark in-progress to dedupe re-entry
      const pane = paneFor(key)
      if (!pane) { mounted.delete(key); return }
      const def = SUB_TABS.find(t => t.key === key)
      try {
        let cleanup
        if (def.panel) {
          cleanup = await mountSubPanel(pane, def.panel, opts)
        } else if (key === 'api-health') {
          cleanup = await mountApiHealth(pane)
        } else if (key === 'backups') {
          cleanup = mountBackups(pane)
        } else {
          pane.innerHTML = `<div class="sys-error">Unbekannter Sub-Tab: ${htmlEscape(key)}</div>`
          cleanup = () => {}
        }
        mounted.set(key, cleanup || (() => {}))
      } catch (e) {
        pane.innerHTML = `<div class="sys-error">Fehler: ${htmlEscape(e?.message || String(e))}</div>`
        mounted.set(key, () => {})
      }
    }

    async function activate(key) {
      activeKey = key
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.key === key))
      panes.forEach(p => p.classList.toggle('active', p.dataset.key === key))
      // Update hash for shareable deep-link (#system/<sub>)
      // Top-Tab heißt 'system' (siehe permissions.json + crm/index.html-Router),
      // NICHT '_tab-system' — letzteres ist nur der Modul-Filename.
      try {
        const rawHash = (location.hash || '').replace(/^#/, '')
        const [pathPart, queryPart = ''] = rawHash.split('?')
        const seg = pathPart.split('/').filter(Boolean)
        const tab = seg[0] || 'system'
        if (tab === 'system') {
          const target = `#system/${key}${queryPart ? '?' + queryPart : ''}`
          if (location.hash !== target) history.replaceState(null, '', target)
        }
      } catch (_) {}
      await ensureMounted(key)
    }

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => activate(btn.dataset.key))
    })

    // Default-Sub-Tab beim Öffnen von #system:
    //   - owner   → 'settings' (volle Konfig-Hoheit)
    //   - andere  → 'audit'    (Read-Only Audit-Log als sinnvoller Landing-Point)
    // Deep-Link-Quellen, in Reihenfolge der Priorität:
    //   1. opts.sub (vom Top-Router aus #system/<sub> geparst)
    //   2. zweites Segment im location.hash (Back-Compat / direkter Modul-Load)
    //   3. rollen-basierter Default (siehe oben)
    const role = (typeof window !== 'undefined' && window.__CRM_ROLE__) || ''
    const isOwner = role === 'owner'
    const roleDefault = isOwner ? 'settings' : 'audit'
    let initial = SUB_TABS.some(t => t.key === roleDefault) ? roleDefault : SUB_TABS[0].key
    if (routedSub && SUB_TABS.some(t => t.key === routedSub)) {
      initial = routedSub
    } else {
      try {
        const parts = (location.hash || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)
        if (parts[1] && SUB_TABS.some(t => t.key === parts[1])) initial = parts[1]
      } catch (_) {}
    }

    await activate(initial)

    return () => {
      for (const [k, fn] of mounted.entries()) {
        try { if (typeof fn === 'function') fn() } catch (e) {
          console.warn(`[_tab-system] cleanup ${k} threw`, e)
        }
      }
      mounted.clear()
    }
  }
}
