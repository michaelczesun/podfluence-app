/**
 * Cmd-K Action Registry
 *
 * Statisches Verzeichnis aller per Cmd-K erreichbaren Aktionen, Panels, Settings
 * und Help-Artikel. Dynamische User-Lookups (Verify / Ban / Notiz) erfolgen über
 * argSchema + RPCs (siehe `crm_search_users` Aufruf in index.html).
 *
 * Konvention (cmdk-spec.md §3):
 *   - id              stable, Dot-Namespace
 *   - label           Hauptlabel (DE)
 *   - kind            'navigation' | 'user-action' | 'settings' | 'help' | 'action'
 *   - keywords        DE + EN Synonyme für Fuzzy-Search
 *   - scope           RBAC-Rollen die das Item sehen dürfen (leer = alle)
 *   - shortcut        Token-Array (z.B. ['mod','shift','v'])
 *   - argSchema       für template-Items: { fieldName: 'string' | 'user' | ... }
 *   - run             async-Funktion mit ggf. Args
 *
 * Navigation = location.hash setzen (Hash-Format `#<tab>/<subtab>`).
 * RPC / Edge nutzen den globalen `window.sb` Supabase-Client.
 */

import { openConfirm } from '/crm/lib/confirm.js'

const _go = (hash) => { location.hash = hash }
const _confirm = (opts) => openConfirm(typeof opts === 'string' ? { title: opts } : opts)
const _toast = (msg) => (window.toast ? window.toast(msg) : console.log('[cmdk]', msg))

async function _rpc(name, args = {}) {
  if (!window.sb) throw new Error('Supabase client (window.sb) not initialised')
  const { data, error } = await window.sb.rpc(name, args)
  if (error) throw error
  return data
}

