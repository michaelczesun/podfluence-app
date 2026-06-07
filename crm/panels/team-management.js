import { sb } from '/lib/supabase.js?v=20260608f'
import { toast, modal, confirmDialog, fmtDateTime, fmtRelativeTime, htmlEscape, iconHtml, debounce } from '/lib/ui.js?v=20260608f'
import { exportPanelAsPdf, exportCsv } from '/lib/export.js?v=20260608f'
import { countUp, fadeIn } from '/lib/animations.js?v=20260608f'
import { drawer, glassCard } from '/lib/layout-extras.js?v=20260608f'

// Rollen-Definition: key -> { label, color, description, rank }
// rank steuert: höher = mehr Macht. Owner = read-only für Nicht-Owner.
const ROLES = {
  owner:     { label: 'Owner',     color: '#f59e0b', desc: 'Vollzugriff, nicht änderbar', rank: 100 },
  admin:     { label: 'Admin',     color: '#ef4444', desc: 'Voller Admin-Zugriff',         rank: 80  },
  manager:   { label: 'Manager',   color: '#a855f7', desc: 'Operative Leitung',            rank: 60  },
  support:   { label: 'Support',   color: '#3b82f6', desc: 'User-Support / Tickets',       rank: 40  },
  mod:       { label: 'Mod',       color: '#22c55e', desc: 'Content-Moderation',           rank: 35  },
  marketing: { label: 'Marketing', color: '#ec4899', desc: 'Push, Newsletter, IG',         rank: 30  }
}
const ROLE_ORDER = ['owner', 'admin', 'manager', 'support', 'mod', 'marketing']
const NONE_KEY = '__none__'

const REFRESH_MS = 60_000

function styles() {
  return `<style>
    .tm-shell { display:flex; flex-direction:column; gap:18px; padding:20px; }
    .tm-shell h2 { font-size:22px; font-weight:700; letter-spacing:-.02em; margin:0; color:#fff; }
    .tm-shell .sub { font-size:13px; color:var(--text-muted, #888); margin-top:4px; }
    .tm-shell .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .tm-shell .toolbar button {
      padding:8px 14px; border-radius:10px;
      background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
      color:#ddd; font-size:13px; cursor:pointer;
      display:inline-flex; align-items:center; gap:6px;
      transition:background .15s ease;
    }
    .tm-shell .toolbar button:hover { background:rgba(255,255,255,.08); }
    .tm-shell .toolbar button.primary { background:#3b82f6; border-color:#3b82f6; color:#fff; }
    .tm-shell .toolbar button.primary:hover { background:#2563eb; }

    .tm-hero { display:flex; gap:10px; flex-wrap:wrap; }
    .tm-pill {
      display:inline-flex; align-items:center; gap:8px;
      padding:10px 14px; border-radius:999px;
      background:linear-gradient(140deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
      border:1px solid rgba(255,255,255,.06);
      font-size:13px; color:#ddd;
    }
    .tm-pill .dot { width:10px; height:10px; border-radius:50%; }
    .tm-pill .lbl { color:#aaa; font-size:12px; }
    .tm-pill .num { font-weight:700; font-size:14px; color:#fff; }

    .glass-card {
      padding:20px; border-radius:16px;
      background:linear-gradient(140deg, rgba(255,255,255,.04), rgba(255,255,255,.01));
      border:1px solid rgba(255,255,255,.06);
    }

    .data-table { width:100%; border-collapse:collapse; font-size:13px; }
    .data-table thead th {
      text-align:left; padding:10px 12px; color:#888; font-weight:500;
      font-size:11px; text-transform:uppercase; letter-spacing:.5px;
      border-bottom:1px solid rgba(255,255,255,.06);
    }
    .data-table tbody td { padding:12px; border-bottom:1px solid rgba(255,255,255,.04); color:#ddd; vertical-align:middle; }
    .data-table tbody tr:hover { background:rgba(255,255,255,.03); }

    .avatar { width:36px; height:36px; border-radius:50%; object-fit:cover; background:#1a1a1a; display:inline-block; }
    .avatar-fallback {
      width:36px; height:36px; border-radius:50%;
      background:linear-gradient(135deg,#3b82f6,#a855f7);
      display:inline-flex; align-items:center; justify-content:center;
      color:#fff; font-weight:600; font-size:13px;
    }

    .user-cell { display:flex; align-items:center; gap:10px; min-width:0; }
    .user-meta { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .user-name { color:#fff; font-weight:600; font-size:13px; }
    .user-uname { color:#888; font-size:11px; }

    .role-badge {
      padding:4px 10px; border-radius:999px; font-size:11px; font-weight:600;
      letter-spacing:.3px; text-transform:uppercase; display:inline-flex; align-items:center; gap:6px;
    }

    .role-select {
      padding:7px 10px; border-radius:8px;
      background:#0a0a0a; border:1px solid rgba(255,255,255,.1);
      color:#fff; font-size:12px; font-family:inherit;
      cursor:pointer; min-width:140px;
    }
    .role-select:disabled { opacity:.5; cursor:not-allowed; }
    .role-select:focus { outline:none; border-color:#3b82f6; }

    .empty-row td { padding:48px 12px; text-align:center; color:#888; }

    .skel-row { display:grid; gap:10px; margin-bottom:8px; }
    .skel-line { height:48px; border-radius:10px; background:linear-gradient(90deg,#1a1a1a,#222,#1a1a1a); background-size:200% 100%; animation:tm-shimmer 1.4s infinite; }
    @keyframes tm-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    /* Invite-Modal */
    .invite-search {
      width:100%; padding:10px 12px; border-radius:10px;
      background:#0a0a0a; border:1px solid rgba(255,255,255,.1);
      color:#fff; font-size:13px; font-family:inherit;
    }
    .invite-search:focus { outline:none; border-color:#3b82f6; }
    .invite-results { display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; margin-top:10px; }
    .invite-result-item {
      display:flex; align-items:center; gap:10px; padding:8px 10px;
      background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06);
      border-radius:10px; cursor:pointer; transition:background .15s ease;
    }
    .invite-result-item:hover { background:rgba(59,130,246,.1); border-color:#3b82f655; }
    .invite-result-item.is-selected { background:rgba(59,130,246,.15); border-color:#3b82f6; }
  </style>`
}

