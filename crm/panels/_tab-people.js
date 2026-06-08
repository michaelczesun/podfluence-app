// _tab-people.js — People Top-Tab (Users / Leads / Team / Segments)
// Delegate-Pattern: lädt das eigentliche Sub-Panel dynamisch und mounted es in die Inner-Container.
// Sub-Tabs sind echte Panel-Module unter /panels/*.js (oder ein Inline-Placeholder für Phase 3).

import { sb } from '/lib/supabase.js?v=20260608h'
import { toast, iconHtml } from '/lib/ui.js?v=20260608h'
import { fadeIn } from '/lib/animations.js?v=20260608h'
import { pullToRefresh } from '/lib/layout-extras.js?v=20260608h'

const SUBTABS = [
  { key: 'users',    label: 'Users',    panel: 'users-list',      icon: 'users' },
  { key: 'leads',    label: 'Leads',    panel: 'leads-pipeline',  icon: 'target' },
  { key: 'team',     label: 'Team',     panel: 'team-management', icon: 'shield' },
  { key: 'segments', label: 'Segments', panel: null,              icon: 'pie-chart', phase: 3 },
]

const STORAGE_KEY = 'crm.tab-people.active'

function readActive() {
  try {
    const fromHash = (location.hash || '').match(/sub=([a-z]+)/)?.[1]
    if (fromHash && SUBTABS.some(t => t.key === fromHash)) return fromHash
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUBTABS.some(t => t.key === stored)) return stored
  } catch {}
  return 'users'
}

function persistActive(key) {
  try { localStorage.setItem(STORAGE_KEY, key) } catch {}
}

function powerUsersBlockHtml() {
  return `
    <div class="pu-block" data-power-users style="margin-bottom:14px;">
      <style>
        .pu-block { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px 16px; }
        .pu-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
        .pu-head h3 { margin:0; font-size:14px; font-weight:600; letter-spacing:.2px; }
        .pu-head .pu-sub { font-size:11px; opacity:.55; }
        .pu-list { display:flex; flex-direction:column; gap:6px; }
        .pu-row { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:8px; cursor:pointer; transition:background .12s ease; }
        .pu-row:hover { background:rgba(255,255,255,0.04); }
        .pu-rank { width:22px; text-align:center; font-size:11px; font-weight:700; opacity:.55; }
        .pu-rank.top { color:#F59E0B; opacity:1; }
        .pu-av { width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.06); object-fit:cover; flex-shrink:0; }
        .pu-name { flex:1; min-width:0; }
        .pu-name .nm { font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pu-name .un { font-size:11px; opacity:.5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pu-stats { display:flex; gap:10px; font-size:11px; opacity:.7; flex-shrink:0; }
        .pu-stats b { color:#60A5FA; font-weight:600; }
        .pu-empty, .pu-err { padding:14px; opacity:.6; font-size:12px; text-align:center; }
        .pu-err { color:#F87171; }
        @media (max-width: 480px) {
          .pu-stats { flex-direction:column; gap:2px; text-align:right; }
        }
      </style>
      <div class="pu-head">
        <h3>Top 10 Power-Users</h3>
        <span class="pu-sub">7 Tage · Engagement-Score</span>
      </div>
      <div class="pu-list" data-pu-list>
        <div class="pu-empty">Lade Power-Users…</div>
      </div>
    </div>
  `
}

async function mountPowerUsers(rootEl) {
  const listEl = rootEl.querySelector('[data-pu-list]')
  if (!listEl) return
  try {
    const { data, error } = await sb.rpc('admin_power_users', { p_limit: 10 })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    if (!rows.length) {
      listEl.innerHTML = `<div class="pu-empty">Noch keine Engagement-Daten verfügbar.</div>`
      return
    }
    listEl.innerHTML = rows.map(r => {
      const rank = Number(r.rank || 0)
      const score = Number(r.engagement_score || 0).toFixed(1)
      const posts = Number(r.posts_7d || 0)
      const hours = Number(r.listen_hours_7d || 0).toFixed(1)
      const name = (r.full_name || r.username || 'Unbekannt').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]))
      const uname = (r.username ? '@' + r.username : '').replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]))
      const av = r.avatar_url
        ? `<img class="pu-av" src="${String(r.avatar_url).replace(/"/g, '&quot;')}" alt="" loading="lazy" onerror="this.style.background='rgba(255,255,255,0.08)';this.removeAttribute('src')">`
        : `<div class="pu-av"></div>`
      return `
        <div class="pu-row" data-uid="${r.user_id}" title="Score ${score} · ${posts} Posts · ${hours}h">
          <div class="pu-rank ${rank <= 3 ? 'top' : ''}">${rank}</div>
          ${av}
          <div class="pu-name">
            <div class="nm">${name}</div>
            <div class="un">${uname}</div>
          </div>
          <div class="pu-stats">
            <span><b>${score}</b> Score</span>
            <span>${posts} Posts</span>
            <span>${hours}h</span>
          </div>
        </div>
      `
    }).join('')
    listEl.querySelectorAll('.pu-row').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.dataset.uid
        if (uid) location.href = `/crm/user-detail.html?id=${encodeURIComponent(uid)}`
      })
    })
  } catch (e) {
    console.error('[power-users] load failed', e)
    listEl.innerHTML = `<div class="pu-err">Power-Users konnten nicht geladen werden: ${e?.message || e}</div>`
  }
}

