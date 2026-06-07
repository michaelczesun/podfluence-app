# Cmd-K Universal Bar — Spec

Eine globale Suchleiste für das Podfluence-CRM. Floatet als Modal über jedem Panel, erreichbar per Tastatur oder Mic-Icon auf Mobile.

---

## 1. Trigger / Aktivierung

| Plattform | Trigger | Verhalten |
|-----------|---------|-----------|
| macOS | `⌘ + K` | Modal öffnet, Input fokussiert |
| Windows / Linux | `Ctrl + K` | Modal öffnet, Input fokussiert |
| Mobile (iOS/Android) | Mic-Icon in Header-Bar (rechts neben Avatar) | Modal öffnet im Vollbild, Speech-to-Text aktiv |
| Überall | `Esc` | Modal schließt, fokus zurück auf Ursprungs-Element |

Hot-key wird global registriert via `window.addEventListener('keydown')`, inkl. `preventDefault()`. Bei offenem Modal: zweites `⌘K` schließt es (Toggle).

Mobile: Mic-Tap startet `webkitSpeechRecognition` (de-DE) — Transkript fließt live in den Input.

---

## 2. Modal-Layout

```
┌────────────────────────────────────────────────┐
│  🔍  [ Suche Panels, User, Aktionen…    ]  Esc │
├────────────────────────────────────────────────┤
│  QUICK ACTIONS                                 │
│  ▸ Neuer Lead                          ⌘L      │
│  ▸ Neuer Task                          ⌘T      │
│  ▸ Audit-Log letzte Stunde             ⌘⇧A     │
│  ▸ Bulk-Verify wartende                ⌘⇧V     │
│  ▸ Push an Premium                     ⌘⇧P     │
├────────────────────────────────────────────────┤
│  (gefilterte Treffer, gruppiert)               │
└────────────────────────────────────────────────┘
  ↑↓ navigieren  ⏎ ausführen  Esc schließen
```

- **Position**: zentriert, `top: 20vh`, max-width `640px`, Backdrop `rgba(0,0,0,0.4)` mit `backdrop-filter: blur(8px)`.
- **Input**: 48px hoch, monospace-free Sans, Placeholder = "Suche Panels, User, Aktionen oder frag was…".
- **Body**: max-height `60vh`, scrollbar.
- **Footer**: hint-line mit den 3 wichtigsten Shortcuts (grau, 11px).

---

## 3. JSON Action-Registry Schema

Jeder durchsuchbare Eintrag (Panel, User, Action, Setting, Help) ist ein `RegistryItem`:

```json
{
  "id": "action.bulk_verify_pending",
  "type": "action",
  "title": "Bulk-Verify wartende Podcasts",
  "subtitle": "Verifiziert alle Podcasts mit Status = pending_review",
  "icon": "shield-check",
  "group": "actions",
  "keywords": ["bulk", "verify", "verifizieren", "warteschlange", "pending", "queue"],
  "shortcut": ["mod", "shift", "v"],
  "pinned": true,
  "pinnedOrder": 4,
  "scope": ["admin", "moderator"],
  "handler": {
    "kind": "rpc",
    "name": "crm_bulk_verify_pending",
    "args": {},
    "confirm": {
      "title": "Alle wartenden Podcasts verifizieren?",
      "body": "Das markiert {{count}} Einträge als verified. Nicht umkehrbar ohne Audit-Log-Eintrag.",
      "destructive": false
    }
  },
  "telemetry": {
    "event": "cmdk_action_invoked",
    "props": { "action_id": "bulk_verify_pending" }
  }
}
```

### Felder

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `id` | string | ✓ | Stabile ID, Dot-Namespace (`panel.x`, `user.<uuid>`, `action.x`, `setting.x`, `help.x`) |
| `type` | enum | ✓ | `panel` \| `user` \| `action` \| `setting` \| `help` |
| `title` | string | ✓ | Hauptlabel (max 60 chars) |
| `subtitle` | string | – | Zweite Zeile, grau (max 90 chars) |
| `icon` | string | – | Lucide-Icon-Name |
| `group` | enum | ✓ | `panels` \| `users` \| `actions` \| `settings` \| `help` |
| `keywords` | string[] | – | Synonyme für Fuzzy-Search (de + en) |
| `shortcut` | string[] | – | Token-Array, z.B. `["mod","shift","v"]`. `mod` = ⌘ auf Mac, Ctrl sonst. |
| `pinned` | bool | – | Bei `true`: in Quick-Actions-Block oben, IMMER sichtbar |
| `pinnedOrder` | number | – | Sortierung im Pinned-Block (1–7) |
| `scope` | string[] | – | RBAC-Rollen die das Item sehen dürfen. Leer = alle. |
| `handler` | object | ✓ | siehe unten |
| `telemetry` | object | – | Event + Props für `cmdk_action_invoked` |

