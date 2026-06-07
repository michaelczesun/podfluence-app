# Mobile Nav Spec — Podfluence CRM

Ziel: Bottom-Tab-Bar (5 Top-Level) + horizontale Sub-Tabs + Full-Page-Drill-Down + Mic-FAB. Ersetzt Off-Canvas-Drawer auf Mobile. Drawer bleibt Tablet (768–1024px), Sidebar bleibt Desktop (>1024px).

---

## 1) Breakpoints

| Name        | Range            | Nav-Modus                                   |
|-------------|------------------|---------------------------------------------|
| `--bp-desk` | `>= 1025px`      | Sidebar (Status quo)                        |
| `--bp-tab`  | `768px–1024px`   | Drawer (Status quo, Hamburger)              |
| `--bp-mob`  | `<= 767px`       | **Bottom-Tab-Bar + Mic-FAB + Full-Page Overlays** |
| `--bp-sm`   | `<= 380px`       | Labels nur auf aktivem Tab, Sub-Tabs Padding -2 |

Mobile-Block (`.mobile-block`) bleibt deaktiviert.

---

## 2) Top-Level (5 Tabs)

Mapping aus aktueller Sidebar (5 `cat-head` Kategorien — bei Bedarf anpassen):

1. **Home** (Overview / KPIs) — Icon: `home`
2. **Audience** (User / Listener) — Icon: `users`
3. **Content** (Podcasts / Episodes) — Icon: `mic`
4. **Insights** (Analytics / Charts) — Icon: `bar-chart-2`
5. **More** (Admin / Settings / Logout) — Icon: `grid` (öffnet Sheet mit Rest-Panels)

---

## 3) Bottom-Tab-Bar — CSS

### Klassen

```
.mnav                    /* <nav> Container, fixed bottom */
.mnav__inner             /* flex row, 5 cols */
.mnav__tab               /* <button> ein Tab */
.mnav__tab--active       /* aktiver State: purple-glow + Label */
.mnav__icon              /* 24x24 svg / icon-font */
.mnav__label             /* Text unter Icon, nur sichtbar wenn aktiv */
.mnav__indicator         /* optional Pill-Hintergrund hinter aktivem Icon */
```

### Styles

```css
.mnav {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: rgba(18, 18, 24, 0.72);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-top: 1px solid rgba(255,255,255,0.06);
  z-index: 60;
  display: none;
}
@media (max-width: 767px) {
  .mnav { display: block; }
  /* Body bekommt unten Platz, damit letzter Panel-Inhalt nicht verdeckt wird */
  .panel-shell { padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important; }
  /* Drawer/Hamburger auf Mobile aus */
  #sidebar-toggle { display: none !important; }
  #sidebar { display: none !important; }
  #sidebar::before { display: none !important; }
}
.mnav__inner {
  display: flex;
  height: 56px;
  align-items: stretch;
  justify-content: space-around;
}
.mnav__tab {
  flex: 1 1 0;
  min-width: 0;
  min-height: 56px;          /* Touch-Target */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: transparent;
  border: 0;
  color: rgba(255,255,255,0.55);
  font: 500 11px/1 -apple-system, system-ui, sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color .18s ease;
}
.mnav__tab:active { transform: scale(0.96); }
.mnav__icon { width: 24px; height: 24px; }
.mnav__label {
  display: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mnav__tab--active {
  color: #C9A4FF;                                   /* purple */
  text-shadow: 0 0 12px rgba(168, 85, 247, 0.55);   /* glow */
}
.mnav__tab--active .mnav__label { display: block; }
.mnav__tab--active .mnav__icon {
  filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.65));
}
```

---

## 4) Sub-Tabs (Segmented Control)

Horizontal scrollbar, sticky unter dem Header, snap-scroll. Ersetzt zweite Sidebar-Ebene (`.cat-items`).

### Klassen

```
.subnav                  /* sticky wrapper */
.subnav__scroll          /* overflow-x: auto, scroll-snap-type */
.subnav__pill            /* einzelner Sub-Tab */
.subnav__pill--active
```

### Styles

```css
.subnav {
  position: sticky;
  top: 52px;               /* unter mobiler Topbar */
  z-index: 30;
  background: rgba(18,18,24,0.78);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.subnav__scroll {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.subnav__scroll::-webkit-scrollbar { display: none; }
.subnav__pill {
  flex: 0 0 auto;
  min-height: 36px;        /* Sub-Touch-Target — bewusst < 44, weil dicht & sekundär */
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.7);
  font: 500 13px/1 -apple-system, system-ui, sans-serif;
  white-space: nowrap;
  scroll-snap-align: start;
  -webkit-tap-highlight-color: transparent;
}
.subnav__pill--active {
  background: linear-gradient(180deg, rgba(168,85,247,.22), rgba(168,85,247,.10));
  border-color: rgba(168,85,247,.55);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(168,85,247,.25) inset,
              0 4px 16px rgba(168,85,247,.20);
}
```

---

## 5) Drill-Down — Full-Page Overlay (slide-in von rechts)

Ersetzt den `.drawer` auf Mobile. Tablet/Desktop behalten den Drawer.

### Klassen

```
.sheet                   /* fixed full-screen container */
.sheet--open
.sheet__header           /* Back-Button + Titel */
.sheet__back             /* Chevron-Left Button */
.sheet__title
.sheet__body             /* scroll-area */
```