export const ACTIONS = [
  // ─────────────────────── NAVIGATION · Pulse ───────────────────────
  {
    id: 'goto-pulse',
    label: 'Gehe zu Pulse',
    kind: 'navigation',
    icon: 'activity',
    keywords: ['pulse', 'live', 'dashboard', 'overview', 'jetzt', 'now'],
    run: () => _go('#pulse/overview')
  },
  {
    id: 'goto-pulse-live',
    label: 'Pulse · Live-Aktivität',
    kind: 'navigation',
    icon: 'radio',
    keywords: ['pulse', 'live', 'realtime', 'now', 'jetzt'],
    run: () => _go('#pulse/live')
  },
  {
    id: 'goto-pulse-alerts',
    label: 'Pulse · Alerts',
    kind: 'navigation',
    icon: 'bell',
    keywords: ['alerts', 'alarme', 'pulse', 'warnings'],
    run: () => _go('#pulse/alerts')
  },

  // ─────────────────────── NAVIGATION · People ───────────────────────
  {
    id: 'goto-users',
    label: 'Nutzer-Liste öffnen',
    kind: 'navigation',
    icon: 'users',
    keywords: ['users', 'nutzer', 'liste', 'list', 'people', 'übersicht'],
    run: () => _go('#people/users')
  },
  {
    id: 'goto-team',
    label: 'Team-Management',
    kind: 'navigation',
    icon: 'shield',
    keywords: ['team', 'staff', 'mitarbeiter', 'rollen', 'rbac'],
    scope: ['owner', 'admin'],
    run: () => _go('#people/team')
  },
  {
    id: 'goto-reports',
    label: 'Reports & Triage',
    kind: 'navigation',
    icon: 'flag',
    keywords: ['reports', 'meldungen', 'triage', 'bugs', 'flag'],
    run: () => _go('#people/reports')
  },

  // ─────────────────────── NAVIGATION · Growth ───────────────────────
  {
    id: 'goto-growth-funnel',
    label: 'Growth · Funnel',
    kind: 'navigation',
    icon: 'trending-up',
    keywords: ['growth', 'funnel', 'onboarding', 'conversion'],
    run: () => _go('#growth/funnel')
  },
  {
    id: 'goto-growth-cohorts',
    label: 'Growth · Kohorten',
    kind: 'navigation',
    icon: 'layers',
    keywords: ['cohorts', 'kohorten', 'retention', 'growth'],
    run: () => _go('#growth/cohorts')
  },
  {
    id: 'goto-growth-retention',
    label: 'Growth · Retention',
    kind: 'navigation',
    icon: 'repeat',
    keywords: ['retention', 'wiederkehr', 'churn', 'growth'],
    run: () => _go('#growth/retention')
  },
  {
    id: 'goto-growth-forecast',
    label: 'Growth · Forecast',
    kind: 'navigation',
    icon: 'line-chart',
    keywords: ['forecast', 'prognose', 'growth', 'planning'],
    run: () => _go('#growth/forecast')
  },
  {
    id: 'goto-growth-dau',
    label: 'Growth · DAU-Trend',
    kind: 'navigation',
    icon: 'bar-chart',
    keywords: ['dau', 'mau', 'wau', 'daily active', 'trend', 'growth'],
    run: () => _go('#growth/dau')
  },

  // ─────────────────────── NAVIGATION · Content ───────────────────────
  {
    id: 'goto-content-reports',
    label: 'Content · Reports',
    kind: 'navigation',
    icon: 'file-text',
    keywords: ['content', 'reports', 'meldungen', 'beiträge'],
    run: () => _go('#content/reports')
  },
  {
    id: 'goto-content-bot',
    label: 'Bot-Steuerung',
    kind: 'navigation',
    icon: 'bot',
    keywords: ['bot', 'newsletter', 'auto-post', 'tante', 'content'],
    scope: ['owner', 'admin', 'marketing'],
    run: () => _go('#content/bot')
  },
  {
    id: 'goto-content-podcasts',
    label: 'Podcast-Verifizierung',
    kind: 'navigation',
    icon: 'mic',
    keywords: ['podcasts', 'verify', 'queue', 'verifizierung', 'pending'],
    run: () => _go('#content/podcasts')
  },

  // ─────────────────────── NAVIGATION · System ───────────────────────
  {
    id: 'goto-system-audit',
    label: 'Audit-Log',
    kind: 'navigation',
    icon: 'history',
    keywords: ['audit', 'log', 'history', 'verlauf', 'system'],
    run: () => _go('#system/audit')
  },
  {
    id: 'goto-system-audit-1h',
    label: 'Audit-Log · letzte Stunde',
    kind: 'navigation',
    icon: 'clock',
    keywords: ['audit', 'log', 'stunde', '1h', 'recent'],
    shortcut: ['mod', 'shift', 'a'],
    run: () => _go('#system/audit?range=1h')
  },
  {
    id: 'goto-system-flags',
    label: 'Feature-Flags',
    kind: 'navigation',
    icon: 'flag',
    keywords: ['flags', 'features', 'toggle', 'system'],
    scope: ['owner', 'admin'],
    run: () => _go('#system/flags')
  },

  // ─────────────────────── SETTINGS ───────────────────────
  {
    id: 'open-settings',
    label: 'Einstellungen öffnen',
    kind: 'settings',
    icon: 'settings',
    keywords: ['settings', 'einstellungen', 'config', 'optionen'],
    // 'settings' ist KEIN Top-Tab — es ist Sub-Tab von 'system'.
    // Direkter '#settings' Hash fällt durch VISIBLE_IDS.has() im
    // Role-Guard (crm/index.html L723) und zeigt "Kein Zugriff" — auch
    // für owner. Daher korrekt auf #system/settings routen.
    run: () => _go('#system/settings')
  },
  {
    id: 'settings-email-templates',
    label: 'E-Mail-Vorlagen',
    kind: 'settings',
    icon: 'mail',
    keywords: ['email', 'mail', 'vorlage', 'template', 'settings'],
    scope: ['owner', 'admin'],
    run: () => _go('#system/settings?section=email')
  },
  {
    id: 'settings-notifications',
    label: 'Notification-Defaults',
    kind: 'settings',
    icon: 'bell',
    keywords: ['notifications', 'benachrichtigungen', 'push', 'settings'],
    scope: ['owner', 'admin'],
    run: () => _go('#system/settings?section=notifications')
  },
  {
    id: 'settings-rate-limits',
    label: 'Rate-Limits',
    kind: 'settings',
    icon: 'gauge',
    keywords: ['rate', 'limit', 'quota', 'throttle', 'settings'],
    scope: ['owner', 'admin'],
    run: () => _go('#system/settings?section=rate-limits')
  },
  {
    id: 'settings-storage',
    label: 'Storage-Ops',
    kind: 'settings',
    icon: 'database',
    keywords: ['storage', 'speicher', 'bucket', 'cleanup', 'recompress'],
    scope: ['owner', 'admin'],
    run: () => _go('#system/settings?section=storage')
  },

  // ─────────────────────── PINNED QUICK-ACTIONS (Sticky 5) ───────────────────────
  // Immer sichtbar wenn Cmd-K-Input leer ist.
  {
    id: 'new-lead',
    label: 'Neuer Lead',
    kind: 'action',
    icon: '➕',
    keywords: ['lead', 'neu', 'new', 'kontakt', 'add'],
    shortcut: ['mod', 'l'],
    pinned: true,
    pinnedOrder: 1,
    run: () => {
      _go('#leads-pipeline')
      // Add-Modal nach Hash-Switch öffnen (Panel-Mount-Hooks lauschen darauf)
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-modal', {
        detail: { panel: 'leads-pipeline', component: 'NewLeadModal' }
      })), 50)
    }
  },
  {
    id: 'new-task',
    label: 'Neuer Task',
    kind: 'action',
    icon: '✓',
    keywords: ['task', 'todo', 'aufgabe', 'neu', 'new'],
    shortcut: ['mod', 't'],
    pinned: true,
    pinnedOrder: 2,
    run: () => {
      _go('#tasks-inbox')
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-modal', {
        detail: { panel: 'tasks-inbox', component: 'NewTaskModal' }
      })), 50)
    }
  },
  {
    id: 'audit-last-hour',
    label: 'Audit letzte Stunde',
    kind: 'action',
    icon: '🕐',
    keywords: ['audit', 'log', 'stunde', '1h', 'last hour', 'recent'],
    shortcut: ['mod', 'shift', 'a'],
    pinned: true,
    pinnedOrder: 3,
    run: () => _go('#audit-log?range=1h')
  },
  {
    id: 'bulk-verify-pending',
    label: 'Bulk-Verify wartende',
    kind: 'action',
    icon: '🛡️',
    keywords: ['bulk', 'verify', 'verifizieren', 'pending', 'warteschlange', 'queue', 'select all'],
    shortcut: ['mod', 'shift', 'v'],
    pinned: true,
    pinnedOrder: 4,
    scope: ['owner', 'admin', 'mod'],
    run: () => {
      _go('#verification-queue')
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm:bulk-action', {
        detail: { panel: 'verification-queue', action: 'select-all' }
      })), 50)
    }
  },
  {
    id: 'push-premium',
    label: 'Push an Premium',
    kind: 'action',
    icon: '📣',
    keywords: ['push', 'premium', 'broadcast', 'notification', 'send'],
    shortcut: ['mod', 'shift', 'p'],
    pinned: true,
    pinnedOrder: 5,
    scope: ['owner', 'admin', 'marketing'],
    run: () => _go('#push-broadcast?audience=premium')
  },

  // ─────────────────────── USER-ACTIONS (template) ───────────────────────
  {
    id: 'verify-user',
    label: 'User verifizieren …',
    kind: 'user-action',
    icon: 'badge-check',
    keywords: ['verify', 'verifizieren', 'user', 'nutzer', 'badge'],
    scope: ['owner', 'admin', 'mod'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      if (!username) throw new Error('username required')
      if (!(await _confirm({ title: `@${username} verifizieren?`, message: 'Der User bekommt das Verified-Badge.', confirmLabel: 'Verifizieren' }))) return
      const data = await _rpc('crm_verify_user_by_username', { p_username: username })
      _toast(`@${username} verifiziert.`)
      return data
    }
  },
  {
    id: 'unverify-user',
    label: 'Verifizierung entziehen …',
    kind: 'user-action',
    icon: 'badge-x',
    keywords: ['unverify', 'entziehen', 'remove badge', 'user'],
    scope: ['owner', 'admin'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      if (!(await _confirm({ title: `Verifizierung entziehen?`, message: `Das Verified-Badge von @${username} wird entfernt.`, confirmLabel: 'Entziehen', danger: true }))) return
      await _rpc('crm_unverify_user_by_username', { p_username: username })
      _toast(`@${username} unverified.`)
    }
  },
  {
    id: 'ban-user',
    label: 'User bannen …',
    kind: 'user-action',
    icon: 'ban',
    keywords: ['ban', 'sperren', 'block', 'user'],
    scope: ['owner', 'admin'],
    argSchema: { username: 'string', reason: 'string' },
    run: async ({ username, reason }) => {
      if (!(await _confirm({ title: `@${username} bannen?`, message: `Grund: ${reason || '(keiner)'}`, confirmLabel: 'Bannen', danger: true }))) return
      await _rpc('crm_ban_user_by_username', { p_username: username, p_reason: reason || null })
      _toast(`@${username} gebannt.`)
    }
  },
  {
    id: 'unban-user',
    label: 'User entbannen …',
    kind: 'user-action',
    icon: 'unlock',
    keywords: ['unban', 'entsperren', 'restore', 'user'],
    scope: ['owner', 'admin'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      if (!(await _confirm({ title: `@${username} entbannen?`, message: 'Der User kann sich wieder einloggen.', confirmLabel: 'Entbannen' }))) return
      await _rpc('crm_unban_user_by_username', { p_username: username })
      _toast(`@${username} entbannt.`)
    }
  },
  {
    id: 'set-premium',
    label: 'User Premium geben …',
    kind: 'user-action',
    icon: 'star',
    keywords: ['premium', 'pro', 'upgrade', 'user'],
    scope: ['owner', 'admin'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      await _rpc('crm_set_premium_by_username', { p_username: username, p_value: true })
      _toast(`@${username} ist jetzt Premium.`)
    }
  },
  {
    id: 'unset-premium',
    label: 'Premium entziehen …',
    kind: 'user-action',
    icon: 'star-off',
    keywords: ['premium', 'downgrade', 'remove', 'user'],
    scope: ['owner', 'admin'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      if (!(await _confirm({ title: `Premium entziehen?`, message: `@${username} verliert Premium-Features.`, confirmLabel: 'Entziehen', danger: true }))) return
      await _rpc('crm_set_premium_by_username', { p_username: username, p_value: false })
      _toast(`@${username} Premium entzogen.`)
    }
  },
  {
    id: 'add-user-note',
    label: 'Notiz zu User hinzufügen …',
    kind: 'user-action',
    icon: 'sticky-note',
    keywords: ['note', 'notiz', 'add', 'user'],
    argSchema: { username: 'string', note: 'string' },
    run: async ({ username, note }) => {
      if (!note?.trim()) throw new Error('Notiz darf nicht leer sein.')
      await _rpc('crm_add_user_note_by_username', { p_username: username, p_note: note.trim() })
      _toast('Notiz gespeichert.')
    }
  },
  {
    id: 'open-user-profile',
    label: 'User-Profil öffnen …',
    kind: 'user-action',
    icon: 'user',
    keywords: ['user', 'profil', 'profile', 'open', 'detail'],
    argSchema: { username: 'string' },
    run: ({ username }) => _go(`#people/users?u=${encodeURIComponent(username)}`)
  },
  {
    id: 'send-password-reset',
    label: 'Passwort-Reset senden …',
    kind: 'user-action',
    icon: 'key',
    keywords: ['password', 'reset', 'passwort', 'recovery', 'user'],
    scope: ['owner', 'admin', 'support'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      if (!(await _confirm({ title: 'Reset-Mail senden?', message: `An @${username} geht eine Passwort-Reset-Mail raus.`, confirmLabel: 'Senden' }))) return
      await _rpc('crm_send_password_reset_by_username', { p_username: username })
      _toast('Reset-Mail rausgeschickt.')
    }
  },
  {
    id: 'send-verify-email',
    label: 'Verify-Mail erneut senden …',
    kind: 'user-action',
    icon: 'mail',
    keywords: ['verify', 'email', 'resend', 'verification', 'user'],
    scope: ['owner', 'admin', 'support'],
    argSchema: { username: 'string' },
    run: async ({ username }) => {
      await _rpc('crm_resend_verify_email_by_username', { p_username: username })
      _toast('Verify-Mail rausgeschickt.')
    }
  },

  // ─────────────────────── HELP ───────────────────────
  {
    id: 'help-verify-podcast',
    label: 'Hilfe: Wie verifiziere ich einen Podcast?',
    kind: 'help',
    icon: 'help-circle',
    keywords: ['hilfe', 'help', 'verify', 'verifizieren', 'podcast', 'anleitung'],
    run: () => window.open('https://docs.podfluence.app/verify-podcast', '_blank', 'noopener')
  },
  {
    id: 'help-bulk-actions',
    label: 'Hilfe: Bulk-Actions im CRM',
    kind: 'help',
    icon: 'help-circle',
    keywords: ['hilfe', 'help', 'bulk', 'mass', 'actions'],
    run: () => window.open('https://docs.podfluence.app/crm-bulk', '_blank', 'noopener')
  },
  {
    id: 'help-rbac-roles',
    label: 'Hilfe: Rollen & Berechtigungen',
    kind: 'help',
    icon: 'help-circle',
    keywords: ['hilfe', 'help', 'rbac', 'rollen', 'roles', 'permissions'],
    run: () => window.open('https://docs.podfluence.app/crm-rbac', '_blank', 'noopener')
  },
  {
    id: 'help-cmdk-shortcuts',
    label: 'Hilfe: Cmd-K Shortcuts',
    kind: 'help',
    icon: 'keyboard',
    keywords: ['hilfe', 'help', 'shortcuts', 'tastatur', 'cmdk'],
    run: () => window.open('https://docs.podfluence.app/crm-cmdk', '_blank', 'noopener')
  }
]