function avatarHtml(u) {
  const initial = (u?.username || u?.full_name || '?').trim().charAt(0).toUpperCase()
  if (u?.avatar_url) {
    return `<img src="${htmlEscape(u.avatar_url)}" class="avatar" alt="">`
  }
  return `<div class="avatar-fallback">${htmlEscape(initial)}</div>`
}

function roleBadge(roleKey) {
  const r = ROLES[roleKey]
  if (!r) return `<span class="role-badge" style="background:rgba(255,255,255,.05);color:#888;border:1px solid rgba(255,255,255,.08);">—</span>`
  return `<span class="role-badge" style="background:${r.color}1a;color:${r.color};border:1px solid ${r.color}33;">
    <span style="width:6px;height:6px;border-radius:50%;background:${r.color};display:inline-block;"></span>
    ${htmlEscape(r.label)}
  </span>`
}

function roleSelectHtml(currentRole, { disabled = false, userId } = {}) {
  const opts = ROLE_ORDER
    .filter(k => k !== 'owner') // owner kann nicht im Select gesetzt werden
    .map(k => `<option value="${k}" ${currentRole === k ? 'selected' : ''}>${htmlEscape(ROLES[k].label)}</option>`)
    .join('')
  const noneSelected = !currentRole || currentRole === NONE_KEY
  return `<select class="role-select" data-user-id="${htmlEscape(userId || '')}" ${disabled ? 'disabled' : ''}>
    <option value="${NONE_KEY}" ${noneSelected ? 'selected' : ''}>— keine —</option>
    ${opts}
  </select>`
}

function errorState(err) {
  return `<div class="glass-card" style="padding:48px; text-align:center;">
    <div style="font-size:32px; color:#ef4444; margin-bottom:12px;">${iconHtml('alert-triangle')}</div>
    <h3 style="margin:0 0 8px; color:#fff;">Fehler beim Laden</h3>
    <p style="margin:0; color:#888; font-size:13px;">${htmlEscape(String(err?.message || err))}</p>
  </div>`
}