### Handler-Varianten

```json
// Navigation zum Panel
"handler": { "kind": "navigate", "to": "/crm/panels/users-overview" }

// Navigation zum User-Detail (dynamisch)
"handler": { "kind": "navigate", "to": "/crm/users/{{user_id}}" }

// Modal öffnen
"handler": { "kind": "modal", "component": "NewLeadModal", "props": {} }

// Supabase-RPC
"handler": { "kind": "rpc", "name": "crm_bulk_verify_pending", "args": {}, "confirm": {...} }

// Edge-Function POST
"handler": { "kind": "edge", "fn": "push-to-premium", "body": {...}, "confirm": {...} }

// Externer Link (neue Tab)
"handler": { "kind": "external", "url": "https://docs.podfluence.app/verify" }

// Inline-Help (Drawer öffnet sich rechts)
"handler": { "kind": "help", "article_id": "verify-podcast" }
```

### Dynamische Items mit Argumenten

Für Aktionen wie "Verify @username" — der User-Teil ist Parameter:

```json
{
  "id": "action.verify_user",
  "type": "action",
  "title": "Verify @{{user}}",
  "template": true,
  "argSpec": [
    { "name": "user", "label": "User", "source": "users", "required": true }
  ],
  "handler": { "kind": "rpc", "name": "crm_verify_user", "args": { "user_id": "{{user.id}}" } }
}
```

Beim Tippen "verify max" matcht der Parser: action `verify_user` + arg `user=max` → zeigt ausgefülltes Item mit echtem User-Avatar.

---

## 4. Pinned Quick-Actions (Top-Block, fest verdrahtet)

Immer sichtbar wenn Input leer **oder** kein Match. 5 fixe + 2 reservierte Slots für context-aware.

| # | Title | Shortcut | Handler |
|---|-------|----------|---------|
| 1 | Neuer Lead | `⌘L` | `modal: NewLeadModal` |
| 2 | Neuer Task | `⌘T` | `modal: NewTaskModal` |
| 3 | Audit-Log letzte Stunde | `⌘⇧A` | `navigate: /crm/audit?range=1h` |
| 4 | Bulk-Verify wartende | `⌘⇧V` | `rpc: crm_bulk_verify_pending` (confirm) |
| 5 | Push an Premium | `⌘⇧P` | `modal: PushComposer{audience:'premium'}` |
| 6 (context) | "Diesen User verifizieren" | – | nur wenn Cmd-K aus User-Detail aufgerufen |
| 7 (context) | "Zu diesem Panel teilen" | – | nur wenn Panel offen |

---

## 5. Such-/Fuzzy-Logik

- **Engine**: `fuse.js` mit `threshold: 0.35`, `keys: ['title','subtitle','keywords']`, weighted (`title=0.7, keywords=0.2, subtitle=0.1`).
- **Pre-Filter**: nach `scope` (User-Rolle) und `group` (wenn Input mit Prefix beginnt — siehe unten).
- **Prefix-Operatoren** (Power-User):
  - `>` Action-only → `> verify max`
  - `@` User-only → `@thomas`
  - `#` Panel-only → `#leaderboard`
  - `?` Help-only → `? wie verifiziere ich`
  - `!` Settings-only → `! email`
- **Ranking**: Fuse-Score → Recency-Boost (zuletzt verwendete Items × 0.85) → Pinned-Items immer oben.
- **Debounce**: 80ms.
- **User-Source**: lazy-load via RPC `crm_search_users(q, limit:20)` — nicht client-side, da >5k User. Andere Sources sind statisch / vorgeladen.
- **Aliase Deutsch ↔ Englisch**: `verifizieren`↔`verify`, `nutzer`↔`user`, `einstellungen`↔`settings`, …  in `keywords` redundant gepflegt.

---

## 6. Group-Headers (Render-Reihenfolge)

Bei Input leer:
```
QUICK ACTIONS   (pinned)
ZULETZT         (last 5 invoked, lokal localStorage)
```

Bei Input mit Treffern:
```
QUICK ACTIONS   (immer, gefiltert wenn passend)
AKTIONEN        (group=actions)
USER            (group=users, max 8)
PANELS          (group=panels, max 8)
EINSTELLUNGEN   (group=settings, max 5)
HILFE           (group=help, max 5)
```

- Header: 11px uppercase, letter-spacing 0.08em, grau-400.
- Leere Gruppen werden ausgeblendet.
- Pro Gruppe `Mehr anzeigen…` wenn truncated.

---

## 7. Keyboard-Navigation

