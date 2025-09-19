// sync.js
/**
 * Integrazione Supabase Realtime e caricamento config.
 * Fornisce helper CRUD e subscription; qui si carica config.json se presente, altrimenti config.example.json come fallback.
 */
import { logError, logEvent } from './logger.js';

let cachedConfig = null;

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

// Lazy import del client Supabase solo quando necessario
let supabaseClient = null;
let supabaseDisabled = false; // circuit breaker: mantenuto ma non viene più attivato nei fallback
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
  // Niente short-circuit: proviamo a creare il client ad ogni chiamata finché non riusciamo
  if (supabaseClient) return supabaseClient;
  const cfg = await getConfig();
  // Abilita Supabase di default, salvo esplicito realtime.enabled === false
  const realtimeEnabled = cfg?.realtime?.enabled !== false;
  if (!realtimeEnabled || !hasValidSupabaseConfig(cfg)) {
    return null; // modalità offline se non configurato o esplicitamente disattivato
  }
  // Import robusto con più CDN compatibili con mobile
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
function lsKey(table){ return `${LS_PREFIX}${table}`; }
function readOffline(table){
  try { return JSON.parse(localStorage.getItem(lsKey(table)) || '[]'); } catch { return []; }
}
function writeOffline(table, rows){
  try { localStorage.setItem(lsKey(table), JSON.stringify(rows)); } catch {}
}