// ─────────────────────────────────────────────────────────────────────────
// Fuzzy-Filter
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score: substring=10, full-word=20, fuzzy-char-sequence=1, no-match=0.
 * Wird gegen `label` + `keywords` (lowercase) berechnet, gewichtet Label > Keywords.
 */
function _score(haystack, needle) {
  if (!needle) return 1
  if (!haystack) return 0
  if (haystack === needle) return 30
  if (haystack.startsWith(needle)) return 22
  if (haystack.includes(' ' + needle) || haystack.includes(needle + ' ')) return 20
  if (haystack.includes(needle)) return 10
  let idx = 0
  for (const ch of needle) {
    idx = haystack.indexOf(ch, idx)
    if (idx === -1) return 0
    idx++
  }
  return 1
}

/**
 * Filter + Ranking der ACTIONS-Liste anhand einer Query.
 *
 * @param {string} query           - User-Input. Leer → alle (pinned zuerst).
 * @param {object} [opts]
 * @param {string} [opts.role]     - Aktuelle Rolle für scope-Filter.
 * @param {string} [opts.kind]     - Optionaler kind-Filter ('navigation' | 'user-action' | ...).
 * @param {number} [opts.limit=30] - Maximal-Treffer.
 * @returns {Array} sortierte Actions mit `_score`-Feld.
 */