| Taste | Aktion |
|-------|--------|
| `↓` | nächstes Item (überspringt Header) |
| `↑` | vorheriges Item |
| `Tab` | nächstes Item (alias zu ↓) |
| `Shift+Tab` | vorheriges Item |
| `Enter` (⏎) | aktives Item ausführen |
| `⌘+Enter` | Item in neuem Tab/Detail öffnen (wenn `kind=navigate`) |
| `→` | nur bei Action mit `template:true` — fokussiert Parameter-Picker |
| `←` | im Parameter-Picker zurück zum Input |
| `Esc` | Modal schließen (bzw. erst Param-Picker schließen wenn offen) |
| `⌘+1..9` | direkt das n-te Item der aktuellen Liste ausführen |
| `⌘+Backspace` | Input clearen ohne Modal zu schließen |

- Aktives Item: blauer Hintergrund + linker 2px Akzent-Strich.
- Bei Wechsel der Liste (neuer Search-Term) springt Cursor auf Item 0.
- Scrollt aktives Item via `scrollIntoView({block:'nearest'})` immer in View.

Screen-Reader: `role="combobox"`, `aria-activedescendant` auf aktives Item, jede Gruppe als `role="group"` mit `aria-label`.

---

## 8. Empty-State (Input leer)

```
┌──────────────────────────────────────────┐
│  🔍   Suche Panels, User, Aktionen…      │
├──────────────────────────────────────────┤
│  QUICK ACTIONS                           │
│  …5 pinned items…                        │
│                                          │
│  ZULETZT                                 │
│  …last 5 invoked…                        │
│                                          │
│  💡 Tipp:  >  für Actions   @ für User   │
│             #  für Panels   ? für Hilfe  │
└──────────────────────────────────────────┘
```

Wenn kein "Zuletzt" vorhanden (neuer User): Tipp-Box prominenter, "Probier `⌘⇧V` für Bulk-Verify".

---

## 9. No-Results-State (Input gesetzt, 0 Treffer)

```
┌──────────────────────────────────────────┐
│  🔍   verifizier alle podcasts ohne x    │
├──────────────────────────────────────────┤
│                                          │
│         🤔  Nichts gefunden.             │
│                                          │
│   Meintest du:                           │
│   ▸ Bulk-Verify wartende      ⌘⇧V        │
│   ▸ Podcasts ohne Cover-Image            │
│                                          │
│   ─────────────────────────────────      │
│   ▸ 🤖 Bot fragen: "verifizier alle…"    │
│   ▸ 📨 Feature anfragen                  │
│                                          │
└──────────────────────────────────────────┘
```

- Drei Fallbacks: Levenshtein-Nachbarn (max 3), "Bot fragen" (öffnet Bot-Drawer mit Query als Prefill), "Feature anfragen" (öffnet Feedback-Modal mit Query).
- Wenn Query >40 Zeichen → "Bot fragen" automatisch primär hervorgehoben.

---

## 10. Beispiel-Registry (Auszug)

