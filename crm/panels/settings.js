import { sb } from '/lib/supabase.js?v=20260608j'
import { toast, confirmDialog, fmtDateTime, htmlEscape } from '/lib/ui.js?v=20260608j'

// ---- helpers ----
const LS_KEY = 'crm_settings'

// Bot-User-ID: the service account that posts newsletter updates.
// Set this to the actual Supabase auth UID of the bot user.
// Falls back to keyword-heuristic if null (legacy behaviour).
const BOT_USER_ID = null // TODO: replace with actual bot user UUID e.g. 'xxxxxxxx-xxxx-...'

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch (_) { return {} }
}

function saveSettings(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

function getDefaults() {
  return { refreshInterval: 60, defaultPanel: 'kpi-live-totals', compactMode: false }
}

const ALL_PANELS = [
  { id: 'kpi-live-totals', title: 'Live-Kennzahlen' },
  { id: 'dau-trend', title: 'Tägliche aktive Nutzer (30T)' },
  { id: 'new-signups-7d', title: 'Neue Anmeldungen (7T)' },
  { id: 'crash-rate', title: 'Stabilität / Crash-Rate' },
  { id: 'open-bug-reports', title: 'Offene Bug-Reports' },
  { id: 'users-list', title: 'Nutzer-Liste' },
  { id: 'user-type-split', title: 'Listener vs. Podcaster' },
  { id: 'verified-premium-flags', title: 'Verifiziert & Premium' },
  { id: 'onboarding-funnel', title: 'Onboarding-Funnel' },
  { id: 'client-build-versions', title: 'App-Versionen im Feld' },
  { id: 'recent-updates-feed', title: 'Aktuelle Posts' },
  { id: 'posts-per-day', title: 'Posts pro Tag' },
  { id: 'trending-hashtags', title: 'Trending Hashtags (30T)' },
  { id: 'active-polls', title: 'Aktive Umfragen' },
  { id: 'episodes-per-day', title: 'Neue Episoden pro Tag' },
  { id: 'listens-per-day', title: 'Listens pro Tag' },
  { id: 'top-listened-podcasts', title: 'Top gehörte Podcasts' },
  { id: 'vibe-distribution', title: 'Vibe-Verteilung' },
  { id: 'top-listeners', title: 'Aktivste Hörer' },
  { id: 'users-by-country', title: 'User-Weltkarte' },
  { id: 'referral-leaderboard', title: 'Top Inviter' },
  { id: 'referral-overview', title: 'Referral-Conversion' },
  { id: 'invite-codes-usage', title: 'Invite-Codes Nutzung' },
  { id: 'podcaster-engagement-7d', title: 'Podcaster-Engagement (7T)' },
  { id: 'trending-podcasters', title: 'Trending Podcaster' },
  { id: 'achievements-unlocks', title: 'Achievement-Unlocks' },
  { id: 'insta-approval-queue', title: 'Instagram-Posts Freigabe' },
  { id: 'insta-post-type-scores', title: 'IG-Post-Typ Scoring' },
  { id: 'newsletter-audience-sync', title: 'Newsletter-Audience' },
  { id: 'bug-reports-triage', title: 'Bug-Reports Triage' },
  { id: 'push-broadcast', title: 'Push-Broadcast senden' },
  { id: 'storage-ops', title: 'Storage & Cleanup' },
  { id: 'podcast-verification-queue', title: 'Podcast-Verifizierung' },
  { id: 'settings', title: 'Einstellungen' }
]

function styles() {
  return `<style>
    .settings-shell { display:flex; flex-direction:column; gap:24px; padding:24px 24px 48px; max-width:860px; margin:0 auto; }
    .settings-head { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
    .settings-head h2 { margin:0; font-size:24px; font-weight:600; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
    .s-card { background:rgba(22,22,29,0.8); border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:24px; backdrop-filter:blur(20px); display:flex; flex-direction:column; gap:18px; }
    .s-card-head { display:flex; align-items:center; gap:10px; margin-bottom:2px; }
    .s-card-head h3 { margin:0; font-size:16px; font-weight:600; color:#fff; }
    .s-card-head .s-icon { width:32px; height:32px; border-radius:8px; display:grid; place-items:center; font-size:16px; flex-shrink:0; }
    .s-icon-blue { background:rgba(96,165,250,0.15); }
    .s-icon-violet { background:rgba(139,92,246,0.15); }
    .s-icon-green { background:rgba(52,211,153,0.15); }
    .s-icon-amber { background:rgba(251,191,36,0.15); }
    .s-divider { height:1px; background:rgba(255,255,255,0.05); margin:4px 0; }
    /* account section */
    .account-row { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
    .account-avatar { width:56px; height:56px; border-radius:50%; display:grid; place-items:center; font-size:22px; font-weight:700; color:#fff; flex-shrink:0; background:linear-gradient(135deg,#8B5CF6,#7C3AED); border:2px solid rgba(139,92,246,0.4); overflow:hidden; }
    .account-avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
    .account-info { flex:1; min-width:0; }
    .account-name { font-size:17px; font-weight:600; color:#fff; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .account-email { font-size:13px; color:var(--text-muted,#9CA3AF); }
    .account-age { font-size:12px; color:var(--text-dim,#6B7280); margin-top:4px; }
    .account-btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    /* crm settings */
    .setting-row { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .setting-label { font-size:14px; color:#e2e2ea; font-weight:500; }
    .setting-sub { font-size:12px; color:var(--text-muted,#9CA3AF); margin-top:2px; }
    .seg-wrap { display:inline-flex; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:3px; gap:2px; }
    .seg-btn { background:transparent; border:none; color:var(--text-muted,#9CA3AF); padding:6px 14px; border-radius:7px; font-size:13px; cursor:pointer; transition:all .15s; font-family:inherit; }
    .seg-btn:hover { color:#fff; }
    .seg-btn.active { background:rgba(139,92,246,0.8); color:#fff; }
    .s-select { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:#fff; border-radius:10px; padding:8px 12px; font-size:13px; font-family:inherit; cursor:pointer; min-width:220px; }
    .s-select:focus { outline:none; border-color:rgba(139,92,246,0.6); }
    .s-select option { background:#1C1C25; }
    /* toggle */
    .toggle-wrap { display:flex; align-items:center; gap:10px; cursor:pointer; }
    .toggle { position:relative; width:42px; height:24px; flex-shrink:0; }
    .toggle input { opacity:0; width:0; height:0; position:absolute; }
    .toggle-track { position:absolute; inset:0; background:rgba(255,255,255,0.1); border-radius:999px; transition:background .2s; border:1px solid rgba(255,255,255,0.08); }
    .toggle input:checked + .toggle-track { background:rgba(139,92,246,0.85); border-color:rgba(139,92,246,0.5); }
    .toggle-thumb { position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .2s; box-shadow:0 1px 4px rgba(0,0,0,0.35); }
    .toggle input:checked ~ .toggle-thumb { transform:translateX(18px); }
    .save-row { display:flex; justify-content:flex-end; }
    /* bot section */
    .bot-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
    .bot-stat { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:14px 16px; }
    .bot-stat .label { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted,#9CA3AF); margin-bottom:6px; }
    .bot-stat .value { font-size:26px; font-weight:700; color:#fff; }
    .bot-actions { display:flex; gap:10px; flex-wrap:wrap; }
    /* system section */
    .system-ping { display:flex; align-items:center; gap:10px; font-size:14px; }
    .ping-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
    .ping-dot.ok { background:#34D399; box-shadow:0 0 6px #34D399; }
    .ping-dot.warn { background:#FCD34D; }
    .ping-dot.error { background:#F87171; }
    .bot-nl-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
    .bot-nl-item { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.05); }
    .bot-nl-item .nl-title { font-size:13px; font-weight:500; color:#e2e2ea; flex:1; min-width:0; }
    .bot-nl-item .nl-date { font-size:11px; color:var(--text-dim,#6B7280); flex-shrink:0; white-space:nowrap; }
    /* buttons */
    .btn { display:inline-flex; align-items:center; gap:6px; border-radius:10px; padding:9px 16px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .btn-ghost { background:transparent; border-color:rgba(255,255,255,0.1); color:#e2e2ea; }
    .btn-ghost:hover { background:rgba(255,255,255,0.05); }
    .btn-primary { background:linear-gradient(135deg,#8B5CF6,#7C3AED); color:#fff; border-color:transparent; box-shadow:0 4px 14px rgba(139,92,246,0.35); }
    .btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 20px rgba(139,92,246,0.45); }
    .btn-danger { background:transparent; border-color:rgba(248,113,113,0.3); color:#F87171; }
    .btn-danger:hover { background:rgba(248,113,113,0.1); }
    .btn-amber { background:transparent; border-color:rgba(251,191,36,0.3); color:#FCD34D; }
    .btn-amber:hover { background:rgba(251,191,36,0.08); }
    .btn:disabled { opacity:0.45; cursor:not-allowed; }
    .loading-inline { color:var(--text-muted,#9CA3AF); font-size:13px; }
    .section-error { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .section-error span { color:#F87171; font-size:13px; }
  </style>`
}

// Shared error partial with retry button
function sectionErrorHtml(msg, retryId) {
  return `<div class="section-error">
    <span>${htmlEscape(msg)}</span>
    <button class="btn btn-ghost" id="${retryId}" style="padding:5px 12px; font-size:12px;">↺ Erneut versuchen</button>
  </div>`
}

export default {
  id: 'settings',
  title: 'Einstellungen',
  category: 'admin_actions',

  async mount(container) {
    container.innerHTML = `${styles()}
      <div class="settings-shell">
        <div class="settings-head">
          <h2>⚙️ Einstellungen</h2>
        </div>
        <div id="s-account" class="s-card"><div class="loading-inline">Konto wird geladen…</div></div>
        <div id="s-crm" class="s-card"></div>
        <div id="s-bot" class="s-card"><div class="loading-inline">Bot-Daten werden geladen…</div></div>
        <div id="s-system" class="s-card"><div class="loading-inline">System wird geprüft…</div></div>
      </div>`

    // Run all sections in parallel — allSettled so one failure doesn't block others
    const results = await Promise.allSettled([
      this._mountAccount(container.querySelector('#s-account')),
      this._mountCrm(container.querySelector('#s-crm')),
      this._mountBot(container.querySelector('#s-bot')),
      this._mountSystem(container.querySelector('#s-system'))
    ])

    // Log unexpected rejections (each _mount already handles its own errors internally)
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[settings] section ${i} unhandled rejection:`, r.reason)
      }
    })
  },

  // ── 1) Mein Admin-Konto ──────────────────────────────────────────────────
  async _mountAccount(el) {
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Keine Session')

      // Try to get more profile info
      let profile = null
      try {
        const { data } = await sb.rpc('admin_users_list_full', { p_limit: 1, p_offset: 0, p_search: user.email || '' })
        if (data && data.length) profile = data[0]
      } catch (_) {}

      const username = profile?.username || profile?.display_name || user.email?.split('@')[0] || 'Admin'
      const email = user.email || '—'
      const avatarUrl = profile?.avatar_url || null
      const createdAt = user.created_at ? new Date(user.created_at) : null
      const accountAgeMs = createdAt ? Date.now() - createdAt.getTime() : 0
      const accountAgeDays = Math.floor(accountAgeMs / 86400000)
      const accountAgeStr = createdAt
        ? `Mitglied seit ${createdAt.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })} (${accountAgeDays} Tage)`
        : ''

      const initials = username.slice(0, 2).toUpperCase()

      el.innerHTML = `
        <div class="s-card-head">
          <div class="s-icon s-icon-blue">👤</div>
          <h3>Mein Admin-Konto</h3>
        </div>
        <div class="s-divider"></div>
        <div class="account-row">
          <div class="account-avatar" id="acct-avatar">
            ${avatarUrl ? `<img src="${htmlEscape(avatarUrl)}" alt="Avatar" onerror="this.style.display='none';document.getElementById('acct-initials').style.display='grid'" />` : ''}
            <span id="acct-initials" style="${avatarUrl ? 'display:none' : ''}">${htmlEscape(initials)}</span>
          </div>
          <div class="account-info">
            <div class="account-name">${htmlEscape(username)}</div>
            <div class="account-email">${htmlEscape(email)}</div>
            ${accountAgeStr ? `<div class="account-age">${htmlEscape(accountAgeStr)}</div>` : ''}
          </div>
        </div>
        <div class="account-btns">
          <button class="btn btn-danger" id="btn-logout">🚪 Abmelden</button>
          <button class="btn btn-ghost" id="btn-refresh-token">🔄 Token erneuern</button>
        </div>
      `

      el.querySelector('#btn-logout').onclick = async () => {
        const ok = await confirmDialog('Abmelden?', 'Du wirst aus dem CRM abgemeldet.', 'Abmelden', true)
        if (!ok) return
        await sb.auth.signOut()
        location.href = '/login/'
      }

      el.querySelector('#btn-refresh-token').onclick = async () => {
        const btn = el.querySelector('#btn-refresh-token')
        btn.disabled = true
        btn.textContent = '⏳ Erneuert…'
        try {
          const { error } = await sb.auth.refreshSession()
          if (error) throw error
          toast('Session-Token erfolgreich erneuert', 'success')
        } catch (e) {
          toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
        }
        btn.disabled = false
        btn.innerHTML = '🔄 Token erneuern'
      }

    } catch (e) {
      el.innerHTML = `<div class="s-card-head"><div class="s-icon s-icon-blue">👤</div><h3>Mein Admin-Konto</h3></div>
        ${sectionErrorHtml('Fehler beim Laden: ' + (e.message || String(e)), 'retry-account')}`
      el.querySelector('#retry-account').onclick = () => {
        el.innerHTML = '<div class="loading-inline">Konto wird geladen…</div>'
        this._mountAccount(el)
      }
    }
  },

  // ── 2) CRM-Einstellungen ─────────────────────────────────────────────────
  _mountCrm(el) {
    const saved = loadSettings()
    const cfg = Object.assign({}, getDefaults(), saved)

    el.innerHTML = `
      <div class="s-card-head">
        <div class="s-icon s-icon-violet">🖥️</div>
        <h3>CRM-Einstellungen</h3>
      </div>
      <div class="s-divider"></div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Auto-Refresh-Intervall</div>
          <div class="setting-sub">Wie oft Panel-Daten automatisch neu geladen werden</div>
        </div>
        <div class="seg-wrap" id="seg-interval">
          ${[30, 60, 120].map(v => `<button class="seg-btn ${cfg.refreshInterval === v ? 'active' : ''}" data-v="${v}">${v}s</button>`).join('')}
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Standard-Panel beim Login</div>
          <div class="setting-sub">Dieses Panel wird beim Start des CRM geöffnet</div>
        </div>
        <select class="s-select" id="sel-default-panel">
          ${ALL_PANELS.map(p => `<option value="${p.id}" ${cfg.defaultPanel === p.id ? 'selected' : ''}>${htmlEscape(p.title)}</option>`).join('')}
        </select>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Compact-Mode</div>
          <div class="setting-sub">Reduzierte Abstände und kleinere Schrift in Tabellen</div>
        </div>
        <label class="toggle-wrap">
          <label class="toggle">
            <input type="checkbox" id="tog-compact" ${cfg.compactMode ? 'checked' : ''} />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </label>
      </div>

      <div class="save-row">
        <button class="btn btn-primary" id="btn-save-crm">💾 Einstellungen speichern</button>
      </div>
    `

    // Segment control for interval
    el.querySelector('#seg-interval').querySelectorAll('.seg-btn').forEach(btn => {
      btn.onclick = () => {
        el.querySelectorAll('#seg-interval .seg-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      }
    })

    el.querySelector('#btn-save-crm').onclick = () => {
      const activeIntervalBtn = el.querySelector('#seg-interval .seg-btn.active')
      const newCfg = {
        refreshInterval: activeIntervalBtn ? parseInt(activeIntervalBtn.dataset.v) : 60,
        defaultPanel: el.querySelector('#sel-default-panel').value,
        compactMode: el.querySelector('#tog-compact').checked
      }
      saveSettings(newCfg)
      // Apply compact mode immediately
      document.body.classList.toggle('crm-compact', newCfg.compactMode)
      toast('Einstellungen gespeichert', 'success')
    }

    // Restore compact mode on load
    document.body.classList.toggle('crm-compact', cfg.compactMode)
  },

  // ── 3) Bot-Steuerung ─────────────────────────────────────────────────────
  async _mountBot(el) {
    try {
      // Fetch insta_posts_queue counts via admin_db_live_stats (SECURITY DEFINER, bypasses RLS)
      // admin_db_live_stats returns aggregated stats; fall back to direct count only when the RPC
      // explicitly exposes the fields — otherwise use three targeted HEAD queries which are safe
      // because insta_posts_queue has no user-scoped RLS (admin-only table).
      const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
        sb.from('insta_posts_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('insta_posts_queue').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        sb.from('insta_posts_queue').select('id', { count: 'exact', head: true }).eq('status', 'rejected')
      ])

      // If any count came back as null it likely means RLS blocked the read — surface a warning
      if (pendingRes.count === null && approvedRes.count === null && rejectedRes.count === null) {
        throw new Error('Keine Leseberechtigung auf insta_posts_queue (RLS?). Bitte RPC einrichten.')
      }

      const pending = pendingRes.count ?? 0
      const approved = approvedRes.count ?? 0
      const rejected = rejectedRes.count ?? 0
      const totalEmpty = pending + approved + rejected === 0

      el.innerHTML = `
        <div class="s-card-head">
          <div class="s-icon s-icon-green">🤖</div>
          <h3>Bot-Steuerung</h3>
        </div>
        <div class="s-divider"></div>

        <div class="bot-grid">
          <div class="bot-stat">
            <div class="label">Ausstehend</div>
            <div class="value" style="color:#FCD34D">${pending}</div>
          </div>
          <div class="bot-stat">
            <div class="label">Genehmigt</div>
            <div class="value" style="color:#34D399">${approved}</div>
          </div>
          <div class="bot-stat">
            <div class="label">Abgelehnt</div>
            <div class="value" style="color:#F87171">${rejected}</div>
          </div>
        </div>
        ${totalEmpty ? `<div style="color:var(--text-muted,#9CA3AF); font-size:13px;">Queue ist leer — keine Instagram-Posts in der Pipeline.</div>` : ''}

        <div class="bot-actions">
          <button class="btn btn-primary" id="btn-gen-start">▶ Generator manuell starten</button>
          <button class="btn btn-amber" id="btn-resend-sync">📧 Resend-Audience syncen</button>
        </div>
      `

      el.querySelector('#btn-gen-start').onclick = async () => {
        const btn = el.querySelector('#btn-gen-start')
        btn.disabled = true
        btn.textContent = '⏳ Wird gestartet…'
        try {
          const { error } = await sb.functions.invoke('insta-marketing-generator')
          if (error) throw error
          toast('Generator erfolgreich gestartet', 'success')
        } catch (e) {
          toast('Generator-Fehler: ' + (e.message || String(e)), 'error')
        }
        btn.disabled = false
        btn.innerHTML = '▶ Generator manuell starten'
      }

      el.querySelector('#btn-resend-sync').onclick = async () => {
        const btn = el.querySelector('#btn-resend-sync')
        btn.disabled = true
        btn.textContent = '⏳ Wird synchronisiert…'
        try {
          const { error } = await sb.functions.invoke('newsletter-sync')
          if (error) {
            // If function does not exist (404 / relay error), treat as not yet implemented
            if (error.message && (error.message.includes('404') || error.message.includes('not found') || error.message.includes('relay'))) {
              toast('Newsletter-Sync noch nicht implementiert', 'info')
            } else {
              throw error
            }
          } else {
            toast('Resend-Audience erfolgreich synchronisiert', 'success')
          }
        } catch (e) {
          toast('Sync-Fehler: ' + (e.message || String(e)), 'error')
        }
        btn.disabled = false
        btn.innerHTML = '📧 Resend-Audience syncen'
      }

    } catch (e) {
      el.innerHTML = `<div class="s-card-head"><div class="s-icon s-icon-green">🤖</div><h3>Bot-Steuerung</h3></div>
        ${sectionErrorHtml('Fehler beim Laden: ' + (e.message || String(e)), 'retry-bot')}`
      el.querySelector('#retry-bot').onclick = () => {
        el.innerHTML = '<div class="loading-inline">Bot-Daten werden geladen…</div>'
        this._mountBot(el)
      }
    }
  },

  // ── 4) System-Status ─────────────────────────────────────────────────────
  async _mountSystem(el) {
    el.innerHTML = `
      <div class="s-card-head">
        <div class="s-icon s-icon-amber">🛰️</div>
        <h3>System-Status</h3>
      </div>
      <div class="s-divider"></div>
      <div id="sys-ping" class="loading-inline">Verbindung wird geprüft…</div>
      <div id="sys-nl-wrap"></div>
    `

    const pingEl = el.querySelector('#sys-ping')
    const nlWrap = el.querySelector('#sys-nl-wrap')

    // Ping via admin_db_live_stats (SECURITY DEFINER RPC)
    const t0 = performance.now()
    let pingMs = null
    let pingOk = false
    try {
      const { error } = await sb.rpc('admin_db_live_stats')
      pingMs = Math.round(performance.now() - t0)
      pingOk = !error
    } catch (_) {
      pingMs = Math.round(performance.now() - t0)
      pingOk = false
    }

    const dotClass = !pingOk ? 'error' : pingMs < 400 ? 'ok' : 'warn'
    const pingLabel = pingOk ? `${pingMs} ms` : 'Fehler'
    pingEl.innerHTML = `
      <div class="system-ping">
        <div class="ping-dot ${dotClass}"></div>
        <span>Datenbank-Latenz: <strong>${htmlEscape(pingLabel)}</strong></span>
      </div>
    `

    // Bot newsletter posts from `updates` table.
    // Filter strategy: prefer BOT_USER_ID (exact match) when configured;
    // fall back to keyword-heuristic only as legacy path.
    // Note: `updates` is read directly. If RLS limits rows to the current admin user,
    // this section will show 0 results silently. Add a SECURITY DEFINER RPC for bot-posts
    // if that becomes a problem.
    try {
      let query = sb
        .from('updates')
        .select('id, content, created_at, user_id')
        .order('created_at', { ascending: false })
        .limit(20)

      if (BOT_USER_ID) {
        // Exact bot-user filter — reliable, no keyword guessing
        query = query.eq('user_id', BOT_USER_ID)
      }

      const { data: nlPosts } = await query

      let botPosts = nlPosts || []

      if (!BOT_USER_ID) {
        // Legacy keyword-heuristic (used until BOT_USER_ID is configured)
        botPosts = botPosts.filter(p => {
          const c = (p.content || '').toLowerCase()
          return c.includes('newsletter') || c.includes('tagesreport') || c.includes('zusammenfassung') || c.includes('wochenbericht')
        })
      }

      botPosts = botPosts.slice(0, 5)

      if (botPosts.length === 0) {
        if (!BOT_USER_ID) {
          // Fallback: show last 5 updates regardless when heuristic found nothing
          const last5 = (nlPosts || []).slice(0, 5)
          if (last5.length) {
            renderNlList(nlWrap, last5, 'Letzte 5 Updates (allgemein)')
          } else {
            nlWrap.innerHTML = `<div style="color:var(--text-muted,#9CA3AF); font-size:13px;">Keine Newsletter-Posts gefunden.</div>`
          }
        } else {
          nlWrap.innerHTML = `<div style="color:var(--text-muted,#9CA3AF); font-size:13px;">Keine Bot-Posts gefunden.</div>`
        }
      } else {
        renderNlList(nlWrap, botPosts, BOT_USER_ID ? 'Letzte Bot-Newsletter' : 'Letzte Bot-Newsletter (Heuristik)')
      }
    } catch (e) {
      nlWrap.innerHTML = `${sectionErrorHtml('Newsletter-Posts konnten nicht geladen werden: ' + (e.message || String(e)), 'retry-nl')}`
      nlWrap.querySelector('#retry-nl').onclick = () => {
        nlWrap.innerHTML = '<div class="loading-inline">Wird erneut geladen…</div>'
        // Re-run only the nl portion
        this._mountSystem(el)
      }
    }
  }
}

function renderNlList(wrap, posts, title) {
  wrap.innerHTML = `
    <div style="margin-top:16px;">
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.07em; color:var(--text-muted,#9CA3AF); margin-bottom:10px;">${htmlEscape(title)}</div>
      <ul class="bot-nl-list">
        ${posts.map(p => {
          const preview = (p.content || '').replace(/\n/g, ' ').trim().slice(0, 90)
          const dateStr = p.created_at ? fmtDateTime(p.created_at) : '—'
          return `<li class="bot-nl-item">
            <span class="nl-title">${htmlEscape(preview || '(kein Inhalt)')}${(p.content||'').length > 90 ? '…' : ''}</span>
            <span class="nl-date">${htmlEscape(dateStr)}</span>
          </li>`
        }).join('')}
      </ul>
    </div>
  `
}