### Styles

```css
.sheet {
  position: fixed;
  inset: 0;
  background: #0E0E14;
  z-index: 70;
  transform: translateX(100%);
  transition: transform .26s cubic-bezier(.22,.61,.36,1);
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  padding-bottom: calc(56px + env(safe-area-inset-bottom));
  overflow: hidden;
}
.sheet--open { transform: translateX(0); }
.sheet__header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 8px 0 4px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sheet__back {
  width: 44px; height: 44px;          /* Touch-Target */
  display: inline-flex;
  align-items: center; justify-content: center;
  background: transparent; border: 0;
  color: #fff;
  border-radius: 12px;
  -webkit-tap-highlight-color: transparent;
}
.sheet__back:active { background: rgba(255,255,255,0.06); }
.sheet__title {
  font: 600 16px/1.2 -apple-system, system-ui, sans-serif;
  color: #fff;
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sheet__body { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
```

Stack-Verhalten: Mehrere offene Sheets stapeln (z-index 70, 71, 72…). Edge-Swipe-back (JS, optional): horizontaler `touchstart` <16px vom linken Rand → translateX folgen, >40% commit → close.

---

## 6) Mic-FAB (Cmd-K Ersatz)

```
.fab-mic                 /* fixed, bottom-right */
.fab-mic--recording      /* pulsierender ring */
```

```css
.fab-mic {
  position: fixed;
  right: 16px;
  bottom: calc(56px + env(safe-area-inset-bottom) + 16px);
  width: 56px; height: 56px;
  border-radius: 50%;
  border: 0;
  background: radial-gradient(circle at 30% 30%, #B47CFF, #7C3AED 70%);
  color: #fff;
  box-shadow: 0 8px 24px rgba(124, 58, 237, 0.45),
              0 0 0 1px rgba(255,255,255,0.06) inset;
  display: none;
  align-items: center; justify-content: center;
  z-index: 65;
  -webkit-tap-highlight-color: transparent;
}
@media (max-width: 767px) { .fab-mic { display: inline-flex; } }
.fab-mic:active { transform: scale(0.94); }
.fab-mic--recording {
  animation: fab-pulse 1.4s ease-in-out infinite;
}
@keyframes fab-pulse {
  0%,100% { box-shadow: 0 8px 24px rgba(124,58,237,.45), 0 0 0 0 rgba(168,85,247,.55); }
  50%     { box-shadow: 0 8px 24px rgba(124,58,237,.45), 0 0 0 14px rgba(168,85,247,0); }
}
```

Tap → Web-Speech / Whisper-Aufnahme. Long-Press 500ms → Push-to-Talk-Modus.

---

## 7) Touch-Target Mindestgrößen

| Element                | Min            | Begründung                     |
|------------------------|----------------|--------------------------------|
| `.mnav__tab`           | **56×56px**    | Primärnav, Apple HIG 44+, Material 48+ |
| `.fab-mic`             | **56×56px**    | Primäre Aktion                 |
| `.sheet__back`         | **44×44px**    | Header-Button                  |
| `.subnav__pill`        | **36×min**     | Sekundär, dicht — Tap-Slop via 8px gap |
| Tabellen-Zellen mit Action | **40×40px** | Klickbare Rows mind. 40 hoch   |
| Toolbar-Buttons (Mobile) | **40×40px**  | Aktuell ~28px — **muss erhöht werden** |
| Refresh / Logout       | **40×min**     | Aktuell ~30px — **muss erhöht werden** |

Regel: Abstand zwischen zwei Touch-Targets ≥ 8px. Alle interaktiven Elemente brauchen `-webkit-tap-highlight-color: transparent` und `:active` Feedback (Scale oder Background).

---

## 8) Topbar Mobile (Anpassung)

- Höhe bleibt 52px.
- `#sidebar-toggle` (☰) wird ausgeblendet (`display:none`) — Hamburger entfällt komplett auf <768px.
- Topbar enthält nur: Logo (links), Panel-Title (mitte, ellipsis), 1 Kontext-Action (rechts, 44×44).
- `.topbar-mid` bleibt versteckt (Status quo).

---

## 9) States & A11y

- `.mnav__tab` braucht `aria-label`, `aria-current="page"` wenn aktiv.
- `.subnav` mit `role="tablist"`, `.subnav__pill` mit `role="tab"` + `aria-selected`.
- `.sheet` mit `role="dialog"`, `aria-modal="true"`, Focus-Trap, ESC schließt.
- Reduzierte Bewegung: `@media (prefers-reduced-motion: reduce)` → `.sheet` Transition auf 0s, FAB-Pulse aus.

---

## 10) JS-Hooks (Erwartung an Implementierung)

```
data-mnav-tab="home|audience|content|insights|more"
data-subnav-tab="<panel-id>"
data-sheet-open="<panel-id>"
data-sheet-close
data-fab="mic"
```

Router merkt sich pro Top-Tab den letzten aktiven Sub-Tab (Tab-Switch restored State). Sheet-Stack in `history.pushState`, Back-Geste/Hardware-Back schließt oberstes Sheet.

---

## 11) Out-of-scope (für später)

- Edge-Swipe-Back Gesten (Phase 2)
- Haptic-Feedback (`navigator.vibrate(8)` on tab-change)
- Pull-to-refresh innerhalb `.sheet__body`
- Theming: Light-Mode-Variante der `.mnav` Backdrop