```json
[
  {
    "id": "action.new_lead",
    "type": "action",
    "title": "Neuer Lead",
    "icon": "user-plus",
    "group": "actions",
    "keywords": ["lead", "neu", "kontakt", "add", "new"],
    "shortcut": ["mod", "l"],
    "pinned": true, "pinnedOrder": 1,
    "handler": { "kind": "modal", "component": "NewLeadModal" }
  },
  {
    "id": "action.new_task",
    "type": "action",
    "title": "Neuer Task",
    "icon": "check-square",
    "group": "actions",
    "keywords": ["task", "todo", "aufgabe", "neu"],
    "shortcut": ["mod", "t"],
    "pinned": true, "pinnedOrder": 2,
    "handler": { "kind": "modal", "component": "NewTaskModal" }
  },
  {
    "id": "action.audit_last_hour",
    "type": "action",
    "title": "Audit-Log letzte Stunde",
    "icon": "history",
    "group": "actions",
    "keywords": ["audit", "log", "stunde", "1h", "letzte"],
    "shortcut": ["mod", "shift", "a"],
    "pinned": true, "pinnedOrder": 3,
    "handler": { "kind": "navigate", "to": "/crm/audit?range=1h" }
  },
  {
    "id": "action.bulk_verify_pending",
    "type": "action",
    "title": "Bulk-Verify wartende Podcasts",
    "subtitle": "Setzt alle pending_review auf verified",
    "icon": "shield-check",
    "group": "actions",
    "keywords": ["bulk", "verify", "verifizieren", "warteschlange", "pending"],
    "shortcut": ["mod", "shift", "v"],
    "pinned": true, "pinnedOrder": 4,
    "scope": ["admin", "moderator"],
    "handler": {
      "kind": "rpc", "name": "crm_bulk_verify_pending", "args": {},
      "confirm": { "title": "Alle wartenden verifizieren?", "body": "{{count}} Einträge." }
    }
  },
  {
    "id": "action.push_premium",
    "type": "action",
    "title": "Push an Premium",
    "icon": "send",
    "group": "actions",
    "keywords": ["push", "premium", "notification", "broadcast"],
    "shortcut": ["mod", "shift", "p"],
    "pinned": true, "pinnedOrder": 5,
    "scope": ["admin"],
    "handler": { "kind": "modal", "component": "PushComposer", "props": { "audience": "premium" } }
  },
  {
    "id": "action.verify_user",
    "type": "action",
    "title": "Verify @{{user}}",
    "icon": "badge-check",
    "group": "actions",
    "template": true,
    "keywords": ["verify", "verifizieren", "user"],
    "argSpec": [ { "name": "user", "label": "User", "source": "users", "required": true } ],
    "handler": {
      "kind": "rpc", "name": "crm_verify_user",
      "args": { "user_id": "{{user.id}}" },
      "confirm": { "title": "@{{user.username}} verifizieren?" }
    }
  },
  {
    "id": "action.ban_user",
    "type": "action",
    "title": "Ban @{{user}}",
    "icon": "ban",
    "group": "actions",
    "template": true,
    "keywords": ["ban", "sperren", "block"],
    "scope": ["admin"],
    "argSpec": [ { "name": "user", "label": "User", "source": "users", "required": true } ],
    "handler": {
      "kind": "rpc", "name": "crm_ban_user",
      "args": { "user_id": "{{user.id}}" },
      "confirm": { "title": "@{{user.username}} bannen?", "destructive": true }
    }
  },
  {
    "id": "action.add_note",
    "type": "action",
    "title": "Notiz zu @{{user}} hinzufügen",
    "icon": "sticky-note",
    "group": "actions",
    "template": true,
    "keywords": ["note", "notiz", "add"],
    "argSpec": [ { "name": "user", "label": "User", "source": "users", "required": true } ],
    "handler": { "kind": "modal", "component": "AddNoteModal", "props": { "userId": "{{user.id}}" } }
  },
  {
    "id": "action.inactive_users_7d",
    "type": "action",
    "title": "Zeige inaktive User > 7 Tage",
    "icon": "user-x",
    "group": "actions",
    "keywords": ["inactive", "inaktiv", "7d", "tage"],
    "handler": { "kind": "navigate", "to": "/crm/panels/inactive-users?days=7" }
  },
  {
    "id": "panel.users_overview",
    "type": "panel",
    "title": "User-Übersicht",
    "icon": "users",
    "group": "panels",
    "keywords": ["users", "nutzer", "übersicht", "liste"],
    "handler": { "kind": "navigate", "to": "/crm/panels/users-overview" }
  },
  {
    "id": "setting.email_templates",
    "type": "setting",
    "title": "E-Mail-Vorlagen",
    "icon": "mail",
    "group": "settings",
    "keywords": ["email", "vorlage", "template", "mail"],
    "handler": { "kind": "navigate", "to": "/crm/settings/email" }
  },
  {
    "id": "help.verify_podcast",
    "type": "help",
    "title": "Wie verifiziere ich einen Podcast?",
    "subtitle": "Schritt-für-Schritt Anleitung",
    "icon": "help-circle",
    "group": "help",
    "keywords": ["verify", "verifizieren", "podcast", "anleitung", "wie"],
    "handler": { "kind": "help", "article_id": "verify-podcast" }
  }
]
```

---

## 11. Telemetrie

Jede ausgeführte Aktion → Event `cmdk_action_invoked` in `analytics_events`:
```
{ action_id, query, position, group, ms_to_invoke, used_shortcut: bool }
```

Daraus ergibt sich Top-10-Liste → Auto-Pin-Vorschläge im Admin-Settings.

---

## 12. Performance / Tech-Notes

- Registry lazy-imported (`import('./registry.json')`) → ~12kb gzipped, statisch.
- User-Search debounced 80ms, RPC nutzt `pg_trgm` Index auf `users.username`.
- Modal als React-Portal in `<body>`, eigener z-index Layer `9999`.
- Erste Render < 50ms (kein Fuse-Build vor Input-Fokus — `requestIdleCallback`).
- KAV: Input auf Mobile in `KeyboardAvoidingView behavior='padding'` (siehe Memory: KAV-Regel).

---

## 13. Open Questions (für später)

- Voice-Mode auf Desktop (Push-to-Talk via `⌘+Space` lang gedrückt)?
- Multi-Step Macros ("Audit + Verify + Push") als verkettete Actions?
- Sharing von Cmd-K Deep-Links (`?cmdk=verify_user&user=max`)?
