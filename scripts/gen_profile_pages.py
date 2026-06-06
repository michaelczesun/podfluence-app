#!/usr/bin/env python3
"""Static-HTML Generator für /u/<username>/index.html + sitemap.xml.

Liest User-JSON aus /tmp/hozd_users.json (von der GitHub-Action befüllt
via public-users-list Edge-Function — nur whitelisted Public-Felder).
"""
import json
import os
import html

OUT_DIR = 'u'
SHARED_HTML = open(f'{OUT_DIR}/index.html').read()

with open('/tmp/hozd_users.json') as f:
    users = json.load(f)

created = 0
for u in users:
    username = (u.get('username') or '').strip()
    if not username:
        continue
    full_name = (u.get('full_name') or username).strip()
    bio = (u.get('bio') or '').strip()
    avatar = (u.get('avatar_url') or '').strip()
    user_type = u.get('type') or 'user'
    type_label = {
        'podcaster': 'Podcaster:in',
        'listener': 'Hörer:in',
        'bot': 'hozd-Bot',
    }.get(user_type, '')
    country = (u.get('country') or '').strip()
    is_verified = bool(u.get('is_verified'))

    title = f"{full_name} (@{username}) · hozd"
    desc_parts = []
    if type_label:
        desc_parts.append(type_label)
    if country:
        desc_parts.append(f"📍 {country}")
    if is_verified:
        desc_parts.append('✓ verifiziert')
    if username == 'michaelczesun':
        desc_parts.append('👑 Founder')
    if bio:
        desc = (
            f"{bio[:140]}{'…' if len(bio) > 140 else ''} · "
            + (' · '.join(desc_parts) if desc_parts else 'hozd')
        )
    else:
        desc = (
            (' · '.join(desc_parts) + ' auf hozd — die soziale Podcast-App')
            if desc_parts
            else f'{full_name} auf hozd'
        )

    og_image = avatar if avatar else 'https://hozd.app/og-default.png'

    h = SHARED_HTML
    h = h.replace(
        '<title id="page-title">hozd — Profil</title>',
        f'<title id="page-title">{html.escape(title)}</title>',
    )
    h = h.replace(
        '<meta name="description" id="page-desc" content="hozd — die soziale Podcast-App"/>',
        f'<meta name="description" id="page-desc" content="{html.escape(desc)}"/>',
    )
    h = h.replace(
        '<meta property="og:title" content="hozd — Profil"/>',
        f'<meta property="og:title" content="{html.escape(title)}"/>',
    )
    h = h.replace(
        '<meta property="og:description" content="Read-only Profil-Ansicht. App laden für Follow + Posten."/>',
        f'<meta property="og:description" content="{html.escape(desc)}"/>',
    )
    h = h.replace(
        '<meta property="og:image" content="https://hozd.app/og-default.png"/>',
        f'<meta property="og:image" content="{html.escape(og_image)}"/>',
    )
    # JSON-LD Person Schema
    person_ld = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        'name': full_name,
        'alternateName': f'@{username}',
        'url': f'https://hozd.app/u/{username}',
        'description': bio or f'{full_name} auf hozd',
    }
    if avatar:
        person_ld['image'] = avatar
    if country:
        person_ld['nationality'] = country
    person_ld_json = json.dumps(person_ld, ensure_ascii=False)
    twitter_inject = (
        f'<meta name="twitter:card" content="summary"/>\n'
        f'<meta name="twitter:title" content="{html.escape(title)}"/>\n'
        f'<meta name="twitter:description" content="{html.escape(desc)}"/>\n'
        f'<meta name="twitter:image" content="{html.escape(og_image)}"/>\n'
        f'<link rel="canonical" href="https://hozd.app/u/{html.escape(username)}"/>\n'
        f'<script type="application/ld+json">{person_ld_json}</script>'
    )
    h = h.replace(
        '<meta name="twitter:card" content="summary_large_image"/>',
        twitter_inject,
    )
    h = h.replace(
        '  var username = getUsername();',
        f"  var username = '{username}'; // baked at generation time",
    )

    user_dir = f'{OUT_DIR}/{username}'
    os.makedirs(user_dir, exist_ok=True)
    with open(f'{user_dir}/index.html', 'w') as f:
        f.write(h)
    created += 1

# Sitemap
with open('sitemap.xml', 'w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    f.write('  <url><loc>https://hozd.app/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n')
    for u in users:
        uname = u.get('username') or ''
        if uname:
            f.write(
                f'  <url><loc>https://hozd.app/u/{uname}</loc>'
                f'<changefreq>weekly</changefreq><priority>0.7</priority></url>\n'
            )
    f.write('</urlset>\n')

print(f'Generated {created} profile HTMLs + sitemap.xml')
