// Content Top-Tab — Meta-Panel
// Hosts 5 sub-tabs: Posts · Podcasts · Comments · Reports · Bot
// Each sub-tab can contain 1..n existing child-panels (split-tiles),
// dynamically imported and mounted into sandboxed child containers.
//
// CACHE-BUST: ?v=20260608j

import { sb } from '/lib/supabase.js?v=20260608j'
import {
  toast, htmlEscape, fmtRelativeTime, fmtNumber, iconHtml, spinnerHtml
} from '/lib/ui.js?v=20260608k'
import { fadeIn, skeletonLoader } from '/lib/animations.js?v=20260608j'
import { showUserDetailModal } from '/lib/panel-actions.js?v=20260608j'

// ------------ Sub-Tab config ------------
// Each entry maps to an array of "tiles". A tile either references an existing
// panel (id), or is an inline custom renderer (render: async (el) => ...).
const SUBTABS = [
  {
    key: 'posts',
    label: 'Posts',
    icon: '📝',
    tiles: [
      { kind: 'panel', id: 'recent-updates-feed' }
    ]
  },
  {
    key: 'podcasts',
    label: 'Podcasts',
    icon: '🎙️',
    tiles: [
      { kind: 'panel', id: 'trending-podcasters', title: 'Trending Podcaster' },
      { kind: 'panel', id: 'podcast-verification-queue', title: 'Verification-Queue' }
    ]
  },
  {
    key: 'comments',
    label: 'Comments',
    icon: '💬',
    tiles: [
      { kind: 'panel', id: 'active-polls', title: 'Polls' },
      { kind: 'inline', id: 'comment-feed', title: 'Letzte Kommentare', render: renderCommentFeed }
    ]
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: '🐞',
    tiles: [
      { kind: 'panel', id: 'open-bug-reports', title: 'Offene Bug-Reports' },
      { kind: 'panel', id: 'bug-reports-triage', title: 'Triage' }
    ]
  },
  {
    key: 'bot',
    label: 'Bot',
    icon: '🤖',
    tiles: [
      { kind: 'panel', id: 'insta-approval-queue', title: 'Approval-Queue' },
      { kind: 'panel', id: 'insta-post-type-scores', title: 'Post-Type-Scores' }
    ]
  }
]

const state = {
  panelRoot: null,
  activeSub: 'posts',
  // child panel modules cache: id -> { module, mountedInto, key }
  childCache: new Map(),
  // child panels currently mounted (for proper unmount): [{ id, container }]
  mounted: []
}

// ------------ Helper: unmount currently mounted children ------------
async function unmountAllChildren() {
  for (const { id, container, mod } of state.mounted) {
    try {
      if (mod && typeof mod.unmount === 'function') mod.unmount()
    } catch (e) {
      console.warn('[_tab-content] child unmount failed', id, e)
    }
    try { container.innerHTML = '' } catch (_) {}
  }
  state.mounted = []
}

// ------------ Helper: mount a child panel into a container ------------
async function mountChildPanel(id, container, titleOverride) {
  try {
    container.innerHTML = `<div class="loading">${spinnerHtml ? spinnerHtml() : 'Lädt…'}</div>`
    let mod = state.childCache.get(id)
    if (!mod) {
      const v = '20260608f'
      mod = await import(`./${id}.js?v=${v}`)
      state.childCache.set(id, mod)
    }
    const panel = mod.default || mod
    if (!panel || typeof panel.mount !== 'function') {
      throw new Error(`Panel "${id}" exportiert kein mount()`)
    }
    // Clear loader and mount
    container.innerHTML = ''
    await panel.mount(container)
    state.mounted.push({ id, container, mod: panel })

    // Optional title-override: the child panel renders its own headline. We
    // do NOT touch it to avoid breaking the panel's internal DOM queries.
  } catch (e) {
    console.error('[_tab-content] mountChild failed', id, e)
    container.innerHTML = `
      <div class="error-state glass-card" style="padding:16px;">
        <div class="error-state__icon">⚠️</div>
        <div class="error-state__title">Tile "${htmlEscape(titleOverride || id)}" konnte nicht geladen werden</div>
        <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
      </div>`
  }
}