// Tombstones per gestire cancellazioni offline/idempotenti
const TS_PREFIX = 'roxstar_tombstones_';
function tsKey(table){ return `${TS_PREFIX}${table}`; }
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
  if (table === 'documents') {
    return arr.map(r => ({ id: docMetaRemoteId(r.id), title: `${DOC_MARK}${r.title || ''}`, body: JSON.stringify({ type: r?.type || 'note', docId: r.id }) }));
  }
  if (isChecklistTable(table)) {
    const dId = docIdFromTable(table);
    return arr.map(r => {
      const text = (r || {}).text || '';
      const checked = !!(r || {}).checked;
      const column = (r || {}).column || 'left';
      const fixed = !!(r || {}).fixed;
      return { id: r.id, title: `${CHK_MARK}${dId}|${text}`, body: JSON.stringify({ checked, column, fixed }) };
    });
  }
  return arr;
}
function fromRemoteRows(table, rows){
  if (table === 'documents') {
    return rows.map(r => {
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

// Helpers di base per tabella generica
export async function upsert(table, values) {
  try {
    const sb = await getSupabase();
    const arr = Array.isArray(values) ? values : [values];
    // Annulla eventuali tombstones per gli id che si stanno re-inserendo
    try { arr.forEach(r => { if (r && r.id) clearTombstone(table, r.id); }); } catch {}
    const isChecklist = isChecklistTable(table);
    const isDocuments = table === 'documents';
    const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
    const toRemote = (isChecklist || isDocuments) ? toRemoteRows(table, arr) : arr;
    if (!sb) {
      const data = upsertOffline(table, values);
      logEvent('sync', 'upsert_offline', { table, count: Array.isArray(values) ? values.length : 1 });
      return { data, error: null };
    }
    const { data, error } = await sb.from(remoteTable).upsert(toRemote).select();
    if (error) throw error;
    // Cleanup legacy meta rows (pre-fix) che usavano id uguale alla nota
    if (isDocuments) {
      try {
        for (const r of arr) {
          if (r && r.id) {
            await sb.from('notes').delete().eq('id', r.id).like('title', `${DOC_MARK}%`);
          }
        }
      } catch {}
    }
    const mapped = (isChecklist || isDocuments) ? fromRemoteRows(table, data || []) : (data || []);
    return { data: mapped, error: null };
  } catch (e) {
    // Degrada in offline senza disattivare definitivamente Supabase
    const data = upsertOffline(table, values);
    logEvent('sync', 'upsert_offline_fallback', { table, reason: e?.message });
    return { data, error: null };
  }
}

export async function remove(table, match) {
  try {
    const sb = await getSupabase();
    const isChecklist = isChecklistTable(table);
    const isDocuments = table === 'documents';
    const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
    if (!sb) {
      const data = removeOffline(table, match);
      if (match?.id) addTombstone(table, match.id);
      logEvent('sync', 'delete_offline', { table, match });
      return { data, error: null };
    }
    let query = sb.from(remoteTable).delete();
    if (match?.id) {
      if (isDocuments) {
        // delete meta nuova
        query = query.eq('id', docMetaRemoteId(match.id));
      } else {
        query = query.eq('id', match.id);
      }
    } else if (isChecklist && match?.all === true) {
      const dId = docIdFromTable(table);
      const prefix = `${CHK_MARK}${dId}|`;
      query = query.like('title', `${prefix}%`);
    } else if (isDocuments && match?.all === true) {
      // protezione: non consentire delete-all del catalogo documenti
      throw new Error('Refuse to delete-all on documents');
    }
    const { data, error } = await query.select();
    if (error) throw error;
    // cleanup meta legacy (pre-fix)
    if (isDocuments && match?.id) {
      try { await sb.from('notes').delete().eq('id', match.id).like('title', `${DOC_MARK}%`); } catch {}
    }
    if (match?.id) addTombstone(table, match.id);
    // se match.all su checklist, svuota anche l’offline
    if (isChecklist && match?.all === true) { try { writeOffline(table, []); } catch {} }
    const mapped = (isChecklist || isDocuments) ? fromRemoteRows(table, data || []) : (data || []);
    return { data: mapped, error: null };
  } catch (e) {
    const data = removeOffline(table, match);
    if (match?.id) addTombstone(table, match.id);
    logEvent('sync', 'delete_offline_fallback', { table, reason: e?.message, match });
    return { data, error: null };
  }
}

export async function list(table, match = null) {
  try {
    const sb = await getSupabase();
    const isChecklist = isChecklistTable(table);
    const isDocuments = table === 'documents';
    const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
    const dId = isChecklist ? docIdFromTable(table) : null;
    if (!sb) {
      const rows = readOffline(table);
      const filtered = rows.filter(r => !isTombstoned(table, r?.id));
      if (!match) return filtered;
      // filtro semplice lato client
      return filtered.filter(r => Object.entries(match).every(([k, v]) => r[k] === v));
    }
    let query = sb.from(remoteTable).select('*');
    if (isDocuments) {
      query = query.like('title', `${DOC_MARK}%`);
    } else if (isChecklist) {
      query = query.like('title', `${CHK_MARK}${dId}|%`);
    } else if (table === 'notes') {
      // Escludi righe "tecniche" usate per compat layer
      query = query
        .not('title', 'like', `${DOC_MARK}%`)
        .not('title', 'like', `${CHK_MARK}%`);
    }
    if (match && Object.keys(match).length && !isChecklist && !isDocuments) {
      query = query.match(match);
    }
    const { data, error } = await query;
    if (error) throw error;
    const mapped = (isChecklist || isDocuments) ? fromRemoteRows(table, data || []) : (data || []);
    return mapped.filter(r => !isTombstoned(table, r?.id));
  } catch (e) {
    logEvent('sync', 'list_offline_fallback', { table, reason: e?.message });
    return readOffline(table).filter(r => !isTombstoned(table, r?.id));
  }
}

export async function getById(table, id) {
  try {
    const sb = await getSupabase();
    const isChecklist = isChecklistTable(table);
    const isDocuments = table === 'documents';
    const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
    const dId = isChecklist ? docIdFromTable(table) : null;
    if (!sb) {
      const rows = readOffline(table);
      return rows.find(r => r.id === id) || null;
    }
    let query = sb.from(remoteTable).select('*');
    if (isDocuments) {
      query = query.eq('id', docMetaRemoteId(id));
    } else if (isChecklist) {
      query = query.like('title', `${CHK_MARK}${dId}|%`).eq('id', id);
    } else {
      // plain notes: escludi righe tecniche eventualmente rimaste
      query = query.eq('id', id)
        .not('title', 'like', `${DOC_MARK}%`)
        .not('title', 'like', `${CHK_MARK}%`);
    }
    const { data, error } = await (query.maybeSingle?.() ?? query.single());
    if (error) throw error;
    const mapped = (isChecklist || isDocuments) ? fromRemoteRows(table, data ? [data] : []) : (data ? [data] : []);
    return mapped[0] || null;
  } catch (e) {
    logEvent('sync', 'getById_offline_fallback', { table, reason: e?.message, id });
    const rows = readOffline(table);
    return rows.find(r => r.id === id) || null;
  }
}

export async function subscribe(table, callback) {
  try {
    const sb = await getSupabase();
    if (!sb) return () => {};
    const isChecklist = isChecklistTable(table);
    const isDocuments = table === 'documents';
    const remoteTable = (isChecklist || isDocuments) ? 'notes' : table;
    const dId = isChecklist ? docIdFromTable(table) : null;
    const channelName = `table:${remoteTable}`;
    const ch = sb.channel(channelName);
    const params = { event: '*', schema: 'public', table: remoteTable };
    ch.on('postgres_changes', params, payload => {
      const t = payload?.new?.title || payload?.old?.title || '';
      const evt = payload?.eventType || payload?.event;
      // NOTA: per 'notes' filtriamo i "tecnici" e inoltriamo raw
      if (table === 'notes') {
        if (t.startsWith(DOC_MARK) || t.startsWith(CHK_MARK)) return;
        return callback(payload);
      }
      // documents: mappo su id locale e shape locale
      if (isDocuments) {
        if (!t.startsWith(DOC_MARK)) return; // solo documents
        const mappedNew = payload?.new ? fromRemoteRows('documents', [payload.new])[0] : null;
        const mappedOld = payload?.old ? fromRemoteRows('documents', [payload.old])[0] : null;
        const localId = (mappedNew && mappedNew.id) || (mappedOld && mappedOld.id) || null;
        if (localId && isTombstoned(table, localId) && evt !== 'DELETE') return; // filtra reintroduzioni
        return callback({ ...payload, new: mappedNew, old: mappedOld });
      }
      // checklist: filtra per prefisso e mappa le righe
      if (isChecklist) {
        const prefix = `${CHK_MARK}${dId}|`;
        if (!t.startsWith(prefix)) return; // solo checklist del documento target
        const mappedNew = payload?.new ? fromRemoteRows(table, [payload.new])[0] : null;
        const mappedOld = payload?.old ? fromRemoteRows(table, [payload.old])[0] : null;
        const localId = (mappedNew && mappedNew.id) || (mappedOld && mappedOld.id) || null;
        if (localId && isTombstoned(table, localId) && evt !== 'DELETE') return; // filtra reintroduzioni
        return callback({ ...payload, new: mappedNew, old: mappedOld });
      }
      // di default, inoltra
      return callback(payload);
    });
    ch.subscribe();
    return () => sb.removeChannel(ch);
  } catch (e) {
    logEvent('sync', 'subscribe_offline_fallback', { table, reason: e?.message });
    return () => {};
  }
}