export function searchActions(query, opts = {}) {
  const { role = null, kind = null, limit = 30 } = opts
  const q = (query || '').trim().toLowerCase()

  const filtered = ACTIONS.filter(a => {
    if (kind && a.kind !== kind) return false
    if (role && Array.isArray(a.scope) && a.scope.length && !a.scope.includes(role)) return false
    return true
  })

  if (!q) {
    return filtered
      .slice()
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1
        if (b.pinned && !a.pinned) return 1
        if (a.pinned && b.pinned) return (a.pinnedOrder ?? 99) - (b.pinnedOrder ?? 99)
        return a.label.localeCompare(b.label)
      })
      .slice(0, limit)
  }

  const scored = filtered.map(a => {
    const lbl = a.label.toLowerCase()
    const kw = (a.keywords || []).join(' ').toLowerCase()
    const score = Math.max(_score(lbl, q) * 0.7 + _score(kw, q) * 0.3, 0)
    return { ...a, _score: score }
  })
  return scored
    .filter(a => a._score > 0)
    .sort((a, b) => b._score - a._score || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/**
 * Direkt-Lookup über `id`. Wird vom Shortcut-Handler genutzt.
 */
export function getActionById(id) {
  return ACTIONS.find(a => a.id === id) || null
}

/**
 * Convenience: alle Actions eines `kind` (für Section-Render im Modal).
 */
export function actionsByKind(kind, role = null) {
  return ACTIONS.filter(a => {
    if (a.kind !== kind) return false
    if (role && Array.isArray(a.scope) && a.scope.length && !a.scope.includes(role)) return false
    return true
  })
}

export default { ACTIONS, searchActions, getActionById, actionsByKind }
