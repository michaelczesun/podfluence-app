// Shared Supabase Client für hozd.app (Login + CRM)
// Anon-Key ist publishable → kein Geheimnis.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://nlgedaxiailhhcmgtmdp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_aJrojJ8QFI0uCETwimeRLw_-ymYCVw_';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
    storageKey: 'hozd-auth',
  },
});

// Alias damit alle 33 Panel-Module `import { sb } from '/lib/supabase.js'`
// nutzen können (war so im Workflow vereinbart, ohne diese Export-Zeile
// hängt das CRM bei "Lädt..." weil dynamic import scheitert).
export const sb = supabase;

/** Liefert {session, user, isAdmin} oder null wenn nicht eingeloggt. */
export async function currentUserContext() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const userId = session.user.id;
  // is_app_admin direkt aus users-Tabelle (RLS muss SELECT auf eigene Row erlauben)
  let isAdmin = false;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('is_app_admin, username, is_verified')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) isAdmin = !!data.is_app_admin;
    return { session, user: session.user, profile: data || null, isAdmin };
  } catch (e) {
    return { session, user: session.user, profile: null, isAdmin };
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Auth-Guard: rufe oben in <script> auf. opts={requireAdmin:bool} */
export async function guard(opts = {}) {
  const ctx = await currentUserContext();
  if (!ctx) {
    window.location.href = '/login/';
    return null;
  }
  if (opts.requireAdmin && !ctx.isAdmin) {
    window.location.href = '/app/';
    return null;
  }
  return ctx;
}