export default {
  id: 'team-management',
  title: 'Team-Verwaltung',
  category: 'admin_actions',

  async mount(container) {
    let refreshTimer = null
    let rtChannel = null
    let drawerHandle = null
    let teamRows = []
    let currentUserRole = null // Rolle des eingeloggten Admins (für Owner-Schutz)

    try {
      container.innerHTML = `${styles()}
        <div class="tm-shell">
          <div class="panel-head" style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
            <div>
              <h2>Team-Verwaltung</h2>
              <div class="sub" id="tm-last">Lädt …</div>
            </div>
            <div class="toolbar">
              <button id="tm-invite" class="primary">${iconHtml('user-plus')} Mitarbeiter einladen</button>
              <button id="tm-refresh">${iconHtml('refresh-cw')} Aktualisieren</button>
              <button id="tm-pdf">${iconHtml('file-text')} PDF</button>
              <button id="tm-csv">${iconHtml('download')} CSV</button>
            </div>
          </div>

          <div id="tm-hero" class="tm-hero"></div>

          <div class="glass-card" style="padding:0; overflow:hidden;">
            <div id="tm-table-wrap" style="overflow-x:auto;">
              <div class="skel-row" style="padding:14px;">
                <div class="skel-line"></div><div class="skel-line"></div>
                <div class="skel-line"></div><div class="skel-line"></div>
              </div>
            </div>
          </div>
        </div>`

      try { fadeIn(container, 300) } catch (_) {}

      const tableWrap = container.querySelector('#tm-table-wrap')
      const heroEl   = container.querySelector('#tm-hero')
      const lastUpd  = container.querySelector('#tm-last')

      // -------- Daten-Lader --------
      async function load() {
        try {
          // 1) eigene Rolle ermitteln (für Owner-Schutz)
          const { data: meData } = await sb.auth.getUser()
          const myId = meData?.user?.id || null

          // 2) Team-Liste via RPC
          const { data, error } = await sb.rpc('admin_team_list')
          if (error) throw error
          teamRows = (data || []).map(r => ({
            id: r.id,
            username: r.username || '',
            full_name: r.full_name || '',
            email: r.email || '',
            avatar_url: r.avatar_url || null,
            role: r.role || null, // 'owner' | 'admin' | ...
            last_seen_at: r.last_seen_at || null,
            created_at: r.created_at || null
          }))

          if (myId) {
            const me = teamRows.find(r => r.id === myId)
            currentUserRole = me?.role || null
          }

          renderHero()
          renderTable()
          lastUpd.textContent = `Aktualisiert ${fmtRelativeTime(new Date().toISOString())} · ${teamRows.length} Team-Mitglieder`
        } catch (e) {
          console.error('[team-management] load failed', e)
          tableWrap.innerHTML = errorState(e)
          heroEl.innerHTML = ''
          lastUpd.textContent = 'Fehler'
        }
      }

      function renderHero() {
        const counts = {}
        ROLE_ORDER.forEach(k => { counts[k] = 0 })
        teamRows.forEach(r => { if (r.role && counts[r.role] != null) counts[r.role]++ })

        heroEl.innerHTML = ROLE_ORDER.map(k => {
          const r = ROLES[k]
          return `<div class="tm-pill">
            <span class="dot" style="background:${r.color};"></span>
            <span class="lbl">${htmlEscape(r.label)}</span>
            <span class="num cu" data-val="${counts[k]}">0</span>
          </div>`
        }).join('')

        heroEl.querySelectorAll('.cu').forEach(el => {
          try { countUp(el, 0, parseInt(el.dataset.val) || 0, 700) }
          catch (_) { el.textContent = el.dataset.val }
        })
      }

      function renderTable() {
        const isOwner = currentUserRole === 'owner'

        if (!teamRows.length) {
          tableWrap.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
            <div style="font-size:36px;opacity:.45;margin-bottom:10px">${iconHtml('users')}</div>
            <div style="font-weight:600;color:var(--text);margin-bottom:4px;font-size:15px">Noch keine Team-Mitglieder</div>
            <div style="font-size:13px;line-height:1.4;max-width:380px;margin:0 auto 16px">Außer dir hat noch niemand Admin- oder Mitarbeiter-Zugang. Lade die ersten Kollegen ein, damit ihr gemeinsam moderieren könnt.</div>
            ${isOwner ? `<button class="btn btn-primary" id="empty-invite-btn">${iconHtml('user-plus')} Mitarbeiter einladen</button>` : ''}
          </div>`
          if (isOwner) {
            const eb = tableWrap.querySelector('#empty-invite-btn')
            if (eb) eb.onclick = () => document.getElementById('tm-invite')?.click()
          }
          return
        }

        // Owner zuerst, dann nach role-rank absteigend, dann nach username
        const sorted = [...teamRows].sort((a, b) => {
          const ra = ROLES[a.role]?.rank || 0
          const rb = ROLES[b.role]?.rank || 0
          if (rb !== ra) return rb - ra
          return (a.username || '').localeCompare(b.username || '')
        })

        const rowsHtml = sorted.map(u => {
          const isThisOwner = u.role === 'owner'
          // Owner-Rolle ist read-only für Nicht-Owner; Owner kann sich selbst auch nicht degradieren
          const selectDisabled = isThisOwner || (!isOwner && (ROLES[u.role]?.rank || 0) >= (ROLES[currentUserRole]?.rank || 0))

          const roleCell = isThisOwner
            ? roleBadge('owner')
            : roleSelectHtml(u.role, { disabled: selectDisabled, userId: u.id })

          const lastSeen = u.last_seen_at
            ? fmtRelativeTime(u.last_seen_at)
            : '<span style="color:#666;">nie</span>'

          return `<tr data-uid="${htmlEscape(u.id)}">
            <td>
              <div class="user-cell">
                ${avatarHtml(u)}
                <div class="user-meta">
                  <span class="user-name">${htmlEscape(u.full_name || u.username || '—')}</span>
                  <span class="user-uname">@${htmlEscape(u.username || '?')}</span>
                </div>
              </div>
            </td>
            <td><span style="color:#aaa; font-size:12px;">${htmlEscape(u.email || '—')}</span></td>
            <td>${roleCell}</td>
            <td>
              ${isThisOwner
                ? `<span style="color:#666; font-size:11px;">geschützt</span>`
                : `<button class="tm-remove" data-uid="${htmlEscape(u.id)}" style="padding:6px 10px; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); color:#fca5a5; border-radius:8px; font-size:11px; cursor:pointer;" ${selectDisabled ? 'disabled' : ''}>
                    ${iconHtml('user-x')} Entfernen
                  </button>`}
            </td>
            <td><span style="color:#888; font-size:12px;">${lastSeen}</span></td>
          </tr>`
        }).join('')

        tableWrap.innerHTML = `<table class="data-table">
          <thead><tr>
            <th>User</th><th>Email</th><th>Rolle</th><th>Aktion</th><th>Letzte Aktivität</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>`

        wireTable()
      }

      function wireTable() {
        tableWrap.querySelectorAll('.role-select').forEach(sel => {
          sel.addEventListener('change', async () => {
            const uid = sel.dataset.userId
            const newRole = sel.value === NONE_KEY ? null : sel.value
            const row = teamRows.find(r => r.id === uid)
            const prev = row?.role || null
            if (!row) return

            const label = ROLES[newRole]?.label || 'keine Rolle'
            const ok = await confirmDialog(
              'Rolle ändern?',
              `${htmlEscape(row.full_name || row.username)} wird auf "${htmlEscape(label)}" gesetzt.`,
              'Bestätigen',
              false
            )
            if (!ok) {
              sel.value = prev || NONE_KEY
              return
            }

            try {
              const { error } = await sb.rpc('admin_team_set_role', {
                p_user_id: uid,
                p_role: newRole
              })
              if (error) throw error
              toast('Rolle aktualisiert')
              load()
            } catch (e) {
              toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
              sel.value = prev || NONE_KEY
            }
          })
        })

        tableWrap.querySelectorAll('.tm-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            const uid = btn.dataset.uid
            const row = teamRows.find(r => r.id === uid)
            if (!row) return
            const ok = await confirmDialog(
              'Aus Team entfernen?',
              `${htmlEscape(row.full_name || row.username)} verliert sämtliche Team-Berechtigungen.`,
              'Entfernen',
              true
            )
            if (!ok) return
            try {
              const { error } = await sb.rpc('admin_team_set_role', {
                p_user_id: uid,
                p_role: null
              })
              if (error) throw error
              toast('Aus Team entfernt')
              load()
            } catch (e) {
              toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
            }
          })
        })
      }

      // -------- Invite-Modal --------
      function openInviteModal() {
        let selectedUser = null
        let selectedRole = 'support'

        const content = document.createElement('div')
        content.style.cssText = 'display:flex; flex-direction:column; gap:14px;'
        content.innerHTML = `
          <p style="margin:0; color:#aaa; font-size:13px;">
            Suche einen User und weise ihm eine Rolle zu. Owner-Rechte können hier nicht vergeben werden.
          </p>
          <div>
            <label style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.5px; display:block; margin-bottom:6px;">User suchen</label>
            <input type="text" class="invite-search" id="inv-search" placeholder="Username, Name oder Email …" autocomplete="off">
            <div id="inv-results" class="invite-results"></div>
          </div>
          <div>
            <label style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.5px; display:block; margin-bottom:6px;">Rolle</label>
            <select id="inv-role" class="role-select" style="width:100%;">
              ${ROLE_ORDER.filter(k => k !== 'owner').map(k =>
                `<option value="${k}" ${k === selectedRole ? 'selected' : ''}>${htmlEscape(ROLES[k].label)} — ${htmlEscape(ROLES[k].desc)}</option>`
              ).join('')}
            </select>
          </div>
          <div id="inv-pick" style="display:none; padding:10px; background:rgba(59,130,246,.1); border:1px solid #3b82f655; border-radius:10px; font-size:12px; color:#93c5fd;"></div>
        `

        const footer = document.createElement('div')
        footer.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;'
        const cancelBtn = document.createElement('button')
        cancelBtn.textContent = 'Abbrechen'
        cancelBtn.style.cssText = 'padding:8px 14px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); color:#ccc; border-radius:8px; cursor:pointer; font-size:13px;'
        const okBtn = document.createElement('button')
        okBtn.textContent = 'Einladen'
        okBtn.disabled = true
        okBtn.style.cssText = 'padding:8px 14px; background:#3b82f6; border:none; color:#fff; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; opacity:.5;'
        footer.appendChild(cancelBtn)
        footer.appendChild(okBtn)

        const { close } = modal({ title: 'Mitarbeiter einladen', content, footer, width: 560 })

        const searchInput = content.querySelector('#inv-search')
        const resultsEl   = content.querySelector('#inv-results')
        const pickEl      = content.querySelector('#inv-pick')
        const roleSel     = content.querySelector('#inv-role')

        roleSel.addEventListener('change', () => { selectedRole = roleSel.value })

        function setSelected(u) {
          selectedUser = u
          pickEl.style.display = 'block'
          pickEl.innerHTML = `${iconHtml('user-check')} <strong>${htmlEscape(u.full_name || u.username)}</strong> · @${htmlEscape(u.username)} · ${htmlEscape(u.email || '—')}`
          okBtn.disabled = false
          okBtn.style.opacity = '1'
          resultsEl.querySelectorAll('.invite-result-item').forEach(el => {
            el.classList.toggle('is-selected', el.dataset.uid === u.id)
          })
        }

        const runSearch = debounce(async (q) => {
          if (!q || q.length < 2) { resultsEl.innerHTML = ''; return }
          resultsEl.innerHTML = `<div style="padding:10px; color:#666; font-size:12px;">Suche …</div>`
          try {
            const { data, error } = await sb.rpc('admin_users_list_filtered', {
              p_search: q, p_limit: 20, p_offset: 0
            })
            if (error) throw error
            const list = (data || []).slice(0, 20)
            if (!list.length) {
              resultsEl.innerHTML = `<div style="padding:10px; color:#666; font-size:12px;">Keine Treffer.</div>`
              return
            }
            resultsEl.innerHTML = list.map(u => `
              <div class="invite-result-item" data-uid="${htmlEscape(u.id)}">
                ${avatarHtml(u)}
                <div style="flex:1; min-width:0;">
                  <div style="color:#fff; font-size:13px; font-weight:600;">${htmlEscape(u.full_name || u.username || '—')}</div>
                  <div style="color:#888; font-size:11px;">@${htmlEscape(u.username || '?')} · ${htmlEscape(u.email || '—')}</div>
                </div>
                ${u.role ? roleBadge(u.role) : ''}
              </div>
            `).join('')
            resultsEl.querySelectorAll('.invite-result-item').forEach(el => {
              el.addEventListener('click', () => {
                const u = list.find(x => x.id === el.dataset.uid)
                if (u) setSelected(u)
              })
            })
          } catch (e) {
            resultsEl.innerHTML = `<div style="padding:10px; color:#ef4444; font-size:12px;">Fehler: ${htmlEscape(e.message || 'unbekannt')}</div>`
          }
        }, 280)

        searchInput.addEventListener('input', (ev) => runSearch(ev.target.value.trim()))
        setTimeout(() => searchInput.focus(), 50)

        cancelBtn.onclick = () => close()
        okBtn.onclick = async () => {
          if (!selectedUser || !selectedRole) return
          okBtn.disabled = true
          okBtn.textContent = 'Speichere …'
          try {
            const { error } = await sb.rpc('admin_team_set_role', {
              p_user_id: selectedUser.id,
              p_role: selectedRole
            })
            if (error) throw error
            toast(`${selectedUser.username} ist jetzt ${ROLES[selectedRole].label}`)
            close()
            load()
          } catch (e) {
            toast('Fehler: ' + (e.message || 'unbekannt'), 'error')
            okBtn.disabled = false
            okBtn.textContent = 'Einladen'
          }
        }
      }

      // -------- Toolbar wiring --------
      container.querySelector('#tm-invite').onclick = openInviteModal
      container.querySelector('#tm-refresh').onclick = () => { toast('Aktualisiere …'); load() }
      container.querySelector('#tm-csv').onclick = () => {
        try {
          exportCsv(
            teamRows.map(u => ({
              username: u.username,
              full_name: u.full_name,
              email: u.email,
              role: u.role || '',
              last_seen_at: u.last_seen_at || '',
              created_at: u.created_at || ''
            })),
            null,
            `team-${new Date().toISOString().slice(0, 10)}.csv`
          )
        } catch (e) { toast('CSV-Export fehlgeschlagen', 'error') }
      }
      container.querySelector('#tm-pdf').onclick = () => {
        try { exportPanelAsPdf(container, { title: 'Team-Verwaltung' }) }
        catch (e) { toast('PDF-Export fehlgeschlagen', 'error') }
      }

      // -------- Initial load + auto-refresh + realtime --------
      await load()
      refreshTimer = setInterval(load, REFRESH_MS)

      const debouncedReload = debounce(() => load(), 1500)
      try {
        rtChannel = sb.channel('admin-team-mgmt')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: 'is_app_admin=eq.true' }, () => debouncedReload())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_audit_log' }, () => debouncedReload())
          .subscribe()
      } catch (_) { /* realtime optional */ }

      // -------- Cleanup --------
      return () => {
        if (refreshTimer) clearInterval(refreshTimer)
        if (rtChannel) { try { sb.removeChannel(rtChannel) } catch (_) {} }
        if (drawerHandle?.close) { try { drawerHandle.close() } catch (_) {} }
      }
    } catch (err) {
      console.error('[team-management] mount failed', err)
      container.innerHTML = `${styles()}<div class="tm-shell">${errorState(err)}</div>`
      return () => {
        if (refreshTimer) clearInterval(refreshTimer)
        if (rtChannel) { try { sb.removeChannel(rtChannel) } catch (_) {} }
      }
    }
  }
}
