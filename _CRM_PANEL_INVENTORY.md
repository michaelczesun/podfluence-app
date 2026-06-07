# CRM Panel Inventory
**Generated:** 2026-06-07  
**Panels found:** 34 active (+ 1 `.bak`)

---

## Import Consistency Notes

All panels use the same import pattern:
- `sb` from `/lib/supabase.js` — consistent across all panels
- `ui.js` exports: `htmlEscape`, `debounce`, `modal`, `confirmDialog`, `toast`, `spinnerHtml`, `fmtNumber`, `fmtRelativeTime`, `fmtDateTime`, `exportCsv`, `renderActionButtons`, `searchInput`, `pagination`, `iconHtml`, `promptDialog`
- `layout-extras.js` exports: `drawer`, `tabs`, `segmentedControl`, `timeRangePicker`, `statHero`, `glassCard`
- `panel-actions.js` exports: `verifyUser`, `unverifyUser`, `banUser`, `unbanUser`, `setUserRole`, `deletePost`, `sendTestPush`, `sendBroadcastPush`, `resolveBugReport`, `forceVerifyPodcast`, `assignInviteCodes`, `grantPremium`, `revokePremium`, `showUserDetailModal`, `showPostDetailModal`

**Import mismatch detected:**  
`bug-reports-triage.js` imports `drawer`, `glassCard`, `statHero` from `/lib/ui.js` — these are NOT exported from `ui.js`, they live in `/lib/layout-extras.js`. Runtime will silently get `undefined` for these three.

---

## Panel Table

