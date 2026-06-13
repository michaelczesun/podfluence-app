#!/usr/bin/env node
// Regeneriert /sitemap.xml aus den Live-Daten der public-users-list Edge-Function.
// Nutzung: node scripts/generate-sitemap.mjs
// Läuft anon — keine Service-Role-Keys nötig.
//
// Memory: /crm/ + /login/ + /admin/ + /reset-password/ + /verify/ NICHT in Sitemap
// (sind in robots.txt disallowed). Alles andere Public ist drin.

import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT = join(REPO_ROOT, 'sitemap.xml')

const SB = 'https://nlgedaxiailhhcmgtmdp.supabase.co'
const PUB = 'sb_publishable_aJrojJ8QFI0uCETwimeRLw_-ymYCVw_'

const TODAY = new Date().toISOString().slice(0, 10)

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/app', changefreq: 'monthly', priority: '0.8' },
  { path: '/agb/', changefreq: 'monthly', priority: '0.5' },
  { path: '/transparenz/', changefreq: 'monthly', priority: '0.5' },
  { path: '/datenschutz/', changefreq: 'monthly', priority: '0.5' },
  { path: '/impressum/', changefreq: 'monthly', priority: '0.5' },
]

const SKIP_USERNAMES = new Set(['applereview', 'reviewbot', 'test', 'demo', 'rewrite'])

// Test-/E2E-Accounts raus (kein SEO-Wert, würden sonst die Sitemap verwässern).
function isTestAccount(n) {
  const low = n.toLowerCase()
  if (/^e2e/.test(low)) return true            // e2etest..., e2ever..., e2epost...
  if (/\d{10,}$/.test(low)) return true        // Timestamp-Suffix: bomb1780..., grace1780...
  if (/^user_[0-9a-f]{6,}$/.test(low)) return true // anonyme user_<hash>
  return false
}

function isSafe(n) {
  if (!n) return false
  if (n.length < 2 || n.length > 60) return false
  // Only ASCII letters, digits, dot, underscore, hyphen
  return /^[A-Za-z0-9._-]+$/.test(n)
}

async function fetchUsers() {
  const r = await fetch(`${SB}/functions/v1/public-users-list`, {
    headers: { apikey: PUB, Authorization: `Bearer ${PUB}` },
  })
  if (!r.ok) throw new Error(`public-users-list ${r.status}`)
  return await r.json()
}

async function fetchPodcasts() {
  // Falls die Tabelle anon-readable ist
  const r = await fetch(
    `${SB}/rest/v1/podcasts?select=id&is_verified=eq.true&deleted_at=is.null&limit=200`,
    { headers: { apikey: PUB } }
  )
  if (!r.ok) return []
  try { return await r.json() } catch { return [] }
}

function urlBlock(loc, freq, prio) {
  return `  <url><loc>${loc}</loc><lastmod>${TODAY}</lastmod><changefreq>${freq}</changefreq><priority>${prio}</priority></url>`
}

async function main() {
  const users = await fetchUsers().catch(e => {
    console.error('Users fetch fail:', e.message)
    return []
  })

  // Filter + dedupe
  const seen = new Set()
  const userPaths = []
  for (const u of users) {
    const n = (u.username || '').trim()
    if (!isSafe(n)) continue
    if (SKIP_USERNAMES.has(n.toLowerCase())) continue
    if (isTestAccount(n)) continue
    if (seen.has(n.toLowerCase())) continue
    seen.add(n.toLowerCase())
    userPaths.push(n)
  }

  const podcasts = await fetchPodcasts().catch(() => [])

  const lines = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

  for (const p of STATIC_PAGES) {
    lines.push(urlBlock(`https://hozd.app${p.path}`, p.changefreq, p.priority))
  }

  for (const n of userPaths) {
    lines.push(urlBlock(`https://hozd.app/u/${encodeURIComponent(n)}`, 'weekly', '0.7'))
  }

  // Podcast-Detail-Pages (falls /podcast/[id] gerendert wird)
  for (const p of podcasts) {
    if (p && p.id) lines.push(urlBlock(`https://hozd.app/podcast/${p.id}`, 'weekly', '0.6'))
  }

  lines.push('</urlset>')
  const xml = lines.join('\n') + '\n'
  writeFileSync(OUT, xml)

  console.log(`Wrote ${OUT}`)
  console.log(`  ${STATIC_PAGES.length} static pages`)
  console.log(`  ${userPaths.length} user profiles`)
  console.log(`  ${podcasts.length} podcasts`)
  console.log(`  TOTAL: ${STATIC_PAGES.length + userPaths.length + podcasts.length} URLs`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
