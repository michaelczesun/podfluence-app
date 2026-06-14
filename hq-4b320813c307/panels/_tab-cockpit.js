// Cockpit Top-Tab — das Founder-Hauptdashboard, erster Tab + Default-Landing.
// Single-Panel-Tab (keine Subtabs): mountet panels/cockpit.js direkt.
import cockpit from '/hq-4b320813c307/panels/cockpit.js?v=20260610q'

export default {
  async mount(container, _ctx) {
    await cockpit.mount(container)
  },
  unmount() { /* cockpit hält keine Subscriptions/Intervalle */ }
}