// ------------ Inline custom renderer: comment-feed ------------
async function renderCommentFeed(container) {
  container.innerHTML = `
    <div class="glass-card" style="padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <h3 style="margin:0;">Letzte Kommentare</h3>
          <div class="text-muted" style="font-size:.85rem;">Live-Feed der letzten 100 Kommentare</div>
        </div>
        <button class="btn" id="cmt-refresh" title="Aktualisieren">🔄</button>
      </div>
      <div id="cmt-body">${skeletonLoader({ count: 6, height: 56, layout: 'list' })}</div>
    </div>
  `

  async function loadComments() {
    const body = container.querySelector('#cmt-body')
    if (!body) return
    body.innerHTML = skeletonLoader({ count: 6, height: 56, layout: 'list' })
    try {
      // Try text-comments first
      const { data: tComments, error: tErr } = await sb
        .from('comments')
        .select('id, user_id, update_id, content, created_at, users:user_id(id, username, full_name, avatar_url, is_verified)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (tErr) throw tErr

      // Voice-comments in parallel (optional)
      let vComments = []
      try {
        const { data: v, error: vErr } = await sb
          .from('voice_comments')
          .select('id, user_id, update_id, duration_sec, created_at, users:user_id(id, username, full_name, avatar_url, is_verified)')
          .order('created_at', { ascending: false })
          .limit(50)
        if (!vErr && Array.isArray(v)) vComments = v.map(x => ({ ...x, _kind: 'voice' }))
      } catch (_) {}

      const all = [
        ...(tComments || []).map(x => ({ ...x, _kind: 'text' })),
        ...vComments
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100)

      if (!all.length) {
        body.innerHTML = `<div class="empty">Noch keine Kommentare.</div>`
        return
      }

      body.innerHTML = all.map(c => {
        const u = c.users || {}
        const name = htmlEscape(u.full_name || u.username || 'Unbekannt')
        const verified = u.is_verified ? ' ✓' : ''
        const avatar = u.avatar_url
          ? `<img src="${htmlEscape(u.avatar_url)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
          : `<div style="width:32px;height:32px;border-radius:50%;background:#374151;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:600;color:#E5E7EB;">${htmlEscape(name.charAt(0))}</div>`
        const txt = c._kind === 'voice'
          ? `<em>🎙️ Sprachkommentar · ${fmtNumber(c.duration_sec || 0)}s</em>`
          : htmlEscape((c.content || '').slice(0, 240)) + (((c.content || '').length > 240) ? '…' : '')
        return `
          <div class="cmt-row" data-uid="${htmlEscape(u.id || '')}" data-uid-clickable="1"
               style="display:flex;gap:10px;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,0.06);align-items:flex-start;cursor:pointer;">
            ${avatar}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
                <strong style="color:#E5E7EB;">${name}${verified}</strong>
                <span class="text-muted" style="font-size:.75rem;">${htmlEscape(fmtRelativeTime ? fmtRelativeTime(c.created_at) : new Date(c.created_at).toLocaleString('de-DE'))}</span>
              </div>
              <div style="color:#D1D5DB;font-size:.9rem;margin-top:2px;word-break:break-word;">${txt}</div>
            </div>
          </div>
        `
      }).join('')

      // Wire click → user-detail
      body.querySelectorAll('.cmt-row[data-uid-clickable="1"]').forEach(row => {
        row.addEventListener('click', () => {
          const uid = row.getAttribute('data-uid')
          if (uid && typeof showUserDetailModal === 'function') {
            try { showUserDetailModal(uid) } catch (e) { console.warn('[_tab-content] showUserDetailModal failed', e) }
          }
        })
      })
    } catch (e) {
      console.error('[_tab-content] comment-feed load error', e)
      body.innerHTML = `
        <div class="error-state" style="padding:16px;">
          <div class="error-state__title" style="color:#F87171;">Kommentare konnten nicht geladen werden</div>
          <div class="error-state__text">${htmlEscape(e?.message || String(e))}</div>
        </div>`
    }
  }

  container.querySelector('#cmt-refresh')?.addEventListener('click', loadComments)
  loadComments()
}

// ------------ Render sub-tab body ------------
async function renderSubTab(subKey) {
  state.activeSub = subKey
  const sub = SUBTABS.find(s => s.key === subKey)
  if (!sub) return

  // Active pill state
  state.panelRoot?.querySelectorAll('.subtab-pill').forEach(p => {
    p.classList.toggle('is-active', p.dataset.sub === subKey)
  })

  const body = state.panelRoot?.querySelector('#subtab-body')
  if (!body) return

  // Unmount prior children
  await unmountAllChildren()

  // Build tile grid
  const tilesHtml = sub.tiles.map((tile, idx) => `
    <div class="content-tile glass-card" data-tile-idx="${idx}" style="padding:0;overflow:hidden;">
      <div id="tile-${sub.key}-${idx}" class="tile-host"></div>
    </div>
  `).join('')

  // Single-tile sub-tabs render full-width; multi-tile = 2-col split on desktop
  // Mobile (<768px): force single-column to avoid horizontal overflow
  const gridCls = sub.tiles.length > 1 ? 'content-grid-split' : 'content-grid-single'
  const isMobile = (typeof window !== 'undefined' && window.innerWidth < 768)
  const gridCols = (sub.tiles.length > 1 && !isMobile)
    ? 'grid-template-columns:repeat(auto-fit,minmax(360px,1fr));'
    : 'grid-template-columns:1fr;'
  body.innerHTML = `<div class="${gridCls}" style="display:grid;gap:16px;${gridCols}min-width:0;">${tilesHtml}</div>`

  // Mount tiles
  for (let i = 0; i < sub.tiles.length; i++) {
    const tile = sub.tiles[i]
    const host = body.querySelector(`#tile-${sub.key}-${i}`)
    if (!host) continue
    if (tile.kind === 'panel') {
      await mountChildPanel(tile.id, host, tile.title)
    } else if (tile.kind === 'inline' && typeof tile.render === 'function') {
      try {
        await tile.render(host)
      } catch (e) {
        console.error('[_tab-content] inline tile failed', tile.id, e)
        host.innerHTML = `<div class="error-state" style="padding:16px;color:#F87171;">${htmlEscape(e?.message || String(e))}</div>`
      }
    }
  }
}

// ------------ Read sub-tab from URL hash (?sub=...) ------------
function getSubFromHash() {
  const raw = location.hash.replace(/^#/, '')
  const qIdx = raw.indexOf('?')
  if (qIdx < 0) return null
  const params = new URLSearchParams(raw.slice(qIdx + 1))
  const sub = params.get('sub')
  return SUBTABS.find(s => s.key === sub) ? sub : null
}

function setSubInHash(subKey) {
  const raw = location.hash.replace(/^#/, '')
  const qIdx = raw.indexOf('?')
  const base = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '')
  params.set('sub', subKey)
  const next = `#${base}?${params.toString()}`
  if (location.hash !== next) {
    // replaceState avoids cluttering history + avoids triggering hashchange→full reload
    history.replaceState(null, '', next)
  }
}

// ------------ Public mount/unmount ------------
export default {
  id: 'content',
  title: 'Content',
  category: 'content',

  async mount(container) {
    state.panelRoot = container
    container.id = 'panel-tab-content'

    const pillsHtml = SUBTABS.map(s => `
      <button class="subtab-pill ${s.key === state.activeSub ? 'is-active' : ''}"
              data-sub="${s.key}"
              style="padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#E5E7EB;cursor:pointer;font-size:.9rem;display:inline-flex;align-items:center;gap:6px;">
        <span>${s.icon}</span><span>${htmlEscape(s.label)}</span>
      </button>
    `).join('')

    container.innerHTML = `
      <div class="panel-shell">
        <div class="panel-head glass-card">
          <div class="panel-head__left">
            <h2 class="panel-title">💬 Content</h2>
            <p class="panel-sub">Posts · Podcasts · Comments · Reports · Bot</p>
          </div>
        </div>

        <div class="subtab-bar glass-card" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;margin:12px 0;">
          ${pillsHtml}
        </div>

        <style>
          #panel-tab-content .subtab-pill.is-active {
            background: linear-gradient(135deg, #7C3AED, #A78BFA) !important;
            border-color: #A78BFA !important;
            color: #fff !important;
            box-shadow: 0 4px 14px rgba(124,58,237,0.35);
          }
          #panel-tab-content .subtab-pill:hover:not(.is-active) {
            background: rgba(255,255,255,0.08) !important;
          }
          #panel-tab-content .content-tile { min-width: 0; overflow: hidden; }
          /* Inside a tile, child-panel's own .panel-shell should not double-pad */
          #panel-tab-content .content-tile .panel-shell { padding: 12px !important; }
          /* Mobile: enforce single-column + prevent horizontal overflow */
          @media (max-width: 767px) {
            #panel-tab-content .content-grid-split,
            #panel-tab-content .content-grid-single { grid-template-columns: 1fr !important; }
            #panel-tab-content .subtab-bar { overflow-x: auto; }
            #panel-tab-content .panel-shell { max-width: 100%; overflow-x: hidden; }
          }
        </style>

        <div id="subtab-body"><div class="loading">Lädt…</div></div>
      </div>
    `

    try { fadeIn(container, { duration: 240 }) } catch (_) {}

    // Wire pill clicks
    container.querySelectorAll('.subtab-pill').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sub = btn.dataset.sub
        if (!sub || sub === state.activeSub) return
        setSubInHash(sub)
        await renderSubTab(sub)
      })
    })

    // Initial sub-tab: from hash (?sub=...), else default 'posts'
    const initial = getSubFromHash() || 'posts'
    state.activeSub = initial
    await renderSubTab(initial)
  },

  async unmount() {
    await unmountAllChildren()
    state.panelRoot = null
    state.activeSub = 'posts'
  }
}
