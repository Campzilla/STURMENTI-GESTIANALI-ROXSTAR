// sync.js
/**
 * Integrazione storage offline + Supabase Realtime.
 * Espone API: list, upsert, remove, subscribe con compat layer su tabella 'notes'.
 */
import { logError, logEvent } from './logger.js';

let cachedConfig = null;

// Utente corrente (username) per scoping client-side dei dati
function getCurrentUser() {
  try {
    const raw = localStorage.getItem('roxstar_auth_user') || sessionStorage.getItem('roxstar_auth_user');
    const u = JSON.parse(raw || '{}');
    return (u && u.username) ? String(u.username) : null;
  } catch {
    return null;
  }
}

export async function getConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) { cachedConfig = await res.json(); return cachedConfig; }
  } catch {}
  try {
    const res = await fetch('./config.example.json', { cache: 'no-store' });
    if (res.ok) { cachedConfig = await res.json(); return cachedConfig; }
  } catch (e) {
    logError('config_load_failed', e);
  }
  return {};
}

// ===== Supabase client (lazy) =====
let supabaseClient = null;
function isPlaceholder(v) {
  return typeof v === 'string' && /^\s*\$\{[A-Za-z0-9_]+\}\s*$/.test(v);
}
function looksLikeJwt(s) {
  return typeof s === 'string' && s.split('.').length === 3 && s.length > 80;
}
function hasValidSupabaseConfig(cfg) {
  const url = cfg?.supabase?.url?.trim();
  const key = (cfg?.supabase?.anonKey?.trim?.() || cfg?.supabase?.anon_key?.trim?.());
  if (!url || !key) return false;
  const badToken = /YOUR_|REPLACE|CHANGEME|EXAMPLE/i;
  if (isPlaceholder(url) || isPlaceholder(key)) return false;
  if (badToken.test(url) || badToken.test(key)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (!/\.supabase\.co/i.test(url)) return false;
  if (!looksLikeJwt(key)) return false;
  return true;
}
export async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const cfg = await getConfig();
  const realtimeEnabled = cfg?.realtime?.enabled !== false;
  if (!realtimeEnabled || !hasValidSupabaseConfig(cfg)) return null; // offline mode
  // Import robusto con più CDN
  let createClient;
  try {
    ({ createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'));
  } catch {
    try {
      ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2'));
    } catch {
      ({ createClient } = await import('https://unpkg.com/@supabase/supabase-js@2.47.10/+esm'));
    }
  }
  const url = cfg.supabase.url;
  const key = cfg.supabase.anonKey || cfg.supabase.anon_key;
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

// ===== Persistenza OFFLINE (LocalStorage) =====
const LS_PREFIX = 'roxstar_table_';
function lsKey(table){ const me = getCurrentUser(); return me ? `${LS_PREFIX}${me}_${table}` : `${LS_PREFIX}${table}`; }
function readOffline(table){
  try { return JSON.parse(localStorage.getItem(lsKey(table)) || '[]'); } catch { return []; }
}
function writeOffline(table, rows){
  try { localStorage.setItem(lsKey(table), JSON.stringify(rows)); } catch {}
}

// Tombstones per gestire cancellazioni offline/idempotenti
const TS_PREFIX = 'roxstar_tombstones_';
function tsKey(table){ const me = getCurrentUser(); return me ? `${TS_PREFIX}${me}_${table}` : `${TS_PREFIX}${table}`; }
function readTombstones(table){
  try { return (JSON.parse(localStorage.getItem(tsKey(table)) || '[]') || []).filter(x => x && x.id); } catch { return []; }
}
function writeTombstones(table, arr){ try { localStorage.setItem(tsKey(table), JSON.stringify(arr)); } catch {} }
const TS_TTL = 1000 * 60 * 60 * 24; // 24h
function isTombstoned(table, id){
  if (!id) return false;
  const now = Date.now();
  const arr = readTombstones(table).filter(x => (now - (x.ts || 0)) < TS_TTL);
  if (arr.length !== readTombstones(table).length) writeTombstones(table, arr);
  return !!arr.find(x => x.id === id);
}
function addTombstone(table, id){
  if (!id) return;
  const now = Date.now();
  const arr = readTombstones(table).filter(x => (now - (x.ts || 0)) < TS_TTL && x.id !== id);
  arr.push({ id, ts: now });
  writeTombstones(table, arr);
}
function clearTombstone(table, id){
  if (!id) return;
  const now = Date.now();
  const arr = readTombstones(table).filter(x => (now - (x.ts || 0)) < TS_TTL && x.id !== id);
  writeTombstones(table, arr);
}
export { isTombstoned };

function upsertOffline(table, values){
  const arr = Array.isArray(values) ? values : [values];
  const existing = readOffline(table);
  const byId = new Map(existing.map(r => [r.id, r]));
  arr.forEach(r => { if (r && r.id) byId.set(r.id, { ...byId.get(r.id), ...r }); });
  const merged = Array.from(byId.values());
  writeOffline(table, merged);
  return merged;
}
function removeOffline(table, match){
  const existing = readOffline(table);
  let filtered = existing;
  if (match && match.all === true) {
    filtered = [];
  } else if (match && match.id) {
    filtered = existing.filter(r => r.id !== match.id);
  }
  writeOffline(table, filtered);
  return filtered;
}

// ===== Compat layer: mappa documents/checklist su 'notes' =====
const DOC_MARK = '__DOC__:'; // title prefisso per documents
const CHK_MARK = '__CHK__:'; // title prefisso per checklist, seguito da `${docId}|`
const DOCMETA_PREFIX = 'docmeta_';
function docMetaRemoteId(docId){ return `${DOCMETA_PREFIX}${docId}`; }
function isChecklistTable(t){ return /^checklist(_.+)?$/.test(t); }
function docIdFromTable(t){ return t === 'checklist' ? 'fixed_list' : t.replace(/^checklist_/, ''); }
function toRemoteRows(table, arr){
  const owner = getCurrentUser();
  if (table === 'documents') {
    return arr.map(r => ({ id: docMetaRemoteId(r.id), title: `${DOC_MARK}${r.title || ''}`, body: JSON.stringify({ type: r?.type || 'note', docId: r.id, owner }) }));
  }
  if (isChecklistTable(table)) {
    const dId = docIdFromTable(table);
    return arr.map(r => {
      const text = (r || {}).text || '';
      const checked = !!(r || {}).checked;
      const column = (r || {}).column || 'left';
      const fixed = !!(r || {}).fixed;
      return { id: r.id, title: `${CHK_MARK}${dId}|${text}`, body: JSON.stringify({ checked, column, fixed, owner }) };
    });
  }
  return arr;
}
function fromRemoteRows(table, rows){
  const me = getCurrentUser();
  if (table === 'documents') {
    const filtered = rows.filter(r => {
      let o = null;
      try { o = (JSON.parse(r.body || '{}') || {}).owner || null; } catch {}
      if (!me) return true; // fallback se non autenticato
      return o === me;      // mostra solo i miei documenti
    });
    return filtered.map(r => {
      let type = 'note';
      let docId = null;
      try { const parsed = JSON.parse(r.body || '{}') || {}; type = parsed?.type || 'note'; docId = parsed?.docId || null; } catch {}
      const title = (r.title || '').startsWith(DOC_MARK) ? r.title.slice(DOC_MARK.length) : (r.title || '');
      const id = docId || (String(r.id || '').startsWith(DOCMETA_PREFIX) ? String(r.id).slice(DOCMETA_PREFIX.length) : r.id);
      return { id, title, type };
    });
  }
  if (isChecklistTable(table)) {
    const dId = docIdFromTable(table);
    return rows
      .filter(r => (r.title || '').startsWith(`${CHK_MARK}${dId}|`))
      .filter(r => { let o = null; try { o = (JSON.parse(r.body || '{}') || {}).owner || null; } catch {}; if (!me) return true; return o === me; })
      .map(r => {
        const raw = r.title || '';
        const sep = raw.indexOf('|');
        const text = sep >= 0 ? raw.slice(sep + 1) : raw;
        let meta = { checked: false, column: 'left', fixed: false };
        try { meta = { ...meta, ...(JSON.parse(r.body || '{}') || {}) }; } catch {}
        return { id: r.id, text, checked: !!meta.checked, column: meta.column || 'left', fixed: !!meta.fixed };
      });
  }
  return rows;
}

// ===== API =====
export async function list(table) {
  const sb = await getSupabase();
  try { logEvent('sync', 'list', { table, online: !!sb }); } catch {}
  if (!sb) {
    // offline
    const rows = readOffline(table);
    return Array.isArray(rows) ? rows : [];
  }
  const isChecklist = isChecklistTable(table);
  const isDocuments = table === 'documents';
  const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
  try {
    let query = sb.from(remoteTable).select('*');
    if (isDocuments) {
      query = query.like('title', `${DOC_MARK}%`);
    } else if (isChecklist) {
      const dId = docIdFromTable(table);
      query = query.like('title', `${CHK_MARK}${dId}|%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    const arr = Array.isArray(data) ? data : [];
    if (isDocuments || isChecklist) {
      return fromRemoteRows(table, arr);
    }
    return arr;
  } catch (e) {
    logError('list_failed', e, { table });
    const rows = readOffline(table);
    return Array.isArray(rows) ? rows : [];
  }
}

export async function upsert(table, values) {
  const arr = Array.isArray(values) ? values : [values];
  const sb = await getSupabase();
  try { logEvent('sync', 'upsert', { table, count: arr.length, online: !!sb }); } catch {}
  // Prima aggiorno offline per responsività
  const updatedLocal = upsertOffline(table, arr);
  // Pulisci eventuale tombstone
  arr.forEach(r => clearTombstone(table, r?.id));

  if (!sb) return updatedLocal;
  const isChecklist = isChecklistTable(table);
  const isDocuments = table === 'documents';
  const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
  const rows = (isChecklist || isDocuments) ? toRemoteRows(table, arr) : arr;
  try {
    const { error } = await sb.from(remoteTable).upsert(rows);
    if (error) throw error;
  } catch (e) {
    logError('upsert_failed', e, { table, count: arr.length });
  }
  return updatedLocal;
}

export async function remove(table, match) {
  const sb = await getSupabase();
  const id = match?.id;
  try { logEvent('sync', 'remove', { table, id, online: !!sb }); } catch {}
  // Gestione tombstone per evitare re-introduzioni
  if (id) addTombstone(table, id);
  // Aggiorna offline subito
  const afterLocal = removeOffline(table, match);

  if (!sb) return afterLocal;
  const isChecklist = isChecklistTable(table);
  const isDocuments = table === 'documents';
  const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
  if (id) {
    const remoteId = isDocuments ? docMetaRemoteId(id) : id;
    try {
      const { error } = await sb.from(remoteTable).delete().eq('id', remoteId);
      if (error) throw error;
    } catch (e) {
      logError('remove_failed', e, { table, id });
    }
  } else if (match && match.all === true) {
    try {
      const { error } = await sb.from(remoteTable).delete().neq('id', '__never__');
      if (error) throw error;
    } catch (e) {
      logError('remove_all_failed', e, { table });
    }
  }
  return afterLocal;
}

// Recupera una singola riga per id (rispetta il compat layer e funziona anche offline)
export async function getById(table, id) {
  if (!id) return null;
  const sb = await getSupabase();
  const isChecklist = isChecklistTable(table);
  const isDocuments = table === 'documents';
  const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
  if (!sb) {
    // offline
    const rows = readOffline(table) || [];
    const found = rows.find(r => r && r.id === id) || null;
    return found || null;
  }
  try {
    const remoteId = isDocuments ? docMetaRemoteId(id) : id;
    const { data, error } = await sb.from(remoteTable).select('*').eq('id', remoteId).limit(1);
    if (error) throw error;
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) return null;
    if (isDocuments || isChecklist) {
      const mapped = fromRemoteRows(table, arr);
      return mapped && mapped[0] ? mapped[0] : null;
    }
    return arr[0] || null;
  } catch (e) {
    logError('getById_failed', e, { table, id });
    const rows = readOffline(table) || [];
    return rows.find(r => r && r.id === id) || null;
  }
}

export async function subscribe(table, callback) {
  const sb = await getSupabase();
  const isChecklist = isChecklistTable(table);
  const isDocuments = table === 'documents';
  const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;

  if (!sb) {
    // Offline: nessun realtime, ritorno un unsubscribe no-op
    try { logEvent('sync', 'subscribe_offline', { table }); } catch {}
    return async () => {};
  }

  // const me = getCurrentUser(); // Non catturare qui: calcolare dinamicamente per ogni evento
  const dId = isChecklist ? docIdFromTable(table) : null;
  const channel = sb.channel(`public:${remoteTable}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: remoteTable }, (payload) => {
      try {
        const newRow = payload?.new || null;
        const oldRow = payload?.old || null;
        const title = (newRow?.title || oldRow?.title || '') || '';
        if (isDocuments) {
          if (!title.startsWith(DOC_MARK)) return;
        }
        if (isChecklist) {
          if (!title.startsWith(`${CHK_MARK}${dId}|`)) return;
        }
        // Filtra per owner (dinamico per evento)
        const me = getCurrentUser();
        const ownerNew = (() => { try { return (JSON.parse(newRow?.body || '{}') || {}).owner || null; } catch { return null; } })();
        const ownerOld = (() => { try { return (JSON.parse(oldRow?.body || '{}') || {}).owner || null; } catch { return null; } })();
        const owner = ownerNew != null ? ownerNew : ownerOld;
        if (me && owner && owner !== me) return;
        // Filtra eventi checklist tombstoned
        if (isChecklist) {
          const itemId = newRow?.id || oldRow?.id;
          if (isTombstoned(table, itemId)) return;
        }
        callback(payload);
      } catch {}
    })
    .subscribe();

  return async () => { try { await sb.removeChannel(channel); } catch {} };
}

// Pulisce completamente le tabelle offline e i tombstones per un sottoinsieme di tabelle logiche (per l’utente corrente)
export async function clearAllForUser(tables = ['documents']) {
  try {
    const me = getCurrentUser();
    const lsKeys = [];
    const tsKeys = [];
    for (const t of tables) {
      const lkey = me ? `roxstar_table_${me}_${t}` : `roxstar_table_${t}`;
      const tkey = me ? `roxstar_tombstones_${me}_${t}` : `roxstar_tombstones_${t}`;
      lsKeys.push(lkey);
      tsKeys.push(tkey);
      // per le checklist legate ai documenti, elimina anche roxstar_table_${me}_checklist_* e relativi tombstones
      if (t === 'documents') {
        const allKeys = Object.keys(localStorage);
        for (const k of allKeys) {
          if (me && k.startsWith(`roxstar_table_${me}_checklist_`)) localStorage.removeItem(k);
          else if (!me && k.startsWith('roxstar_table_checklist_')) localStorage.removeItem(k);
          if (me && k.startsWith(`roxstar_tombstones_${me}_checklist_`)) localStorage.removeItem(k);
          else if (!me && k.startsWith('roxstar_tombstones_checklist_')) localStorage.removeItem(k);
        }
      }
    }
    for (const k of lsKeys) localStorage.removeItem(k);
    for (const k of tsKeys) localStorage.removeItem(k);
    try { logEvent('sync', 'clear_all_for_user', { me, tables }); } catch {}
  } catch (e) {
    logError('clear_all_for_user_failed', e);
  }
}