async function mountSubPanel(host, sub) {
  host.innerHTML = `<div class="loading" style="padding:24px;opacity:.7">Lade ${sub.label}…</div>`

  if (sub.key === 'segments') {
    host.innerHTML = `
      <div class="panel-shell" style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">${iconHtml('pie-chart') || '🧩'}</div>
        <h2 style="margin:0 0 8px 0;">Segments</h2>
        <p style="opacity:.7;margin:0 0 16px 0;max-width:480px;margin-left:auto;margin-right:auto;">
          Dynamische User-Segmente (Power-Listener, Inactive 30d, Top-Podcasters, At-Risk-Premium…)
          mit gespeicherten Filtern und Push/Email-Targeting.
        </p>
        <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(96,165,250,.12);color:#60A5FA;font-size:12px;font-weight:600;letter-spacing:.4px;">
          COMING PHASE 3
        </span>
      </div>
    `
    try { fadeIn(host) } catch {}
    return
  }

  try {
    const v = new Date().toISOString().slice(0, 13)
    const mod = await import(`./${sub.panel}.js?v=${v}`)
    const panel = mod.default || mod
    if (!panel || typeof panel.mount !== 'function') {
      throw new Error(`Sub-Panel ${sub.panel} hat kein mount()`)
    }
    host.innerHTML = ''
    if (sub.key === 'users') {
      const puWrap = document.createElement('div')
      puWrap.innerHTML = powerUsersBlockHtml()
      host.appendChild(puWrap.firstElementChild)
      mountPowerUsers(host).catch(() => {})
    }
    const panelMount = document.createElement('div')
    host.appendChild(panelMount)
    await panel.mount(panelMount)
    try { fadeIn(host) } catch {}
  } catch (e) {
    console.error('[_tab-people] sub-mount failed', sub.key, e)
    host.innerHTML = `
      <div class="panel-shell">
        <div class="empty" style="color:#F87171;padding:24px;">
          Sub-Tab "${sub.label}" konnte nicht geladen werden: ${e?.message || e}
          <div style="margin-top:12px;">
            <button class="btn" data-act="retry">${iconHtml('refresh-cw') || ''} Erneut versuchen</button>
          </div>
        </div>
      </div>
    `
    host.querySelector('[data-act="retry"]')?.addEventListener('click', () => mountSubPanel(host, sub))
  }
}

export default {
  id: 'people',
  title: 'People',
  category: 'people',

  async mount(container) {
    let active = readActive()

    container.innerHTML = `
      <style>
        .tp-wrap { display:flex; flex-direction:column; gap:14px; }
        .tp-seg {
          display:inline-flex; gap:4px; padding:4px;
          background:rgba(255,255,255,0.04);
          border:1px solid rgba(255,255,255,0.08);
          border-radius:10px; align-self:flex-start;
          flex-wrap:wrap;
        }
        .tp-seg button {
          appearance:none; border:0; background:transparent; color:inherit;
          padding:8px 14px; border-radius:7px; font-size:13px; font-weight:500;
          cursor:pointer; display:inline-flex; align-items:center; gap:6px;
          opacity:.7; transition:all .15s ease;
        }
        .tp-seg button:hover { opacity:1; background:rgba(255,255,255,0.04); }
        .tp-seg button.active {
          background:rgba(96,165,250,.16); color:#60A5FA; opacity:1;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2) inset;
        }
        .tp-seg .badge {
          font-size:9px; padding:1px 5px; border-radius:4px;
          background:rgba(245,158,11,.18); color:#F59E0B;
          letter-spacing:.4px; font-weight:700;
        }
        .tp-sub-host { min-height: 240px; min-width: 0; }
        .tp-wrap { min-width: 0; max-width: 100%; }
        @media (max-width: 767px) {
          .tp-wrap { overflow-x: hidden; }
          .tp-seg { overflow-x: auto; flex-wrap: nowrap; align-self: stretch; }
          .tp-seg button { white-space: nowrap; flex-shrink: 0; }
        }
      </style>
      <div class="tp-wrap">
        <div class="tp-seg" role="tablist" aria-label="People Sub-Tabs">
          ${SUBTABS.map(t => `
            <button role="tab"
                    data-key="${t.key}"
                    class="${t.key === active ? 'active' : ''}"
                    aria-selected="${t.key === active}">
              ${iconHtml(t.icon) || ''} ${t.label}
              ${t.phase ? `<span class="badge">P${t.phase}</span>` : ''}
            </button>
          `).join('')}
        </div>
        <div class="tp-sub-host" data-sub-host></div>
      </div>
    `

    const host = container.querySelector('[data-sub-host]')
    const buttons = Array.from(container.querySelectorAll('.tp-seg button'))

    const switchTo = async (key) => {
      const sub = SUBTABS.find(t => t.key === key)
      if (!sub) return
      active = key
      persistActive(key)
      buttons.forEach(b => {
        const on = b.dataset.key === key
        b.classList.toggle('active', on)
        b.setAttribute('aria-selected', on ? 'true' : 'false')
      })
      // Audit-Log (fire & forget)
      try { sb.rpc('admin_log_action', { p_action: 'people_subtab_switch', p_target: key }) } catch {}
      await mountSubPanel(host, sub)
    }

    buttons.forEach(b => b.addEventListener('click', () => switchTo(b.dataset.key)))

    // Initial mount
    const initial = SUBTABS.find(t => t.key === active) || SUBTABS[0]
    await mountSubPanel(host, initial)

    // Pull-to-Refresh: re-mountet aktives Sub-Panel
    try {
      pullToRefresh(container, async () => {
        const sub = SUBTABS.find(t => t.key === active) || SUBTABS[0]
        await mountSubPanel(host, sub)
      })
    } catch (_) {}
  }
}