| Panel | RPCs | Tabellen (direct) | Edge Functions | Empty-State | Action-Buttons | Import-Probleme |
|---|---|---|---|---|---|---|
| **achievements-unlocks.js** | `admin_get_user` | `user_achievements` (select×2, insert) | — | Ja ("Noch keine Unlocks", "Noch keine Achievements freigeschaltet") | Grant-Button, CSV, PDF, Refresh, Row-Click → Drawer | Keine |
| **active-polls.js** | — | `polls` (select), `poll_votes` (select), `poll_votes`/`polls` (update/close) | — | Ja (`emptyState()` — "Noch keine Umfragen") | Details-Drawer, Umfrage-schliessen-Button, Refresh, PDF, CSV | Keine |
| **bug-reports-triage.js** | `admin_set_bug_status` | `bug_reports` (update priority×2, update status+note) | — | Ja ("Keine Tickets") | Save-Note, Resolve, Drag-n-Drop Kanban, Refresh, PDF, CSV | **MISMATCH:** importiert `drawer`, `glassCard`, `statHero` aus `ui.js` statt `layout-extras.js` |
| **client-build-versions.js** | `admin_build_versions`, `admin_users_list_full` | — | — | Ja ("Daten kommen sobald Tabelle `user_devices` angelegt ist") | Force-Update-Push Button, Row-Click → User-Detail, Refresh, PDF, CSV | Keine |
| **crash-rate.js** | — | `crash_logs` (select), `app_opens` (select) | — | Ja ("Daten kommen sobald Tabelle `app_sessions` angelegt ist") | Export CSV, Refresh | Keine |
| **dau-trend.js** | `admin_daily_series` (dau), `admin_users_list_full` | — | — | Ja ("Noch keine Aktivität") | Refresh, PDF, CSV, Day-Drill-Down mit Export | Keine |
| **episodes-per-day.js** | `admin_daily_series` (episodes) | — | — | Ja ("Keine Episoden") | Refresh, PDF, CSV | Keine |
| **insta-approval-queue.js** | — | `insta_posts_queue` (select×2, update caption/hashtags/status/insights) | `insta-publish`, `insta-marketing-generator` | Ja (`.empty-state` Klasse) | Approve, Reject, Edit Caption/Hashtags, Update Insights, Generator-starten Button | Keine |
| **insta-post-type-scores.js** | — | `insta_post_performance` (select) | — | Ja ("Noch keine IG-Posts im Zeitraum", Retry-Button) | Type-Drawer öffnen (onClick), Retry | Keine |
| **invite-codes-usage.js** | — | `invites` (update revoked_at, insert bulk) | — | Ja (CTA-Button "Bulk-Generate öffnen") | Revoke-Code, Bulk-Generate, Search/Filter/Sort, Paginierung, User-Detail-Link, Refresh, PDF, CSV | Keine |
| **kpi-live-totals.js** | `admin_db_live_stats`, `admin_daily_series` (signups, posts) | `app_opens` (count×2), `episode_listening_pulses` (select×2) | — | Ja ("Daten kommen sobald Tabelle `profiles` angelegt ist") | Refresh, PDF, CSV, KPI-Card Drill-Down, Drill-CSV | Keine |
| **listens-per-day.js** | — | `episode_listening_pulses` (select×2), `episodes` (select für Top-Episoden) | — | Ja ("Noch keine Hörsessions") | Refresh, PDF, CSV | Keine |
| **new-signups-7d.js** | `admin_daily_series` (signups), `admin_users_list_full` | — | — | Ja (`emptyState()` — "Noch keine Anmeldungen") | Refresh, PDF, CSV, User-Row → Detail-Modal | Keine |
| **newsletter-audience-sync.js** | — | — | `newsletter-broadcast` (×2: Test + Live) | Ja ("Noch keine Broadcasts versendet") | Test-Newsletter senden, Live-Newsletter senden, Refresh, PDF, CSV, Row-Click → History-Detail | Keine |
| **onboarding-funnel.js** | `onboarding_funnel_stats`, `admin_users_list_full`, `admin_daily_series` (signups) | `episode_listening_pulses` (select) | `send-reactivation-mail` | Ja ("Daten kommen sobald Tabelle `users` oder RPC `onboarding_funnel_stats` angelegt ist") | Select-All Checkbox, Reactivation-Mail senden, Stage-Dropdown-Drill, Refresh, PDF, CSV | Keine |
| **open-bug-reports.js** | — | `bug_reports` (update priority×2, update status+resolution), via `admin_users_list_full` für User-Lookup | — | Ja ("Keine Tickets" grüne Check-Icon) | Priority-Change Dropdown, Drag-n-Drop Reorder, Resolve-Button mit Resolution-Text, Refresh, PDF, CSV | Keine; `admin_users_list_full` via `sb.rpc` |
| **podcast-verification-queue.js** | `admin_force_verify_podcast` | `podcasts` (update approved/rejected) | `send-podcast-verification` (verify + reject) | Ja (Filter-spezifische Texte) | Verify-Mail senden, Force-Verify, Reject mit Grund, Details-Drawer, Refresh, PDF, CSV | Keine |
| **podcaster-engagement-7d.js** | — | `episode_listening_pulses` (select), `users` (select für Top-Podcaster) | — | Ja ("Daten kommen sobald Tabelle X angelegt ist", "Im gewählten Fenster gibt es noch keine Daten") | Refresh, PDF, CSV, User-Detail via `showUserDetailModal`, Push via `sendBroadcastPush` | Keine |
| **posts-per-day.js** | `admin_daily_series` (posts) | — | — | Ja ("Keine Posts", "Im gewählten Zeitraum gibt es keine Posts") | Refresh, PDF, CSV, Day-Drill → Post-List | Keine |
| **push-broadcast.js** | `admin_db_live_stats`, `admin_user_type_split`, `send_broadcast_push` | — | — | Ja ("Noch keine Broadcasts gesendet") | Test-Push, Live-Broadcast senden (mit Audience-Filter), History-Row-Click, Refresh, PDF, CSV | Keine |
| **recent-updates-feed.js** | — | `updates` (update content, delete) | — | Ja ("Keine Posts gefunden", Filter-Reset-Button) | Edit-Post Modal, Delete-Post, Auto-Refresh Toggle, Refresh, PDF, CSV, Search, Row-Click → Detail | Keine |
| **referral-leaderboard.js** | `referral_leaderboard`, `grant_referral_bonus_code` | — | — | Ja (`emptyState()` — "Noch keine Einladungen", Retry) | Grant-Bonus-Code Button, Profil-öffnen Button, Row-Click → Drawer, Refresh, PDF, CSV | Keine |
| **referral-overview.js** | — | — | — | Ja (`_missingTables: ['referral_codes', 'referral_signups']` — statischer Empty-State, gibt immer Nullwerte zurück) | Refresh, PDF, CSV | **STUB:** `loadData()` gibt immer leere Daten zurück — kein echter SB-Aufruf implementiert |
| **settings.js** | `admin_users_list_full` (User-Lookup), `admin_db_live_stats` | `insta_posts_queue` (count×3 status pending/approved/rejected) | `insta-marketing-generator`, `newsletter-sync` | Nein | Logout, Token-Refresh, Einstellungen-Speichern, Generator-Starten, Resend-Sync | Keine |
| **storage-ops.js** | — | — | `recompress-storage` | Ja ("Keine Storage-Buckets konfiguriert", "Daten kommen sobald Tabelle `storage_recompress_jobs` angelegt ist") | Recompress-Bucket, Export-CSV, Alle-Bucket-Recompress, Job-History Filter, Refresh, CSV, PDF | Keine |
| **top-listened-podcasts.js** | — | `episode_listening_pulses` (select+aggregate) | — | Ja ("Noch keine Hör-Aktivität", "Keine Episode-Daten verfügbar") | Row-Click → Drawer mit Episode-Liste, Refresh, PDF, CSV | Keine |
| **top-listeners.js** | — | `episode_listening_pulses` (select+aggregate) | — | Ja ("Noch keine Hör-Aktivität") | Thank-You-Push senden (Top-10), User-Detail, Suche, Refresh, PDF, CSV | Keine |
| **trending-hashtags.js** | — | `hashtag_trending_7d` / `hashtag_trending_30d` (views, select), `updates` (select×2 für Fallback) | — | Ja ("Keine Hashtags", "Noch keine Hashtags") | Hashtag-Click → Drawer mit Post-Liste, Refresh, PDF, CSV | Keine |
| **trending-podcasters.js** | — | — | — | Ja ("Sobald Wachstum oder Velocity messbar sind...") | Feature-Toggle (Checkbox), Copy-ID, Refresh, PDF, CSV, Row-Click → Drawer | **STUB:** `fetchTrending()` gibt immer `[]` zurück — RPC `crm_trending_podcasters` noch nicht existiert |
| **user-type-split.js** | `admin_user_type_split`, `admin_users_list_full` | — | — | Ja ("Für das gewählte Segment liegen aktuell keine Datensätze vor") | Segment-Filter, User-Row → Detail-Modal, Suche, Refresh, PDF, CSV | Keine |
| **users-by-country.js** | `admin_users_list_full` | — | — | Ja ("Noch keine Länderdaten", "Daten kommen sobald Tabelle `profiles` angelegt ist") | Map-Country-Click → User-Liste, User-Row → Detail-Modal, Refresh, PDF, CSV | Keine |
| **users-list.js** | `admin_users_list_full` (×2: load + paginate), `admin_bulk_verify`, `admin_set_premium`, `send_broadcast_push` | — | — | Ja ("Für die aktuelle Suche gibt es keine Treffer") | Verify-User, Ban-User, Grant-Premium, Bulk-Verify, Broadcast-Push, Search, Paginierung, Refresh, PDF, CSV | Keine |
| **verified-premium-flags.js** | `admin_users_list_full`, `admin_unverify_user`, `admin_set_premium` (remove + bulk-grant) | — | — | Ja ("Keine Verified/Premium-Nutzer") | Unverify, Remove-Premium, Bulk-Premium-Grant (mit User-Picker), Search×2, Refresh, PDF, CSV | Keine |
| **vibe-distribution.js** | — | `episode_vibes` (select+aggregate) | — | Ja ("Noch keine Vibes erfasst", "Noch keine Episodes mit diesem Vibe") | Refresh, PDF, CSV, Vibe-Click → Episode-Drawer | Keine |

---

## Stub-Panels (kein echter Daten-Abruf)

| Panel | Status | Fehlende Voraussetzung |
|---|---|---|
| `trending-podcasters.js` | Stub — `fetchTrending()` gibt immer `[]` | RPC `crm_trending_podcasters` nicht im Schema |
| `referral-overview.js` | Stub — `loadData()` gibt immer Nullwerte | Tabellen `referral_codes`, `referral_signups` nicht angelegt |

---

## Import-Fehler

| Panel | Problem | Wirkung |
|---|---|---|
| `bug-reports-triage.js` | Importiert `drawer`, `glassCard`, `statHero` aus `/lib/ui.js` (nicht exportiert dort) | Alle drei sind `undefined` zur Laufzeit — Drawer/Layout-Komponenten in diesem Panel funktionieren nicht |

---

## Panels ohne jegliche Supabase-Calls in der Signatur-Zeile (benutzen Chained-Calls direkt)

Diese Panels nutzen `sb.from()` mit Method-Chaining ohne Zuweisung auf der gleichen Zeile — wurden daher in der initialen grep-Suche nicht gefunden, aber besitzen echte SB-Aufrufe:

- `achievements-unlocks.js` — `sb.from('user_achievements')`, `sb.rpc('admin_get_user')`
- `crash-rate.js` — `sb.from('crash_logs')`, `sb.from('app_opens')`
- `insta-post-type-scores.js` — `sb.from('insta_post_performance')`
- `listens-per-day.js` — `sb.from('episode_listening_pulses')`, `sb.from('episodes')`
- `podcaster-engagement-7d.js` — `sb.from('episode_listening_pulses')`, `sb.from('users')`
- `top-listened-podcasts.js` — `sb.from('episode_listening_pulses')`
- `top-listeners.js` — `sb.from('episode_listening_pulses')`
- `vibe-distribution.js` — `sb.from('episode_vibes')`

---

## RPC-Übersicht (alle genutzten RPCs)

| RPC | Panels |
|---|---|
| `admin_db_live_stats` | kpi-live-totals, push-broadcast, settings |
| `admin_daily_series` | dau-trend, episodes-per-day, kpi-live-totals, new-signups-7d, onboarding-funnel, posts-per-day |
| `admin_users_list_full` | client-build-versions, dau-trend, new-signups-7d, onboarding-funnel, open-bug-reports, settings, user-type-split, users-by-country, users-list, verified-premium-flags |
| `admin_user_type_split` | push-broadcast, user-type-split |
| `admin_build_versions` | client-build-versions |
| `admin_set_bug_status` | bug-reports-triage |
| `admin_force_verify_podcast` | podcast-verification-queue |
| `admin_bulk_verify` | users-list |
| `admin_set_premium` | users-list, verified-premium-flags |
| `admin_unverify_user` | verified-premium-flags |
| `admin_get_user` | achievements-unlocks |
| `onboarding_funnel_stats` | onboarding-funnel |
| `referral_leaderboard` | referral-leaderboard |
| `grant_referral_bonus_code` | referral-leaderboard |
| `send_broadcast_push` | push-broadcast, users-list |
| `crm_force_update_push` | client-build-versions |

---

## Edge-Function-Übersicht

| Edge Function | Panels |
|---|---|
| `insta-publish` | insta-approval-queue |
| `insta-marketing-generator` | insta-approval-queue, settings |
| `newsletter-broadcast` | newsletter-audience-sync |
| `newsletter-sync` | settings |
| `send-reactivation-mail` | onboarding-funnel |
| `send-podcast-verification` | podcast-verification-queue |
| `recompress-storage` | storage-ops |

---

## Direkte Tabellen-Zugriffe (sb.from)

| Tabelle | Panels | Operationen |
|---|---|---|
| `user_achievements` | achievements-unlocks | select, insert |
| `polls` / `poll_votes` | active-polls | select, update (close poll / vote management) |
| `bug_reports` | bug-reports-triage, open-bug-reports | update (priority, status, note, resolution) |
| `insta_posts_queue` | insta-approval-queue, settings | select, update (caption, hashtags, status, insights); count |
| `insta_post_performance` | insta-post-type-scores | select |
| `invites` | invite-codes-usage | update (revoked_at), insert |
| `app_opens` | kpi-live-totals | select count×2 |
| `episode_listening_pulses` | kpi-live-totals, listens-per-day, onboarding-funnel, podcaster-engagement-7d, top-listened-podcasts, top-listeners | select (various filters + limits) |
| `crash_logs` | crash-rate | select |
| `updates` | recent-updates-feed, trending-hashtags | update, delete; select (hashtag fallback) |
| `podcasts` | podcast-verification-queue | update (approved/rejected) |
| `episodes` | listens-per-day | select (top episode metadata) |
| `users` | podcaster-engagement-7d | select |
| `episode_vibes` | vibe-distribution | select+aggregate |
| `hashtag_trending_7d` / `hashtag_trending_30d` | trending-hashtags | select (materialized views) |
